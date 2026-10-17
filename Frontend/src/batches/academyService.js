import {
  collection, doc, getDocs, query, runTransaction, updateDoc,
  serverTimestamp, where,
} from 'firebase/firestore';
import { db } from '../firebase';

const COURSES = 'courses';
const BATCHES = 'batches';
const STUDENTS = 'students';
const ENROLLMENTS = 'enrollments';
const HISTORY = 'enrollmentHistory';
const SEQUENCES = 'sequences';
const LOCKS = 'scheduleLocks';

function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateInitialPayment(amountInput, feeInput) {
  const fee = Number(feeInput);
  const amount = Number(amountInput || 0);
  const feeMinor = Math.round(fee * 100);
  const amountMinor = Math.round(amount * 100);
  if (!Number.isFinite(fee) || fee < 0 || Math.abs(fee * 100 - feeMinor) > 1e-7) throw serviceError('enrollment/fee-invalid', 'The saved course fee is invalid. Ask the Owner to review it.');
  if (feeMinor === 0 && amountMinor === 0) return { fee: 0, paid: 0, remaining: 0 };
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - amountMinor) > 1e-7) throw serviceError('enrollment/advance-invalid', 'Enter a valid positive amount with no more than two decimal places.');
  if (amountMinor * 2 < feeMinor) throw serviceError('enrollment/advance-required', 'The initial payment must be at least 50% of the saved course fee.');
  if (amountMinor > feeMinor) throw serviceError('enrollment/advance-excessive', 'The initial payment cannot exceed the course fee.');
  return { fee: feeMinor / 100, paid: amountMinor / 100, remaining: (feeMinor - amountMinor) / 100 };
}

async function offlineEnrollmentCount(transaction, batchDocId) {
  const snapshot = await transaction.get(query(collection(db, ENROLLMENTS), where('batchDocId', '==', batchDocId), where('status', '==', 'ACTIVE'), where('learningMode', '==', 'OFFLINE')));
  return snapshot.size;
}

function explain(error) {
  if (error.code === 'permission-denied') return serviceError(error.code, 'Firestore denied this operation. Confirm the latest Firestore rules are deployed and your role is approved.');
  if (error.code === 'unavailable' || error.code === 'deadline-exceeded') return serviceError(error.code, 'Firebase is temporarily unavailable. Check your connection and retry.');
  return error;
}

function formatId(prefix, year, value) {
  return `${prefix}-${year}-${String(value).padStart(4, '0')}`;
}

function slug(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 48);
}

function timeMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

export function getBatchDurationHours(batch) {
  const saved = Number(batch?.durationHours);
  if (Number.isFinite(saved) && saved > 0) return saved;
  const start = timeMinutes(batch?.startTime); const end = timeMinutes(batch?.endTime);
  const legacyMinutes = end - start;
  return Number.isFinite(start) && Number.isFinite(end) && legacyMinutes >= 15 && legacyMinutes % 15 === 0
    ? legacyMinutes / 60
    : null;
}

function dateKey(date) {
  const current = date ? new Date(date) : new Date();
  const year = current.getFullYear();
  const month = String(current.getMonth() + 1).padStart(2, '0');
  const day = String(current.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function batchStatus(batch, today = dateKey()) {
  if (batch.isClosed) return 'CLOSED';
  if (batch.endDate < today) return 'COMPLETED';
  const modes = batch.learningModes || ['OFFLINE'];
  const offlineCount = Number(batch.offlineEnrolledCount ?? batch.enrolledCount ?? 0);
  if (modes.includes('OFFLINE') && offlineCount >= Number(batch.offlineCapacity || batch.capacity || 0) && !modes.includes('ONLINE')) return 'FULL';
  if (batch.startDate > today) return 'UPCOMING';
  return 'ACTIVE';
}

export function validateCourse(input) {
  const value = {
    name: String(input.name || '').trim(), description: String(input.description || '').trim(),
    category: String(input.category || '').trim(), duration: Number(input.duration),
    durationUnit: input.durationUnit || 'months', fee: Number(input.fee),
    status: input.status || 'ACTIVE',
  };
  const errors = {};
  if (value.name.length < 2) errors.name = 'Course name must contain at least 2 characters.';
  if (!value.category) errors.category = 'Choose a category.';
  if (!Number.isInteger(value.duration) || value.duration < 1 || value.duration > 600) errors.duration = 'Enter a positive duration.';
  if (!['days', 'weeks', 'months', 'years'].includes(value.durationUnit)) errors.durationUnit = 'Choose a valid duration unit.';
  if (!Number.isFinite(value.fee) || value.fee < 0) errors.fee = 'Fee must be zero or more.';
  if (!['ACTIVE', 'INACTIVE'].includes(value.status)) errors.status = 'Choose a valid course status.';
  if (Object.keys(errors).length) throw Object.assign(serviceError('validation/invalid-data', 'Correct the highlighted course fields.'), { fields: errors });
  return value;
}

export function validateBatch(input) {
  const legacyHours = Number(input.durationHours) * Number(input.sessionsPerWeek || (input.daysOfWeek || []).length || 1);
  const value = {
    name: String(input.name || '').trim(), courseDocId: String(input.courseDocId || '').trim(),
    teacherId: String(input.teacherId || '').trim(), roomNumber: String(input.roomNumber || '').trim(),
    startDate: String(input.startDate || '').trim(), endDate: String(input.endDate || '').trim(),
    daysOfWeek: [...new Set(input.daysOfWeek || [])], startTime: String(input.startTime || '').trim(),
    endTime: String(input.endTime || '').trim(), capacity: Number(input.capacity),
    weeklyTeachingHours: Number(input.weeklyTeachingHours ?? (Number.isInteger(legacyHours) ? legacyHours : NaN)),
    price: Number(input.price ?? input.fee ?? 0),
    learningModes: [...new Set(input.learningModes || ['OFFLINE'])],
    onlineClassDetails: String(input.onlineClassDetails || '').trim(),
    isClosed: Boolean(input.isClosed), isArchived: Boolean(input.isArchived),
  };
  const errors = {};
  if (value.name.length < 2) errors.name = 'Batch name is required.';
  if (!value.courseDocId) errors.courseDocId = 'Select a course.';
  if (!value.teacherId) errors.teacherId = 'Select an approved Trainer.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.startDate)) errors.startDate = 'Choose a start date.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.endDate) || value.endDate < value.startDate) errors.endDate = 'End date must be on or after the start date.';
  if (!Number.isInteger(value.weeklyTeachingHours) || value.weeklyTeachingHours < 1 || value.weeklyTeachingHours > 60) errors.weeklyTeachingHours = 'Enter a whole number of teaching hours from 1 to 60 per week.';
  const hasLegacyTime = Boolean(value.startTime || value.endTime);
  if (hasLegacyTime && (!Number.isFinite(timeMinutes(value.startTime)) || !Number.isFinite(timeMinutes(value.endTime)) || timeMinutes(value.endTime) <= timeMinutes(value.startTime))) errors.endTime = 'Existing preferred time must have an end after the start. Clear both legacy times or correct them.';
  if (!Number.isInteger(value.capacity) || value.capacity < 1 || value.capacity > 500) errors.capacity = 'Capacity must be a positive whole number (maximum 500).';
  if (!Number.isFinite(value.price) || value.price < 0) errors.price = 'Enter a non-negative batch price.';
  if (!value.learningModes.length || value.learningModes.some((mode) => !['ONLINE', 'OFFLINE'].includes(mode))) errors.learningModes = 'Select Online, Offline, or both modes.';
  if (Object.keys(errors).length) throw Object.assign(serviceError('validation/invalid-data', 'Correct the highlighted batch fields.'), { fields: errors });
  return value;
}

export async function loadAcademyWorkspace(role, uid) {
  try {
    const coursePromise = getDocs(collection(db, COURSES));
    const batchPromise = role === 'TRAINER'
      ? getDocs(query(collection(db, BATCHES), where('teacherId', '==', uid)))
      : getDocs(collection(db, BATCHES));
    const teacherPromise = role === 'OWNER'
      ? getDocs(query(collection(db, 'users'), where('role', '==', 'TRAINER')))
      : Promise.resolve(null);
    const [courseSnapshot, batchSnapshot, teacherSnapshot] = await Promise.all([coursePromise, batchPromise, teacherPromise]);
    const courses = courseSnapshot.docs.map((item) => ({ documentId: item.id, ...item.data() }));
    const batches = batchSnapshot.docs.map((item) => ({ documentId: item.id, ...item.data(), status: batchStatus(item.data()) }));
    const teachers = teacherSnapshot?.docs.map((item) => ({ uid: item.id, ...item.data() })).filter((item) => item.status === 'APPROVED') || [];
    return { courses, batches, teachers };
  } catch (error) {
    throw explain(error);
  }
}

export async function getEnrollmentOptions() {
  const { courses, batches } = await loadAcademyWorkspace('COUNSELOR', '');
  const activeCourses = courses.filter((course) => course.status === 'ACTIVE' && !course.isArchived);
  const activeCourseIds = new Set(activeCourses.map((course) => course.documentId));
  const availableBatches = batches.filter((batch) => activeCourseIds.has(batch.courseDocId)
    && !batch.isArchived && !['FULL', 'CLOSED', 'COMPLETED'].includes(batch.status));
  return { courses: activeCourses, batches: availableBatches };
}

export async function saveCourse(input, actorUid, existingId = '') {
  const course = validateCourse(input);
  const year = new Date().getFullYear();
  const sequenceRef = doc(db, SEQUENCES, `course-${year}`);
  const courseRef = existingId ? doc(db, COURSES, existingId) : doc(collection(db, COURSES));
  try {
    return await runTransaction(db, async (transaction) => {
      const sequenceSnap = existingId ? null : await transaction.get(sequenceRef);
      const number = existingId ? null : Number(sequenceSnap?.data()?.lastNumber || 0) + 1;
      const courseId = existingId || formatId('CRS', year, number);
      const targetRef = existingId ? courseRef : doc(db, COURSES, courseId);
      const currentSnap = existingId ? await transaction.get(targetRef) : null;
      if (existingId && !currentSnap.exists()) throw serviceError('course/not-found', 'This course was removed. Refresh the page and retry.');
      const now = serverTimestamp();
      transaction.set(targetRef, existingId
        ? { ...currentSnap.data(), ...course, courseId, updatedAt: now }
        : { ...course, courseId, createdAt: now, updatedAt: now, createdBy: actorUid, isArchived: false });
      if (!existingId) transaction.set(sequenceRef, { lastNumber: number, updatedAt: now });
      return { ...course, courseId, documentId: courseId };
    });
  } catch (error) { throw explain(error); }
}

function lockKeys(batch) {
  if (Number.isInteger(Number(batch.weeklyTeachingHours)) && Number(batch.weeklyTeachingHours) > 0) return [];
  if (!Number.isFinite(timeMinutes(batch.startTime)) || !Number.isFinite(timeMinutes(batch.endTime)) || timeMinutes(batch.endTime) <= timeMinutes(batch.startTime)) return [];
  const firstSlot = Math.floor(timeMinutes(batch.startTime) / 15);
  const afterLastSlot = Math.ceil(timeMinutes(batch.endTime) / 15);
  const keys = [];
  batch.daysOfWeek.forEach((day) => {
    for (let slot = firstSlot; slot < afterLastSlot; slot += 1) {
      if ((batch.learningModes || ['OFFLINE']).includes('OFFLINE') && batch.roomNumber) keys.push(`room-${slug(batch.roomNumber)}-${day}-${slot}`);
      keys.push(`teacher-${slug(batch.teacherId)}-${day}-${slot}`);
    }
  });
  return [...new Set(keys)].sort();
}

export async function saveBatch(input, actorUid, existingId = '') {
  const batch = validateBatch(input);
  const year = new Date().getFullYear();
  const sequenceRef = doc(db, SEQUENCES, `batch-${year}`);
  try {
    const saved = await runTransaction(db, async (transaction) => {
      const sequenceSnap = existingId ? null : await transaction.get(sequenceRef);
      const number = existingId ? null : Number(sequenceSnap?.data()?.lastNumber || 0) + 1;
      const batchId = existingId || formatId('BAT', year, number);
      const batchRef = doc(db, BATCHES, batchId);
      const currentSnap = existingId ? await transaction.get(batchRef) : null;
      if (existingId && !currentSnap.exists()) throw serviceError('batch/not-found', 'This batch was removed. Refresh the page and retry.');
      const [courseSnap, teacherSnap] = await Promise.all([
        transaction.get(doc(db, COURSES, batch.courseDocId)),
        transaction.get(doc(db, 'users', batch.teacherId)),
      ]);
      if (!courseSnap.exists() || courseSnap.data().status !== 'ACTIVE' || courseSnap.data().isArchived) throw serviceError('batch/course-unavailable', 'Choose an existing active course.');
      if (!teacherSnap.exists() || teacherSnap.data().role !== 'TRAINER' || teacherSnap.data().status !== 'APPROVED') throw serviceError('batch/teacher-unavailable', 'Choose an approved Trainer account.');
      const prior = currentSnap?.data() || {};
      const enrolledCount = Number(prior.enrolledCount || 0);
      if (enrolledCount > batch.capacity) throw serviceError('batch/capacity-below-enrollment', `Capacity cannot be less than the ${enrolledCount} active enrollments.`);
      const next = {
        ...batch, batchId, courseId: courseSnap.data().courseId, courseName: courseSnap.data().name,
        teacherName: teacherSnap.data().name || teacherSnap.data().email,
        enrolledCount, status: batchStatus({ ...batch, enrolledCount }),
      };
      const beforeKeys = existingId ? lockKeys(prior) : [];
      const afterKeys = lockKeys(next);
      const allKeys = [...new Set([...beforeKeys, ...afterKeys])].sort();
      const lockRefs = allKeys.map((key) => doc(db, LOCKS, key));
      const lockSnaps = await Promise.all(lockRefs.map((ref) => transaction.get(ref)));
      for (let index = 0; index < allKeys.length; index += 1) {
        const key = allKeys[index];
        const snapshot = lockSnaps[index];
        if (afterKeys.includes(key) && snapshot.exists() && snapshot.data().batchDocId !== batchId) {
          const resource = key.startsWith('room-') ? 'room' : 'teacher';
          throw serviceError(`batch/${resource}-conflict`, `That ${resource} already has an overlapping weekly schedule.`);
        }
      }
      const now = serverTimestamp();
      transaction.set(batchRef, existingId
        ? { ...prior, ...next, updatedAt: now }
        : { ...next, createdAt: now, updatedAt: now, createdBy: actorUid, isArchived: false });
      if (!existingId) transaction.set(sequenceRef, { lastNumber: number, updatedAt: now });
      const nextKeys = new Set(afterKeys);
      for (let index = 0; index < allKeys.length; index += 1) {
        const key = allKeys[index];
        const snap = lockSnaps[index];
        const lockRef = lockRefs[index];
        if (nextKeys.has(key)) {
          transaction.set(lockRef, { batchDocId: batchId, resource: key.startsWith('room-') ? 'room' : 'teacher', updatedAt: now });
        } else if (snap.exists() && snap.data().batchDocId === batchId) {
          transaction.delete(lockRef);
        }
      }
      return { ...next, documentId: batchId };
    });
    if (existingId) {
      if (input.scheduleRequirementsChanged) {
        const scheduled = await getDocs(query(collection(db, 'timetableSessions'), where('batchDocId', '==', existingId)));
        await Promise.all(scheduled.docs.filter((item) => !item.data().needsReview).map((item) => updateDoc(item.ref, {
          needsReview: true,
          reviewReason: 'Batch weekly hours or unavailable days changed. Owner review is required before the schedule is published.',
          updatedAt: serverTimestamp(),
        })));
      }
    }
    return saved;
  } catch (error) { throw explain(error); }
}

export async function setBatchClosed(batchDocId, isClosed, actorUid) {
  try {
    await runTransaction(db, async (transaction) => {
      const ref = doc(db, BATCHES, batchDocId);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw serviceError('batch/not-found', 'This batch no longer exists.');
      const batch = snapshot.data();
      const next = { ...batch, isClosed, status: batchStatus({ ...batch, isClosed }), updatedAt: serverTimestamp(), updatedBy: actorUid };
      transaction.update(ref, next);
    });
  } catch (error) { throw explain(error); }
}

export async function archiveCourse(courseDocId, archived) {
  try { await updateDoc(doc(db, COURSES, courseDocId), { isArchived: archived, updatedAt: serverTimestamp() }); }
  catch (error) { throw explain(error); }
}

export async function archiveBatch(batchDocId, archived) {
  try {
    await runTransaction(db, async (transaction) => {
      const batchRef = doc(db, BATCHES, batchDocId);
      const batchSnap = await transaction.get(batchRef);
      if (!batchSnap.exists()) throw serviceError('batch/not-found', 'This batch no longer exists.');
      const batch = batchSnap.data();
      if (archived && Number(batch.enrolledCount || 0) > 0) throw serviceError('batch/has-enrollments', 'A batch with active students cannot be archived. Close it or withdraw/transfer its students first.');
      const keys = lockKeys(batch);
      const refs = keys.map((key) => doc(db, LOCKS, key));
      const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
      if (!archived) {
        for (let index = 0; index < refs.length; index += 1) {
          const snapshot = snapshots[index];
          if (snapshot.exists() && snapshot.data().batchDocId !== batchDocId) {
            const resource = keys[index].startsWith('room-') ? 'room' : 'teacher';
            throw serviceError(`batch/${resource}-conflict`, `Cannot restore: that ${resource} schedule is now occupied.`);
          }
        }
      }
      const now = serverTimestamp();
      transaction.update(batchRef, { isArchived: archived, updatedAt: now });
      refs.forEach((ref, index) => {
        const snapshot = snapshots[index];
        if (archived && snapshot.exists() && snapshot.data().batchDocId === batchDocId) transaction.delete(ref);
        if (!archived) transaction.set(ref, { batchDocId, resource: keys[index].startsWith('room-') ? 'room' : 'teacher', updatedAt: now });
      });
    });
  }
  catch (error) { throw explain(error); }
}

function checkEnrollmentAllowed(course, batch) {
  if (!course || course.status !== 'ACTIVE' || course.isArchived) throw serviceError('enrollment/course-unavailable', 'This course is inactive or archived.');
  if (!batch || batch.isArchived || batch.isClosed || batchStatus(batch) === 'COMPLETED') throw serviceError('enrollment/batch-unavailable', 'This batch is closed, completed, or archived.');
  if (batch.courseDocId !== course.documentId && batch.courseDocId !== course.courseId) throw serviceError('enrollment/course-mismatch', 'The selected batch does not belong to that course.');
}

function enrollmentId(studentDocId, batchDocId) { return `${studentDocId}__${batchDocId}`; }

function enrollmentRecord({ student, studentDocId, course, courseDocId, batch, batchDocId, actorUid, now, status = 'ACTIVE', learningMode = (batch.learningModes || ['OFFLINE'])[0] }) {
  return {
    studentDocId, studentId: student.studentId, courseDocId, courseId: course.courseId, courseName: course.name,
    batchDocId, batchId: batch.batchId, batchName: batch.name, studentName: student.fullName,
    studentEmail: student.email, studentPhone: student.phone, status, learningMode,
    feeRecordId: enrollmentId(studentDocId, batchDocId),
    teacherId: batch.teacherId,
    enrolledAt: now, enrolledBy: actorUid, updatedAt: now, updatedBy: actorUid,
  };
}

function batchWithCount(batch, count, now, actorUid, mutationId, offlineCount = Number(batch.offlineEnrolledCount || 0)) {
  // Workspace records include a UI-only `documentId`; never persist it back.
  // Firestore rules intentionally whitelist only enrollment counter mutations.
  const { documentId, ...storedBatch } = batch;
  const next = { ...storedBatch, enrolledCount: count, offlineEnrolledCount: offlineCount, status: batchStatus({ ...storedBatch, enrolledCount: count, offlineEnrolledCount: offlineCount }), updatedAt: now, updatedBy: actorUid, lastEnrollmentMutationId: mutationId };
  return next;
}

export async function createStudentAndEnroll(input, actorUid, courseDocId, batchDocId) {
  const studentRef = input.authUid ? doc(db, STUDENTS, input.authUid) : doc(collection(db, STUDENTS));
  const nowYear = new Date().getFullYear();
  const sequenceRef = doc(db, SEQUENCES, `student-${nowYear}`);
  const historyRef = doc(collection(db, HISTORY));
  try {
    return await runTransaction(db, async (transaction) => {
      const sequenceSnap = await transaction.get(sequenceRef);
      const courseRef = doc(db, COURSES, courseDocId);
      const batchRef = doc(db, BATCHES, batchDocId);
      const userRef = input.authUid ? doc(db, 'users', input.authUid) : null;
      const [courseSnap, batchSnap, existingStudentSnap, accountSnap] = await Promise.all([
        transaction.get(courseRef), transaction.get(batchRef), transaction.get(studentRef),
        userRef ? transaction.get(userRef) : Promise.resolve(null),
      ]);
      if (!courseSnap.exists() || !batchSnap.exists()) throw serviceError('enrollment/not-found', 'The selected course or batch no longer exists.');
      if (existingStudentSnap.exists()) throw serviceError('student/already-linked', 'This account already has a Student Management record. Refresh the student list and enroll that record instead.');
      if (input.authUid && (!accountSnap?.exists() || accountSnap.data().role !== 'STUDENT'
        || accountSnap.data().status !== 'APPROVED'
        || String(accountSnap.data().email || '').toLowerCase() !== String(input.email || '').toLowerCase())) {
        throw serviceError('student/account-mismatch', 'This approved Student account could not be verified. Refresh the list and try again.');
      }
      const course = { documentId: courseSnap.id, ...courseSnap.data() };
      const batch = { documentId: batchSnap.id, ...batchSnap.data() };
      checkEnrollmentAllowed(course, batch);
      const learningMode = input.learningMode || (batch.learningModes || ['OFFLINE'])[0];
      if (!['ONLINE', 'OFFLINE'].includes(learningMode) || !(batch.learningModes || ['OFFLINE']).includes(learningMode)) throw serviceError('enrollment/mode-unavailable', 'Choose a learning mode offered for this batch.');
      const initialPayment = validateInitialPayment(input.initialPaymentAmount, batch.price ?? course.fee);
      const offlineCount = learningMode === 'OFFLINE' ? await offlineEnrollmentCount(transaction, batchDocId) : Number(batch.offlineEnrolledCount || 0);
      if (learningMode === 'OFFLINE' && offlineCount >= Number(batch.offlineCapacity || batch.capacity || 0)) throw serviceError('enrollment/offline-full', 'Offline seats are full. Please select Online mode if available.');
      const studentNumber = Number(sequenceSnap.data()?.lastNumber || 0) + 1;
      const studentId = formatId('STU', nowYear, studentNumber);
      const idRef = doc(db, 'studentIds', studentId);
      const enrollmentRef = doc(db, ENROLLMENTS, enrollmentId(studentRef.id, batchDocId));
      const feeRef = doc(db, 'feeRecords', enrollmentRef.id);
      const paymentRef = doc(db, 'payments', `initial_${enrollmentRef.id}`);
      const [idSnap, enrollmentSnap, feeSnap, paymentSnap] = await Promise.all([transaction.get(idRef), transaction.get(enrollmentRef), transaction.get(feeRef), transaction.get(paymentRef)]);
      if (idSnap.exists()) throw serviceError('student/id-conflict', 'Student ID allocation conflicted. Please retry.');
      if (enrollmentSnap.exists()) throw serviceError('enrollment/duplicate', 'This student is already enrolled in the selected batch.');
      if (feeSnap.exists() || paymentSnap.exists()) throw serviceError('enrollment/financial-conflict', 'Existing financial records exist for this enrollment. Ask an Owner to reconcile them.');
      const now = serverTimestamp();
      const studentFields = { ...input };
      delete studentFields.initialPaymentAmount;
      delete studentFields.learningMode;
      const student = {
        ...studentFields, studentId, accountStatus: input.authUid ? 'ACTIVE' : 'NO_ACCOUNT', course: course.name, courseDocId, courseId: course.courseId,
        batch: batch.name, batchDocId, batchId: batch.batchId, enrollmentStatus: 'ACTIVE',
        isArchived: false,
        createdAt: now, updatedAt: now, createdBy: actorUid, updatedBy: actorUid,
      };
      transaction.set(studentRef, student);
      transaction.set(idRef, { studentDocId: studentRef.id, createdAt: now, createdBy: actorUid });
      transaction.set(sequenceRef, { lastNumber: studentNumber, lastStudentId: studentId, lastStudentDocId: studentRef.id, updatedAt: now });
      const enrollment = enrollmentRecord({ student, studentDocId: studentRef.id, course, courseDocId, batch, batchDocId, actorUid, now, learningMode });
      transaction.set(enrollmentRef, enrollment);
      transaction.set(feeRef, { enrollmentId: enrollmentRef.id, studentDocId: studentRef.id, studentId, studentName: student.fullName, courseName: course.name, batchId: batch.batchId, batchName: batch.name, courseDocId, batchDocId, learningMode, enrolledAt: now, totalFee: initialPayment.fee, amountPaid: initialPayment.paid, remainingBalance: initialPayment.remaining, paymentStatus: initialPayment.remaining === 0 ? 'PAID' : 'PARTIALLY_PAID', advancePaid: initialPayment.paid * 2 >= initialPayment.fee, ...(initialPayment.paid > 0 ? { lastPaymentId: paymentRef.id } : {}), createdAt: now, updatedAt: now });
      if (initialPayment.paid > 0) transaction.set(paymentRef, { feeRecordId: enrollmentRef.id, enrollmentId: enrollmentRef.id, studentDocId: studentRef.id, studentId, batchDocId, amount: initialPayment.paid, remainingBalance: initialPayment.remaining, method: 'MANUAL', purpose: 'ADVANCE', status: 'VERIFIED', isDemo: false, reference: null, recordedBy: actorUid, createdAt: now });
      transaction.set(batchRef, batchWithCount(batch, Number(batch.enrolledCount || 0) + 1, now, actorUid, enrollmentRef.id, offlineCount + (learningMode === 'OFFLINE' ? 1 : 0)));
      transaction.set(historyRef, { studentDocId: studentRef.id, studentId, courseDocId, batchDocId, action: 'ENROLLED', actorUid, createdAt: now });
      return { ...student, documentId: studentRef.id };
    });
  } catch (error) { throw explain(error); }
}

export async function transferStudent(studentDocId, courseDocId, batchDocId, actorUid, studentChanges = {}) {
  const initialPaymentAmount = studentChanges.initialPaymentAmount;
  const requestedLearningMode = studentChanges.learningMode;
  const profileChanges = { ...studentChanges };
  delete profileChanges.initialPaymentAmount;
  delete profileChanges.learningMode;
  const studentRef = doc(db, STUDENTS, studentDocId);
  const newHistoryRef = doc(collection(db, HISTORY));
  try {
    return await runTransaction(db, async (transaction) => {
      const studentSnap = await transaction.get(studentRef);
      if (!studentSnap.exists()) throw serviceError('student/not-found', 'Student record not found.');
      const student = { documentId: studentSnap.id, ...studentSnap.data() };
      const newCourseRef = doc(db, COURSES, courseDocId);
      const newBatchRef = doc(db, BATCHES, batchDocId);
      const newEnrollmentRef = doc(db, ENROLLMENTS, enrollmentId(studentDocId, batchDocId));
      const newFeeRef = doc(db, 'feeRecords', newEnrollmentRef.id);
      const [courseSnap, batchSnap, destinationEnrollmentSnap] = await Promise.all([
        transaction.get(newCourseRef), transaction.get(newBatchRef), transaction.get(newEnrollmentRef),
      ]);
      if (!courseSnap.exists() || !batchSnap.exists()) throw serviceError('enrollment/not-found', 'The selected course or batch no longer exists.');
      const course = { documentId: courseSnap.id, ...courseSnap.data() };
      const batch = { documentId: batchSnap.id, ...batchSnap.data() };
      const currentBatchDocId = student.batchDocId || '';
      const isSameBatch = currentBatchDocId === batchDocId && student.enrollmentStatus === 'ACTIVE';
      if (!isSameBatch) checkEnrollmentAllowed(course, batch);
      if (destinationEnrollmentSnap.exists() && !isSameBatch) {
        throw serviceError('enrollment/duplicate', 'A prior enrollment record exists for this batch. Ask an Owner to reconcile it before retrying.');
      }
      const destinationFeeSnap = await transaction.get(newFeeRef);
      const initialPaymentRef = doc(db, 'payments', `initial_${newEnrollmentRef.id}`);
      const initialPaymentSnap = await transaction.get(initialPaymentRef);
      if (!isSameBatch && (destinationFeeSnap.exists() || initialPaymentSnap.exists())) throw serviceError('enrollment/financial-conflict', 'Prior fee records exist for this enrollment. Ask an Owner to reconcile them.');
      const oldBatchRef = currentBatchDocId ? doc(db, BATCHES, currentBatchDocId) : null;
      const oldEnrollmentRef = currentBatchDocId ? doc(db, ENROLLMENTS, enrollmentId(studentDocId, currentBatchDocId)) : null;
      const [oldBatchSnap, oldEnrollmentSnap] = oldBatchRef
        ? await Promise.all([transaction.get(oldBatchRef), transaction.get(oldEnrollmentRef)])
        : [null, null];
      if (currentBatchDocId && student.enrollmentStatus === 'ACTIVE' && (!oldBatchSnap?.exists() || !oldEnrollmentSnap?.exists())) {
        throw serviceError('enrollment/inconsistent', 'The current enrollment is incomplete. Ask an Owner to review this record before transferring it.');
      }
      const learningMode = requestedLearningMode || (batch.learningModes || ['OFFLINE'])[0];
      let initialPayment = null;
      let offlineCount = Number(batch.offlineEnrolledCount || 0);
      if (!isSameBatch) {
        if (!['ONLINE', 'OFFLINE'].includes(learningMode) || !(batch.learningModes || ['OFFLINE']).includes(learningMode)) throw serviceError('enrollment/mode-unavailable', 'Choose a learning mode offered for this batch.');
        initialPayment = validateInitialPayment(initialPaymentAmount, batch.price ?? course.fee);
        if (learningMode === 'OFFLINE') {
          offlineCount = await offlineEnrollmentCount(transaction, batchDocId);
          if (offlineCount >= Number(batch.offlineCapacity || batch.capacity || 0)) throw serviceError('enrollment/offline-full', 'Offline seats are full. Please select Online mode if available.');
        }
      }
      const now = serverTimestamp();
      const updatedStudent = {
        ...student, ...profileChanges, studentId: student.studentId,
        course: course.name, courseDocId, courseId: course.courseId,
        batch: batch.name, batchDocId, batchId: batch.batchId,
        enrollmentStatus: 'ACTIVE', updatedAt: now, updatedBy: actorUid,
      };
      if (!isSameBatch) {
        if (oldBatchSnap?.exists() && student.enrollmentStatus === 'ACTIVE') {
          const oldBatch = oldBatchSnap.data();
          const oldOfflineCount = Math.max(0, Number(oldBatch.offlineEnrolledCount ?? (oldEnrollmentSnap.data().learningMode === 'OFFLINE' ? oldBatch.enrolledCount : 0)) - (oldEnrollmentSnap.data().learningMode === 'OFFLINE' ? 1 : 0));
          transaction.set(oldBatchRef, batchWithCount(oldBatch, Math.max(0, Number(oldBatch.enrolledCount || 0) - 1), now, actorUid, oldEnrollmentRef.id, oldOfflineCount));
          transaction.update(oldEnrollmentRef, { status: 'TRANSFERRED', updatedAt: now, updatedBy: actorUid });
        }
        if (destinationEnrollmentSnap.exists()) {
          transaction.update(newEnrollmentRef, {
            status: 'ACTIVE', studentName: updatedStudent.fullName, studentEmail: updatedStudent.email,
            studentPhone: updatedStudent.phone, updatedAt: now, updatedBy: actorUid,
          });
        } else {
          const enrollment = enrollmentRecord({ student: updatedStudent, studentDocId, course, courseDocId, batch, batchDocId, actorUid, now, learningMode });
          transaction.set(newEnrollmentRef, enrollment);
          transaction.set(newFeeRef, { enrollmentId: newEnrollmentRef.id, studentDocId, studentId: student.studentId, studentName: updatedStudent.fullName, courseName: course.name, batchId: batch.batchId, batchName: batch.name, courseDocId, batchDocId, learningMode, enrolledAt: now, totalFee: initialPayment.fee, amountPaid: initialPayment.paid, remainingBalance: initialPayment.remaining, paymentStatus: initialPayment.remaining === 0 ? 'PAID' : 'PARTIALLY_PAID', advancePaid: initialPayment.paid * 2 >= initialPayment.fee, ...(initialPayment.paid > 0 ? { lastPaymentId: initialPaymentRef.id } : {}), createdAt: now, updatedAt: now });
          if (initialPayment.paid > 0) transaction.set(initialPaymentRef, { feeRecordId: newEnrollmentRef.id, enrollmentId: newEnrollmentRef.id, studentDocId, studentId: student.studentId, batchDocId, amount: initialPayment.paid, remainingBalance: initialPayment.remaining, method: 'MANUAL', purpose: 'ADVANCE', status: 'VERIFIED', isDemo: false, reference: null, recordedBy: actorUid, createdAt: now });
        }
        transaction.set(newBatchRef, batchWithCount(batch, Number(batch.enrolledCount || 0) + 1, now, actorUid, newEnrollmentRef.id, offlineCount + (learningMode === 'OFFLINE' ? 1 : 0)));
        transaction.set(newHistoryRef, {
          studentDocId, studentId: student.studentId, action: currentBatchDocId ? 'TRANSFERRED' : 'ENROLLED',
          previousBatchDocId: currentBatchDocId || null, newBatchDocId: batchDocId, actorUid, createdAt: now,
        });
      } else {
        transaction.update(newEnrollmentRef, { studentName: updatedStudent.fullName, studentEmail: updatedStudent.email, studentPhone: updatedStudent.phone, updatedAt: now, updatedBy: actorUid });
      }
      transaction.set(studentRef, updatedStudent);
      return updatedStudent;
    });
  } catch (error) { throw explain(error); }
}

export async function updateStudentDetails(studentDocId, studentChanges, actorUid) {
  const studentRef = doc(db, STUDENTS, studentDocId);
  try {
    return await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(studentRef);
      if (!snapshot.exists()) throw serviceError('student/not-found', 'Student record not found.');
      const now = serverTimestamp();
      const updated = { ...snapshot.data(), ...studentChanges, studentId: snapshot.data().studentId, updatedAt: now, updatedBy: actorUid };
      transaction.set(studentRef, updated);
      return updated;
    });
  } catch (error) { throw explain(error); }
}

export async function withdrawStudent(studentDocId, actorUid) {
  const studentRef = doc(db, STUDENTS, studentDocId);
  const historyRef = doc(collection(db, HISTORY));
  try {
    return await runTransaction(db, async (transaction) => {
      const studentSnap = await transaction.get(studentRef);
      if (!studentSnap.exists()) throw serviceError('student/not-found', 'Student record not found.');
      const student = studentSnap.data();
      if (student.enrollmentStatus !== 'ACTIVE' || !student.batchDocId) throw serviceError('enrollment/not-active', 'This student has no active batch enrollment.');
      const batchRef = doc(db, BATCHES, student.batchDocId);
      const enrollmentRef = doc(db, ENROLLMENTS, enrollmentId(studentRef.id, student.batchDocId));
      const [batchSnap, enrollmentSnap] = await Promise.all([transaction.get(batchRef), transaction.get(enrollmentRef)]);
      if (!batchSnap.exists() || !enrollmentSnap.exists() || enrollmentSnap.data().status !== 'ACTIVE') throw serviceError('enrollment/inconsistent', 'The active enrollment record is missing. Ask an Owner to review this student.');
      const now = serverTimestamp();
      const batch = batchSnap.data(); const enrollment = enrollmentSnap.data();
      const currentOffline = Number(batch.offlineEnrolledCount ?? (enrollment.learningMode === 'OFFLINE' ? batch.enrolledCount : 0));
      transaction.set(batchRef, batchWithCount(batch, Math.max(0, Number(batch.enrolledCount || 0) - 1), now, actorUid, enrollmentRef.id, Math.max(0, currentOffline - (enrollment.learningMode === 'OFFLINE' ? 1 : 0))));
      transaction.update(enrollmentRef, { status: 'WITHDRAWN', updatedAt: now, updatedBy: actorUid });
      transaction.update(studentRef, { enrollmentStatus: 'WITHDRAWN', batchDocId: null, updatedAt: now, updatedBy: actorUid });
      transaction.set(historyRef, { studentDocId: studentRef.id, studentId: student.studentId, previousBatchDocId: student.batchDocId, action: 'WITHDRAWN', actorUid, createdAt: now });
      return { ...student, enrollmentStatus: 'WITHDRAWN', batchDocId: null };
    });
  } catch (error) { throw explain(error); }
}

export async function getBatchRoster(batchDocId, role, uid) {
  try {
    const constraints = [where('batchDocId', '==', batchDocId)];
    if (role === 'TRAINER') constraints.push(where('teacherId', '==', uid));
    const enrollmentsSnapshot = await getDocs(query(collection(db, ENROLLMENTS), ...constraints));
    const active = enrollmentsSnapshot.docs.filter((item) => item.data().status === 'ACTIVE');
    return active.map((enrollment) => {
      const record = enrollment.data();
      return {
        documentId: record.studentDocId, studentId: record.studentId, fullName: record.studentName,
        email: record.studentEmail, phone: record.studentPhone, enrollmentId: enrollment.id,
        enrolledAt: record.enrolledAt, enrolledBy: record.enrolledBy, status: record.status, learningMode: record.learningMode || 'OFFLINE',
      };
    });
  } catch (error) { throw explain(error); }
}
