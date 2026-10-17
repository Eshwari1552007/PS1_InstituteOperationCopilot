/**
 * Read-only integrity check for the attendance/enrollment references used by
 * Firestore rules and AttendanceWorkspace. Requires --dry-run explicitly.
 * This script never writes, deletes, or repairs documents and never prints PII.
 */
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const initializeFirebase = require('../config/firebase');

if (!process.argv.includes('--dry-run')) {
  console.error('This audit is read-only. Run it with --dry-run to confirm no data will be changed.');
  process.exit(2);
}

async function run() {
  const { db } = initializeFirebase();
  const names = ['batches', 'users', 'enrollments', 'attendanceSessions', 'attendanceRecords'];
  const snapshots = await Promise.all(names.map((name) => db.collection(name).get()));
  const [batchSnap, userSnap, enrollmentSnap, sessionSnap, attendanceSnap] = snapshots;
  const batches = new Map(batchSnap.docs.map((item) => [item.id, item.data()]));
  const users = new Map(userSnap.docs.map((item) => [item.id, item.data()]));
  const enrollments = new Map(enrollmentSnap.docs.map((item) => [item.id, item.data()]));
  const sessions = new Map(sessionSnap.docs.map((item) => [item.id, item.data()]));
  const issues = {
    batchesWithoutAssignedTrainer: 0,
    assignedTrainerMissingOrUnapproved: 0,
    enrollmentsWithoutBatch: 0,
    activeEnrollmentsMissingTrainer: 0,
    activeEnrollmentTrainerMismatch: 0,
    sessionsWithoutBatch: 0,
    sessionsWithTrainerMismatch: 0,
    attendanceWithoutSession: 0,
    attendanceWithoutEnrollment: 0,
    attendanceStudentMismatch: 0,
    attendanceBatchMismatch: 0,
    attendanceTrainerMismatch: 0,
    duplicateSessionStudentRecords: 0,
  };

  for (const [batchId, batch] of batches) {
    const trainer = users.get(batch.teacherId);
    if (!batch.teacherId) issues.batchesWithoutAssignedTrainer += 1;
    else if (trainer?.role !== 'TRAINER' || trainer?.status !== 'APPROVED') issues.assignedTrainerMissingOrUnapproved += 1;
    void batchId;
  }
  for (const enrollment of enrollments.values()) {
    const batch = batches.get(enrollment.batchDocId);
    if (!batch) issues.enrollmentsWithoutBatch += 1;
    if (enrollment.status === 'ACTIVE' && !enrollment.teacherId) issues.activeEnrollmentsMissingTrainer += 1;
    if (enrollment.status === 'ACTIVE' && batch && enrollment.teacherId !== batch.teacherId) issues.activeEnrollmentTrainerMismatch += 1;
  }
  for (const session of sessions.values()) {
    const batch = batches.get(session.batchDocId);
    if (!batch) issues.sessionsWithoutBatch += 1;
    else if (session.teacherId !== batch.teacherId) issues.sessionsWithTrainerMismatch += 1;
  }
  const seen = new Set();
  for (const item of attendanceSnap.docs) {
    const record = item.data();
    const session = sessions.get(record.sessionId);
    const enrollment = enrollments.get(record.enrollmentId);
    if (!session) issues.attendanceWithoutSession += 1;
    if (!enrollment) issues.attendanceWithoutEnrollment += 1;
    if (enrollment && enrollment.studentDocId !== record.studentDocId) issues.attendanceStudentMismatch += 1;
    if (enrollment && enrollment.batchDocId !== record.batchDocId) issues.attendanceBatchMismatch += 1;
    if ((session && session.teacherId !== record.teacherId) || (enrollment && enrollment.teacherId !== record.teacherId)) issues.attendanceTrainerMismatch += 1;
    const pair = `${record.sessionId}__${record.studentDocId}`;
    if (seen.has(pair)) issues.duplicateSessionStudentRecords += 1;
    seen.add(pair);
  }

  console.log(JSON.stringify({
    mode: 'READ_ONLY_DRY_RUN',
    projectId: process.env.FIREBASE_PROJECT_ID || 'edupilot-80fa2',
    scanned: { batches: batchSnap.size, users: userSnap.size, enrollments: enrollmentSnap.size, attendanceSessions: sessionSnap.size, attendanceRecords: attendanceSnap.size },
    issues,
    writesPerformed: 0,
  }, null, 2));
}

run().catch((error) => {
  console.error(`Read-only attendance audit could not complete: ${error.code || error.name || 'ERROR'}. Check Firebase Admin credentials and project access.`);
  process.exitCode = 1;
});
