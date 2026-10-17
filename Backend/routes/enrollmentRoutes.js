const express = require('express');
const { paymentIdFor, validateAdvance, hasRecentAuthentication } = require('../services/enrollmentPayments');

const roleCollection = 'users';
const approvedStudent = (profile) => profile?.role === 'STUDENT' && profile?.status === 'APPROVED';
const dataError = (status, code, message) => Object.assign(new Error(message), { status, code });
const money = (minor) => minor / 100;
const activeBatch = (batch) => batch && !batch.isClosed && !batch.isArchived
  && !['INACTIVE', 'CLOSED', 'COMPLETED'].includes(batch.status)
  && (batch.status !== 'FULL' || (batch.learningModes || ['OFFLINE']).includes('ONLINE'));

function createEnrollmentRoutes({ admin, db }) {
  const router = express.Router();
  const authenticate = async (req, _res, next) => {
    try {
      const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
      if (!match) throw dataError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
      const decoded = await admin.auth().verifyIdToken(match[1]);
      const profileSnap = await db.collection(roleCollection).doc(decoded.uid).get();
      if (!profileSnap.exists || !approvedStudent(profileSnap.data())) throw dataError(403, 'STUDENT_REQUIRED', 'An approved Student account is required.');
      req.studentUid = decoded.uid;
      req.authTime = decoded.auth_time;
      next();
    } catch (error) {
      if (!error.status) error.status = 401;
      next(error);
    }
  };

  router.use(authenticate);

  router.post('/availability', async (req, res, next) => {
    try {
      const batchIds = [...new Set((Array.isArray(req.body?.batchDocIds) ? req.body.batchDocIds : []).filter((id) => typeof id === 'string' && id.length <= 128))].slice(0, 30);
      const result = {};
      for (const batchDocId of batchIds) {
        const snapshot = await db.collection('enrollments').where('batchDocId', '==', batchDocId).where('status', '==', 'ACTIVE').where('learningMode', '==', 'OFFLINE').get();
        result[batchDocId] = snapshot.size;
      }
      res.json({ offlineEnrollmentCounts: result });
    } catch (error) { next(error); }
  });

  router.post('/confirm-demo', async (req, res, next) => {
    try {
      if (!hasRecentAuthentication(req.authTime)) throw dataError(401, 'RECENT_LOGIN_REQUIRED', 'Reauthenticate your EDUPILOT account, then try again.');
      const { batchDocId, learningMode, amount: amountInput, requestId } = req.body || {};
      if (typeof batchDocId !== 'string' || batchDocId.length > 128) throw dataError(400, 'BATCH_INVALID', 'Choose an available batch.');
      if (!['ONLINE', 'OFFLINE'].includes(learningMode)) throw dataError(400, 'MODE_INVALID', 'Choose Online or Offline mode.');
      if (typeof requestId !== 'string' || !/^[a-f0-9-]{16,64}$/i.test(requestId)) throw dataError(400, 'REQUEST_INVALID', 'Refresh the payment dialog and try again.');
      const uid = req.studentUid;
      const studentRef = db.collection('students').doc(uid);
      const batchRef = db.collection('batches').doc(batchDocId);
      const paymentId = paymentIdFor(uid, requestId);
      const paymentRef = db.collection('payments').doc(paymentId);
      const enrollmentRef = db.collection('enrollments').doc(`${uid}__${batchDocId}`);
      const feeRef = db.collection('feeRecords').doc(enrollmentRef.id);
      const historyRef = db.collection('enrollmentHistory').doc(`demo_${paymentId}`);
      const result = await db.runTransaction(async (transaction) => {
        const [paymentSnap, studentSnap, batchSnap, enrollmentSnap, feeSnap] = await Promise.all([
          transaction.get(paymentRef), transaction.get(studentRef), transaction.get(batchRef),
          transaction.get(enrollmentRef), transaction.get(feeRef),
        ]);
        if (paymentSnap.exists) {
          const existing = paymentSnap.data();
          if (existing.studentDocId !== uid || existing.batchDocId !== batchDocId || existing.amount !== Number(amountInput) || existing.learningMode !== learningMode) throw dataError(409, 'IDEMPOTENCY_CONFLICT', 'This payment request ID was already used for a different payment.');
          if (!enrollmentSnap.exists || enrollmentSnap.data().status !== 'ACTIVE' || !feeSnap.exists
            || feeSnap.data().lastPaymentId !== paymentRef.id || feeSnap.data().amountPaid !== existing.amount) {
            throw dataError(409, 'ENROLLMENT_REVIEW_REQUIRED', 'A prior payment record is incomplete. Contact the institute before retrying.');
          }
          return { enrollmentId: enrollmentRef.id, totalFee: existing.totalFee, amountPaid: existing.amount, remainingBalance: existing.remainingBalance, idempotent: true };
        }
        if (!studentSnap.exists || !studentSnap.data().studentId || studentSnap.data().authUid !== uid) throw dataError(404, 'STUDENT_PROFILE_MISSING', 'Your Student Management record is not ready. Contact the institute.');
        if (enrollmentSnap.exists && enrollmentSnap.data().status === 'ACTIVE') throw dataError(409, 'ALREADY_ENROLLED', 'You are already enrolled in this batch.');
        if (enrollmentSnap.exists || feeSnap.exists) throw dataError(409, 'ENROLLMENT_REVIEW_REQUIRED', 'A prior enrollment exists for this batch. Contact the counselor to reconcile it before retrying.');
        if (!activeBatch(batchSnap.data())) throw dataError(409, 'BATCH_UNAVAILABLE', 'This batch is closed or no longer available.');
        const batch = batchSnap.data();
        const modes = batch.learningModes || ['OFFLINE'];
        if (!modes.includes(learningMode)) throw dataError(409, 'MODE_UNAVAILABLE', 'That learning mode is not offered for this batch.');
        const courseRef = db.collection('courses').doc(batch.courseDocId);
        const courseSnap = await transaction.get(courseRef);
        if (!courseSnap.exists || courseSnap.data().status !== 'ACTIVE' || courseSnap.data().isArchived) throw dataError(409, 'COURSE_UNAVAILABLE', 'This course is no longer accepting enrollment.');
        const course = courseSnap.data();
        const feeValue = batch.price ?? course.fee;
        const feeValidation = validateAdvance(amountInput, feeValue);
        if (!feeValidation.ok) throw dataError(400, 'ADVANCE_INVALID', feeValidation.error);
        const fee = money(feeValidation.fee);
        const paid = money(feeValidation.amount);
        const remaining = money(feeValidation.remaining);
        let offlineEnrolledCount = Number(batch.offlineEnrolledCount || 0);
        if (learningMode === 'OFFLINE') {
          const offlineQuery = db.collection('enrollments').where('batchDocId', '==', batchDocId).where('status', '==', 'ACTIVE').where('learningMode', '==', 'OFFLINE');
          const offlineSnap = await transaction.get(offlineQuery);
          offlineEnrolledCount = offlineSnap.size;
          const offlineCapacity = Number(batch.offlineCapacity || batch.capacity || 0);
          if (offlineEnrolledCount >= offlineCapacity) throw dataError(409, 'OFFLINE_FULL', 'Offline seats are full. Please select Online mode if available.');
        }
        const now = admin.firestore.FieldValue.serverTimestamp();
        const enrollment = {
          studentDocId: uid, studentId: studentSnap.data().studentId, studentName: studentSnap.data().fullName,
          studentEmail: studentSnap.data().email || '', studentPhone: studentSnap.data().phone || '',
          courseDocId: batch.courseDocId, courseId: course.courseId || '', courseName: course.name,
          batchDocId, batchId: batch.batchId || '', batchName: batch.name || '', teacherId: batch.teacherId || '',
          learningMode, status: 'ACTIVE', feeRecordId: enrollmentRef.id, enrolledAt: now, enrolledBy: uid,
          updatedAt: now, updatedBy: uid,
        };
        const feeRecord = {
          enrollmentId: enrollmentRef.id, studentDocId: uid, studentId: studentSnap.data().studentId,
          studentName: studentSnap.data().fullName, courseName: course.name, courseDocId: batch.courseDocId,
          batchId: batch.batchId || '', batchDocId, totalFee: fee, amountPaid: paid, remainingBalance: remaining,
          paymentStatus: remaining === 0 ? 'PAID' : 'PARTIALLY_PAID', advancePaid: true, learningMode,
          enrolledAt: now,
          createdAt: now, updatedAt: now, updatedBy: uid, lastPaymentId: paymentId,
        };
        const payment = {
          feeRecordId: enrollmentRef.id, enrollmentId: enrollmentRef.id, studentDocId: uid,
          studentId: studentSnap.data().studentId, batchDocId, learningMode, totalFee: fee, amount: paid, remainingBalance: remaining,
          method: 'DEMO', purpose: 'ADVANCE', status: 'DEMO_CONFIRMED', isDemo: true,
          reference: null, requestIdHash: paymentId.slice(5), recordedBy: uid, createdAt: now,
        };
        transaction.create(enrollmentRef, enrollment);
        transaction.create(feeRef, feeRecord);
        transaction.create(paymentRef, payment);
        const nextCount = Number(batch.enrolledCount || 0) + 1;
        const nextOffline = offlineEnrolledCount + (learningMode === 'OFFLINE' ? 1 : 0);
        transaction.update(batchRef, { enrolledCount: nextCount, offlineEnrolledCount: nextOffline, updatedAt: now, updatedBy: uid });
        transaction.update(studentRef, {
          course: course.name, courseDocId: batch.courseDocId, courseId: course.courseId || '',
          batch: batch.name || '', batchDocId, batchId: batch.batchId || '', enrollmentStatus: 'ACTIVE',
          updatedAt: now, updatedBy: uid,
        });
        transaction.create(historyRef, { studentDocId: uid, studentId: studentSnap.data().studentId, courseDocId: batch.courseDocId, batchDocId, action: 'ENROLLED', actorUid: uid, paymentId, createdAt: now });
        return { enrollmentId: enrollmentRef.id, totalFee: fee, amountPaid: paid, remainingBalance: remaining, idempotent: false };
      });
      res.json({ ...result, isDemo: true, status: 'DEMO_CONFIRMED' });
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = createEnrollmentRoutes;
