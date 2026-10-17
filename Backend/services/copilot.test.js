const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyIntent, loadData, readAll, summarize } = require('./copilot');

const data = {
  students: [], courses: [{ id: 'course-python', name: 'Python' }],
  batches: [
    { id: 'python-a', name: 'Python Evening', weeklyTeachingHours: 4 },
    { id: 'java-a', name: 'Java Morning', weeklyTeachingHours: 2 },
  ],
  enrollments: [
    { studentDocId: 'student-a', batchDocId: 'python-a', status: 'ACTIVE' },
    { studentDocId: 'student-a', batchDocId: 'python-a', status: 'ACTIVE' },
    { studentDocId: 'student-b', batchDocId: 'java-a', status: 'ACTIVE' },
  ],
  fees: [
    { studentDocId: 'student-a', batchDocId: 'python-a', amountPaid: 200, remainingBalance: 300 },
    { studentDocId: 'student-b', batchDocId: 'java-a', amountPaid: 50, remainingBalance: 0 },
  ],
  attendance: [
    { studentDocId: 'student-a', batchDocId: 'python-a', status: 'PRESENT' },
    { studentDocId: 'student-a', batchDocId: 'python-a', status: 'ABSENT' },
  ],
  sessions: [{ id: 's1', batchDocId: 'python-a', day: 'Tue', startMinutes: 540, endMinutes: 660, durationMinutes: 120, status: 'PUBLISHED' }],
  payments: [],
};

test('paginates large Firestore reads and reports when its documented cap is reached', async () => {
  let cursor = 0;
  let pages = 0;
  const query = {
    where() { return this; }, orderBy() { return this; }, limit() { return this; }, startAfter() { return this; },
    async get() {
      pages += 1;
      const docs = Array.from({ length: Math.min(400, 401 - cursor) }, (_, index) => {
        const id = `doc-${cursor + index}`;
        return { id, data: () => ({ value: id }) };
      });
      cursor += docs.length;
      return { docs, size: docs.length };
    },
  };
  const result = await readAll({ collection: () => query }, 'records');
  assert.equal(result.records.length, 401);
  assert.equal(pages, 2);
  assert.equal(result.truncated, false);
});

test('marks a collection truncated at the 8,000-document safety limit', async () => {
  let nextId = 0;
  const query = {
    where() { return this; }, orderBy() { return this; }, limit() { return this; }, startAfter() { return this; },
    async get() {
      const docs = Array.from({ length: 400 }, () => {
        const id = `doc-${nextId++}`;
        return { id, data: () => ({}) };
      });
      return { docs, size: docs.length };
    },
  };
  const result = await readAll({ collection: () => query }, 'records');
  assert.equal(result.records.length, 8000);
  assert.equal(result.truncated, true);
});

test('calculates fee totals deterministically from fee records', () => {
  const result = summarize('Show pending fees', [], { uid: 'owner', role: 'OWNER' }, data);
  assert.match(result.answer, /Outstanding balance: ₹300/);
  assert.match(result.answer, /Recorded payments: ₹250/);
  assert.equal(result.links[0].route, 'fees');
});

test('student summary is labelled as personal and reports only supplied own records', () => {
  const personal = { ...data, fees: [data.fees[0]], enrollments: [data.enrollments[0]], batches: [data.batches[0]], courses: [data.courses[0]] };
  const result = summarize('Show my pending fees', [], { uid: 'student-a', role: 'STUDENT' }, personal);
  assert.match(result.answer, /only your own fee records/);
  assert.match(result.answer, /₹300/);
  assert.doesNotMatch(result.answer, /Java Morning/);
});

test('follow-up batch filters refine the previous question', () => {
  const result = summarize('Only Python Evening', [{ role: 'user', content: 'Which batches have fewer students?' }], { uid: 'owner', role: 'OWNER' }, data);
  assert.match(result.title, /Python Evening/);
  assert.match(result.answer, /Python Evening: 2 active enrollment/);
  assert.doesNotMatch(result.answer, /Java Morning/);
});

test('timetable answer computes missing hours from session durations and batch requirements', () => {
  const result = summarize('Which batches have incomplete weekly teaching hours?', [], { uid: 'owner', role: 'OWNER' }, data);
  assert.match(result.answer, /Python Evening: 2 of 4 required weekly hours/);
  assert.match(result.answer, /Java Morning: 0 of 2 required weekly hours/);
});

test('reports actual overlapping trainer and room assignments from authorized sessions', () => {
  const collisionData = { ...data, sessions: [
    { id: 's1', batchDocId: 'python-a', day: 'Tue', startMinutes: 540, endMinutes: 660, roomId: 'r1', roomName: 'Room 1', teacherId: 'trainer-1', teacherName: 'Trainer One' },
    { id: 's2', batchDocId: 'java-a', day: 'Tue', startMinutes: 600, endMinutes: 690, roomId: 'r1', roomName: 'Room 1', teacherId: 'trainer-1', teacherName: 'Trainer One' },
  ] };
  const result = summarize('Find timetable conflicts', [], { uid: 'owner', role: 'OWNER' }, collisionData);
  assert.match(result.answer, /Trainer One is assigned to overlapping sessions/);
});

test('roles without permission receive no attendance or fee details', () => {
  const fee = summarize('Show pending fees', [], { uid: 'trainer', role: 'TRAINER' }, data);
  const attendance = summarize('Show attendance', [], { uid: 'accounts', role: 'ACCOUNTS' }, data);
  assert.match(fee.answer, /not available for your role/);
  assert.match(attendance.answer, /not available for your role/);
});

test('counselor Copilot answers never expose fee totals', () => {
  const result = summarize('Show pending fees', [], { uid: 'counselor', role: 'COUNSELOR' }, data);
  assert.match(result.answer, /not available for your role/);
  assert.doesNotMatch(result.answer, /₹300|₹250|Outstanding balance/);
  assert.equal(result.links.length, 0);
});

test('unsupported actions are described without claiming to execute them', () => {
  const result = summarize('Delete the student record', [], { uid: 'owner', role: 'OWNER' }, data);
  assert.match(result.answer, /read-only questions/);
  assert.match(result.answer, /has not changed, deleted/);
});

const DAY_CODES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dateWithOffset = (days) => { const date = new Date(); date.setDate(date.getDate() + days); return date; };
const isoOf = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

test('answers "which lectures are scheduled tomorrow" from the recurring timetable', () => {
  const dayCode = DAY_CODES[dateWithOffset(1).getDay()];
  const dated = {
    ...data,
    batches: [{ id: 'python-a', name: 'Python Evening', weeklyTeachingHours: 4 }],
    sessions: [{ id: 's1', batchDocId: 'python-a', day: dayCode, startMinutes: 540, endMinutes: 660, durationMinutes: 120, roomName: 'Room 1', teacherName: 'Trainer One', status: 'PUBLISHED' }],
  };
  const result = summarize('Which lectures are scheduled tomorrow?', [], { uid: 'owner', role: 'OWNER' }, dated);
  assert.match(result.answer, /1 recurring session\(s\) are scheduled for/);
  assert.match(result.answer, /Python Evening/);
  assert.match(result.answer, /Trainer One/);
  assert.doesNotMatch(result.answer, /read-only questions|not available for your role/);
});

test('tolerates the "tommorow" spelling in a date question', () => {
  const dayCode = DAY_CODES[dateWithOffset(1).getDay()];
  const dated = {
    ...data,
    batches: [{ id: 'python-a', name: 'Python Evening', weeklyTeachingHours: 4 }],
    sessions: [{ id: 's1', batchDocId: 'python-a', day: dayCode, startMinutes: 540, endMinutes: 660, durationMinutes: 120, status: 'PUBLISHED' }],
  };
  const result = summarize('Which are the lectures scheduled tommorow?', [], { uid: 'owner', role: 'OWNER' }, dated);
  assert.match(result.answer, /1 recurring session\(s\) are scheduled for/);
});

test('resolves a named weekday question to that weekday of the recurring timetable', () => {
  const dated = {
    ...data,
    batches: [{ id: 'java-a', name: 'Java Morning', weeklyTeachingHours: 2 }],
    sessions: [{ id: 's2', batchDocId: 'java-a', day: 'Sat', startMinutes: 600, endMinutes: 720, durationMinutes: 120, roomName: 'Room 2', teacherName: 'Trainer Two', status: 'PUBLISHED' }],
  };
  const result = summarize('What lectures are scheduled on Saturday?', [], { uid: 'owner', role: 'OWNER' }, dated);
  assert.match(result.answer, /Saturday/);
  assert.match(result.answer, /Java Morning/);
});

test('excludes recurring sessions whose batch is not active on the requested date', () => {
  const dayCode = DAY_CODES[dateWithOffset(1).getDay()];
  const dated = {
    ...data,
    batches: [{ id: 'python-a', name: 'Python Evening', weeklyTeachingHours: 4, endDate: isoOf(dateWithOffset(-1)) }],
    sessions: [{ id: 's1', batchDocId: 'python-a', day: dayCode, startMinutes: 540, endMinutes: 660, durationMinutes: 120, status: 'PUBLISHED' }],
  };
  const result = summarize('Which lectures are scheduled tomorrow?', [], { uid: 'owner', role: 'OWNER' }, dated);
  assert.match(result.answer, /No recurring timetable session is scheduled/);
});

test('classifies common questions locally without an AI round-trip', () => {
  assert.equal(classifyIntent('Show pending fees'), 'fees');
  assert.equal(classifyIntent('Summarize attendance'), 'attendance');
  assert.equal(classifyIntent('Which lectures are scheduled tomorrow?'), 'timetable');
  assert.equal(classifyIntent('Which batches have fewer students?'), 'low_enrollment');
  assert.equal(classifyIntent('Delete the student record'), 'write_action');
});

// A spy database records which collections a load actually touches so the test can
// prove an answer only pays for the reads it needs.
const spyDb = (touched) => ({
  collection(name) {
    touched.push(name);
    return {
      where() { return this; }, orderBy() { return this; }, limit() { return this; }, startAfter() { return this; },
      async get() { return { docs: [], size: 0 }; },
    };
  },
});

test('a fee question loads only the batches and fee collections', async () => {
  const touched = [];
  await loadData(spyDb(touched), { uid: 'owner', role: 'OWNER' }, 'fees');
  assert.deepEqual(touched.sort(), ['batches', 'feeRecords']);
});

test('a count question loads batches, courses, and enrollments but not the ledgers', async () => {
  const touched = [];
  await loadData(spyDb(touched), { uid: 'owner', role: 'OWNER' }, 'counts');
  assert.deepEqual(touched.sort(), ['batches', 'courses', 'enrollments']);
});

test('an unknown intent falls back to loading every collection', async () => {
  const touched = [];
  await loadData(spyDb(touched), { uid: 'owner', role: 'OWNER' }, '');
  assert.deepEqual(touched.sort(), ['attendanceRecords', 'batches', 'courses', 'enrollments', 'feeRecords', 'timetableSessions']);
});
