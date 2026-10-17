import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, BookOpen, RefreshCw, Users } from 'lucide-react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { batchStatus } from '../batches/academyService';
import { confirmDemoEnrollment, getOfflineEnrollmentCounts, reauthenticateCurrentStudent } from './enrollmentApi';
import { calculateStudentAttendance } from './attendanceModel';
import './portal.css';

const money = (amount) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(amount || 0));

export default function StudentPortal({ profile, onNavigate }) {
  const [data, setData] = useState({ student: null, courses: [], batches: [], enrollments: [], fees: [], attendance: [], attendanceSessions: [], payments: [], timetable: [], offlineCounts: {} });
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [busy, setBusy] = useState(''); const [message, setMessage] = useState('');
  const [modeByBatch, setModeByBatch] = useState({}); const [search, setSearch] = useState(''); const [payment, setPayment] = useState(null);
  const [courseFilter, setCourseFilter] = useState(''); const [modeFilter, setModeFilter] = useState('');
  const requiresPassword = auth.currentUser?.providerData.some((provider) => provider.providerId === 'password');
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
      const enrollmentRecords = records(enrollmentsSnap);
      const scheduleResults = await Promise.allSettled(enrollmentRecords.filter((item) => item.status === 'ACTIVE').map((item) => getDocs(query(collection(db, 'timetableSessions'), where('batchDocId', '==', item.batchDocId), where('status', '==', 'PUBLISHED')))));
      const attendanceSessionResults = await Promise.allSettled(enrollmentRecords.map((item) => getDocs(query(collection(db, 'attendanceSessions'), where('batchDocId', '==', item.batchDocId)))));
      const scheduleErrors = scheduleResults.filter((result) => result.status === 'rejected').length;
      const timetable = scheduleResults.flatMap((result) => result.status === 'fulfilled' ? records(result.value) : []);
      const attendanceSessionErrors = attendanceSessionResults.filter((result) => result.status === 'rejected').length;
      const attendanceSessions = attendanceSessionResults.flatMap((result) => result.status === 'fulfilled' ? records(result.value) : []);
      const batches = records(batchesSnap);
      let offlineCounts = Object.fromEntries(batches.map((batch) => [batch.documentId, Number(batch.offlineEnrolledCount || 0)]));
      try { offlineCounts = { ...offlineCounts, ...(await getOfflineEnrollmentCounts(batches.map((batch) => batch.documentId))).offlineEnrollmentCounts }; }
      catch { /* Confirmation performs an authoritative backend capacity check. */ }
      setData({ student, courses: records(coursesSnap), batches, enrollments: enrollmentRecords, fees: feesSnap?.docs.map((d) => d.data()) || [], attendance: attendanceSnap?.docs.map((d) => d.data()) || [], attendanceSessions, payments: records(paymentsSnap), timetable, offlineCounts });
      if (scheduleErrors) denied.push(`your published timetable (${scheduleErrors} batch read(s))`);
      if (attendanceSessionErrors) denied.push(`your attendance sessions (${attendanceSessionErrors} batch read(s))`);
      if (denied.length) setError(`Firestore denied these reads: ${denied.join(', ')}. Verify the deployed rules for project edupilot-80fa2 and confirm users/${profile.uid} has role STUDENT and status APPROVED, then refresh.`);
    } catch (failure) { setError(failure.code === 'permission-denied' ? `Firestore denied your student profile read. Confirm users/${profile.uid} has role STUDENT and status APPROVED, and that this app is connected to project edupilot-80fa2.` : failure.message); }
    finally { setLoading(false); }
  }, [profile.uid]);
  useEffect(() => { refresh(); }, [refresh]);
  const activeIds = new Set(data.enrollments.filter((item) => item.status === 'ACTIVE').map((item) => item.batchDocId));
  const openBatches = data.batches.filter((batch) => {
    const course = data.courses.find((item) => item.documentId === batch.courseDocId);
    return course && !batch.isArchived && !batch.isClosed && batchStatus(batch) !== 'COMPLETED' && !activeIds.has(batch.documentId)
      && (!courseFilter || course.documentId === courseFilter)
      && (!modeFilter || (batch.learningModes || ['OFFLINE']).includes(modeFilter))
      && `${course.name} ${batch.name} ${batch.batchId} ${batch.teacherName || ''}`.toLowerCase().includes(search.toLowerCase());
  });
  const startEnrollment = (batch) => {
    const course = data.courses.find((item) => item.documentId === batch.courseDocId);
    const modes = batch.learningModes || ['OFFLINE'];
    const offlineFull = Number(data.offlineCounts[batch.documentId] ?? batch.offlineEnrolledCount ?? 0) >= Number(batch.offlineCapacity || batch.capacity || 0);
    setError(''); setMessage('');
    setPayment({ batch, course, learningMode: modeByBatch[batch.documentId] || (offlineFull && modes.includes('ONLINE') ? 'ONLINE' : modes[0]), amount: '', password: '', requestId: window.crypto.randomUUID(), step: 'review' });
  };
  const beginDemoPayment = () => {
    const fee = Number(payment.batch.price ?? payment.course?.fee);
    const amount = Number(payment.amount);
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7 || amount < Math.ceil(fee * 100 / 2) / 100 || amount > fee) {
      setError(`Enter a valid amount from ${money(Math.ceil(fee * 100 / 2) / 100)} to ${money(fee)}.`); return;
    }
    setError(''); setPayment((current) => ({ ...current, step: 'reauth' }));
  };
  const submitDemoPayment = async () => {
    if (!payment) return;
    const amount = Number(payment.amount);
    setBusy(payment.batch.documentId); setError(''); setMessage('');
    try {
      await reauthenticateCurrentStudent(payment.password);
      await confirmDemoEnrollment({ batchDocId: payment.batch.documentId, learningMode: payment.learningMode, amount, requestId: payment.requestId });
      setPayment(null); setMessage(`Enrollment confirmed in ${payment.batch.name}. A demo payment was recorded; no real money was transferred.`); await refresh();
    } catch (failure) {
      const messages = { 'auth/wrong-password': 'That password is incorrect. Enter the password for your signed-in EDUPILOT account.', 'auth/invalid-credential': 'The password could not be verified. Check it and try again.', 'auth/too-many-requests': 'Too many attempts. Wait a little while, then try again.', 'auth/network-request-failed': 'Could not reach Firebase Authentication. Check your connection and retry.', RECENT_LOGIN_REQUIRED: 'Your session needs fresh verification. Re-enter your account password and try again.', AUTH_REQUIRED: 'Your session expired. Sign in again, then retry enrollment.' };
      setError(messages[failure.code] || failure.message || 'Authentication or enrollment failed. No payment was recorded.');
    } finally { setPayment((current) => current ? { ...current, password: '' } : current); setBusy(''); }
  };
  const enrollments = data.enrollments.filter((item) => item.status === 'ACTIVE');
  const attendanceSessionById = new Map(data.attendanceSessions.map((item) => [item.documentId, item]));
  const attendancePercent = calculateStudentAttendance(data.attendance, attendanceSessionById).percentage;
  return <div className="ep-portal">
    <header className="ep-portal__head"><div><p className="ep-eyebrow">STUDENT WORKSPACE</p><h1>Welcome, {data.student?.fullName || profile.name}</h1><p>Student ID <strong>{data.student?.studentId || '…'}</strong> · {enrollments.length} active enrollment{enrollments.length === 1 ? '' : 's'}</p></div><button className="sm-button sm-button--quiet" type="button" onClick={refresh} disabled={loading}><RefreshCw size={15}/> Refresh</button></header>
    {error && <p className="ep-inline-error"><AlertCircle size={17}/>{error}</p>}{message && <p className="ep-portal__success">{message}</p>}
    {loading ? <p className="ep-portal__empty">Loading your EDUPILOT records…</p> : <>
      <div className="ep-portal__stats"><article><span>Active enrollments</span><strong>{enrollments.length}</strong></article><article><span>Attendance</span><strong>{attendancePercent === null ? '—' : `${attendancePercent}%`}</strong></article><article><span>Outstanding fees</span><strong>{money(data.fees.reduce((sum, fee) => sum + Number(fee.remainingBalance || 0), 0))}</strong></article></div>
      <section className="ep-portal__section"><header><div><h2>My courses</h2><p>Current batch, learning mode, attendance and fees.</p></div></header>{enrollments.length ? <div className="ep-portal__grid">{enrollments.map((item) => { const batch = data.batches.find((b) => b.documentId === item.batchDocId); const fee = data.fees.find((f) => f.enrollmentId === item.documentId); const relatedAttendance = data.attendance.filter((a) => a.batchDocId === item.batchDocId); const percentage = calculateStudentAttendance(relatedAttendance, attendanceSessionById).percentage; const payments = data.payments.filter((payment) => payment.feeRecordId === fee?.enrollmentId); const schedules = data.timetable.filter((slot) => slot.batchDocId === item.batchDocId); return <article className="ep-portal__card" key={item.documentId}><div className="ep-portal__cardhead"><BookOpen size={18}/><span>{item.learningMode || 'Mode not set'} · locked</span></div><h3>{item.courseName}</h3><p>{item.batchName || batch?.name} · {item.batchId}</p><p>{schedules.length ? schedules.map((slot) => `${slot.day} ${String(Math.floor(slot.startMinutes / 60)).padStart(2, '0')}:${String(slot.startMinutes % 60).padStart(2, '0')}–${String(Math.floor(slot.endMinutes / 60)).padStart(2, '0')}:${String(slot.endMinutes % 60).padStart(2, '0')} · ${slot.roomName || 'Online'}`).join(' · ') : `${batch?.weeklyTeachingHours || 'Weekly hours not set'} teaching hours/week · ${batch?.teacherName || ''} · timetable not published`}</p><button type="button" className="sm-button sm-button--quiet" onClick={() => onNavigate?.('timetable', item.batchDocId)}>View timetable</button><p className="ep-portal__mode">Learning mode: {item.learningMode || 'Not set'} · contact the institute for a correction</p><div className="ep-portal__metrics"><span>Attendance <b>{percentage === null ? '—' : `${percentage}%`}</b></span><span>Total fee <b>{money(fee?.totalFee)}</b></span><span>Amount paid <b>{money(fee?.amountPaid)}</b></span><span>Balance <b>{money(fee?.remainingBalance ?? fee?.totalFee)}</b></span><span>Payment status <b>{fee?.paymentStatus || 'Unpaid'}</b></span></div><details className="ep-portal__payment-history"><summary>Payment history</summary>{payments.length ? payments.map((payment) => <p key={payment.documentId}>{money(payment.amount)} · {payment.method} · {payment.status}{payment.isDemo ? ' · Demo only; no money transferred' : ''}{payment.reference ? ` · ${payment.reference}` : ''}</p>) : <p>No recorded payments.</p>}</details></article>; })}</div> : <p className="ep-portal__empty">You are not enrolled yet. Browse open batches below.</p>}</section>
      <section className="ep-portal__section"><header><div><h2>Available courses &amp; batches</h2><p>Choose a learning mode, then review and confirm the required advance payment.</p></div><input aria-label="Search courses and batches" placeholder="Search courses or batches" value={search} onChange={(e) => setSearch(e.target.value)}/></header><div className="ep-portal__browse-filters"><select aria-label="Filter by course" value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)}><option value="">All courses</option>{data.courses.map((course) => <option key={course.documentId} value={course.documentId}>{course.name}</option>)}</select><select aria-label="Filter by mode" value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}><option value="">All learning modes</option><option value="ONLINE">Online</option><option value="OFFLINE">Offline</option></select></div>{openBatches.length ? <div className="ep-portal__grid">{openBatches.map((batch) => { const course = data.courses.find((item) => item.documentId === batch.courseDocId); const modes = batch.learningModes || ['OFFLINE']; const offlineCount = Number(data.offlineCounts[batch.documentId] ?? batch.offlineEnrolledCount ?? 0); const offlineFull = offlineCount >= Number(batch.offlineCapacity || batch.capacity || 0); return <article className="ep-portal__card" key={batch.documentId}><div className="ep-portal__cardhead"><Users size={18}/><span>{batchStatus(batch)}</span></div><h3>{course.name} · {batch.name}</h3><p>{batch.batchId} · {batch.teacherName || 'Trainer to be assigned'}</p><p>{batch.weeklyTeachingHours ? `${batch.weeklyTeachingHours} teaching hours/week` : 'Weekly hours set by the institute'} · {batch.startDate}–{batch.endDate}</p><p>{modes.includes('OFFLINE') ? (offlineFull ? 'Offline seats are full. Please select Online mode.' : `${Math.max(0, Number(batch.offlineCapacity || batch.capacity || 0) - offlineCount)} offline seats left`) : (batch.onlineClassDetails || 'Online class')}</p><strong className="ep-portal__price">{money(batch.price ?? course.fee)}</strong><label className="ep-portal__mode">Learning mode<select value={modeByBatch[batch.documentId] || (offlineFull && modes.includes('ONLINE') ? 'ONLINE' : modes[0])} onChange={(e) => setModeByBatch((current) => ({ ...current, [batch.documentId]: e.target.value }))}>{modes.map((mode) => <option key={mode} value={mode} disabled={mode === 'OFFLINE' && offlineFull}>{mode === 'OFFLINE' && offlineFull ? 'Offline (full)' : mode}</option>)}</select></label><button className="sm-button sm-button--primary" type="button" disabled={busy === batch.documentId || (offlineFull && !modes.includes('ONLINE'))} onClick={() => startEnrollment(batch)}>{busy === batch.documentId ? 'Working…' : 'Enroll now'}</button></article>; })}</div> : <p className="ep-portal__empty">No open batches with seats are available right now.</p>}</section>
    </>}
            {payment && <div className="ep-pay-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setPayment(null); setError(''); } }}><section className="ep-pay-dialog" role="dialog" aria-modal="true" aria-labelledby="ep-pay-title"><header><div><p className="ep-eyebrow">SECURE DEMONSTRATION</p><h2 id="ep-pay-title">{payment.step === 'review' ? 'Review enrollment & payment' : 'Confirm demo payment'}</h2></div><button type="button" className="ep-icon-button" disabled={Boolean(busy)} aria-label="Close" onClick={() => { setPayment(null); setError(''); }}>×</button></header><p className="ep-pay-demo"><strong>Demo Payment — No Real Money Will Be Transferred</strong><span>This only simulates advance authorization. No gateway, bank, or UPI transaction occurs.</span></p><dl><div><dt>Course</dt><dd>{payment.course?.name}</dd></div><div><dt>Batch</dt><dd>{payment.batch.name}</dd></div><div><dt>Learning mode</dt><dd>{payment.learningMode}</dd></div><div><dt>Total course fee</dt><dd>{money(payment.batch.price ?? payment.course?.fee)}</dd></div><div><dt>Minimum 50% advance</dt><dd>{money(Math.ceil(Number(payment.batch.price ?? payment.course?.fee) * 100 / 2) / 100)}</dd></div><div><dt>Amount entered</dt><dd>{money(payment.amount)}</dd></div><div><dt>Remaining after payment</dt><dd>{money(Math.max(0, Number(payment.batch.price ?? payment.course?.fee) - Number(payment.amount || 0)))}</dd></div></dl>{payment.step === 'review' ? <label className="ep-pay-field">Advance payment amount<input type="number" min={Math.ceil(Number(payment.batch.price ?? payment.course?.fee) * 100 / 2) / 100} max={Number(payment.batch.price ?? payment.course?.fee)} step="0.01" inputMode="decimal" value={payment.amount} onChange={(event) => setPayment((current) => ({ ...current, amount: event.target.value }))}/></label> : <>{requiresPassword ? <><p className="ep-pay-note">Re-enter the password for your signed-in EDUPILOT account. Firebase Authentication verifies it; the password is never sent to the enrollment server.</p><label className="ep-pay-field">EDUPILOT account password<input type="password" autoComplete="current-password" autoFocus value={payment.password} onChange={(event) => setPayment((current) => ({ ...current, password: event.target.value }))}/></label></> : <p className="ep-pay-note">Continue to reauthenticate with your current sign-in provider. No separate payment password is used.</p>}</>}{error && <p className="ep-inline-error" role="alert"><AlertCircle size={17}/>{error}</p>}<footer><button type="button" className="sm-button sm-button--quiet" disabled={Boolean(busy)} onClick={() => payment.step === 'reauth' ? (setPayment((current) => ({ ...current, step: 'review', password: '' })), setError('')) : (setPayment(null), setError(''))}>{payment.step === 'reauth' ? 'Back' : 'Cancel'}</button><button type="button" className="sm-button sm-button--primary" disabled={Boolean(busy)} onClick={payment.step === 'review' ? beginDemoPayment : submitDemoPayment}>{busy ? 'Verifying…' : payment.step === 'review' ? 'Continue' : (requiresPassword ? 'Verify & confirm demo enrollment' : 'Reauthenticate & confirm enrollment')}</button></footer></section></div>}
  </div>;
}
