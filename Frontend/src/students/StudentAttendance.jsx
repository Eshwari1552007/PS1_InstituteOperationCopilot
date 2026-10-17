import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarCheck, ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useToast } from '../components/Toast';
import './portal.css';

const ATTENDED = ['PRESENT', 'LATE'];
const BADGE_CLASS = { PRESENT: 'is-present', ABSENT: 'is-absent', LATE: 'is-late', EXCUSED: 'is-excused' };
const STATUS_LABEL = { PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late', EXCUSED: 'Excused' };
const PAGE_SIZE = 12;
const recordsOf = (snapshot) => snapshot?.docs.map((d) => ({ documentId: d.id, ...d.data() })) || [];
const timeLabel = (value) => {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : '';
};

export default function StudentAttendance({ profile }) {
  const toast = useToast();
  const [data, setData] = useState({ enrollments: [], records: [], sessions: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [course, setCourse] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      // Each read stays independent so one denied/legacy collection cannot blank the whole module.
      const [enrollmentsSnap, recordsSnap] = await Promise.all([
        getDocs(query(collection(db, 'enrollments'), where('studentDocId', '==', profile.uid))),
        getDocs(query(collection(db, 'attendanceRecords'), where('studentDocId', '==', profile.uid))),
      ]);
      const enrollments = recordsOf(enrollmentsSnap);
      const records = recordsOf(recordsSnap);
      const batchIds = [...new Set(enrollments.map((item) => item.batchDocId).filter(Boolean))];
      const sessionResults = await Promise.allSettled(batchIds.map((id) => getDocs(query(collection(db, 'attendanceSessions'), where('batchDocId', '==', id)))));
      const sessions = sessionResults.flatMap((result) => result.status === 'fulfilled' ? recordsOf(result.value) : []);
      const denied = sessionResults.filter((result) => result.status === 'rejected').length;
      setData({ enrollments, records, sessions });
      if (denied) setError(`Firestore denied ${denied} attendance session read(s), so cancelled lectures may still be counted. Confirm the deployed rules for your account and refresh.`);
    } catch (failure) {
      const text = failure.code === 'permission-denied'
        ? 'Firestore denied your attendance records. Confirm this account is an APPROVED Student and the current rules are deployed.'
        : (failure.message || 'Your attendance could not be loaded.');
      setError(text); toast.error(text, 'My attendance');
    } finally { setLoading(false); }
  }, [profile.uid, toast]);

  useEffect(() => { refresh(); }, [refresh]);

  const sessionById = useMemo(() => new Map(data.sessions.map((session) => [session.documentId, session])), [data.sessions]);
  const batchById = useMemo(() => new Map(data.enrollments.map((item) => [item.batchDocId, item])), [data.enrollments]);
  const cancelledIds = useMemo(() => new Set(data.sessions.filter((session) => session.status === 'CANCELLED').map((session) => session.documentId)), [data.sessions]);

  // Lifetime view: every finalized record for this student, cancelled lectures removed.
  const finalized = useMemo(() => data.records
    .filter((record) => !cancelledIds.has(record.sessionId))
    .map((record) => {
      const enrollment = batchById.get(record.batchDocId);
      const session = sessionById.get(record.sessionId);
      return {
        ...record,
        courseKey: enrollment?.courseDocId || enrollment?.courseName || record.batchDocId || 'unknown',
        courseName: enrollment?.courseName || 'Course not recorded',
        batchName: enrollment?.batchName || enrollment?.batchId || record.batchDocId || 'Batch not recorded',
        startTime: timeLabel(session?.startTime),
        endTime: timeLabel(session?.endTime),
      };
    })
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.startTime).localeCompare(String(a.startTime))), [data.records, cancelledIds, batchById, sessionById]);

  const courses = useMemo(() => {
    const map = new Map();
    data.enrollments.forEach((item) => {
      const key = item.courseDocId || item.courseName;
      if (key && !map.has(key)) map.set(key, item.courseName || 'Course');
    });
    return [...map.entries()].map(([key, name]) => ({ key, name }));
  }, [data.enrollments]);

  const courseRows = useMemo(() => {
    const map = new Map();
    finalized.forEach((record) => {
      const row = map.get(record.courseKey) || { key: record.courseKey, name: record.courseName, total: 0, attended: 0, absent: 0, late: 0, excused: 0, batches: new Set() };
      row.total += 1;
      if (ATTENDED.includes(record.status)) row.attended += 1;
      if (record.status === 'ABSENT') row.absent += 1;
      if (record.status === 'LATE') row.late += 1;
      if (record.status === 'EXCUSED') row.excused += 1;
      row.batches.add(record.batchName);
      map.set(record.courseKey, row);
    });
    return [...map.values()].map((row) => ({ ...row, percent: row.total ? Math.round(row.attended / row.total * 100) : null, batches: [...row.batches] }));
  }, [finalized]);

  const scoped = useMemo(() => finalized.filter((record) => {
    if (course && record.courseKey !== course) return false;
    if (status && record.status !== status) return false;
    if (search) {
      const haystack = `${record.date || ''} ${record.courseName} ${record.batchName} ${record.status}`.toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  }), [finalized, course, status, search]);

  const summary = useMemo(() => {
    const base = course ? finalized.filter((record) => record.courseKey === course) : finalized;
    const attended = base.filter((record) => ATTENDED.includes(record.status)).length;
    return {
      total: base.length,
      attended,
      absent: base.filter((record) => record.status === 'ABSENT').length,
      late: base.filter((record) => record.status === 'LATE').length,
      excused: base.filter((record) => record.status === 'EXCUSED').length,
      percent: base.length ? Math.round(attended / base.length * 100) : null,
    };
  }, [finalized, course]);

  useEffect(() => { setPage(1); }, [course, status, search]);

  const totalPages = Math.max(1, Math.ceil(scoped.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = scoped.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return <section className="ep-portal ep-student-attendance">
    <header className="ep-portal__head">
      <div>
        <p className="ep-eyebrow">MY RECORDS</p>
        <h1>My attendance</h1>
        <p>Lifetime attendance for every course you are enrolled in. Cancelled lectures are excluded and unmarked lectures are never counted as absences.</p>
      </div>
      <button className="sm-button sm-button--quiet" type="button" onClick={refresh} disabled={loading}><RefreshCw size={15}/> Refresh</button>
    </header>
    {error && <p className="ep-inline-error" role="alert"><AlertCircle size={17}/>{error}</p>}

    {loading ? <p className="ep-portal__empty">Loading your lifetime attendance…</p> : <>
      <div className="ep-attendance-overview">
        <article><span>Attendance</span><strong>{summary.percent === null ? '—' : `${summary.percent}%`}</strong></article>
        <article><span>Sessions counted</span><strong>{summary.total}</strong></article>
        <article><span>Attended</span><strong>{summary.attended}</strong></article>
        <article><span>Absent</span><strong>{summary.absent}</strong></article>
        <article><span>Late</span><strong>{summary.late}</strong></article>
        <article><span>Excused</span><strong>{summary.excused}</strong></article>
      </div>
      {summary.total === 0 && <p className="ep-att-note">No finalized attendance records yet. Your percentage appears once a trainer saves a session.</p>}

      <section className="ep-portal__section">
        <header><div><h2>Course-wise attendance</h2><p>Click a course to filter the full history below.</p></div></header>
        {courseRows.length ? <div className="ep-attendance-cards">
          {courseRows.map((row) => <article key={row.key} className={course === row.key ? 'is-selected' : ''} onClick={() => setCourse(course === row.key ? '' : row.key)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setCourse(course === row.key ? '' : row.key); } }}>
            <div className="ep-portal__cardhead"><CalendarCheck size={16}/><span>{row.batches.length} batch{row.batches.length === 1 ? '' : 'es'}</span></div>
            <h3>{row.name}</h3>
            <div className="ep-portal__metrics">
              <span>Attendance <b>{row.percent === null ? 'No finalized records' : `${row.percent}%`}</b></span>
              <span>Attended <b>{row.attended} / {row.total}</b></span>
              <span>Absent <b>{row.absent}</b></span>
              <span>Late <b>{row.late}</b></span>
              <span>Excused <b>{row.excused}</b></span>
            </div>
          </article>)}
        </div> : <p className="ep-portal__empty">You have no course enrollments yet.</p>}
      </section>

      <section className="ep-portal__section">
        <header><div><h2>{course ? courseRows.find((row) => row.key === course)?.name : 'Full history'}</h2><p>{scoped.length} record{scoped.length === 1 ? '' : 's'} · newest first</p></div></header>
        <div className="ep-att-roster-filters">
          <label className="ep-att-search"><Search size={15}/><input aria-label="Search attendance history" placeholder="Search by date, course, batch or status" value={search} onChange={(event) => setSearch(event.target.value)}/></label>
          <select aria-label="Filter by course" value={course} onChange={(event) => setCourse(event.target.value)}>
            <option value="">All courses</option>
            {courses.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
          </select>
          <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            {ATTENDED.concat(['ABSENT', 'EXCUSED']).map((value) => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}
          </select>
          {(course || status || search) && <button type="button" className="sm-button sm-button--quiet" onClick={() => { setCourse(''); setStatus(''); setSearch(''); }}>Reset filters</button>}
        </div>
        {visible.length ? <>
          <ul className="ep-attendance-history">
            {visible.map((record, index) => <li key={`${record.sessionId}-${index}`}>
              <span>{record.date || 'Date not recorded'}{record.startTime ? ` · ${record.startTime}${record.endTime ? `–${record.endTime}` : ''}` : ''}<br/><em>{record.courseName} · {record.batchName}{record.learningMode ? ` · ${record.learningMode}` : ''}</em></span>
              <span className={`ep-attendance-badge ${BADGE_CLASS[record.status] || ''}`}>{STATUS_LABEL[record.status] || record.status}</span>
            </li>)}
          </ul>
          {totalPages > 1 && <div className="ep-att-pager">
            <button type="button" className="ep-icon-button" aria-label="Previous page" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}><ChevronLeft size={16}/></button>
            <span>Page {safePage} of {totalPages}</span>
            <button type="button" className="ep-icon-button" aria-label="Next page" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}><ChevronRight size={16}/></button>
          </div>}
        </> : <p className="ep-portal__empty">{finalized.length ? 'No attendance records match these filters.' : 'No finalized attendance records yet. Your history appears once a trainer saves a session.'}</p>}
      </section>
    </>}
  </section>;
}
