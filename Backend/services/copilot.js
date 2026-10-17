const PAGE_SIZE = 400;
const MAX_PAGES = 20;
const STAFF_ROLES = new Set(['OWNER', 'COUNSELOR']);
const FEE_ROLES = new Set(['OWNER', 'ACCOUNTS', 'STUDENT']);
const ATTENDANCE_ROLES = new Set(['OWNER', 'COUNSELOR', 'TRAINER', 'STUDENT']);
const TIMETABLE_ROLES = new Set(['OWNER', 'TRAINER', 'STUDENT']);

async function readAll(db, name, constraints = []) {
  let query = db.collection(name);
  constraints.forEach(({ field, op, value }) => { query = query.where(field, op, value); });
  const records = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let next = query.orderBy('__name__').limit(PAGE_SIZE);
    if (cursor) next = next.startAfter(cursor);
    const snapshot = await next.get();
    records.push(...snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    if (snapshot.size < PAGE_SIZE) return { records, truncated: false };
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
  return { records, truncated: true };
}

async function loadData(db, profile) {
  const { uid, role } = profile;
  const truncated = [];
  const load = async (key, collection, constraints = []) => {
    const result = await readAll(db, collection, constraints);
    if (result.truncated) truncated.push(key);
    return result.records;
  };
  const data = { batches: [], courses: [], enrollments: [], fees: [], attendance: [], sessions: [] };

  if (STAFF_ROLES.has(role)) {
    [data.batches, data.courses, data.enrollments] = await Promise.all([
      load('batches', 'batches'), load('courses', 'courses'), load('enrollments', 'enrollments'),
    ]);
  } else if (role === 'TRAINER') {
    [data.batches, data.enrollments] = await Promise.all([
      load('batches', 'batches', [{ field: 'teacherId', op: '==', value: uid }]),
      load('enrollments', 'enrollments', [{ field: 'teacherId', op: '==', value: uid }, { field: 'status', op: '==', value: 'ACTIVE' }]),
    ]);
    const courseIds = [...new Set(data.batches.map((batch) => batch.courseDocId).filter(Boolean))];
    data.courses = (await Promise.all(courseIds.map(async (id) => {
      const snap = await db.collection('courses').doc(id).get();
      return snap.exists ? { id: snap.id, name: snap.data().name } : null;
    }))).filter(Boolean);
  } else if (role === 'STUDENT') {
    data.enrollments = await load('enrollments', 'enrollments', [{ field: 'studentDocId', op: '==', value: uid }, { field: 'status', op: '==', value: 'ACTIVE' }]);
    const batchIds = [...new Set(data.enrollments.map((item) => item.batchDocId).filter(Boolean))];
    data.batches = (await Promise.all(batchIds.map(async (id) => {
      const snap = await db.collection('batches').doc(id).get();
      return snap.exists ? { id: snap.id, ...snap.data() } : null;
    }))).filter(Boolean);
    const courseIds = [...new Set(data.batches.map((batch) => batch.courseDocId).filter(Boolean))];
    data.courses = (await Promise.all(courseIds.map(async (id) => {
      const snap = await db.collection('courses').doc(id).get();
      return snap.exists ? { id: snap.id, ...snap.data() } : null;
    }))).filter(Boolean);
  } else if (role === 'ACCOUNTS') {
    // Accounts can inspect fee and payment records, but not student rosters.
  }

  if (FEE_ROLES.has(role)) {
    const own = role === 'STUDENT' ? [{ field: 'studentDocId', op: '==', value: uid }] : [];
    data.fees = await load('fees', 'feeRecords', own);
  }
  if (ATTENDANCE_ROLES.has(role)) {
    const scope = role === 'TRAINER' ? [{ field: 'teacherId', op: '==', value: uid }]
      : role === 'STUDENT' ? [{ field: 'studentDocId', op: '==', value: uid }] : [];
    data.attendance = await load('attendance', 'attendanceRecords', scope);
  }
  if (TIMETABLE_ROLES.has(role)) {
    if (role === 'OWNER') data.sessions = await load('sessions', 'timetableSessions');
    else if (role === 'TRAINER') data.sessions = await load('sessions', 'timetableSessions', [{ field: 'teacherId', op: '==', value: uid }]);
    else {
      const ids = [...new Set(data.enrollments.map((item) => item.batchDocId).filter(Boolean))];
      const snapshots = await Promise.all(ids.map((id) => load('sessions', 'timetableSessions', [{ field: 'batchDocId', op: '==', value: id }, { field: 'status', op: '==', value: 'PUBLISHED' }])));
      data.sessions = snapshots.flat();
    }
  }
  data.batches = data.batches.map(({ id, name, batchName, batchId, courseDocId, courseName, weeklyTeachingHours, teacherId }) => ({ id, name, batchName, batchId, courseDocId, courseName, weeklyTeachingHours, teacherId }));
  data.courses = data.courses.map(({ id, name, courseName }) => ({ id, name, courseName }));
  data.enrollments = data.enrollments.map(({ status, studentDocId, batchDocId }) => ({ status, studentDocId, batchDocId }));
  data.fees = data.fees.map(({ studentDocId, batchDocId, amountPaid, remainingBalance }) => ({ studentDocId, batchDocId, amountPaid, remainingBalance }));
  data.attendance = data.attendance.map(({ studentDocId, batchDocId, status }) => ({ studentDocId, batchDocId, status }));
  data.sessions = data.sessions.map(({ id, batchDocId, day, startMinutes, endMinutes, startTime, endTime, durationMinutes, batchName, batchId, roomName, roomId, teacherId, teacherName, status }) => ({ id, batchDocId, day, startMinutes, endMinutes, startTime, endTime, durationMinutes, batchName, batchId, roomName, roomId, teacherId, teacherName, status }));
  return { data, truncated: [...new Set(truncated)] };
}

const money = (amount) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(amount) || 0);
const clockText = (minutes) => Number.isFinite(Number(minutes)) ? new Date(2000, 0, 1, Math.floor(Number(minutes) / 60), Number(minutes) % 60).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '';
const nameOfBatch = (batch) => batch.name || batch.batchName || batch.batchId || batch.id;
const queryText = (question, history = []) => {
  const current = String(question || '').trim();
  if (!/^(only|just|filter|show me|and|what about)\b/i.test(current)) return current;
  const prior = [...history].reverse().find((item) => item.role === 'user' && typeof item.content === 'string');
  return prior ? `${prior.content} ${current}` : current;
};

function summarize(question, history, profile, data, truncated = [], intent = '') {
  const intentTerms = {
    fees: 'fee payment balance', attendance: 'attendance', timetable: 'timetable',
    conflicts: 'timetable conflict', trainer_workload: 'timetable trainer workload',
    missing_hours: 'timetable missing weekly teaching hours', low_enrollment: 'batch low enrollment',
    courses: 'course', attention: 'attention', counts: 'student batch count',
  };
  const normalized = `${queryText(question, history)} ${intentTerms[intent] || ''}`.toLowerCase();
  const matchedBatch = data.batches.find((batch) => {
    const name = String(nameOfBatch(batch) || '').toLowerCase();
    return name.length > 2 && normalized.includes(name);
  });
  const batches = matchedBatch ? data.batches.filter((batch) => batch.id === matchedBatch.id) : data.batches;
  const batchIds = new Set(batches.map((batch) => batch.id));
  const enrollments = data.enrollments.filter((item) => !matchedBatch || batchIds.has(item.batchDocId));
  const fees = data.fees.filter((item) => !matchedBatch || batchIds.has(item.batchDocId));
  const attendance = data.attendance.filter((item) => !matchedBatch || batchIds.has(item.batchDocId));
  const sessions = data.sessions.filter((item) => !matchedBatch || batchIds.has(item.batchDocId));
  const lines = [];
  const title = matchedBatch ? `Scope: ${nameOfBatch(matchedBatch)}` : `Scope: ${profile.role === 'STUDENT' ? 'your account' : profile.role === 'TRAINER' ? 'your assigned batches' : 'institute records'}`;
  if (/\b(delete|remove|modify|change|update|send|publish|cancel|reschedule)\b/.test(normalized) || /\benroll\s+(me|this|the student)\b/.test(normalized)) {
    return { answer: 'This Copilot currently supports read-only questions. It has not changed, deleted, published, or sent anything. Use the relevant EDUPILOT module to make a change.', title, links: [], truncated };
  }
  if (intent === 'write_action') return { answer: 'This Copilot is read-only. It has not created, changed, deleted, approved, enrolled, published, or sent anything. Use the relevant EDUPILOT module to make a change.', title, links: [], truncated };

  if (/fee|payment|balance|collection|paid|due|pending/.test(normalized)) {
    if (!FEE_ROLES.has(profile.role)) return { answer: 'Fee information is not available for your role.', title, links: [], truncated };
    const pending = fees.reduce((sum, item) => sum + (Number(item.remainingBalance) || 0), 0);
    const collected = fees.reduce((sum, item) => sum + (Number(item.amountPaid) || 0), 0);
    const outstandingCount = fees.filter((item) => Number(item.remainingBalance) > 0).length;
    lines.push(`Fee records: ${fees.length}. Outstanding balance: ${money(pending)} across ${outstandingCount} record(s). Recorded payments: ${money(collected)}.`);
    lines.push('Calculated directly from feeRecords.remainingBalance and feeRecords.amountPaid.');
    if (profile.role === 'STUDENT') lines.push('These figures include only your own fee records.');
    return { answer: lines.join('\n\n'), title, links: profile.role === 'STUDENT' ? [{ label: 'Open Student Home', route: 'dashboard' }] : [{ label: 'Open Fees & EMI', route: 'fees' }], truncated };
  }
  if (/attendance|present|absent|late/.test(normalized)) {
    if (!ATTENDANCE_ROLES.has(profile.role)) return { answer: 'Attendance information is not available for your role.', title, links: [], truncated };
    const attended = attendance.filter((item) => ['PRESENT', 'LATE'].includes(item.status)).length;
    const pct = attendance.length ? Math.round((attended / attendance.length) * 100) : null;
    lines.push(`Saved attendance records: ${attendance.length}. Present or late: ${attended}. Recorded-attendance rate: ${pct === null ? 'not available (no records)' : `${pct}%`}.`);
    lines.push('This is based on saved attendanceRecords only; it is not a session-completion or future-attendance estimate.');
    return { answer: lines.join('\n\n'), title, links: [{ label: 'Open Attendance', route: 'attendance' }], truncated };
  }
  if (/timetable|schedule|class|trainer conflict|teaching hours|trainer workload|trainers have the most classes/.test(normalized)) {
    if (!TIMETABLE_ROLES.has(profile.role)) return { answer: 'Timetable information is not available for your role.', title, links: [], truncated };
    const scoped = sessions.filter((session) => profile.role === 'STUDENT' ? session.status === 'PUBLISHED' : true);
    const hours = (session) => Math.max(0, Number(session.durationMinutes || (session.endMinutes - session.startMinutes)) || 0) / 60;
    const weekly = batches.map((batch) => {
      const scheduled = scoped.filter((session) => session.batchDocId === batch.id).reduce((sum, item) => sum + hours(item), 0);
      const required = Number(batch.weeklyTeachingHours) || 0;
      return { batch, scheduled, required };
    });
    const missing = weekly.filter((item) => item.required > item.scheduled);
    if (/tomorrow|today|next week/.test(normalized)) {
      lines.push('EDUPILOT stores recurring weekly timetable sessions. The Copilot cannot confirm date-specific holidays, cancellations, or a particular calendar day yet; open Timetable to review the selected week.');
    } else if (/conflict|overlap|double.?book/.test(normalized)) {
      const conflicts = [];
      for (let left = 0; left < scoped.length; left += 1) for (let right = left + 1; right < scoped.length; right += 1) {
        const a = scoped[left]; const b = scoped[right];
        const startA = Number(a.startMinutes); const endA = Number(a.endMinutes); const startB = Number(b.startMinutes); const endB = Number(b.endMinutes);
        if (a.day !== b.day || !(startA < endB && startB < endA)) continue;
        if (a.batchDocId === b.batchDocId) conflicts.push(`${a.day}: batch ${a.batchName || a.batchDocId} overlaps itself.`);
        else if (a.teacherId && a.teacherId === b.teacherId) conflicts.push(`${a.day}: ${a.teacherName || a.teacherId} is assigned to overlapping sessions.`);
        else if (a.roomId && a.roomId !== 'ONLINE' && a.roomId === b.roomId) conflicts.push(`${a.day}: ${a.roomName || a.roomId} is assigned to overlapping sessions.`);
      }
      lines.push(conflicts.length ? [...new Set(conflicts)].join('\n') : 'No overlapping batch, trainer, or physical-room assignments were found in the authorized session records.');
    } else if (/trainer workload|trainers have the most classes/.test(normalized)) {
      const counts = new Map();
      scoped.forEach((session) => { if (session.teacherId) counts.set(session.teacherName || session.teacherId, (counts.get(session.teacherName || session.teacherId) || 0) + 1); });
      lines.push([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => `${name}: ${count} weekly session(s).`).join('\n') || 'No assigned trainer sessions were found.');
    } else if (/incomplete|missing|why|hours/.test(normalized)) {
      lines.push(missing.length ? missing.map((item) => `${nameOfBatch(item.batch)}: ${item.scheduled} of ${item.required} required weekly hours are scheduled (${item.required - item.scheduled} missing).`).join('\n') : 'No eligible batch in this scope is missing weekly hours based on the loaded sessions and batch requirements.');
    } else {
      const shown = scoped.slice(0, 20).map((session) => `${session.day || 'Day not set'} ${session.startTime || clockText(session.startMinutes)}–${session.endTime || clockText(session.endMinutes)} · ${session.batchName || session.batchId || session.batchDocId || 'Class'} · ${session.roomName || session.roomId || 'Room not set'} · ${session.status || 'status not set'}`.trim());
      lines.push(shown.length ? shown.join('\n') : 'No authorized timetable sessions were found.');
      if (scoped.length > 20) lines.push(`Showing 20 of ${scoped.length} sessions.`);
    }
    lines.push('These are database-backed session and weekly-hours values; this answer does not propose or write a schedule change.');
    return { answer: lines.join('\n\n'), title, links: [{ label: 'Open Timetable', route: 'timetable' }], truncated };
  }
  if (/batch|enroll|student|course|low|few|count|how many|attention|today/.test(normalized)) {
    if (profile.role === 'ACCOUNTS' && /batch|enroll|student|course|low|few/.test(normalized)) return { answer: 'Your Accounts role is limited to authorized fees, balances, and payment records. I cannot retrieve student, batch, or course details for this account.', title, links: [], truncated };
    const activeEnrollments = enrollments.filter((item) => item.status === 'ACTIVE');
    const activeEnrollmentCount = activeEnrollments.length;
    const studentCount = new Set(activeEnrollments.map((item) => item.studentDocId).filter(Boolean)).size;
    const countByBatch = batches.map((batch) => ({ name: nameOfBatch(batch), count: enrollments.filter((item) => item.batchDocId === batch.id && item.status === 'ACTIVE').length }));
    if (/low|few|smaller|under.?enroll/.test(normalized)) {
      const low = countByBatch.filter((item) => item.count <= 5).sort((a, b) => a.count - b.count);
      lines.push(low.length ? low.map((item) => `${item.name}: ${item.count} active enrollment(s).`).join('\n') : 'No batch in this scope has five or fewer active enrollments.');
    } else if (/course/.test(normalized) && !/student/.test(normalized)) {
      lines.push(`Courses available in your permitted scope: ${data.courses.length}.`);
      lines.push(data.courses.map((item) => item.name || item.courseName || item.id).filter(Boolean).join(', ') || 'No course records were found.');
    } else if (/attention|today/.test(normalized) && profile.role === 'ACCOUNTS') {
      const owing = fees.filter((item) => Number(item.remainingBalance) > 0).length;
      const pendingFees = fees.reduce((sum, item) => sum + (Number(item.remainingBalance) || 0), 0);
      lines.push(`${owing} fee record(s) have an outstanding balance of ${money(pendingFees)}. This uses the fee records available to your Accounts role.`);
    } else if (/attention|today/.test(normalized)) {
      const pendingFees = fees.reduce((sum, item) => sum + (Number(item.remainingBalance) || 0), 0);
      const unassigned = batches.filter((item) => !item.teacherId).length;
      lines.push(`Active enrollments: ${activeEnrollmentCount}; batches without a trainer: ${unassigned}; outstanding fees in this role’s scope: ${FEE_ROLES.has(profile.role) ? money(pendingFees) : 'not accessible'}.`);
      lines.push('This summary reports current stored records; it does not infer urgency or claim a live task deadline.');
    } else {
      lines.push(`Batches: ${batches.length}. Students with an active enrollment: ${studentCount}. Active enrollments: ${activeEnrollmentCount}. Courses: ${data.courses.length}.`);
      lines.push(countByBatch.map((item) => `${item.name}: ${item.count} active enrollment(s)`).join('\n') || 'No batch records were found in your permitted scope.');
    }
    const links = profile.role === 'STUDENT' ? [{ label: 'Open Student Home', route: 'dashboard' }]
      : [{ label: 'Open Batches & Courses', route: 'batches' }, ...(profile.role !== 'ACCOUNTS' ? [{ label: 'Open Students', route: 'students' }] : [])];
    return { answer: lines.join('\n\n'), title, links, truncated };
  }
  return {
    answer: 'I can answer data-backed questions about student and batch counts, low-enrollment batches, pending fees, saved attendance, timetable sessions, and incomplete weekly teaching hours. Try one of those, or add a batch name to narrow the scope.',
    title, links: [], truncated,
  };
}

module.exports = { loadData, readAll, summarize };
