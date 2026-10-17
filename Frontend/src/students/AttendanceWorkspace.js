import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, ClipboardCheck, RefreshCw, Search, Users } from 'lucide-react';
import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { loadAcademyWorkspace, batchStatus } from '../batches/academyService';
import { useToast } from '../components/Toast';
import './portal.css';

const STATES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];
const STATE_LABELS = { PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late', EXCUSED: 'Excused' };
const DAY_CODES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (value) => String(value).padStart(2, '0');
const hm = (minutes) => `${pad(Math.floor(Number(minutes) / 60))}:${pad(Number(minutes) % 60)}`;
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dayCodeFor = (date) => DAY_CODES[new Date(`${date}T12:00:00`).getDay()];
const shiftDate = (date, days) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const atTime = (date, hhmm) => new Date(`${date}T${hhmm || '00:00'}:00`);
const weekdayName = (date) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' });

const STATUS_STYLES = {
  UPCOMING: { label: 'Upcoming', className: 'is-upcoming' },
  IN_PROGRESS: { label: 'In progress', className: 'is-progress' },
  RECORDED: { label: 'Recorded', className: 'is-recorded' },
  COMPLETED: { label: 'Completed', className: 'is-completed' },
  CANCELLED: { label: 'Cancelled', className: 'is-cancelled' },
};

export default function AttendanceWorkspace({ profile }) {
  const toast = useToast();
  const isManager = ['OWNER', 'COUNSELOR'].includes(profile.role);
  // Existing Firestore rules let counselors read attendance but only Owners and
  // the assigned Trainer write it, so counselors get a read-only view.
  const canRecord = profile.role === 'OWNER' || profile.role === 'TRAINER';
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [batchId, setBatchId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [entries, setEntries] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [roster, setRoster] = useState([]);
  const [recordsBySession, setRecordsBySession] = useState({});
  const [openKey, setOpenKey] = useState('');
  const [draft, setDraft] = useState({});
  const [rosterSearch, setRosterSearch] = useState('');
  const [rosterFilter, setRosterFilter] = useState('ALL');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Time-based availability without a page reload. The interval is cleaned up on unmount.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const loadBatches = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const workspace = await loadAcademyWorkspace(profile.role, profile.uid);
      const list = (workspace.batches || []).filter((batch) => !batch.isArchived);
      setBatches(list);
      setBatchId((current) => (current && list.some((batch) => batch.documentId === current) ? current : (list[0]?.documentId || '')));
    } catch (failure) {
      const text = failure.code === 'permission-denied' ? 'Firestore denied batch access. Confirm your role and the deployed rules.' : failure.message;
      setError(text); toast.error(text, 'Attendance');
    } finally { setLoading(false); }
  }, [profile.role, profile.uid, toast]);
  useEffect(() => { loadBatches(); }, [loadBatches]);

  const loadBatchData = useCallback(async () => {
    if (!batchId) { setEntries([]); setSessions([]); setRoster([]); setRecordsBySession({}); return; }
    setLoading(true); setError('');
    try {
      const entryConstraints = [where('batchDocId', '==', batchId)];
      const sessionConstraints = [where('batchDocId', '==', batchId)];
      const enrollmentConstraints = [where('batchDocId', '==', batchId), where('status', '==', 'ACTIVE')];
      const recordConstraints = [where('batchDocId', '==', batchId)];
      if (profile.role === 'TRAINER') {
        entryConstraints.push(where('teacherId', '==', profile.uid));
        sessionConstraints.push(where('teacherId', '==', profile.uid));
        enrollmentConstraints.push(where('teacherId', '==', profile.uid));
        recordConstraints.push(where('teacherId', '==', profile.uid));
      }
      const [entrySnap, sessionSnap, rosterSnap, recordSnap] = await Promise.all([
        getDocs(query(collection(db, 'timetableSessions'), ...entryConstraints)),
        getDocs(query(collection(db, 'attendanceSessions'), ...sessionConstraints)),
        getDocs(query(collection(db, 'enrollments'), ...enrollmentConstraints)),
        getDocs(query(collection(db, 'attendanceRecords'), ...recordConstraints)),
      ]);
      setEntries(entrySnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((entry) => entry.status === 'PUBLISHED'));
      setSessions(sessionSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      // Enrollment doc ids are `${studentDocId}__${batchDocId}`; the student uid is the stable key
      // used by attendanceRecords and by the Firestore rules, so resolve it explicitly.
      setRoster(rosterSnap.docs.map((d) => {
        const data = d.data();
        return { enrollmentId: d.id, ...data, studentDocId: data.studentDocId || d.id.split('__')[0] };
      }).sort((a, b) => String(a.studentName || '').localeCompare(String(b.studentName || ''))));
      const grouped = {};
      recordSnap.docs.forEach((d) => { const record = { documentId: d.id, ...d.data() }; (grouped[record.sessionId] ||= []).push(record); });
      setRecordsBySession(grouped);
    } catch (failure) {
      const text = failure.code === 'permission-denied' ? 'Firestore denied this batch roster. Confirm you are assigned to this batch and the deployed rules are current.' : failure.message;
      setError(text); toast.error(text, 'Attendance');
    } finally { setLoading(false); }
  }, [batchId, profile.role, profile.uid, toast]);
  useEffect(() => { loadBatchData(); }, [loadBatchData]);

  const batch = batches.find((item) => item.documentId === batchId);
  const dayCode = dayCodeFor(date);

  // One published timetable lecture -> at most one attendance session for the date.
  const lectures = (() => {
    const scheduled = entries.filter((entry) => entry.day === dayCode
      && (!batch?.startDate || date >= batch.startDate)
      && (!batch?.endDate || date <= batch.endDate));
    const built = scheduled.map((entry) => {
      const startTime = hm(entry.startMinutes);
      const endTime = hm(entry.endMinutes);
      const session = sessions.find((item) => item.date === date && (item.scheduledSessionId === entry.id || item.startTime === startTime)) || null;
      return { key: entry.id, entry, startTime, endTime, session, room: entry.roomName || 'Online / TBD', needsReview: entry.needsReview === true };
    });
    const matched = new Set(built.map((item) => item.session?.id).filter(Boolean));
    const orphans = sessions.filter((item) => item.date === date && !matched.has(item.id))
      .map((session) => ({ key: session.id, entry: null, startTime: session.startTime || '00:00', endTime: session.endTime || '00:00', session, room: '—', needsReview: false }));
    return [...built, ...orphans].sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
  })();

  const statsFor = (lecture) => {
    const records = lecture.session ? (recordsBySession[lecture.session.id] || []) : [];
    const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
    records.forEach((record) => { if (counts[record.status] !== undefined) counts[record.status] += 1; });
    const enrolled = roster.length;
    return { records, enrolled, marked: records.length, unmarked: Math.max(0, enrolled - records.length), ...counts };
  };

  const statusFor = (lecture) => {
    if (lecture.session?.status === 'CANCELLED') return STATUS_STYLES.CANCELLED;
    const start = atTime(date, lecture.startTime).getTime();
    const end = atTime(date, lecture.endTime).getTime();
    if (now < start) return STATUS_STYLES.UPCOMING;
    if (now <= end) return STATUS_STYLES.IN_PROGRESS;
    const stats = statsFor(lecture);
    if (lecture.session && stats.enrolled > 0 && stats.unmarked === 0) return STATUS_STYLES.RECORDED;
    return STATUS_STYLES.COMPLETED;
  };

  const summary = (() => {
    let upcoming = 0; let inProgress = 0; let recorded = 0; let cancelled = 0; let marked = 0; let attended = 0;
    lectures.forEach((lecture) => {
      const status = statusFor(lecture);
      if (status.label === 'Upcoming') upcoming += 1;
      else if (status.label === 'In progress') inProgress += 1;
      else if (status.label === 'Recorded') recorded += 1;
      else if (status.label === 'Cancelled') cancelled += 1;
      const stats = statsFor(lecture);
      marked += stats.marked; attended += stats.PRESENT + stats.LATE;
    });
    return { scheduled: lectures.length, upcoming, inProgress, recorded, cancelled, marked, percent: marked ? Math.round(attended / marked * 100) : null };
  })();

  const openLecture = lectures.find((lecture) => lecture.key === openKey) || null;

  const openRoster = async (lecture) => {
    const start = atTime(date, lecture.startTime);
    if (now < start.getTime()) { toast.warning('Attendance opens at the scheduled start time.', 'Not yet available'); return; }
    if (!lecture.entry) { toast.error('This session is not linked to a published timetable class. Contact the Owner.', 'Cannot open roster'); return; }
    if (lecture.session?.status === 'CANCELLED') { toast.error('This lecture was cancelled. Attendance cannot be recorded.', 'Lecture cancelled'); return; }
    setBusy('open'); setError('');
    try {
      let session = lecture.session;
      if (!session) {
        const sessionId = `att__${batchId}__${date}__${lecture.entry.id}`;
        const ref = doc(db, 'attendanceSessions', sessionId);
        const snapshot = await getDoc(ref);
        if (snapshot.exists()) session = { id: ref.id, ...snapshot.data() };
        else {
          const payload = {
            batchDocId: batchId, batchId: batch?.batchId || '', courseDocId: batch?.courseDocId || '',
            teacherId: batch?.teacherId || lecture.entry.teacherId || profile.uid, scheduledSessionId: lecture.entry.id,
            date, sessionAt: Timestamp.fromDate(start), startTime: lecture.startTime, endTime: lecture.endTime,
            status: 'OPEN', createdBy: profile.uid, createdAt: serverTimestamp(),
          };
          await setDoc(ref, payload);
          session = { id: ref.id, ...payload };
        }
        setSessions((current) => (current.some((item) => item.id === session.id) ? current : [...current, session]));
      }
      const saved = recordsBySession[session.id] || [];
      setDraft(Object.fromEntries(saved.map((record) => [record.studentDocId, record.status])));
      setOpenKey(lecture.key); setRosterSearch(''); setRosterFilter('ALL');
      toast.info('Roster opened. Mark each student, then save once.', 'Take attendance');
    } catch (failure) {
      const text = failure.code === 'permission-denied'
        ? 'Only the assigned Trainer or Owner can open attendance for this lecture.'
        : (failure.message || 'The roster could not be opened.');
      setError(text); toast.error(text, 'Attendance');
    } finally { setBusy(''); }
  };

  const cancelSession = async (lecture) => {
    if (!lecture.session) return;
    if (!window.confirm(`Cancel the ${date} ${lecture.startTime} lecture? Attendance for this session will be locked.`)) return;
    setBusy('cancel');
    try {
      await updateDoc(doc(db, 'attendanceSessions', lecture.session.id), { status: 'CANCELLED' });
      setSessions((current) => current.map((item) => item.id === lecture.session.id ? { ...item, status: 'CANCELLED' } : item));
      toast.success('Lecture cancelled. Recorded attendance is preserved and locked.', 'Session cancelled');
    } catch (failure) {
      const text = failure.code === 'permission-denied' ? 'Only the assigned Trainer or Owner can cancel this session.' : failure.message;
      toast.error(text, 'Cancel failed');
    } finally { setBusy(''); }
  };

  const filteredRoster = roster.filter((student) => {
    const status = draft[student.studentDocId] || '';
    const mode = student.learningMode || 'OFFLINE';
    const matchesSearch = `${student.studentName || ''} ${student.studentId || ''}`.toLowerCase().includes(rosterSearch.toLowerCase());
    const matchesFilter = rosterFilter === 'ALL'
      || (rosterFilter === 'OFFLINE' && mode === 'OFFLINE')
      || (rosterFilter === 'ONLINE' && mode === 'ONLINE')
      || (rosterFilter === 'UNMARKED' && !status)
      || (STATES.includes(rosterFilter) && status === rosterFilter);
    return matchesSearch && matchesFilter;
  });

  const offlineCount = roster.filter((student) => (student.learningMode || 'OFFLINE') === 'OFFLINE').length;
  const onlineCount = roster.length - offlineCount;
  const markedCount = roster.filter((student) => STATES.includes(draft[student.studentDocId])).length;
  const draftCounts = STATES.reduce((result, state) => ({ ...result, [state]: roster.filter((student) => draft[student.studentDocId] === state).length }), {});

  const setMark = (studentDocId, status) => setDraft((current) => {
    const next = { ...current };
    if (!status || next[studentDocId] === status) delete next[studentDocId];
    else next[studentDocId] = status;
    return next;
  });

  const bulkMark = (status) => {
    const targets = filteredRoster.filter((student) => draft[student.studentDocId] !== status);
    if (!targets.length) { toast.info(`Every student in the current filter is already marked ${STATE_LABELS[status].toLowerCase()}.`, 'Nothing to change'); return; }
    if (!window.confirm(`Mark ${targets.length} student(s) in the current filter as ${STATE_LABELS[status]}? This overwrites their current marks. Nothing saves until you save.`)) return;
    setDraft((current) => ({ ...current, ...Object.fromEntries(targets.map((student) => [student.studentDocId, status])) }));
    toast.info(`${targets.length} student(s) marked ${STATE_LABELS[status]}. Review, then save.`, 'Bulk action applied');
  };

  const requestSave = () => {
    if (!openLecture?.session) { toast.error('Open a lecture roster before saving.', 'Nothing to save'); return; }
    if (openLecture.session.status !== 'OPEN') { toast.error('This session is not open for attendance.', 'Cannot save'); return; }
    if (!markedCount) { toast.warning('Mark at least one student before saving.', 'Nothing to save'); return; }
    setConfirmOpen(true);
  };

  const commitSave = async () => {
    const lecture = openLecture;
    const session = lecture?.session;
    if (!session) return;
    if (now < atTime(date, session.startTime || lecture.startTime).getTime()) { setConfirmOpen(false); toast.error('Attendance can only be saved from the scheduled start time.', 'Too early'); return; }
    const toSave = roster.map((student) => ({ student, status: draft[student.studentDocId] })).filter((entry) => STATES.includes(entry.status));
    if (!toSave.length) { setConfirmOpen(false); toast.warning('Mark at least one student before saving.', 'Nothing to save'); return; }
    setBusy('save'); setError('');
    try {
      await runTransaction(db, async (transaction) => {
        const refs = toSave.map(({ student }) => doc(db, 'attendanceRecords', `${session.id}__${student.studentDocId}`));
        const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
        toSave.forEach(({ student, status }, index) => {
          const payload = {
            sessionId: session.id, batchDocId: batchId, enrollmentId: student.enrollmentId, studentDocId: student.studentDocId,
            studentId: student.studentId || '', studentName: student.studentName || '', learningMode: student.learningMode || 'OFFLINE',
            status, teacherId: profile.role === 'TRAINER' ? profile.uid : (session.teacherId || batch?.teacherId || profile.uid),
            recordedBy: profile.uid, source: 'MANUAL', date, updatedAt: serverTimestamp(),
          };
          if (snapshots[index].exists()) transaction.update(refs[index], payload);
          else transaction.set(refs[index], { ...payload, createdAt: serverTimestamp() });
        });
      });
      setRecordsBySession((current) => ({
        ...current,
        [session.id]: toSave.map(({ student, status }) => ({ documentId: `${session.id}__${student.studentDocId}`, sessionId: session.id, studentDocId: student.studentDocId, status, batchDocId: batchId })),
      }));
      const summaryText = `Present ${draftCounts.PRESENT}, Absent ${draftCounts.ABSENT}, Late ${draftCounts.LATE}, Excused ${draftCounts.EXCUSED}.`;
      toast.success(`Attendance saved for ${date} ${lecture.startTime}. ${summaryText}`, 'Attendance saved');
      setConfirmOpen(false);
    } catch (failure) {
      const text = failure.code === 'permission-denied'
        ? 'Attendance was rejected by the security rules. Confirm you are the assigned Trainer or an Owner for this batch, the lecture has started, and the enrolled student still matches the roster.'
        : failure.message;
      setError(text); toast.error(text, 'Save failed');
    } finally { setBusy(''); }
  };

  return <section className="ep-content-card ep-attendance">
    <header className="ep-content-card__head">
      <div>
        <p className="ep-eyebrow">CLASS RECORDS</p>
        <h1>Attendance</h1>
        <p>One lecture has one attendance session. Online and offline students share the same roster; unmarked is never treated as absent.</p>
      </div>
      <button className="sm-button sm-button--quiet" type="button" onClick={() => { loadBatches(); loadBatchData(); }} disabled={loading}><RefreshCw size={15}/> Refresh</button>
    </header>
    {error && <p className="ep-inline-error" role="alert"><AlertCircle size={17}/>{error}</p>}

    <div className="ep-att-controls">
      <label>Assigned batch
        <select value={batchId} onChange={(event) => { setBatchId(event.target.value); setOpenKey(''); setDraft({}); }}>
          <option value="">Select batch</option>
          {batches.map((item) => <option key={item.documentId} value={item.documentId}>{item.name} · {item.batchId}</option>)}
        </select>
      </label>
      <div className="ep-att-date">
        <button type="button" className="ep-icon-button" aria-label="Previous day" onClick={() => { setDate((current) => shiftDate(current, -1)); setOpenKey(''); }}><ChevronLeft size={16}/></button>
        <label>Session date<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setOpenKey(''); }}/></label>
        <button type="button" className="ep-icon-button" aria-label="Next day" onClick={() => { setDate((current) => shiftDate(current, 1)); setOpenKey(''); }}><ChevronRight size={16}/></button>
        <button type="button" className="sm-button sm-button--quiet" onClick={() => { setDate(todayStr()); setOpenKey(''); }}>Today</button>
      </div>
    </div>

    {loading ? <p className="ep-portal__empty">Loading attendance records…</p> : !batchId ? <p className="ep-portal__empty">Select an assigned batch to see its lecture schedule.</p> : <>
      <p className="ep-att-context"><CalendarDays size={15}/> {weekdayName(date)} · {date} · {batch?.name} {batch && <span className={`ep-att-badge ${batchStatus(batch) === 'COMPLETED' ? 'is-completed' : 'is-recorded'}`}>{batchStatus(batch)}</span>}</p>

      <div className="ep-att-summary">
        <article><span>Scheduled</span><strong>{summary.scheduled}</strong></article>
        <article><span>Upcoming</span><strong>{summary.upcoming}</strong></article>
        <article><span>In progress</span><strong>{summary.inProgress}</strong></article>
        <article><span>Recorded</span><strong>{summary.recorded}</strong></article>
        <article><span>Cancelled</span><strong>{summary.cancelled}</strong></article>
        <article><span>Attendance</span><strong>{summary.percent === null ? '—' : `${summary.percent}%`}</strong></article>
      </div>
      <p className="ep-att-note">Attendance % counts saved records only ({summary.marked} marked for this date). Cancelled lectures are excluded and unmarked students are never counted as absent.</p>

      {lectures.length ? <div className="ep-att-cards">{lectures.map((lecture) => {
        const status = statusFor(lecture);
        const stats = statsFor(lecture);
        const startMs = atTime(date, lecture.startTime).getTime();
        const canTake = canRecord && now >= startMs && lecture.session?.status !== 'CANCELLED' && Boolean(lecture.entry);
        return <article className={`ep-att-card ${status.className}`} key={lecture.key}>
          <header>
            <div>
              <strong>{lecture.entry?.courseName || batch?.courseName || batch?.name || 'Lecture'}</strong>
              <span>{lecture.startTime}–{lecture.endTime} · {lecture.entry?.teacherName || batch?.teacherName || 'Trainer to be assigned'}</span>
              <span>{lecture.entry ? 'Published lecture' : 'Session'} · {lecture.room}</span>
            </div>
            <span className={`ep-att-badge ${status.className}`}>{status.label}</span>
          </header>
          <div className="ep-att-metrics">
            <span>Enrolled <b>{stats.enrolled}</b></span>
            <span>Marked <b>{stats.marked}</b></span>
            <span>Present <b>{stats.PRESENT}</b></span>
            <span>Absent <b>{stats.ABSENT}</b></span>
            <span>Late <b>{stats.LATE}</b></span>
            <span>Excused <b>{stats.EXCUSED}</b></span>
            <span>Unmarked <b>{stats.unmarked}</b></span>
          </div>
          {lecture.needsReview && <p className="ep-att-warning"><AlertCircle size={14}/> This timetable entry is flagged for review; confirm the details with the Owner before marking.</p>}
          <footer>
            <button type="button" className="sm-button sm-button--primary" disabled={!canTake || busy === 'open'} onClick={() => openRoster(lecture)}>
              <ClipboardCheck size={14}/>{busy === 'open' && openKey === lecture.key ? 'Opening…' : lecture.session ? 'Open roster' : 'Take attendance'}
            </button>
            {!canRecord && <span className="ep-att-hint">Read-only: counselors cannot record attendance.</span>}
            {canRecord && !canTake && lecture.session?.status !== 'CANCELLED' && <span className="ep-att-hint">{now < startMs ? 'Available at the scheduled start time.' : 'Link this lecture to a published timetable class first.'}</span>}
            {canRecord && lecture.session?.status === 'OPEN' && <button type="button" className="sm-button sm-button--quiet" disabled={busy === 'cancel'} onClick={() => cancelSession(lecture)}>Cancel lecture</button>}
            {lecture.session?.status === 'CANCELLED' && <span className="ep-att-hint">Cancelled — attendance locked.</span>}
          </footer>
        </article>;
      })}</div> : <p className="ep-portal__empty">{entries.length ? `No published lectures are scheduled on ${weekdayName(date)} for this batch.` : 'This batch has no published timetable yet. Ask the Owner to publish the schedule.'}</p>}
    </>}

    {openLecture?.session && <section className="ep-portal__section ep-att-roster">
      <header>
        <div>
          <h2>Roster · {openLecture.startTime}–{openLecture.endTime}</h2>
          <p>{roster.length} enrolled · {offlineCount} offline · {onlineCount} online · {markedCount} marked</p>
        </div>
        <button type="button" className="sm-button sm-button--quiet" onClick={() => setOpenKey('')}>Close</button>
      </header>
      <div className="ep-att-roster-filters">
        <label className="ep-att-search"><Search size={15}/><input aria-label="Search roster" placeholder="Search by name or student ID" value={rosterSearch} onChange={(event) => setRosterSearch(event.target.value)}/></label>
        <select aria-label="Filter roster" value={rosterFilter} onChange={(event) => setRosterFilter(event.target.value)}>
          <option value="ALL">All students</option>
          <option value="OFFLINE">Offline only</option>
          <option value="ONLINE">Online only</option>
          {STATES.map((state) => <option key={state} value={state}>{state[0] + state.slice(1).toLowerCase()}</option>)}
          <option value="UNMARKED">Unmarked</option>
        </select>
      </div>
      <div className="ep-att-bulk">
        <span>Quick mark (applies to students in the current filter):</span>
        <button type="button" className="sm-button sm-button--primary" onClick={() => bulkMark('PRESENT')}>Present all</button>
        <button type="button" className="sm-button sm-button--danger" onClick={() => bulkMark('ABSENT')}>Absent all</button>
        <button type="button" className="sm-button sm-button--quiet" onClick={() => { setDraft({}); toast.info('All marks cleared. Nothing is saved until you save.', 'Roster cleared'); }}>Clear marks</button>
      </div>
      {openLecture.session.status === 'CANCELLED' ? <p className="ep-inline-error">This lecture is cancelled. Attendance is locked.</p> : filteredRoster.length ? <div className="ep-att-roster-list">
        {filteredRoster.map((student, index) => {
          const mark = draft[student.studentDocId] || '';
          return <article key={student.enrollmentId}>
            <div>
              <strong>{student.studentName || student.studentId}</strong>
              <span>#{index + 1} · {student.studentId} · {student.learningMode || 'OFFLINE'} · {student.learningMode === 'ONLINE' ? 'manual online review' : 'classroom roll'}</span>
            </div>
            <div className="ep-att-mark" role="group" aria-label={`Attendance for ${student.studentName || student.studentId}`}>
              {STATES.map((state) => <button key={state} type="button" disabled={busy === 'save'} aria-pressed={mark === state}
                className={`ep-att-mark__btn is-${state.toLowerCase()}${mark === state ? ' is-active' : ''}${state === 'PRESENT' || state === 'ABSENT' ? ' is-primary-option' : ''}`}
                title={mark === state ? `Clear ${STATE_LABELS[state]} (back to Unmarked)` : `Mark ${STATE_LABELS[state]}`}
                onClick={() => setMark(student.studentDocId, state)}>{STATE_LABELS[state]}</button>)}
              <span className={`ep-att-mark__state${mark ? ' is-set' : ''}`}>{mark ? STATE_LABELS[mark] : 'Unmarked'}</span>
            </div>
          </article>;
        })}
      </div> : <p className="ep-portal__empty">No students match this search or filter.</p>}
      <footer className="ep-att-save">
        <span>Draft: Present {draftCounts.PRESENT} · Absent {draftCounts.ABSENT} · Late {draftCounts.LATE} · Excused {draftCounts.EXCUSED} · Unmarked {Math.max(0, roster.length - markedCount)}</span>
        <button type="button" className="sm-button sm-button--primary" disabled={!canRecord || busy === 'save' || openLecture.session.status !== 'OPEN' || !markedCount} onClick={requestSave}>{busy === 'save' ? 'Saving…' : 'Save attendance'}</button>
      </footer>
    </section>}

    {confirmOpen && openLecture && <div className="ep-pay-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && busy !== 'save') setConfirmOpen(false); }}>
      <section className="ep-pay-dialog" role="dialog" aria-modal="true" aria-labelledby="ep-att-confirm-title">
        <header><div><p className="ep-eyebrow">CONFIRM SUBMISSION</p><h2 id="ep-att-confirm-title">Save attendance for {date} {openLecture.startTime}</h2></div></header>
        <p className="ep-pay-note">This writes one record per marked student in a single transaction. {roster.length - markedCount} student(s) remain unmarked and will not be saved.</p>
        <dl>
          <div><dt>Present</dt><dd>{draftCounts.PRESENT}</dd></div>
          <div><dt>Absent</dt><dd>{draftCounts.ABSENT}</dd></div>
          <div><dt>Late</dt><dd>{draftCounts.LATE}</dd></div>
          <div><dt>Excused</dt><dd>{draftCounts.EXCUSED}</dd></div>
          <div><dt>Unmarked (not saved)</dt><dd>{Math.max(0, roster.length - markedCount)}</dd></div>
        </dl>
        <footer>
          <button type="button" className="sm-button sm-button--quiet" disabled={busy === 'save'} onClick={() => setConfirmOpen(false)}>Back</button>
          <button type="button" className="sm-button sm-button--primary" disabled={busy === 'save'} onClick={commitSave}>{busy === 'save' ? 'Saving…' : 'Confirm & save'}</button>
        </footer>
      </section>
    </div>}

    {isManager && <p className="ep-att-note"><Users size={14}/> {profile.role === 'OWNER' ? 'As Owner you can record attendance for any batch.' : 'As Counselor you can review attendance across batches, but cannot mark or change records.'} Trainers can record only for their assigned batches.</p>}
  </section>;
}
