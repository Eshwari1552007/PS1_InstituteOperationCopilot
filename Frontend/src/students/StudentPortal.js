import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, BookOpen, RefreshCw, Users } from 'lucide-react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { batchStatus, changeEnrollmentMode, enrollSelf } from '../batches/academyService';
import './portal.css';

const money = (amount) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(amount || 0));

export default function StudentPortal({ profile }) {
  const [data, setData] = useState({ student: null, courses: [], batches: [], enrollments: [], fees: [], attendance: [], payments: [] });
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [busy, setBusy] = useState(''); const [message, setMessage] = useState('');
  const [modeByBatch, setModeByBatch] = useState({}); const [search, setSearch] = useState('');
  const [courseFilter, setCourseFilter] = useState(''); const [modeFilter, setModeFilter] = useState(''); const [dayFilter, setDayFilter] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      // Keep each read independent so one denied/legacy collection doesn't hide
      // the rest of the student's dashboard or make the source impossible to find.
      const reads = await Promise.allSettled([
        getDoc(doc(db, 'students', profile.uid)),
        getDocs(query(collection(db, 'courses'), where('status', '==', 'ACTIVE'))),
        getDocs(collection(db, 'batches')),
        getDocs(query(collection(db, 'enrollments'), where('studentDocId', '==', profile.uid))),
        getDocs(query(collection(db, 'feeRecords'), where('studentDocId', '==', profile.uid))),
        getDocs(query(collection(db, 'attendanceRecords'), where('studentDocId', '==', profile.uid))),
        getDocs(query(collection(db, 'payments'), where('studentDocId', '==', profile.uid))),
      ]);
      const labels = ['student profile', 'active courses', 'batches', 'your enrollments', 'your fees', 'your attendance', 'your payment history'];
      const values = reads.map((result) => result.status === 'fulfilled' ? result.value : null);
      const denied = reads.flatMap((result, index) => result.status === 'rejected'
        ? [`${labels[index]} (${result.reason?.code || 'read failed'})`] : []);
      const [studentSnap, coursesSnap, batchesSnap, enrollmentsSnap, feesSnap, attendanceSnap, paymentsSnap] = values;
      if (!studentSnap) throw reads[0].reason;
      const student = studentSnap.exists() ? { documentId: studentSnap.id, ...studentSnap.data() } : null;
      if (!student) throw new Error('Your student record is not ready. Sign out and back in, or contact the Owner.');
      const records = (snapshot) => snapshot?.docs.map((d) => ({ documentId: d.id, ...d.data() })) || [];
      setData({ student, courses: records(coursesSnap), batches: records(batchesSnap), enrollments: records(enrollmentsSnap), fees: feesSnap?.docs.map((d) => d.data()) || [], attendance: attendanceSnap?.docs.map((d) => d.data()) || [], payments: records(paymentsSnap) });
      if (denied.length) setError(`Firestore denied these reads: ${denied.join(', ')}. Rules for project edupilot-80fa2 were just deployed. Verify this account's users/${profile.uid} document has role STUDENT and status APPROVED, then refresh.`);
    } catch (failure) { setError(failure.code === 'permission-denied' ? `Firestore denied your student profile read. Confirm users/${profile.uid} has role STUDENT and status APPROVED, and that this app is connected to project edupilot-80fa2.` : failure.message); }
    finally { setLoading(false); }
  }, [profile.uid]);
  useEffect(() => { refresh(); }, [refresh]);
  const activeIds = new Set(data.enrollments.filter((item) => item.status === 'ACTIVE').map((item) => item.batchDocId));
  const openBatches = data.batches.filter((batch) => {
    const course = data.courses.find((item) => item.documentId === batch.courseDocId);
    return course && !batch.isArchived && !batch.isClosed && batchStatus(batch) !== 'COMPLETED' && Number(batch.enrolledCount || 0) < Number(batch.capacity || 0) && !activeIds.has(batch.documentId)
      && (!courseFilter || course.documentId === courseFilter)
      && (!modeFilter || (batch.learningModes || ['OFFLINE']).includes(modeFilter))
      && (!dayFilter || (batch.daysOfWeek || []).includes(dayFilter))
      && `${course.name} ${batch.name} ${batch.batchId} ${batch.teacherName || ''}`.toLowerCase().includes(search.toLowerCase());
  });
  const enroll = async (batch) => {
    const mode = modeByBatch[batch.documentId] || (batch.learningModes || ['OFFLINE'])[0];
    setBusy(batch.documentId); setError(''); setMessage('');
    try { await enrollSelf({ uid: profile.uid, batchDocId: batch.documentId, learningMode: mode }); setMessage(`Enrolled in ${batch.name} (${mode.toLowerCase()}). Fees are recorded as unpaid until a payment is recorded.`); await refresh(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  };
  const changeMode = async (enrollment, learningMode) => { setBusy(enrollment.documentId); setError(''); setMessage(''); try { await changeEnrollmentMode({ uid: profile.uid, enrollmentId: enrollment.documentId, learningMode }); setMessage(`Learning mode updated to ${learningMode}. Historical attendance remains unchanged.`); await refresh(); } catch (failure) { setError(failure.message); } finally { setBusy(''); } };
  const enrollments = data.enrollments.filter((item) => item.status === 'ACTIVE');
  const attendancePercent = data.attendance.length ? Math.round(data.attendance.filter((item) => ['PRESENT', 'LATE'].includes(item.status)).length / data.attendance.length * 100) : 0;
  return <div className="ep-portal">
    <header className="ep-portal__head"><div><p className="ep-eyebrow">STUDENT WORKSPACE</p><h1>Welcome, {data.student?.fullName || profile.name}</h1><p>Student ID <strong>{data.student?.studentId || '…'}</strong> · {enrollments.length} active enrollment{enrollments.length === 1 ? '' : 's'}</p></div><button className="sm-button sm-button--quiet" type="button" onClick={refresh} disabled={loading}><RefreshCw size={15}/> Refresh</button></header>
    {error && <p className="ep-inline-error"><AlertCircle size={17}/>{error}</p>}{message && <p className="ep-portal__success">{message}</p>}
    {loading ? <p className="ep-portal__empty">Loading your EDUPILOT records…</p> : <>
      <div className="ep-portal__stats"><article><span>Active enrollments</span><strong>{enrollments.length}</strong></article><article><span>Attendance</span><strong>{attendancePercent}%</strong></article><article><span>Outstanding fees</span><strong>{money(data.fees.reduce((sum, fee) => sum + Number(fee.remainingBalance || 0), 0))}</strong></article></div>
      <section className="ep-portal__section"><header><div><h2>My courses</h2><p>Current batch, learning mode, attendance and fees.</p></div></header>{enrollments.length ? <div className="ep-portal__grid">{enrollments.map((item) => { const batch = data.batches.find((b) => b.documentId === item.batchDocId); const fee = data.fees.find((f) => f.enrollmentId === item.documentId); const relatedAttendance = data.attendance.filter((a) => a.batchDocId === item.batchDocId); const percentage = relatedAttendance.length ? Math.round(relatedAttendance.filter((a) => ['PRESENT', 'LATE'].includes(a.status)).length / relatedAttendance.length * 100) : 0; const modes = batch?.learningModes || ['OFFLINE']; const payments = data.payments.filter((payment) => payment.feeRecordId === fee?.enrollmentId); return <article className="ep-portal__card" key={item.documentId}><div className="ep-portal__cardhead"><BookOpen size={18}/><span>{item.learningMode || 'Mode not set'}</span></div><h3>{item.courseName}</h3><p>{item.batchName || batch?.name} · {item.batchId}</p><p>{batch?.daysOfWeek?.join(', ')} · {batch?.startTime}–{batch?.endTime} · {batch?.teacherName}</p><label className="ep-portal__mode">Future class mode<select disabled={busy === item.documentId} value={item.learningMode || 'OFFLINE'} onChange={(e) => changeMode(item, e.target.value)}>{modes.map((mode) => <option key={mode}>{mode}</option>)}</select></label><div className="ep-portal__metrics"><span>Attendance <b>{percentage}%</b></span><span>Total fee <b>{money(fee?.totalFee)}</b></span><span>Amount paid <b>{money(fee?.amountPaid)}</b></span><span>Balance <b>{money(fee?.remainingBalance ?? fee?.totalFee)}</b></span><span>Payment status <b>{fee?.paymentStatus || 'Unpaid'}</b></span></div><details className="ep-portal__payment-history"><summary>Payment history</summary>{payments.length ? payments.map((payment) => <p key={payment.documentId}>{money(payment.amount)} · {payment.method} · {payment.status}{payment.reference ? ` · ${payment.reference}` : ''}</p>) : <p>No recorded payments.</p>}</details></article>; })}</div> : <p className="ep-portal__empty">You are not enrolled yet. Browse open batches below.</p>}</section>
      <section className="ep-portal__section"><header><div><h2>Available courses &amp; batches</h2><p>Choose a batch and supported learning mode to enroll directly.</p></div><input aria-label="Search courses and batches" placeholder="Search courses or batches" value={search} onChange={(e) => setSearch(e.target.value)}/></header><div className="ep-portal__browse-filters"><select aria-label="Filter by course" value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)}><option value="">All courses</option>{data.courses.map((course) => <option key={course.documentId} value={course.documentId}>{course.name}</option>)}</select><select aria-label="Filter by mode" value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}><option value="">All learning modes</option><option value="ONLINE">Online</option><option value="OFFLINE">Offline</option></select><select aria-label="Filter by class day" value={dayFilter} onChange={(e) => setDayFilter(e.target.value)}><option value="">All schedules</option>{[['MON','Monday'],['TUE','Tuesday'],['WED','Wednesday'],['THU','Thursday'],['FRI','Friday'],['SAT','Saturday'],['SUN','Sunday']].map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div>{openBatches.length ? <div className="ep-portal__grid">{openBatches.map((batch) => { const course = data.courses.find((item) => item.documentId === batch.courseDocId); const modes = batch.learningModes || ['OFFLINE']; return <article className="ep-portal__card" key={batch.documentId}><div className="ep-portal__cardhead"><Users size={18}/><span>{batchStatus(batch)}</span></div><h3>{course.name} · {batch.name}</h3><p>{batch.batchId} · {batch.teacherName || 'Trainer to be assigned'}</p><p>{batch.daysOfWeek?.join(', ')} · {batch.startTime}–{batch.endTime} · {batch.startDate}–{batch.endDate}</p><p>{modes.includes('OFFLINE') ? (batch.roomNumber || 'Classroom') : (batch.onlineClassDetails || 'Online class')} · {Math.max(0, batch.capacity - (batch.enrolledCount || 0))} seats left</p><strong className="ep-portal__price">{money(batch.price ?? course.fee)}</strong><label className="ep-portal__mode">Learning mode<select value={modeByBatch[batch.documentId] || modes[0]} onChange={(e) => setModeByBatch((current) => ({ ...current, [batch.documentId]: e.target.value }))}>{modes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label><button className="sm-button sm-button--primary" type="button" disabled={busy === batch.documentId} onClick={() => enroll(batch)}>{busy === batch.documentId ? 'Enrolling…' : 'Enroll now'}</button></article>; })}</div> : <p className="ep-portal__empty">No open batches with seats are available right now.</p>}</section>
    </>}
  </div>;
}
