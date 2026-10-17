import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarDays, RefreshCw } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { loadTimetableWorkspace } from '../timetable/timetableService';
import { calculateStudentAttendance, dateInTimeZone, DEFAULT_INSTITUTE_TIME_ZONE, zonedDateTime } from './attendanceModel';
import './attendance.css';

const timeOfDay = (minutes, timeZone) => new Intl.DateTimeFormat(undefined, { timeZone, hour: 'numeric', minute: '2-digit' }).format(zonedDateTime('2026-01-01', `${String(Math.floor(Number(minutes) / 60)).padStart(2, '0')}:${String(Number(minutes) % 60).padStart(2, '0')}`, timeZone));
const plusDays = (date, amount) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + amount); return value.toISOString().slice(0, 10); };
const weekday = (date) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${date}T12:00:00Z`));

export default function StudentAttendance({ profile }) {
  const [data, setData] = useState({ enrollments: [], batches: [], timetable: [], sessions: [], records: [], timeZone: DEFAULT_INSTITUTE_TIME_ZONE });
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [courseFilter, setCourseFilter] = useState(''); const [batchFilter, setBatchFilter] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [workspace, enrollmentSnap, recordSnap] = await Promise.all([
        loadTimetableWorkspace(profile),
        getDocs(query(collection(db, 'enrollments'), where('studentDocId', '==', profile.uid))),
        getDocs(query(collection(db, 'attendanceRecords'), where('studentDocId', '==', profile.uid))),
      ]);
      const enrollments = enrollmentSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
      const batches = workspace.batches || [];
      const perBatch = await Promise.all(enrollments.map((enrollment) => getDocs(query(collection(db, 'attendanceSessions'), where('batchDocId', '==', enrollment.batchDocId), where('status', 'in', ['OPEN', 'COMPLETED', 'CANCELLED'])))));
      const sessions = perBatch.flatMap((snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      setData({ enrollments, batches, timetable: workspace.sessions || [], sessions, records: recordSnap.docs.map((item) => ({ id: item.id, ...item.data() })), timeZone: workspace.settings?.timeZone || DEFAULT_INSTITUTE_TIME_ZONE });
    } catch (failure) { setError(failure.code === 'permission-denied' ? 'Firestore denied your attendance records. Confirm your account is approved and deploy the current attendance security rules.' : failure.message || 'Attendance data could not be loaded.'); }
    finally { setLoading(false); }
  }, [profile]);
  useEffect(() => { refresh(); }, [refresh]);

  const today = dateInTimeZone(new Date(), data.timeZone);
  const sessionById = useMemo(() => new Map(data.sessions.map((item) => [item.id, item])), [data.sessions]);
  const courses = [...new Set(data.enrollments.map((item) => item.courseDocId).filter(Boolean))];
  const enrollments = data.enrollments.filter((item) => item.status === 'ACTIVE' && (!courseFilter || item.courseDocId === courseFilter) && (!batchFilter || item.batchDocId === batchFilter));
  const upcoming = data.timetable.flatMap((slot) => {
    const enrollment = data.enrollments.find((item) => item.batchDocId === slot.batchDocId);
    const batch = data.batches.find((item) => item.documentId === slot.batchDocId);
    if (!enrollment || enrollment.status !== 'ACTIVE' || !batch) return [];
    return Array.from({ length: 8 }, (_, offset) => plusDays(today, offset)).filter((date) => weekday(date) === slot.day && (!batch.startDate || date >= batch.startDate) && (!batch.endDate || date <= batch.endDate))
      .map((date) => ({ ...slot, date, enrollment, batch }));
  }).sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes).slice(0, 8);
  const overall = calculateStudentAttendance(data.records, sessionById);
  const history = data.records.map((record) => ({ ...record, session: sessionById.get(record.sessionId) })).filter((record) => record.session && record.session.status !== 'CANCELLED')
    .sort((a, b) => String(b.date || b.session.date).localeCompare(String(a.date || a.session.date)) || Number(b.startMinutes || 0) - Number(a.startMinutes || 0));

  return <main className="att-page"><header className="att-header"><div><p className="att-eyebrow">STUDENT WORKSPACE</p><h1>My Attendance</h1><p>Your attendance and upcoming lectures for active enrollments.</p></div><button type="button" className="att-button att-button--quiet" onClick={refresh} disabled={loading}><RefreshCw size={16}/> Refresh</button></header>
    {error && <p className="att-alert" role="alert"><AlertCircle size={17}/>{error}</p>}
    {loading ? <div className="att-empty">Loading your attendance…</div> : <>
      <section className="att-stats att-stats--student"><article><span>Attendance percentage</span><strong>{overall.percentage === null ? '—' : `${overall.percentage}%`}</strong><small>Present + late ÷ finalized present, late, absent marks. Excused and unmarked excluded.</small></article><article><span>Finalized marked sessions</span><strong>{overall.finalizedMarkedSessions}</strong></article><article><span>Present</span><strong>{overall.counts.PRESENT}</strong></article><article><span>Absent</span><strong>{overall.counts.ABSENT}</strong></article><article><span>Late / excused</span><strong>{overall.counts.LATE} / {overall.counts.EXCUSED}</strong></article></section>
      <section className="att-card"><div className="att-card__header"><div><h2>Course and batch summary</h2><p>Only your own saved attendance records are used. No finalized marks yet is shown as —.</p></div></div><div className="att-filters"><label><span>Course</span><select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}><option value="">All courses</option>{courses.map((id) => <option key={id} value={id}>{data.enrollments.find((item) => item.courseDocId === id)?.courseName || id}</option>)}</select></label><label><span>Batch</span><select value={batchFilter} onChange={(event) => setBatchFilter(event.target.value)}><option value="">All batches</option>{data.enrollments.map((item) => <option key={item.id} value={item.batchDocId}>{item.batchName} · {item.batchId}</option>)}</select></label></div><div className="att-session-grid">{enrollments.map((enrollment) => {
        const matching = data.records.filter((record) => record.batchDocId === enrollment.batchDocId);
        const stats = calculateStudentAttendance(matching, sessionById);
        const batch = data.batches.find((item) => item.documentId === enrollment.batchDocId);
        const cancelled = data.sessions.filter((session) => session.batchDocId === enrollment.batchDocId && session.status === 'CANCELLED').length;
        return <article className="att-session att-student-course" key={enrollment.id}><span className="att-badge">{enrollment.learningMode || 'Mode not set'}</span><h3>{enrollment.courseName || 'Course'} · {enrollment.batchName || batch?.name || 'Batch'}</h3><p>{enrollment.batchId || batch?.batchId}</p><strong className="att-student-course__percentage">{stats.percentage === null ? '—' : `${stats.percentage}%`}</strong><span>{stats.qualifyingSessions} qualifying finalized marks · {stats.counts.PRESENT} present · {stats.counts.ABSENT} absent · {stats.counts.LATE} late · {stats.counts.EXCUSED} excused</span>{cancelled > 0 && <small>{cancelled} cancelled lecture(s), excluded</small>}</article>;
      })}{!enrollments.length && <div className="att-empty">No active course enrollments.</div>}</div></section>
      <section className="att-card"><div className="att-card__header"><div><h2>Upcoming lectures</h2><p>Published timetable sessions · institute time zone: {data.timeZone}</p></div></div>{upcoming.length ? <div className="att-history">{upcoming.map((item) => <article key={`${item.id}-${item.date}`}><span className="att-badge att-badge--upcoming">Upcoming</span><strong>{item.courseName || item.enrollment.courseName} · {item.batchName || item.batch.name}</strong><span>{new Intl.DateTimeFormat(undefined, { timeZone: data.timeZone, dateStyle: 'medium' }).format(new Date(`${item.date}T12:00:00Z`))} · {timeOfDay(item.startMinutes, data.timeZone)}–{timeOfDay(item.endMinutes, data.timeZone)}</span><span>{item.roomName || (item.roomId === 'ONLINE' ? 'Online' : 'Room')} · {item.deliveryMode || item.enrollment.learningMode}</span></article>)}</div> : <p className="att-empty"><CalendarDays size={20}/> No upcoming published lectures.</p>}</section>
      <section className="att-card"><div className="att-card__header"><div><h2>Attendance history</h2><p>Cancelled sessions are omitted here. Unmarked students do not have an attendance result.</p></div></div>{history.length ? <div className="att-history">{history.map((record) => <article key={record.id}><span className={`att-badge att-badge--${record.status.toLowerCase()}`}>{record.status}</span><strong>{record.courseName || 'Course'} · {record.batchName || 'Batch'}</strong><span>{record.date || record.session.date} · {record.startTime || record.session.startTime}–{record.endTime || record.session.endTime}</span><span>{record.learningMode || 'Mode not recorded'} · {record.teacherName || 'Trainer'}</span></article>)}</div> : <p className="att-empty">No finalized attendance marks yet.</p>}</section>
    </>}
  </main>;
}
