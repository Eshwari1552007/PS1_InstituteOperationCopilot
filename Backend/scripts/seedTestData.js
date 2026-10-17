/**
 * EDUPILOT test-data seeder
 * ----------------------------------------------------------------------------
 * Creates a realistic, rule-consistent dataset so every module (academy,
 * enrollments, fees, payments, attendance, timetable, student portal) can be
 * exercised with different scenarios:
 *   - 5 approved TRAINER accounts
 *   - 2 approved ACCOUNTS (accountant) accounts
 *   - 6 courses
 *   - 12 distinct batches (online / offline / hybrid, active + upcoming)
 *   - 100 STUDENT accounts with uneven batch distribution (7–20 per batch)
 *   - some students enrolled in more than one course
 *   - some fees fully paid (advance + installment) and some partially paid
 *
 * Run with:  npm run seed:test-data        (from the Backend folder)
 *
 * All logins use the password in SEED_PASSWORD (defaults to EduSeed@1234).
 * Re-running the script wipes the previously seeded records first, so it is
 * safe to run repeatedly.
 */
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const crypto = require('node:crypto');
const initializeFirebase = require('../config/firebase');

const { auth, db, FieldValue } = initializeFirebase();

const SEED_TAG = 'EDUPILOT_SEED_V1';
const MANIFEST_COLLECTION = 'seedManifests';
const DOMAIN = 'edupilot.test';
const YEAR = new Date().getFullYear();
const PASSWORD = process.env.SEED_PASSWORD || 'EduSeed@1234';
const TODAY = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x5eed1234);
const money = (value) => Math.round(value * 100) / 100;
const formatId = (prefix, number) => `${prefix}-${YEAR}-${String(number).padStart(4, '0')}`;
const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function ensureAuthUser(email, displayName) {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
  }
  try {
    return await auth.createUser({ email, password: PASSWORD, displayName, emailVerified: true, disabled: false });
  } catch (error) {
    if (error.code === 'auth/email-already-exists') return auth.getUserByEmail(email);
    throw error;
  }
}

async function readCounter(name) {
  const snapshot = await db.collection('sequences').doc(name).get();
  return snapshot.exists ? Number(snapshot.data().lastNumber || 0) : 0;
}

// ---------------------------------------------------------------------------
// Cleanup of a previous run (driven by the manifest so no stray marker fields
// are written into rule-validated documents).
// ---------------------------------------------------------------------------
async function cleanupPreviousRun() {
  const manifestRef = db.collection(MANIFEST_COLLECTION).doc(SEED_TAG);
  const snapshot = await manifestRef.get();
  if (!snapshot.exists) return;

  const manifest = snapshot.data();
  const writer = db.bulkWriter();
  const collect = (ids, collection) => (ids || []).forEach((id) => writer.delete(db.collection(collection).doc(id)));

  collect(manifest.courseIds, 'courses');
  collect(manifest.batchIds, 'batches');
  collect(manifest.enrollmentIds, 'enrollments');
  collect(manifest.feeRecordIds, 'feeRecords');
  collect(manifest.paymentIds, 'payments');
  collect(manifest.historyIds, 'enrollmentHistory');
  collect(manifest.studentIds, 'studentIds');
  collect(manifest.studentDocIds, 'students');
  collect(manifest.userIds, 'users');
  await writer.close();

  const uids = manifest.userIds || [];
  for (let index = 0; index < uids.length; index += 1000) {
    await auth.deleteUsers(uids.slice(index, index + 1000));
  }
  await manifestRef.delete();
  console.log(`Cleaned up the previous seed (${uids.length} accounts removed).`);
}

// ---------------------------------------------------------------------------
// Seed definitions
// ---------------------------------------------------------------------------
const TRAINER_SEEDS = [
  { name: 'Anita Sharma', phone: '+919000000101' },
  { name: 'Rahul Verma', phone: '+919000000102' },
  { name: 'Priya Nair', phone: '+919000000103' },
  { name: 'Karan Mehta', phone: '+919000000104' },
  { name: 'Sneha Iyer', phone: '+919000000105' },
];

const ACCOUNT_SEEDS = [
  { name: 'Rohit Khanna', phone: '+919000000201' },
  { name: 'Meera Pillai', phone: '+919000000202' },
];

const COURSE_SEEDS = [
  { name: 'Full Stack Web Development', category: 'Technology', duration: 6, durationUnit: 'months', fee: 45000, description: 'React, Node.js, MongoDB and deployment for full-stack engineers.' },
  { name: 'Data Science with Python', category: 'Technology', duration: 5, durationUnit: 'months', fee: 55000, description: 'Python, Pandas, statistics and machine learning foundations.' },
  { name: 'UI/UX Design Mastery', category: 'Design', duration: 4, durationUnit: 'months', fee: 38000, description: 'Figma, design systems and usability for product designers.' },
  { name: 'Digital Marketing Pro', category: 'Marketing', duration: 3, durationUnit: 'months', fee: 28000, description: 'SEO, performance ads, content and analytics for growth teams.' },
  { name: 'Cloud & DevOps Engineering', category: 'Technology', duration: 6, durationUnit: 'months', fee: 60000, description: 'AWS, Docker, Kubernetes and CI/CD pipelines.' },
  { name: 'Business Analytics with Excel & SQL', category: 'Business', duration: 2, durationUnit: 'months', fee: 22000, description: 'Spreadsheet modelling, SQL and dashboards for analysts.' },
];

// courseIndex -> COURSE_SEEDS index, teacher -> TRAINER_SEEDS index
const BATCH_SEEDS = [
  { course: 0, name: 'Full Stack - Morning A', teacher: 0, room: 'Lab 101', modes: ['ONLINE', 'OFFLINE'], size: 15, capacity: 25, hours: 6, start: '2026-07-01', end: '2027-01-31', days: ['Mon', 'Wed', 'Fri'] },
  { course: 0, name: 'Full Stack - Evening B', teacher: 1, room: '', modes: ['ONLINE'], size: 10, capacity: 20, hours: 6, start: '2026-08-01', end: '2027-02-28', days: ['Tue', 'Thu'] },
  { course: 1, name: 'Data Science - Weekend A', teacher: 2, room: 'Lab 202', modes: ['OFFLINE'], size: 20, capacity: 30, hours: 8, start: '2026-07-15', end: '2027-01-15', days: ['Sat', 'Sun'] },
  { course: 1, name: 'Data Science - Online B', teacher: 3, room: '', modes: ['ONLINE'], size: 12, capacity: 20, hours: 8, start: '2026-09-01', end: '2027-03-01', days: ['Mon', 'Thu'] },
  { course: 2, name: 'UI/UX Design - Morning A', teacher: 4, room: 'Studio 1', modes: ['ONLINE', 'OFFLINE'], size: 8, capacity: 18, hours: 5, start: '2026-08-10', end: '2026-12-20', days: ['Tue', 'Fri'] },
  { course: 2, name: 'UI/UX Design - Evening B', teacher: 0, room: 'Studio 2', modes: ['OFFLINE'], size: 16, capacity: 24, hours: 5, start: '2026-07-20', end: '2026-11-30', days: ['Mon', 'Wed'] },
  { course: 3, name: 'Digital Marketing - Fast Track A', teacher: 1, room: 'Hall 1', modes: ['ONLINE', 'OFFLINE'], size: 14, capacity: 22, hours: 4, start: '2026-09-05', end: '2026-12-05', days: ['Mon', 'Wed', 'Fri'] },
  { course: 3, name: 'Digital Marketing - Online B', teacher: 2, room: '', modes: ['ONLINE'], size: 9, capacity: 18, hours: 4, start: '2026-10-01', end: '2027-01-01', days: ['Tue', 'Sat'] },
  { course: 4, name: 'Cloud & DevOps - Morning A', teacher: 3, room: 'Lab 303', modes: ['OFFLINE'], size: 18, capacity: 28, hours: 7, start: '2026-07-05', end: '2027-01-05', days: ['Mon', 'Fri'] },
  { course: 4, name: 'Cloud & DevOps - Evening B', teacher: 4, room: 'Lab 304', modes: ['ONLINE', 'OFFLINE'], size: 11, capacity: 20, hours: 7, start: '2026-08-15', end: '2027-02-15', days: ['Wed', 'Sat'] },
  { course: 5, name: 'Business Analytics - Weekend A', teacher: 0, room: 'Hall 2', modes: ['OFFLINE'], size: 7, capacity: 16, hours: 3, start: '2026-09-10', end: '2026-12-10', days: ['Sat', 'Sun'] },
  { course: 5, name: 'Business Analytics - Upcoming C', teacher: 1, room: 'Hall 3', modes: ['ONLINE', 'OFFLINE'], size: 13, capacity: 22, hours: 3, start: '2026-11-10', end: '2027-04-10', days: ['Tue', 'Thu'] },
];

const FIRST_NAMES = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayush', 'Krishna', 'Ishaan', 'Ananya', 'Diya', 'Aadhya', 'Saanvi', 'Myra', 'Aarohi', 'Anika', 'Navya', 'Kiara', 'Riya'];
const LAST_NAMES = ['Sharma', 'Verma', 'Patel', 'Reddy', 'Nair', 'Iyer', 'Mehta', 'Gupta', 'Singh', 'Khan', 'Das', 'Bose', 'Rao', 'Kulkarni', 'Joshi', 'Chopra', 'Malhotra', 'Bansal', 'Agarwal', 'Menon'];
const TOTAL_STUDENTS = 100;

function studentProfile(index) {
  const fullName = `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length]}`;
  return {
    fullName,
    email: `student${String(index + 1).padStart(3, '0')}@${DOMAIN}`,
    phone: `+9198${String(100000 + index).padStart(6, '0')}`,
    gender: index % 2 === 0 ? 'Male' : 'Female',
    dateOfBirth: `199${index % 10}-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 27) + 1).padStart(2, '0')}`,
    guardianName: `${LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length]} Guardian`,
    guardianPhone: `+9197${String(200000 + index).padStart(6, '0')}`,
    address: `${index + 1}, Seed Street, Bengaluru 560${String(index % 100).padStart(3, '0')}`,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
  console.log('EDUPILOT test-data seeder starting...');
  if (!process.env.FIREBASE_PROJECT_ID) {
    console.warn('Warning: FIREBASE_PROJECT_ID is not set; falling back to the default project.');
  }

  await cleanupPreviousRun();

  // Actor for createdBy / enrolledBy / recordedBy fields.
  let actorUid = 'seed-script';
  if (process.env.OWNER_EMAIL) {
    try {
      actorUid = (await auth.getUserByEmail(process.env.OWNER_EMAIL.trim().toLowerCase())).uid;
    } catch (error) {
      console.warn(`Warning: OWNER_EMAIL account not found; using "seed-script" as the acting user.`);
    }
  }

  // ---- Trainers -----------------------------------------------------------
  console.log(`Creating ${TRAINER_SEEDS.length} trainer accounts...`);
  const trainers = await mapLimit(TRAINER_SEEDS, 5, async (seed, index) => {
    const email = `trainer${index + 1}@${DOMAIN}`;
    const user = await ensureAuthUser(email, seed.name);
    return { uid: user.uid, email, name: seed.name, phone: seed.phone };
  });

  // ---- Accountants --------------------------------------------------------
  console.log(`Creating ${ACCOUNT_SEEDS.length} accountant accounts...`);
  const accountants = await mapLimit(ACCOUNT_SEEDS, 5, async (seed, index) => {
    const email = `accounts${index + 1}@${DOMAIN}`;
    const user = await ensureAuthUser(email, seed.name);
    return { uid: user.uid, email, name: seed.name, phone: seed.phone };
  });

  // ---- Courses (ID sequence) ---------------------------------------------
  let courseCounter = await readCounter(`course-${YEAR}`);
  const courses = COURSE_SEEDS.map((definition) => {
    courseCounter += 1;
    const courseId = formatId('CRS', courseCounter);
    return { ...definition, courseId, documentId: courseId };
  });

  // ---- Batches (ID sequence) ---------------------------------------------
  let batchCounter = await readCounter(`batch-${YEAR}`);
  const batches = BATCH_SEEDS.map((definition, index) => {
    batchCounter += 1;
    const batchId = formatId('BAT', batchCounter);
    const course = courses[definition.course];
    const teacher = trainers[definition.teacher];
    const status = definition.start > TODAY ? 'UPCOMING' : (definition.end < TODAY ? 'COMPLETED' : 'ACTIVE');
    return {
      ...definition,
      batchId,
      documentId: batchId,
      course,
      teacher,
      capacity: definition.capacity,
      offlineCapacity: definition.capacity,
      price: course.fee,
      status,
      courseName: course.name,
      courseId: course.courseId,
      teacherName: teacher.name,
      slots: [],
      offlineEnrolledCount: 0,
      createdAt: daysAgo(90 - index),
    };
  });

  // ---- Enrollment plan (uneven sizes, some students in 2 courses) --------
  const slotOwners = [];
  const totalSlots = batches.reduce((sum, batch) => sum + batch.size, 0);
  for (let slot = 0; slot < totalSlots; slot += 1) slotOwners.push(slot % TOTAL_STUDENTS);

  let pointer = 0;
  const studentEnrollments = Array.from({ length: TOTAL_STUDENTS }, () => []);
  for (const batch of batches) {
    while (batch.slots.length < batch.size) {
      const studentIndex = slotOwners[pointer % slotOwners.length];
      pointer += 1;
      if (batch.slots.includes(studentIndex)) continue;
      batch.slots.push(studentIndex);
      studentEnrollments[studentIndex].push(batch);
    }
  }

  // ---- Students -----------------------------------------------------------
  console.log(`Creating ${TOTAL_STUDENTS} student accounts...`);
  const students = await mapLimit(
    Array.from({ length: TOTAL_STUDENTS }, (_, index) => index),
    8,
    async (index) => {
      const profile = studentProfile(index);
      const user = await ensureAuthUser(profile.email, profile.fullName);
      const primary = studentEnrollments[index][0];
      return { index, uid: user.uid, ...profile, enrollments: studentEnrollments[index], primary };
    },
  );

  // ---- Student IDs + sequences -------------------------------------------
  let studentCounter = await readCounter(`student-${YEAR}`);
  const studentRecords = students.map((student) => {
    studentCounter += 1;
    const studentId = formatId('STU', studentCounter);
    return { ...student, studentId };
  });
  const lastStudent = studentRecords[studentRecords.length - 1];

  // ---- Build every Firestore document ------------------------------------
  const docs = {
    courses: [], batches: [], students: [], studentIds: [], enrollments: [], feeRecords: [], payments: [], enrollmentHistory: [], users: [],
  };
  const userIds = [];

  trainers.forEach((trainer) => {
    userIds.push(trainer.uid);
    docs.users.push([trainer.uid, {
      uid: trainer.uid,
      name: trainer.name,
      email: trainer.email,
      phone: trainer.phone,
      role: 'TRAINER',
      status: 'APPROVED',
      createdAt: daysAgo(120),
      approvedAt: daysAgo(119),
      approvedBy: actorUid,
    }]);
  });

  accountants.forEach((accountant) => {
    userIds.push(accountant.uid);
    docs.users.push([accountant.uid, {
      uid: accountant.uid,
      name: accountant.name,
      email: accountant.email,
      phone: accountant.phone,
      role: 'ACCOUNTS',
      status: 'APPROVED',
      createdAt: daysAgo(118),
      approvedAt: daysAgo(117),
      approvedBy: actorUid,
    }]);
  });

  courses.forEach((course) => {
    docs.courses.push([course.courseId, {
      name: course.name,
      description: course.description,
      category: course.category,
      duration: course.duration,
      durationUnit: course.durationUnit,
      fee: course.fee,
      status: 'ACTIVE',
      courseId: course.courseId,
      isArchived: false,
      createdAt: daysAgo(100),
      updatedAt: daysAgo(100),
      createdBy: actorUid,
    }]);
  });

  studentRecords.forEach((student) => {
    userIds.push(student.uid);
    docs.users.push([student.uid, {
      uid: student.uid,
      name: student.fullName,
      email: student.email,
      phone: student.phone,
      role: 'STUDENT',
      status: 'APPROVED',
      createdAt: daysAgo(100 - (student.index % 60)),
      approvedAt: daysAgo(100 - (student.index % 60)),
    }]);
    docs.studentIds.push([student.studentId, { studentDocId: student.uid, createdAt: daysAgo(60), createdBy: actorUid }]);
  });

  const paymentIds = [];
  const enrollmentIds = [];
  const feeRecordIds = [];
  const historyIds = [];
  let paidCount = 0;
  let partialCount = 0;

  studentRecords.forEach((student) => {
    const admissions = student.enrollments;
    const enrollmentDocs = admissions.map((batch, order) => {
      const enrolledAt = daysAgo(60 - (student.index % 45) + order);
      let mode = batch.modes[0];
      if (batch.modes.length > 1) mode = rand() < 0.5 ? 'ONLINE' : 'OFFLINE';
      const enrollmentId = `${student.uid}__${batch.batchId}`;
      const totalFee = batch.price;

      // Payment scenario: ~40% fully paid (advance + instalment), ~60% partial.
      const fullyPaid = rand() < 0.4;
      if (fullyPaid) paidCount += 1; else partialCount += 1;
      const advance = fullyPaid
        ? money(totalFee / 2)
        : money(totalFee * (0.5 + rand() * 0.4));
      const remaining = money(totalFee - advance);

      const advancePaymentId = `initial_${enrollmentId}`;
      const instalmentPaymentId = `instalment_${enrollmentId}`;

      const payments = [[advancePaymentId, {
        feeRecordId: enrollmentId,
        enrollmentId,
        studentDocId: student.uid,
        studentId: student.studentId,
        batchDocId: batch.batchId,
        amount: advance,
        remainingBalance: remaining,
        method: 'MANUAL',
        purpose: 'ADVANCE',
        status: 'VERIFIED',
        isDemo: false,
        reference: null,
        recordedBy: actorUid,
        createdAt: enrolledAt,
      }]];

      if (fullyPaid && remaining > 0) {
        payments.push([instalmentPaymentId, {
          feeRecordId: enrollmentId,
          enrollmentId,
          studentDocId: student.uid,
          studentId: student.studentId,
          batchDocId: batch.batchId,
          amount: remaining,
          remainingBalance: 0,
          method: 'MANUAL',
          purpose: 'TUITION',
          status: 'VERIFIED',
          isDemo: false,
          reference: null,
          recordedBy: actorUid,
          createdAt: daysAgo(10),
        }]);
      }

      const amountPaid = fullyPaid ? totalFee : advance;
      const lastPaymentId = payments[payments.length - 1][0];

      payments.forEach(([id, data]) => { docs.payments.push([id, data]); paymentIds.push(id); });

      docs.feeRecords.push([enrollmentId, {
        enrollmentId,
        studentDocId: student.uid,
        studentId: student.studentId,
        studentName: student.fullName,
        courseName: batch.courseName,
        batchId: batch.batchId,
        batchName: batch.name,
        courseDocId: batch.course.courseId,
        batchDocId: batch.batchId,
        learningMode: mode,
        enrolledAt,
        totalFee,
        amountPaid,
        remainingBalance: money(totalFee - amountPaid),
        paymentStatus: amountPaid >= totalFee ? 'PAID' : 'PARTIALLY_PAID',
        advancePaid: amountPaid * 2 >= totalFee,
        lastPaymentId,
        createdAt: enrolledAt,
        updatedAt: enrolledAt,
      }]);
      feeRecordIds.push(enrollmentId);

      const enrollment = {
        studentDocId: student.uid,
        studentId: student.studentId,
        courseDocId: batch.course.courseId,
        courseId: batch.course.courseId,
        courseName: batch.courseName,
        batchDocId: batch.batchId,
        batchId: batch.batchId,
        batchName: batch.name,
        studentName: student.fullName,
        studentEmail: student.email,
        studentPhone: student.phone,
        status: 'ACTIVE',
        learningMode: mode,
        feeRecordId: enrollmentId,
        teacherId: batch.teacher.uid,
        enrolledAt,
        enrolledBy: actorUid,
        updatedAt: enrolledAt,
        updatedBy: actorUid,
      };
      docs.enrollments.push([enrollmentId, enrollment]);
      enrollmentIds.push(enrollmentId);

      const historyId = crypto.randomUUID();
      docs.enrollmentHistory.push([historyId, {
        studentDocId: student.uid,
        studentId: student.studentId,
        courseDocId: batch.course.courseId,
        batchDocId: batch.batchId,
        action: 'ENROLLED',
        actorUid,
        createdAt: enrolledAt,
      }]);
      historyIds.push(historyId);

      if (fullyPaid && remaining > 0) {
        const instalmentHistoryId = crypto.randomUUID();
        docs.enrollmentHistory.push([instalmentHistoryId, {
          studentDocId: student.uid,
          studentId: student.studentId,
          courseDocId: batch.course.courseId,
          batchDocId: batch.batchId,
          action: 'INSTALLMENT_PAID',
          actorUid,
          paymentId: instalmentPaymentId,
          createdAt: daysAgo(10),
        }]);
        historyIds.push(instalmentHistoryId);
      }

      batch.offlineEnrolledCount += mode === 'OFFLINE' ? 1 : 0;
      return { enrollment, batch, mode };
    });

    const primary = enrollmentDocs[0];
    docs.students.push([student.uid, {
      studentId: student.studentId,
      authUid: student.uid,
      fullName: student.fullName,
      email: student.email,
      phone: student.phone,
      dateOfBirth: student.dateOfBirth,
      gender: student.gender,
      course: primary.batch.courseName,
      batch: primary.batch.name,
      courseDocId: primary.batch.course.courseId,
      courseId: primary.batch.course.courseId,
      batchDocId: primary.batch.batchId,
      batchId: primary.batch.batchId,
      admissionDate: daysAgo(60 - (student.index % 45)).toISOString().slice(0, 10),
      status: 'ACTIVE',
      accountStatus: 'ACTIVE',
      enrollmentStatus: 'ACTIVE',
      isArchived: false,
      address: student.address,
      guardianName: student.guardianName,
      guardianPhone: student.guardianPhone,
      createdAt: daysAgo(60 - (student.index % 45)),
      updatedAt: daysAgo(60 - (student.index % 45)),
      createdBy: actorUid,
      updatedBy: actorUid,
    }]);
  });

  batches.forEach((batch) => {
    docs.batches.push([batch.batchId, {
      name: batch.name,
      courseDocId: batch.course.courseId,
      courseId: batch.course.courseId,
      courseName: batch.courseName,
      teacherId: batch.teacher.uid,
      teacherName: batch.teacherName,
      roomNumber: batch.room,
      startDate: batch.start,
      endDate: batch.end,
      daysOfWeek: batch.days,
      startTime: '',
      endTime: '',
      capacity: batch.capacity,
      offlineCapacity: batch.offlineCapacity,
      weeklyTeachingHours: batch.hours,
      price: batch.price,
      learningModes: batch.modes,
      onlineClassDetails: batch.modes.includes('ONLINE') ? 'Join link is shared before every session.' : '',
      isClosed: false,
      isArchived: false,
      batchId: batch.batchId,
      enrolledCount: batch.size,
      offlineEnrolledCount: batch.offlineEnrolledCount,
      status: batch.status,
      createdAt: batch.createdAt,
      updatedAt: batch.createdAt,
      createdBy: actorUid,
      updatedBy: actorUid,
    }]);
  });

  // ---- Write everything ---------------------------------------------------
  console.log('Writing Firestore documents...');
  const writer = db.bulkWriter();
  let written = 0;
  Object.entries(docs).forEach(([collectionName, entries]) => {
    entries.forEach(([id, data]) => {
      writer.set(db.collection(collectionName).doc(id), data);
      written += 1;
    });
  });

  await writer.close();
  console.log(`Wrote ${written} documents.`);

  // ---- Sequences ----------------------------------------------------------
  const now = FieldValue.serverTimestamp();
  await Promise.all([
    db.collection('sequences').doc(`course-${YEAR}`).set({ lastNumber: courseCounter, updatedAt: now }),
    db.collection('sequences').doc(`batch-${YEAR}`).set({ lastNumber: batchCounter, updatedAt: now }),
    db.collection('sequences').doc(`student-${YEAR}`).set({ lastNumber: studentCounter, lastStudentId: lastStudent.studentId, lastStudentDocId: lastStudent.uid, updatedAt: now }),
  ]);

  // ---- Manifest -----------------------------------------------------------
  await db.collection(MANIFEST_COLLECTION).doc(SEED_TAG).set({
    createdAt: now,
    userIds,
    courseIds: courses.map((course) => course.courseId),
    batchIds: batches.map((batch) => batch.batchId),
    studentDocIds: studentRecords.map((student) => student.uid),
    studentIds: studentRecords.map((student) => student.studentId),
    enrollmentIds,
    feeRecordIds,
    paymentIds,
    historyIds,
  });

  // ---- Summary ------------------------------------------------------------
  const multiCourse = studentRecords.filter((student) => student.enrollments.length > 1).length;
  const onlineEnrollments = docs.enrollments.filter(([, data]) => data.learningMode === 'ONLINE').length;

  console.log('\nSeed complete.');
  console.log(`  Trainers   : ${trainers.length}`);
  console.log(`  Accountants: ${accountants.length}`);
  console.log(`  Courses    : ${courses.length}`);
  console.log(`  Batches    : ${batches.length}`);
  console.log(`  Students   : ${studentRecords.length} (${multiCourse} enrolled in a second course)`);
  console.log(`  Enrollments: ${enrollmentIds.length} (${onlineEnrollments} online / ${enrollmentIds.length - onlineEnrollments} offline)`);
  console.log(`  Fees       : ${paidCount} fully paid, ${partialCount} partially paid (pending balance)`);
  console.log(`\nLogin password for every seeded account: ${PASSWORD}`);
  console.log(`  Trainer example: trainer1@${DOMAIN}`);
  console.log(`  Accounts example: accounts1@${DOMAIN}`);
  console.log(`  Student example: student001@${DOMAIN}`);
  console.log(`  Owner account  : ${process.env.OWNER_EMAIL || '(not configured)'}`);
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`Seeding failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
