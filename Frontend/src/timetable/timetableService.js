import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { DEFAULT_SETTINGS } from './scheduler';

const SETTINGS_ID = 'main';
const normalizeDay = (day) => ({ MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' }[day] || day);

export async function loadTimetableWorkspace(profile) {
  const batchesRef = collection(db, 'batches');
  const coursesRef = collection(db, 'courses');
  const batchesQuery = profile.role === 'TRAINER' ? query(batchesRef, where('teacherId', '==', profile.uid)) : batchesRef;
  const sessionRef = collection(db, 'timetableSessions');
  const sessionsQuery = profile.role === 'STUDENT' ? null : sessionRef;
  const [batchSnapshot, settingsSnapshot, sessionSnapshot, teacherSnapshot, enrollmentSnapshot] = await Promise.all([
    profile.role === 'STUDENT' ? Promise.resolve(null) : getDocs(batchesQuery),
    getDoc(doc(db, 'timetableSettings', SETTINGS_ID)),
    sessionsQuery ? getDocs(sessionsQuery) : Promise.resolve(null),
    profile.role === 'OWNER' ? getDocs(query(collection(db, 'users'), where('role', '==', 'TRAINER'))) : Promise.resolve(null),
    profile.role === 'STUDENT' ? getDocs(query(collection(db, 'enrollments'), where('studentDocId', '==', profile.uid), where('status', '==', 'ACTIVE'))) : Promise.resolve(null),
  ]);
  const courseSnapshot = profile.role === 'STUDENT' ? null : await getDocs(coursesRef);
  const courses = courseSnapshot?.docs.map((item) => ({ documentId: item.id, ...item.data() })) || [];
  const courseById = new Map(courses.flatMap((course) => [[course.documentId, course], ...(course.courseId ? [[course.courseId, course]] : [])]));
  const enrollmentRecords = enrollmentSnapshot?.docs.map((item) => ({ documentId: item.id, ...item.data() })) || [];
  const enrolledBatches = profile.role === 'STUDENT'
    ? await Promise.all(enrollmentRecords.map(async (enrollment) => {
      const snapshot = await getDoc(doc(db, 'batches', enrollment.batchDocId));
      return snapshot.exists() ? { documentId: snapshot.id, ...snapshot.data() } : null;
    }))
    : [];
  const batches = profile.role === 'STUDENT'
    ? enrolledBatches.filter(Boolean)
    : batchSnapshot.docs.map((item) => {
      const batch = { documentId: item.id, ...item.data() };
      const course = courseById.get(batch.courseDocId);
      return { ...batch, courseName: batch.courseName || course?.name || batch.course || '', courseArchived: Boolean(course?.isArchived), courseStatus: course?.status || (course ? '' : 'MISSING') };
    });
  const studentSessions = profile.role === 'STUDENT'
    ? await Promise.all(enrollmentRecords.map((enrollment) => getDocs(query(sessionRef, where('batchDocId', '==', enrollment.batchDocId), where('status', '==', 'PUBLISHED')))))
    : [];
  const knownRooms = [...new Set(batches.map((batch) => String(batch.roomNumber || '').trim()).filter(Boolean))];
  const fallbackRooms = knownRooms.map((name, index) => ({
    id: `legacy-room-${index + 1}`, name, type: /lab/i.test(name) ? 'Lab' : 'Classroom',
    capacity: Math.max(30, ...batches.filter((batch) => batch.roomNumber === name).map((batch) => Number(batch.capacity || 30))),
  }));
  // Every bookable room is stored on the institute timetable settings document.
  // Normalise each record so the scheduler always sees a stable id/name/capacity/type
  // and an explicit active flag, and fall back to legacy room preferences when an
  // institute has saved settings but never configured any rooms.
  const normalizeRoom = (room, index) => {
    const id = String(room.id || `room-${index + 1}`);
    const name = String(room.name || `Room ${index + 1}`).trim() || `Room ${index + 1}`;
    const normalized = {
      ...room, id, name,
      type: room.type || (/lab/i.test(name) ? 'Lab' : 'Classroom'),
      capacity: Number(room.capacity) > 0 ? Number(room.capacity) : 30,
    };
    if (room.active === false || room.status === 'INACTIVE') normalized.active = false;
    return normalized;
  };
  const storedRooms = (settingsSnapshot.data()?.rooms || []).filter(Boolean).map(normalizeRoom);
  const settings = settingsSnapshot.exists()
    ? { ...DEFAULT_SETTINGS, ...settingsSnapshot.data(), rooms: storedRooms.length ? storedRooms : fallbackRooms }
    : { ...DEFAULT_SETTINGS, rooms: fallbackRooms };
  return {
    batches,
    courses,
    settings,
    sessions: (profile.role === 'STUDENT' ? studentSessions.flatMap((result) => result.docs) : sessionSnapshot.docs).map((item) => ({ id: item.id, ...item.data(), day: normalizeDay(item.data().day) })),
    teachers: teacherSnapshot?.docs.map((item) => ({ uid: item.id, ...item.data() })).filter((item) => item.status === 'APPROVED') || [],
    enrollments: enrollmentRecords,
  };
}

// Firestore evaluates every write in a commit together and caps the number of
// document-access calls a single request may make (the timetable rules read each
// batch, its trainer and the settings document). Committing the whole timetable at
// once therefore fails with `permission-denied` once more than a handful of batches
// are involved, so writes are grouped into small per-batch commits.
const DISTINCT_BATCHES_PER_COMMIT = 3;
const MAX_WRITES_PER_COMMIT = 400;

function chunkByBatch(operations) {
  const chunks = [];
  let current = [];
  let batches = new Set();
  const flush = () => { if (current.length) { chunks.push(current); current = []; batches = new Set(); } };
  for (const operation of operations) {
    const key = operation.batchDocId || operation.id;
    const startsNewBatch = !batches.has(key) && batches.size >= DISTINCT_BATCHES_PER_COMMIT;
    if (current.length && (startsNewBatch || current.length >= MAX_WRITES_PER_COMMIT)) flush();
    current.push(operation);
    batches.add(key);
  }
  flush();
  return chunks;
}

function commitOperations(operations) {
  return chunkByBatch(operations).reduce(
    (chain, chunk) => chain.then(() => {
      const write = writeBatch(db);
      chunk.forEach(({ ref, kind, data }) => {
        if (kind === 'delete') write.delete(ref);
        else write.set(ref, data, { merge: true });
      });
      return write.commit();
    }),
    Promise.resolve(),
  );
}

export async function persistTimetable(settings, sessions, previousSessions) {
  const nextIds = new Set(sessions.map((session) => session.id));
  const staleDrafts = previousSessions.filter((session) => session.status !== 'PUBLISHED' && session.source === 'GENERATED' && !nextIds.has(session.id));
  await setDoc(doc(db, 'timetableSettings', SETTINGS_ID), { ...settings, updatedAt: serverTimestamp() }, { merge: true });
  const operations = [
    ...sessions.map((session) => ({
      kind: 'set',
      batchDocId: session.batchDocId,
      ref: doc(db, 'timetableSessions', session.id),
      data: { ...session, needsReview: Boolean(session.needsReview), reviewReason: session.needsReview ? session.reviewReason || 'This timetable session needs Owner review.' : '', updatedAt: serverTimestamp() },
    })),
    ...staleDrafts.map((session) => ({ kind: 'delete', batchDocId: session.batchDocId, ref: doc(db, 'timetableSessions', session.id) })),
  ];
  await commitOperations(operations);
}

export async function publishTimetable(sessions) {
  await commitOperations(sessions.map((session) => ({
    kind: 'set',
    batchDocId: session.batchDocId,
    ref: doc(db, 'timetableSessions', session.id),
    data: { status: 'PUBLISHED', publishedAt: serverTimestamp() },
  })));
}

export async function deleteTimetableDraft(session) {
  if (session.status === 'PUBLISHED') throw new Error('Published timetable sessions cannot be deleted from the editor.');
  await deleteDoc(doc(db, 'timetableSessions', session.id));
}
