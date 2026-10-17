const express = require('express');
const { ATTENDANCE_STATUSES, isDate, occurrenceId, weekdayInZone, zonedTimeToDate } = require('../services/attendance');

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const minuteTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const sessionTime = (session, field, legacyField) => {
  const timestamp = session[field]?.toDate?.() || (field === 'startAt' ? session.sessionAt?.toDate?.() : null);
  if (timestamp) return timestamp.getTime();
  if (!isDate(session.date) || typeof session[legacyField] !== 'string') return null;
  const [hours, minutes] = session[legacyField].split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return zonedTimeToDate(session.date, hours * 60 + minutes, session.timeZone || 'Asia/Kolkata').getTime();
};

function createAttendanceRoutes({ admin, db }) {
  const router = express.Router();
  router.use(async (req, _res, next) => {
    try {
      const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
      if (!match) throw fail(401, 'AUTH_REQUIRED', 'Sign in to manage attendance.');
      const decoded = await admin.auth().verifyIdToken(match[1]);
      const profile = await db.collection('users').doc(decoded.uid).get();
      if (!profile.exists || profile.data().status !== 'APPROVED') throw fail(403, 'ACCOUNT_NOT_APPROVED', 'An approved EDUPILOT account is required.');
      req.identity = { uid: decoded.uid, role: profile.data().role };
      next();
    } catch (error) { if (!error.status) error.status = 401; next(error); }
  });

  const requireAttendanceManager = (req) => {
    if (!['OWNER', 'TRAINER'].includes(req.identity.role)) throw fail(403, 'ROLE_FORBIDDEN', 'Only an Owner or assigned Trainer can take attendance.');
  };
  const requireSessionAccess = (identity, session) => {
    if (identity.role === 'OWNER') return;
    if (identity.role !== 'TRAINER' || session.teacherId !== identity.uid) throw fail(403, 'SESSION_FORBIDDEN', 'You are not assigned to this scheduled lecture.');
  };

  router.post('/sessions/open', async (req, res, next) => {
    try {
      requireAttendanceManager(req);
      const { timetableSessionId, date } = req.body || {};
      if (typeof timetableSessionId !== 'string' || timetableSessionId.length > 150 || !isDate(date)) throw fail(400, 'SESSION_INVALID', 'Choose a valid scheduled lecture and date.');
      const timetableRef = db.collection('timetableSessions').doc(timetableSessionId);
      const timetableSnap = await timetableRef.get();
      if (!timetableSnap.exists || timetableSnap.data().status !== 'PUBLISHED') throw fail(409, 'LECTURE_NOT_PUBLISHED', 'Attendance is available only for a published timetable lecture.');
      const timetable = timetableSnap.data();
      requireSessionAccess(req.identity, timetable);
      const settingsSnap = await db.collection('timetableSettings').doc('main').get();
      const timeZone = settingsSnap.exists ? settingsSnap.data().timeZone || 'Asia/Kolkata' : 'Asia/Kolkata';
      if (weekdayInZone(date, timeZone) !== timetable.day) throw fail(400, 'DATE_MISMATCH', 'The selected date does not match this lecture’s scheduled weekday.');
      const batchRef = db.collection('batches').doc(timetable.batchDocId);
      const batchSnap = await batchRef.get();
      if (!batchSnap.exists) throw fail(409, 'BATCH_MISSING', 'The batch linked to this lecture no longer exists.');
      const batch = batchSnap.data();
      if ((batch.startDate && date < batch.startDate) || (batch.endDate && date > batch.endDate)) throw fail(409, 'OUTSIDE_BATCH_DATES', 'This lecture date is outside the batch dates.');
      const rosterSnap = await db.collection('enrollments').where('batchDocId', '==', timetable.batchDocId).where('status', '==', 'ACTIVE').get();
      const startMinutes = Number(timetable.startMinutes);
      const endMinutes = Number(timetable.endMinutes);
      if (!Number.isInteger(startMinutes) || !Number.isInteger(endMinutes) || endMinutes <= startMinutes) throw fail(409, 'SCHEDULE_INVALID', 'This timetable entry has invalid start or end times. Ask the Owner to repair it.');
      const startAt = zonedTimeToDate(date, startMinutes, timeZone);
      const endAt = zonedTimeToDate(date, endMinutes, timeZone);
      if (startAt.getTime() > Date.now()) throw fail(409, 'TOO_EARLY', 'Attendance becomes available at the scheduled start time.');
      const sessionId = occurrenceId(timetableSessionId, date);
      const sessionRef = db.collection('attendanceSessions').doc(sessionId);
      const result = await db.runTransaction(async (transaction) => {
        const existing = await transaction.get(sessionRef);
        if (existing.exists) {
          if (existing.data().scheduledSessionId !== timetableSessionId || existing.data().date !== date) throw fail(409, 'SESSION_ID_CONFLICT', 'An attendance occurrence already exists with inconsistent schedule details.');
          if (existing.data().status === 'CANCELLED') throw fail(409, 'SESSION_CANCELLED', 'This lecture is cancelled and cannot accept attendance.');
          return { idempotent: true, session: { id: existing.id, ...existing.data() } };
        }
        const session = {
          scheduledSessionId: timetableSessionId, batchDocId: timetable.batchDocId, batchId: timetable.batchId || batch.batchId || '',
          batchName: timetable.batchName || batch.name || '', courseDocId: timetable.courseDocId || batch.courseDocId || '',
          courseName: timetable.courseName || batch.courseName || batch.course || '', teacherId: timetable.teacherId,
          teacherName: timetable.teacherName || batch.teacherName || '', date, day: timetable.day, timeZone,
          startTime: minuteTime(startMinutes), endTime: minuteTime(endMinutes), startMinutes, endMinutes,
          startAt: admin.firestore.Timestamp.fromDate(startAt), endAt: admin.firestore.Timestamp.fromDate(endAt),
          sessionAt: admin.firestore.Timestamp.fromDate(startAt), roomId: timetable.roomId || 'ONLINE', roomName: timetable.roomName || 'Online',
          deliveryMode: timetable.deliveryMode || (timetable.roomId === 'ONLINE' ? 'ONLINE' : 'OFFLINE'),
          onlineClassDetails: timetable.onlineClassDetails || '', status: 'OPEN', createdBy: req.identity.uid,
          expectedStudentCount: rosterSnap.size, createdAt: admin.firestore.FieldValue.serverTimestamp(), markedCount: 0,
        };
        transaction.create(sessionRef, session);
        return { idempotent: false, session: { id: sessionId, ...session, createdAt: null } };
      });
      res.json(result);
    } catch (error) { next(error); }
  });

  router.post('/sessions/:sessionId/records', async (req, res, next) => {
    try {
      requireAttendanceManager(req);
      const submissions = Array.isArray(req.body?.records) ? req.body.records : [];
      if (!submissions.length || submissions.length > 200) throw fail(400, 'ROSTER_INVALID', 'Submit between 1 and 200 roster entries.');
      const studentIds = submissions.map((entry) => entry?.studentDocId);
      if (studentIds.some((id) => typeof id !== 'string' || !id) || new Set(studentIds).size !== studentIds.length) throw fail(400, 'ROSTER_DUPLICATE', 'The submitted roster contains an invalid or duplicate student.');
      if (submissions.some((entry) => !ATTENDANCE_STATUSES.has(entry.status))) throw fail(400, 'STATUS_INVALID', 'Choose Present, Absent, Late, or Excused for each submitted student. Unmarked entries are omitted.');
      const sessionRef = db.collection('attendanceSessions').doc(req.params.sessionId);
      const sessionSnap = await sessionRef.get();
      if (!sessionSnap.exists) throw fail(404, 'SESSION_MISSING', 'The attendance session no longer exists.');
      const session = sessionSnap.data();
      requireSessionAccess(req.identity, session);
      if (session.status === 'CANCELLED') throw fail(409, 'SESSION_CANCELLED', 'Cancelled lectures cannot accept attendance.');
      if (!['OPEN', 'COMPLETED'].includes(session.status)) throw fail(409, 'SESSION_INVALID', 'Attendance can only be saved to an open or completed timetable session.');
      if (session.status !== 'OPEN' && req.identity.role !== 'OWNER') throw fail(409, 'SESSION_FINALIZED', 'Only an Owner can correct attendance after finalization.');
      const startTimestamp = sessionTime(session, 'startAt', 'startTime');
      if (startTimestamp === null) throw fail(409, 'SCHEDULE_INVALID', 'This attendance session has no valid scheduled start time.');
      if (startTimestamp > Date.now()) throw fail(409, 'TOO_EARLY', 'Attendance becomes available at the scheduled start time.');
      const enrollmentRefs = submissions.map((entry) => db.collection('enrollments').doc(entry.enrollmentId));
      const recordRefs = submissions.map((entry) => db.collection('attendanceRecords').doc(`${req.params.sessionId}__${entry.studentDocId}`));
      const counts = await db.runTransaction(async (transaction) => {
        const [currentSession, ...snapshots] = await Promise.all([transaction.get(sessionRef), ...enrollmentRefs.map((ref) => transaction.get(ref)), ...recordRefs.map((ref) => transaction.get(ref))]);
        const enrollments = snapshots.slice(0, enrollmentRefs.length);
        const previousRecords = snapshots.slice(enrollmentRefs.length);
        const current = currentSession.data();
        requireSessionAccess(req.identity, current);
        if (current.status === 'CANCELLED' || (current.status !== 'OPEN' && req.identity.role !== 'OWNER')) throw fail(409, 'SESSION_LOCKED', 'This session no longer accepts trainer changes.');
        const currentStart = sessionTime(current, 'startAt', 'startTime');
        if (currentStart === null) throw fail(409, 'SCHEDULE_INVALID', 'This attendance session has no valid scheduled start time.');
        if (currentStart > Date.now()) throw fail(409, 'TOO_EARLY', 'Attendance becomes available at the scheduled start time.');
        let markedCount = 0;
        submissions.forEach((entry, index) => {
          const enrollmentSnap = enrollments[index];
          if (!enrollmentSnap.exists) throw fail(409, 'ENROLLMENT_MISSING', 'A submitted student enrollment no longer exists. Refresh the roster.');
          const enrollment = enrollmentSnap.data();
          if (enrollment.batchDocId !== current.batchDocId || enrollment.status !== 'ACTIVE' || enrollment.studentDocId !== entry.studentDocId) throw fail(403, 'ENROLLMENT_FORBIDDEN', 'Every attendance entry must belong to an active enrollment in this batch.');
          const previous = previousRecords[index];
          const record = {
            sessionId: req.params.sessionId, scheduledSessionId: current.scheduledSessionId, batchDocId: current.batchDocId,
            courseDocId: current.courseDocId || '', courseName: current.courseName || '', batchId: current.batchId || '', batchName: current.batchName || '',
            enrollmentId: enrollmentSnap.id, studentDocId: enrollment.studentDocId, studentId: enrollment.studentId || '',
            studentName: enrollment.studentName || '', learningMode: previous.exists ? previous.data().learningMode : enrollment.learningMode || 'OFFLINE',
            status: entry.status, date: current.date, startTime: current.startTime, endTime: current.endTime, timeZone: current.timeZone,
            teacherId: current.teacherId, recordedBy: req.identity.uid, source: 'MANUAL_TRAINER',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          if (previous.exists) {
            if (previous.data().status !== entry.status) { record.previousStatus = previous.data().status; record.correctedAt = admin.firestore.FieldValue.serverTimestamp(); record.correctedBy = req.identity.uid; }
            transaction.set(recordRefs[index], record, { merge: true });
          } else transaction.create(recordRefs[index], { ...record, createdAt: admin.firestore.FieldValue.serverTimestamp() });
          markedCount += 1;
        });
        transaction.update(sessionRef, { markedCount, lastMarkedAt: admin.firestore.FieldValue.serverTimestamp() });
        return { markedCount };
      });
      res.json({ ...counts, message: 'Attendance saved for the selected enrolled students.' });
    } catch (error) { next(error); }
  });

  router.post('/sessions/:sessionId/finalize', async (req, res, next) => {
    try {
      requireAttendanceManager(req);
      const sessionRef = db.collection('attendanceSessions').doc(req.params.sessionId);
      const result = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(sessionRef);
        if (!snapshot.exists) throw fail(404, 'SESSION_MISSING', 'The attendance session no longer exists.');
        const session = snapshot.data();
        requireSessionAccess(req.identity, session);
        if (session.status === 'CANCELLED') throw fail(409, 'SESSION_CANCELLED', 'Cancelled lectures cannot be finalized.');
        if (session.status === 'COMPLETED') return { finalized: true, idempotent: true };
        const endTimestamp = sessionTime(session, 'endAt', 'endTime');
        if (endTimestamp === null) throw fail(409, 'SCHEDULE_INVALID', 'This attendance session has no valid scheduled end time.');
        if (endTimestamp > Date.now()) throw fail(409, 'CLASS_IN_PROGRESS', 'Attendance can be finalized after the scheduled lecture ends. Unmarked students will remain unmarked.');
        transaction.update(sessionRef, { status: 'COMPLETED', finalizedAt: admin.firestore.FieldValue.serverTimestamp(), finalizedBy: req.identity.uid });
        return { finalized: true, idempotent: false };
      });
      res.json(result);
    } catch (error) { next(error); }
  });

  router.post('/sessions/:sessionId/cancel', async (req, res, next) => {
    try {
      requireAttendanceManager(req);
      const sessionRef = db.collection('attendanceSessions').doc(req.params.sessionId);
      const result = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(sessionRef);
        if (!snapshot.exists) throw fail(404, 'SESSION_MISSING', 'The attendance session no longer exists.');
        const session = snapshot.data();
        requireSessionAccess(req.identity, session);
        if (session.status === 'COMPLETED') throw fail(409, 'SESSION_FINALIZED', 'A completed attendance session cannot be cancelled. Ask the Owner to correct it.');
        if (session.status !== 'CANCELLED') transaction.update(sessionRef, { status: 'CANCELLED', cancelledAt: admin.firestore.FieldValue.serverTimestamp(), cancelledBy: req.identity.uid });
        return { cancelled: true };
      });
      res.json(result);
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = createAttendanceRoutes;
