import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, RefreshCw, Search, Users } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { loadAcademyWorkspace } from '../batches/academyService';
import { loadTimetableWorkspace } from '../timetable/timetableService';
import { cancelAttendanceOccurrence, finalizeAttendanceOccurrence, openAttendanceOccurrence, saveAttendanceRecords } from './attendanceApi';
import { ATTENDANCE_STATES, attendanceAvailability, buildOccurrences, dateInTimeZone, DEFAULT_INSTITUTE_TIME_ZONE, zonedDateTime } from './attendanceModel';
import './attendance.css';

const statusLabel = (status) => ({ UPCOMING: 'Upcoming', IN_PROGRESS: 'In progress', LATE_ENTRY: 'Attendance open', RECORDED: 'Recorded', CANCELLED: 'Cancelled' }[status] || status);
const dateShift = (date, offset) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); };
const timeLabel = (value, timeZone) => new Intl.DateTimeFormat(undefined, { timeZone, hour: 'numeric', minute: '2-digit' }).format(zonedDateTime('2026-01-01', value, timeZone));

export default function AttendanceWorkspace({ profile }) {
  const [date, setDate] = useState(() => dateInTimeZone(new Date(), DEFAULT_INSTITUTE_TIME_ZONE));
  const [workspace, setWorkspace] = useState({ batches: [], courses: [], timetable: [], settings: {}, savedSessions: [], records: [] });
  const [roster, setRoster] = useState([]); const [marked, setMarked] = useState({});
  const [selectedId, setSelectedId] = useState(''); const [courseFilter, setCourseFilter] = useState(''); const [batchFilter, setBatchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState(''); const [modeFilter, setModeFilter] = useState(''); const [search, setSearch] = useState(''); const [tab, setTab] = useState('sessions');
  const [rosterStatusFilter, setRosterStatusFilter] = useState('');
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [now, setNow] = useState(() => new Date());
  const owner = profile.role === 'OWNER'; const trainer = profile.role === 'TRAINER'; const timeZone = workspace.settings.timeZone || DEFAULT_INSTITUTE_TIME_ZONE;

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [timetableResult, savedResult, recordsResult] = await Promise.allSettled([
        (owner || trainer) ? loadTimetableWorkspace(profile) : loadAcademyWorkspace(profile.role, profile.uid),
        getDocs(trainer ? query(collection(db, 'attendanceSessions'), where('teacherId', '==', profile.uid)) : collection(db, 'attendanceSessions')),
        getDocs(trainer ? query(collection(db, 'attendanceRecords'), where('teacherId', '==', profile.uid)) : collection(db, 'attendanceRecords')),
      ]);
      if (timetableResult.status === 'rejected') throw timetableResult.reason;
      if (savedResult.status === 'rejected') throw savedResult.reason;
      if (recordsResult.status === 'rejected') throw recordsResult.reason;
      const base = timetableResult.status === 'fulfilled' ? timetableResult.value : {};
      const sessions = savedResult.value.docs.map((item) => ({ id: item.id, ...item.data() }));
      const records = recordsResult.value.docs.map((item) => ({ id: item.id, ...item.data() }));
      const batches = base.batches || [];
      const courses = base.courses || [];
      const scheduled = (base.sessions || []).filter((item) => item.status === 'PUBLISHED' && (!trainer || item.teacherId === profile.uid));
      const settings = base.settings || { timeZone: DEFAULT_INSTITUTE_TIME_ZONE };
      setWorkspace({ batches, courses, timetable: scheduled, settings, savedSessions: sessions, records });
    } catch (failure) {
      setError(failure.code === 'permission-denied' ? 'Firestore denied attendance access. Check your approved role, trainer assignment, and the deployed attendance rules.' : failure.message || 'Attendance data could not be loaded.');
    } finally { setLoading(false); }
  }, [owner, trainer, profile]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(timer); }, []);

  const batchesById = useMemo(() => new Map(workspace.batches.map((item) => [item.documentId, item])), [workspace.batches]);
  const coursesById = useMemo(() => new Map(workspace.courses.map((item) => [item.documentId, item])), [workspace.courses]);
  const occurrences = useMemo(() => buildOccurrences(workspace.timetable, workspace.savedSessions, date, timeZone).filter((item) => {
    const batch = batchesById.get(item.batchDocId);
    return (!batch?.startDate || date >= batch.startDate) && (!batch?.endDate || date <= batch.endDate);
  }), [workspace.timetable, workspace.savedSessions, date, timeZone, batchesById]);
  const enriched = occurrences.map((item) => {
    const batch = batchesById.get(item.batchDocId); const course = coursesById.get(item.courseDocId || batch?.courseDocId);
    const saved = item.attendanceSession;
    const status = saved ? attendanceAvailability(saved, now) : attendanceAvailability({ ...item, date, timeZone }, now);
    const sessionRecords = saved ? workspace.records.filter((record) => record.sessionId === saved.id) : [];
    const counts = Object.fromEntries([...ATTENDANCE_STATES, 'UNMARKED'].map((key) => [key, 0]));
    sessionRecords.forEach((record) => { if (counts[record.status] !== undefined) counts[record.status] += 1; });
    counts.UNMARKED = Math.max(0, Number(saved?.expectedStudentCount ?? batch?.enrolledCount ?? 0) - sessionRecords.length);
    return { ...item, batch, course, saved, attendanceStatus: status, records: sessionRecords, counts };
  });
  const visible = enriched.filter((item) => (!courseFilter || (item.course?.documentId || item.courseDocId) === courseFilter)
    && (!batchFilter || item.batchDocId === batchFilter) && (!statusFilter || item.attendanceStatus === statusFilter)
    && (!modeFilter || (item.deliveryMode || (item.roomId === 'ONLINE' ? 'ONLINE' : 'OFFLINE')) === modeFilter)
    && `${item.course?.name || item.courseName || ''} ${item.batch?.name || item.batchName || ''} ${item.batch?.batchId || item.batchId || ''} ${item.teacherName || ''}`.toLowerCase().includes(search.toLowerCase()));
  const selected = enriched.find((item) => item.occurrenceId === selectedId || item.saved?.id === selectedId);
  const selectedSessionId = selected?.saved?.id;
  const rosterFilters = useMemo(() => {
    return roster.filter((student) => (!modeFilter || (student.learningMode || 'OFFLINE') === modeFilter)
      && (!rosterStatusFilter || (rosterStatusFilter === 'UNMARKED' ? !marked[student.studentDocId] : marked[student.studentDocId] === rosterStatusFilter))
      && (!search || `${student.studentName || ''} ${student.studentId || ''}`.toLowerCase().includes(search.toLowerCase())));
  }, [roster, modeFilter, rosterStatusFilter, marked, search]);
  const sessionCounts = enriched.reduce((sum, item) => ({ ...sum, [item.attendanceStatus]: (sum[item.attendanceStatus] || 0) + 1 }), {});
  const attendancePercent = (() => {
    const rows = workspace.records.filter((record) => {
      const session = workspace.savedSessions.find((item) => item.id === record.sessionId);
      return session?.status === 'COMPLETED' && (record.status === 'PRESENT' || record.status === 'LATE' || record.status === 'ABSENT');
    });
    const denominator = rows.length;
    return denominator ? Math.round(rows.filter((item) => ['PRESENT', 'LATE'].includes(item.status)).length / denominator * 100) : null;
  })();

  const openRoster = async (occurrence) => {
    setError(''); setNotice(''); setSaving(true);
    try {
      let session = occurrence.saved;
      if (!session) {
        const result = await openAttendanceOccurrence(occurrence.id, date);
        session = result.session;
        setWorkspace((current) => ({ ...current, savedSessions: [...current.savedSessions.filter((item) => item.id !== session.id), session] }));
      }
      setSelectedId(session.id);
      const enrollmentConstraints = [where('batchDocId', '==', occurrence.batchDocId), where('status', '==', 'ACTIVE')];
      if (trainer) enrollmentConstraints.push(where('teacherId', '==', profile.uid));
      const [enrollmentSnap, recordSnap] = await Promise.all([
        getDocs(query(collection(db, 'enrollments'), ...enrollmentConstraints)),
        getDocs(trainer ? query(collection(db, 'attendanceRecords'), where('sessionId', '==', session.id), where('teacherId', '==', profile.uid)) : query(collection(db, 'attendanceRecords'), where('sessionId', '==', session.id))),
      ]);
      const rows = enrollmentSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
      const previous = Object.fromEntries(recordSnap.docs.map((item) => [item.data().studentDocId, item.data().status]));
      setRoster(rows); setMarked(previous); setTab('sessions');
    } catch (failure) {
      setError(failure.code === 'permission-denied' ? 'Firestore denied this roster. Confirm the trainer is assigned to the lecture and deploy the attendance rules.' : failure.message || 'Could not open attendance for this lecture.');
    } finally { setSaving(false); }
  };

  const save = async (finalize = false) => {
    if (!selected || !selectedSessionId || saving) return;
    const records = roster.filter((student) => ATTENDANCE_STATES.includes(marked[student.studentDocId])).map((student) => ({ enrollmentId: student.id, studentDocId: student.studentDocId, status: marked[student.studentDocId] }));
    const counts = records.reduce((result, item) => ({ ...result, [item.status]: (result[item.status] || 0) + 1 }), {});
    const summary = `${records.length} marked: ${counts.PRESENT || 0} present, ${counts.ABSENT || 0} absent, ${counts.LATE || 0} late, ${counts.EXCUSED || 0} excused. ${roster.length - records.length} remain unmarked and will not be counted absent.`;
    if (!window.confirm(`${finalize ? 'Finalize attendance?' : 'Save attendance?'}\n\n${summary}`)) return;
    setSaving(true); setError(''); setNotice('');
    try {
      if (records.length) await saveAttendanceRecords(selectedSessionId, records);
      if (finalize) await finalizeAttendanceOccurrence(selectedSessionId);
      setNotice(finalize ? `Attendance finalized. ${summary}` : `Attendance saved. ${summary}`);
      await refresh();
      if (finalize) { setRoster([]); setMarked({}); setSelectedId(''); }
      else await openRoster({ ...selected, saved: { ...selected.saved, id: selectedSessionId } });
    } catch (failure) { setError(failure.message || 'Attendance could not be saved. Your unsaved marks are still on screen.'); }
    finally { setSaving(false); }
  };

  const cancel = async () => {
    if (!selectedSessionId || !window.confirm(`Cancel this ${selected?.date} lecture? Existing attendance history will be preserved and locked.`)) return;
    setSaving(true); setError('');
    try { await cancelAttendanceOccurrence(selectedSessionId); setNotice('Lecture cancelled. Saved attendance history is preserved.'); setRoster([]); setSelectedId(''); await refresh(); }
    catch (failure) { setError(failure.message || 'The lecture could not be cancelled.'); }
    finally { setSaving(false); }
  };

  const resetFilters = () => { setCourseFilter(''); setBatchFilter(''); setStatusFilter(''); setModeFilter(''); setSearch(''); };
  const goDate = (offset) => { setDate((value) => dateShift(value, offset)); setSelectedId(''); setRoster([]); setMarked({}); };
  const dateHeading = new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(zonedDateTime(date, '12:00', timeZone));
  const selectedEnd = selected ? zonedDateTime(date, `${String(Math.floor(selected.endMinutes / 60)).padStart(2, '0')}:${String(selected.endMinutes % 60).padStart(2, '0')}`, timeZone) : null;
  const canFinalize = Boolean(selectedSessionId && selected?.saved?.status === 'OPEN' && selectedEnd && now >= selectedEnd);

  return <main className="att-page">
    <header className="att-header"><div><p className="att-eyebrow">EDUPILOT · CLASS RECORDS</p><h1>Attendance Management</h1><p>Take and review attendance from published timetable lectures. Online and offline enrollees share one roster.</p></div><button type="button" className="att-button att-button--quiet" onClick={refresh} disabled={loading || saving}><RefreshCw size={16}/> Refresh</button></header>
    <div className="att-datebar"><button type="button" aria-label="Previous day" onClick={() => goDate(-1)}><ArrowLeft size={16}/></button><label><span>Selected date</span><input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSelectedId(''); setRoster([]); }}/></label><strong>{dateHeading}</strong><button type="button" aria-label="Next day" onClick={() => goDate(1)}><ArrowRight size={16}/></button><button type="button" className="att-button att-button--quiet" onClick={() => { setDate(dateInTimeZone(new Date(), timeZone)); setSelectedId(''); setRoster([]); }}>Today</button></div>
    {error && <p className="att-alert" role="alert"><AlertCircle size={17}/>{error}</p>}{notice && <p className="att-notice" role="status"><Check size={17}/>{notice}</p>}
    {loading ? <div className="att-empty">Loading saved timetable and attendance data…</div> : <>
      <section className="att-stats" aria-label="Attendance summary"><article><span>Scheduled today</span><strong>{enriched.length}</strong></article><article><span>Upcoming</span><strong>{sessionCounts.UPCOMING || 0}</strong></article><article><span>In progress / open</span><strong>{(sessionCounts.IN_PROGRESS || 0) + (sessionCounts.LATE_ENTRY || 0)}</strong></article><article><span>Attendance recorded</span><strong>{sessionCounts.RECORDED || 0}</strong></article><article><span>Cancelled</span><strong>{sessionCounts.CANCELLED || 0}</strong></article><article><span>Marked attendance rate</span><strong>{attendancePercent === null ? '—' : `${attendancePercent}%`}</strong><small>Present + late ÷ finalized present, late, absent marks; excused and unmarked excluded.</small></article></section>
      <section className="att-card"><div className="att-card__header"><div><h2>Scheduled lectures</h2><p>Live from the published timetable · institute time zone: {timeZone}{trainer ? ' · assigned to you' : ''}</p></div><div className="att-tabs"><button type="button" className={tab === 'sessions' ? 'is-active' : ''} onClick={() => setTab('sessions')}>Sessions</button><button type="button" className={tab === 'reports' ? 'is-active' : ''} onClick={() => setTab('reports')}>Reports</button></div></div>
        <div className="att-filters"><label><span>Course</span><select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}><option value="">All courses</option>{workspace.courses.map((course) => <option key={course.documentId} value={course.documentId}>{course.name}</option>)}</select></label><label><span>Batch</span><select value={batchFilter} onChange={(event) => setBatchFilter(event.target.value)}><option value="">All batches</option>{workspace.batches.map((batch) => <option key={batch.documentId} value={batch.documentId}>{batch.name} · {batch.batchId}</option>)}</select></label><label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{['UPCOMING', 'IN_PROGRESS', 'LATE_ENTRY', 'RECORDED', 'CANCELLED'].map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label><label><span>Student mode</span><select value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}><option value="">All modes</option><option value="OFFLINE">Offline</option><option value="ONLINE">Online</option></select></label><label className="att-search"><span>Search</span><div><Search size={15}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Course, batch, trainer or student"/></div></label><button type="button" className="att-button att-button--quiet" onClick={resetFilters}>Reset filters</button></div>
        {tab === 'sessions' ? <div className="att-session-grid">{visible.map((item) => {
          const state = item.attendanceStatus; const eligible = (owner || trainer) && state !== 'UPCOMING' && state !== 'CANCELLED' && (state !== 'RECORDED' || owner);
          return <article className="att-session" key={item.occurrenceId}><div className="att-session__top"><span className={`att-badge att-badge--${state.toLowerCase().replace('_', '-')}`}>{statusLabel(state)}</span><span>{item.date} · {item.day}</span></div><h3>{item.course?.name || item.courseName || 'Course'} · {item.batch?.name || item.batchName || 'Batch'}</h3><p className="att-session__id">{item.batch?.batchId || item.batchId || ''} · {item.teacherName || item.batch?.teacherName || 'Trainer not assigned'}</p><p className="att-session__time"><Clock3 size={16}/>{timeLabel(item.startTime || `${String(Math.floor(item.startMinutes / 60)).padStart(2, '0')}:${String(item.startMinutes % 60).padStart(2, '0')}`, timeZone)}–{timeLabel(item.endTime || `${String(Math.floor(item.endMinutes / 60)).padStart(2, '0')}:${String(item.endMinutes % 60).padStart(2, '0')}`, timeZone)} · {item.roomName || (item.roomId === 'ONLINE' ? 'Online' : 'Room unavailable')} · {item.deliveryMode || (item.roomId === 'ONLINE' ? 'ONLINE' : 'OFFLINE')}</p>{item.deliveryMode === 'HYBRID' && item.onlineClassDetails && <p>{item.onlineClassDetails}</p>}<div className="att-session__counts"><span><Users size={15}/> {item.saved?.expectedStudentCount ?? item.batch?.enrolledCount ?? (item.counts.PRESENT + item.counts.ABSENT + item.counts.LATE + item.counts.EXCUSED)} enrolled</span>{item.saved && <span>{item.saved.markedCount || item.records.length} marked</span>}</div>{item.saved && <p className="att-session__summary">{item.counts.PRESENT} present · {item.counts.ABSENT} absent · {item.counts.LATE} late · {item.counts.EXCUSED} excused · {item.counts.UNMARKED} unmarked</p>}<footer>{eligible && <button type="button" className="att-button att-button--primary" disabled={saving} onClick={() => openRoster(item)}>{item.saved ? (state === 'RECORDED' ? 'View / correct' : 'Take attendance') : 'Take attendance'}</button>}{item.saved?.status === 'OPEN' && (owner || trainer) && <button type="button" className="att-button att-button--quiet" disabled={saving || !canFinalize} onClick={() => selectedId === item.saved.id ? save(true) : openRoster(item)}>{canFinalize ? (selectedId === item.saved.id ? 'Finalize attendance' : 'Open to finalize') : 'Finalize after class'}</button>}</footer></article>;
        })}{!visible.length && <div className="att-empty"><CalendarDays size={22}/><strong>No scheduled lectures match these filters.</strong><span>Choose another date or check that the timetable is published.</span></div>}</div> : <div className="att-report"><h3>Recorded attendance for {dateHeading}</h3><p>Based on persisted marks from finalized sessions only. Excused and unmarked students are excluded from the percentage denominator.</p>{enriched.filter((item) => item.saved).map((item) => <article key={item.saved.id}><strong>{item.course?.name || item.courseName} · {item.batch?.name || item.batchName}</strong><span>{item.counts.PRESENT} present · {item.counts.ABSENT} absent · {item.counts.LATE} late · {item.counts.EXCUSED} excused · {item.counts.UNMARKED} unmarked</span><span>{item.saved.status}</span></article>)}{!enriched.some((item) => item.saved) && <p>No saved attendance sessions for this date.</p>}</div>}
      </section>
    </>}
    {selected && selectedSessionId && <div className="att-overlay" role="presentation"><section className="att-roster" role="dialog" aria-modal="true" aria-labelledby="att-roster-title"><header><div><p className="att-eyebrow">UNIFIED LECTURE ROSTER</p><h2 id="att-roster-title">{selected.course?.name || selected.courseName} · {selected.batch?.name || selected.batchName}</h2><p>{dateHeading} · {timeLabel(selected.startTime || `${String(Math.floor(selected.startMinutes / 60)).padStart(2, '0')}:${String(selected.startMinutes % 60).padStart(2, '0')}`, timeZone)}–{timeLabel(selected.endTime || `${String(Math.floor(selected.endMinutes / 60)).padStart(2, '0')}:${String(selected.endMinutes % 60).padStart(2, '0')}`, timeZone)} · {selected.roomName}</p></div><button type="button" aria-label="Close attendance roster" onClick={() => { setSelectedId(''); setRoster([]); }}>×</button></header><div className="att-roster__toolbar"><span>{roster.length} eligible students · {roster.filter((student) => student.learningMode === 'OFFLINE').length} offline · {roster.filter((student) => student.learningMode === 'ONLINE').length} online</span><label>Filter roster<select value={rosterStatusFilter} onChange={(event) => setRosterStatusFilter(event.target.value)}><option value="">All statuses</option><option value="UNMARKED">Unmarked</option>{ATTENDANCE_STATES.map((state) => <option key={state} value={state}>{state}</option>)}</select></label><button type="button" className="att-button att-button--quiet" disabled={saving || (selected.saved?.status === 'COMPLETED' && !owner)} onClick={() => setMarked(Object.fromEntries(roster.map((student) => [student.studentDocId, 'PRESENT'])))}>Mark all present</button></div><div className="att-roster__table-wrap"><table className="att-roster__table"><thead><tr><th>No.</th><th>Student</th><th>Student ID</th><th>Enrollment mode</th><th>Attendance status</th></tr></thead><tbody>{rosterFilters.map((student, index) => <tr key={student.id}><td>{index + 1}</td><td>{student.studentName || 'Student'}</td><td>{student.studentId || '—'}</td><td><span className={`att-mode att-mode--${String(student.learningMode || 'OFFLINE').toLowerCase()}`}>{student.learningMode || 'OFFLINE'}</span></td><td><select aria-label={`Attendance status for ${student.studentName}`} disabled={saving || (selected.saved?.status === 'COMPLETED' && !owner)} value={marked[student.studentDocId] || ''} onChange={(event) => { const value = event.target.value; if (!value && marked[student.studentDocId]) return; setMarked((current) => ({ ...current, [student.studentDocId]: value })); }}><option value="">Unmarked</option>{ATTENDANCE_STATES.map((state) => <option key={state} value={state}>{state}</option>)}</select></td></tr>)}</tbody></table>{!rosterFilters.length && <p>No students match your search and mode filter.</p>}</div><p className="att-note">Online attendance is manual trainer review; no meeting provider is connected. Unmarked students are not automatically absent. Editing a completed session is restricted to the Owner.</p><footer><span>{Object.values(marked).filter(Boolean).length} marked · {roster.length - Object.values(marked).filter(Boolean).length} unmarked</span><div><button type="button" className="att-button att-button--quiet" onClick={() => { setSelectedId(''); setRoster([]); }}>Close</button><button type="button" className="att-button att-button--primary" disabled={saving || !selectedSessionId || (selected.saved?.status === 'COMPLETED' && !owner)} onClick={() => save(false)}>{saving ? 'Saving…' : 'Save attendance'}</button>{canFinalize && <button type="button" className="att-button att-button--primary" disabled={saving} onClick={() => save(true)}>Finalize</button>}{selected.saved?.status === 'OPEN' && (owner || trainer) && <button type="button" className="att-button att-button--danger" disabled={saving} onClick={cancel}>Cancel lecture</button>}</div></footer></section></div>}
  </main>;
}
