const express = require('express');
const { paymentIdFor, validateAdvance, validateInstallmentRequest, hasRecentAuthentication, toMinorUnits, demoPaymentsAllowed } = require('../services/enrollmentPayments');
const { createFixedWindowRateLimiter } = require('../middleware/rateLimit');

const roleCollection = 'users';
const approvedStudent = (profile) => profile?.role === 'STUDENT' && profile?.status === 'APPROVED';
const dataError = (status, code, message) => Object.assign(new Error(message), { status, code });
const money = (minor) => minor / 100;
const activeBatch = (batch) => batch && !batch.isClosed && !batch.isArchived
  && !['INACTIVE', 'CLOSED', 'COMPLETED'].includes(batch.status)
  && (batch.status !== 'FULL' || (batch.learningModes || ['OFFLINE']).includes('ONLINE'));

function createEnrollmentRoutes({ admin, db }) {
  const router = express.Router();
  const requestLimit = createFixedWindowRateLimiter({ limit: 60 });
  const availabilityLimit = createFixedWindowRateLimiter({ limit: 10 });
  const paymentLimit = createFixedWindowRateLimiter({ limit: 10 });
  const staffPaymentLimit = createFixedWindowRateLimiter({ limit: 20 });

  // Register this route before the student-only middleware: only approved finance
  // staff may verify a student's pending manual receipt request.
  router.post('/installment/verify', async (req, res, next) => {
    try {
      const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
      if (!match) throw dataError(401, 'AUTH_REQUIRED', 'Sign in as an Owner or Accounts user to verify receipts.');
      let decoded;
      try { decoded = await admin.auth().verifyIdToken(match[1], true); }
      catch { throw dataError(401, 'AUTH_INVALID', 'Your sign-in expired. Sign in again and retry.'); }
      const staffSnap = await db.collection(roleCollection).doc(decoded.uid).get();
      const staff = staffSnap.exists ? staffSnap.data() : null;
      if (!staff || staff.status !== 'APPROVED' || !['OWNER', 'ACCOUNTS'].includes(staff.role)) {
        throw dataError(403, 'FINANCE_ROLE_REQUIRED', 'Only an approved Owner or Accounts user can verify a receipt.');
      }
      if (!staffPaymentLimit(decoded.uid)) throw dataError(429, 'RATE_LIMITED', 'Too many receipt verifications. Wait a minute and retry.');

      const { paymentId } = req.body || {};
      if (typeof paymentId !== 'string' || !/^demo_[a-f0-9]{64}$/.test(paymentId)) {
        throw dataError(400, 'PAYMENT_INVALID', 'Choose a valid pending installment request.');
      }
      const paymentRef = db.collection('payments').doc(paymentId);
      const result = await db.runTransaction(async (transaction) => {
        const paymentSnap = await transaction.get(paymentRef);
        if (!paymentSnap.exists) throw dataError(404, 'PAYMENT_NOT_FOUND', 'The installment request was not found.');
        const payment = paymentSnap.data();
        if (payment.status === 'VERIFIED' && payment.verifiedBy === decoded.uid) {
          return { paymentId, amountPaid: payment.amount, remainingBalance: payment.remainingBalance, idempotent: true };
        }
        if (payment.status !== 'PENDING' || payment.method !== 'MANUAL' || payment.purpose !== 'TUITION' || payment.isDemo === true) {
          throw dataError(409, 'PAYMENT_NOT_PENDING', 'Only a pending manual installment request can be verified.');
        }
        if (typeof payment.feeRecordId !== 'string' || typeof payment.studentDocId !== 'string') {
          throw dataError(409, 'PAYMENT_RECORD_INVALID', 'The installment request is incomplete. Contact support.');
        }

        const feeRef = db.collection('feeRecords').doc(payment.feeRecordId);
        const enrollmentRef = db.collection('enrollments').doc(payment.enrollmentId || payment.feeRecordId);
        const [feeSnap, enrollmentSnap] = await Promise.all([transaction.get(feeRef), transaction.get(enrollmentRef)]);
        if (!feeSnap.exists || !enrollmentSnap.exists || enrollmentSnap.data().studentDocId !== payment.studentDocId
          || enrollmentSnap.data().status !== 'ACTIVE' || enrollmentSnap.id !== payment.feeRecordId
          || feeSnap.data().enrollmentId !== enrollmentSnap.id || feeSnap.data().studentDocId !== payment.studentDocId) {
          throw dataError(409, 'PAYMENT_RECORD_INVALID', 'The request no longer matches an active enrollment. Contact the institute.');
        }

        const fee = feeSnap.data();
        const total = toMinorUnits(fee.totalFee);
        const paid = toMinorUnits(fee.amountPaid ?? 0);
        const balance = toMinorUnits(fee.remainingBalance);
        const amount = toMinorUnits(payment.amount);
        if (total === null || paid === null || balance === null || amount === null || total - paid !== balance || amount <= 0) {
          throw dataError(409, 'FEE_RECORD_INVALID', 'The fee balance is inconsistent. Reconcile the fee record before verifying this request.');
        }
        if (amount > balance) throw dataError(409, 'PAYMENT_EXCEEDS_BALANCE', 'The requested amount is greater than the remaining balance. Reconcile it with the student before recording payment.');

        const newPaid = paid + amount;
        const newBalance = total - newPaid;
        const now = admin.firestore.FieldValue.serverTimestamp();
        transaction.update(paymentRef, {
          status: 'VERIFIED', method: 'MANUAL', isDemo: false, recordedBy: decoded.uid,
          verifiedBy: decoded.uid, verifiedAt: now, remainingBalance: money(newBalance),
        });
        transaction.update(feeRef, {
          amountPaid: money(newPaid), remainingBalance: money(newBalance),
          paymentStatus: newBalance === 0 ? 'PAID' : 'PARTIALLY_PAID',
          updatedAt: now, updatedBy: decoded.uid, lastPaymentId: paymentId,
        });
        transaction.create(db.collection('enrollmentHistory').doc(`verified_${paymentId}`), {
          studentDocId: payment.studentDocId, studentId: payment.studentId || '',
          courseDocId: enrollmentSnap.data().courseDocId || null, batchDocId: enrollmentSnap.data().batchDocId || null,
          action: 'INSTALLMENT_VERIFIED', actorUid: decoded.uid, paymentId, createdAt: now,
        });
        return { paymentId, enrollmentId: enrollmentSnap.id, totalFee: money(total), amountPaid: money(newPaid), remainingBalance: money(newBalance), paid: money(amount), idempotent: false };
      });
      res.json({ ...result, status: 'VERIFIED' });
    } catch (error) { next(error); }
  });

  const authenticate = async (req, _res, next) => {
    try {
      const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
      if (!match) throw dataError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
      const decoded = await admin.auth().verifyIdToken(match[1]);
      const profileSnap = await db.collection(roleCollection).doc(decoded.uid).get();
      if (!profileSnap.exists || !approvedStudent(profileSnap.data())) throw dataError(403, 'STUDENT_REQUIRED', 'An approved Student account is required.');
      if (!requestLimit(decoded.uid)) throw dataError(429, 'RATE_LIMITED', 'Too many enrollment requests. Wait a minute and retry.');
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
      if (!availabilityLimit(req.studentUid)) throw dataError(429, 'RATE_LIMITED', 'Too many availability checks. Wait a minute and retry.');
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
      if (!demoPaymentsAllowed()) throw dataError(403, 'DEMO_PAYMENTS_DISABLED', 'Demo payments are disabled in production. Connect a payment gateway before accepting real enrollments.');
      if (!paymentLimit(req.studentUid)) throw dataError(429, 'RATE_LIMITED', 'Too many payment attempts. Wait a minute and retry.');
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
        const student = studentSnap.exists ? studentSnap.data() : null;
        // Student documents are keyed by the authenticated UID. Older student
        // profiles may not yet have the optional authUid field; link those during
        // this trusted Admin SDK transaction, but never accept a conflicting link.
        if (!student || !student.studentId || (student.authUid && student.authUid !== uid)) {
          throw dataError(404, 'STUDENT_PROFILE_MISSING', 'Your Student Management record is not linked to this account. Contact the institute to verify your student profile.');
        }
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
          authUid: uid,
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

  router.post('/installment', async (req, res, next) => {
    try {
      if (!paymentLimit(req.studentUid)) throw dataError(429, 'RATE_LIMITED', 'Too many payment attempts. Wait a minute and retry.');
      if (!hasRecentAuthentication(req.authTime)) throw dataError(401, 'RECENT_LOGIN_REQUIRED', 'Reauthenticate your EDUPILOT account, then try again.');
      const { enrollmentId, amount: amountInput, requestId, reference } = req.body || {};
      if (typeof enrollmentId !== 'string' || enrollmentId.length === 0 || enrollmentId.length > 256) throw dataError(400, 'ENROLLMENT_INVALID', 'Choose a valid course enrollment.');
      if (typeof requestId !== 'string' || !/^[a-f0-9-]{16,64}$/i.test(requestId)) throw dataError(400, 'REQUEST_INVALID', 'Refresh the payment dialog and try again.');
      const uid = req.studentUid;
      const paymentId = paymentIdFor(uid, `installment_${requestId}`);
      const paymentRef = db.collection('payments').doc(paymentId);
      const enrollmentRef = db.collection('enrollments').doc(enrollmentId);
      const feeRef = db.collection('feeRecords').doc(enrollmentId);
      const historyRef = db.collection('enrollmentHistory').doc(`installment_${paymentId}`);
      const result = await db.runTransaction(async (transaction) => {
        const [paymentSnap, enrollmentSnap, feeSnap] = await Promise.all([
          transaction.get(paymentRef), transaction.get(enrollmentRef), transaction.get(feeRef),
        ]);
        if (enrollmentSnap.exists && enrollmentSnap.data().studentDocId !== uid) throw dataError(403, 'NOT_YOUR_ENROLLMENT', 'This course enrollment does not belong to your account.');
        if (!enrollmentSnap.exists || enrollmentSnap.data().status !== 'ACTIVE') throw dataError(404, 'ENROLLMENT_NOT_ACTIVE', 'No active enrollment was found for this course.');
        if (!feeSnap.exists) throw dataError(404, 'FEE_RECORD_MISSING', 'Your fee record is not ready yet. Contact the institute.');
        const enrollment = enrollmentSnap.data();
        const feeData = feeSnap.data();
        if (paymentSnap.exists) {
          const existing = paymentSnap.data();
          if (existing.studentDocId !== uid || existing.feeRecordId !== enrollmentId || existing.amount !== Number(amountInput)) throw dataError(409, 'IDEMPOTENCY_CONFLICT', 'This payment request ID was already used for a different installment.');
          return { paymentId, enrollmentId, totalFee: feeData.totalFee, amountPaid: feeData.amountPaid, remainingBalance: feeData.remainingBalance, requestedAmount: existing.amount, status: existing.status, idempotent: true };
        }
        const validation = validateInstallmentRequest(amountInput, feeData.totalFee, feeData.amountPaid ?? 0, feeData.remainingBalance);
        if (!validation.ok) throw dataError(validation.code === 'AMOUNT_TOO_HIGH' ? 400 : validation.code === 'FEE_RECORD_INVALID' ? 409 : 400, validation.code, validation.error);
        const { total, paid: alreadyPaid, balance, amount } = validation;
        if (balance <= 0) throw dataError(409, 'ALREADY_PAID', 'This course is already fully paid.');
        const now = admin.firestore.FieldValue.serverTimestamp();
        transaction.create(paymentRef, {
          feeRecordId: enrollmentId, enrollmentId, studentDocId: uid, studentId: enrollment.studentId || feeData.studentId || '',
          batchDocId: enrollment.batchDocId || feeData.batchDocId || null, learningMode: feeData.learningMode || enrollment.learningMode || 'OFFLINE',
          totalFee: money(total), amount: money(amount), remainingBalance: money(balance),
          method: 'MANUAL', purpose: 'TUITION', status: 'PENDING', isDemo: false,
          reference: typeof reference === 'string' && reference.trim() ? reference.trim().slice(0, 120) : null,
          recordedBy: uid, createdAt: now,
        });
        transaction.create(historyRef, { studentDocId: uid, studentId: enrollment.studentId || '', courseDocId: enrollment.courseDocId || null, batchDocId: enrollment.batchDocId || null, action: 'INSTALLMENT_REQUESTED', actorUid: uid, paymentId, createdAt: now });
        return { paymentId, enrollmentId, totalFee: money(total), amountPaid: money(alreadyPaid), remainingBalance: money(balance), requestedAmount: money(amount), status: 'PENDING', idempotent: false };
      });
      res.json({ ...result, isDemo: false, message: 'The installment request is pending. It will count as paid only after institute staff verifies receipt.' });
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = createEnrollmentRoutes;
