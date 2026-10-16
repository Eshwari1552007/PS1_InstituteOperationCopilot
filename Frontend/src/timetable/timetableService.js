import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { DEFAULT_SETTINGS } from './scheduler';

const SETTINGS_ID = 'main';
const normalizeDay = (day) => ({ MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' }[day] || day);

export async function loadTimetableWorkspace(profile) {
  const batchesRef = collection(db, 'batches');
  const batchesQuery = profile.role === 'TRAINER' ? query(batchesRef, where('teacherId', '==', profile.uid)) : batchesRef;
  const sessionRef = collection(db, 'timetableSessions');
  const sessionsQuery = profile.role === 'TRAINER' ? query(sessionRef, where('teacherId', '==', profile.uid)) : sessionRef;
  const [batchSnapshot, settingsSnapshot, sessionSnapshot, teacherSnapshot] = await Promise.all([
    getDocs(batchesQuery), getDoc(doc(db, 'timetableSettings', SETTINGS_ID)), getDocs(sessionsQuery),
    profile.role === 'OWNER' ? getDocs(query(collection(db, 'users'), where('role', '==', 'TRAINER'))) : Promise.resolve(null),
  ]);
  const batches = batchSnapshot.docs.map((item) => ({ documentId: item.id, ...item.data() }));
  const knownRooms = [...new Set(batches.map((batch) => String(batch.roomNumber || '').trim()).filter(Boolean))];
  const fallbackRooms = knownRooms.map((name, index) => ({
    id: `legacy-room-${index + 1}`, name, type: /lab/i.test(name) ? 'Lab' : 'Classroom',
    capacity: Math.max(30, ...batches.filter((batch) => batch.roomNumber === name).map((batch) => Number(batch.capacity || 30))),
  }));
  const settings = settingsSnapshot.exists()
    ? { ...DEFAULT_SETTINGS, ...settingsSnapshot.data(), rooms: settingsSnapshot.data().rooms || [] }
    : { ...DEFAULT_SETTINGS, rooms: fallbackRooms };
  return {
    batches,
    settings,
    sessions: sessionSnapshot.docs.map((item) => ({ id: item.id, ...item.data(), day: normalizeDay(item.data().day) })),
    teachers: teacherSnapshot?.docs.map((item) => ({ uid: item.id, ...item.data() })).filter((item) => item.status === 'APPROVED') || [],
  };
}

export async function persistTimetable(settings, sessions, previousSessions) {
  const nextIds = new Set(sessions.map((session) => session.id));
  const staleDrafts = previousSessions.filter((session) => session.status !== 'PUBLISHED' && session.source === 'GENERATED' && !nextIds.has(session.id));
  await setDoc(doc(db, 'timetableSettings', SETTINGS_ID), { ...settings, updatedAt: serverTimestamp() }, { merge: true });
  const operations = [
    ...sessions.map((session) => ({ kind: 'set', id: session.id, data: { ...session, updatedAt: serverTimestamp() } })),
    ...staleDrafts.map((session) => ({ kind: 'delete', id: session.id })),
  ];
  for (let offset = 0; offset < operations.length; offset += 400) {
    const write = writeBatch(db);
    operations.slice(offset, offset + 400).forEach((operation) => {
      const ref = doc(db, 'timetableSessions', operation.id);
      if (operation.kind === 'delete') write.delete(ref);
      else write.set(ref, operation.data, { merge: true });
    });
    await write.commit();
  }
}

export async function publishTimetable(sessions) {
  for (let offset = 0; offset < sessions.length; offset += 400) {
    const write = writeBatch(db);
    sessions.slice(offset, offset + 400).forEach((session) => {
      write.update(doc(db, 'timetableSessions', session.id), { status: 'PUBLISHED', publishedAt: serverTimestamp() });
    });
    await write.commit();
  }
}

export async function deleteTimetableDraft(session) {
  if (session.status === 'PUBLISHED') throw new Error('Published timetable sessions cannot be deleted from the editor.');
  await deleteDoc(doc(db, 'timetableSessions', session.id));
}
