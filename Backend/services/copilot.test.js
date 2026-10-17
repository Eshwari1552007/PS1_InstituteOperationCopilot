const test = require('node:test');
const assert = require('node:assert/strict');
const { readAll, summarize } = require('./copilot');

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
