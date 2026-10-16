import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Archive, BookOpen, Check, ChevronRight, Clock3, GraduationCap, MapPin, Pencil, Plus, RefreshCw, Search, Users, X } from 'lucide-react';
import { listStudents, saveStudent } from '../students/studentService';
import {
  archiveBatch, archiveCourse, batchStatus, getBatchRoster,
  loadAcademyWorkspace, saveBatch, saveCourse, setBatchClosed, transferStudent,
  withdrawStudent,
} from './academyService';
import './batches.css';

const DAYS = [['MON', 'Mon'], ['TUE', 'Tue'], ['WED', 'Wed'], ['THU', 'Thu'], ['FRI', 'Fri'], ['SAT', 'Sat'], ['SUN', 'Sun']];
const blankCourse = { name: '', description: '', category: '', duration: 1, durationUnit: 'months', fee: 0, status: 'ACTIVE' };
const blankBatch = { name: '', courseDocId: '', teacherId: '', roomNumber: '', startDate: '', endDate: '', daysOfWeek: [], startTime: '', endTime: '', capacity: 20, price: 0, learningModes: ['OFFLINE'], onlineClassDetails: '', isClosed: false };

function message(error) {
  if (error.code === 'batch/room-conflict' || error.code === 'batch/teacher-conflict') return error.message;
  return error.message || 'The operation could not be completed.';
}

function money(value) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
}

function BatchStatus({ batch }) {
  const status = batchStatus(batch);
  return <span className={`bc-status bc-status--${status.toLowerCase()}`}>{status}</span>;
}

function Field({ label, error, wide, children }) {
  return <label className={`bc-field${wide ? ' bc-field--wide' : ''}`}><span>{label}</span>{children}{error && <small role="alert">{error}</small>}</label>;
}

function CourseForm({ initial, busy, error, onClose, onSave }) {
  const [value, setValue] = useState({ ...blankCourse, ...initial });
  const [fieldErrors, setFieldErrors] = useState({});
  const set = (key) => (event) => setValue((current) => ({ ...current, [key]: event.target.value }));
  const submit = async (event) => { event.preventDefault(); setFieldErrors({}); try { await onSave(value); } catch (failure) { setFieldErrors(failure.fields || {}); } };
  return <div className="bc-backdrop"><section className="bc-dialog" role="dialog" aria-modal="true" aria-labelledby="bc-course-title">
    <header className="bc-dialog__header"><div><p className="ep-eyebrow">COURSE CONFIGURATION</p><h2 id="bc-course-title">{initial?.documentId ? 'Edit course' : 'Create course'}</h2></div><button className="ep-icon-button" aria-label="Close" type="button" disabled={busy} onClick={onClose}><X size={18} /></button></header>
    <form className="bc-form" onSubmit={submit}>
      {error && <p className="bc-alert" role="alert"><AlertCircle size={16} />{error}</p>}
      {initial?.courseId && <p className="bc-idline">Course ID <strong>{initial.courseId}</strong></p>}
      <div className="bc-form__grid">
        <Field label="Course name *" error={fieldErrors.name}><input autoFocus value={value.name} onChange={set('name')} /></Field>
        <Field label="Category *" error={fieldErrors.category}><input value={value.category} onChange={set('category')} placeholder="Programming, Design…" /></Field>
        <Field label="Duration *" error={fieldErrors.duration}><div className="bc-inline-field"><input type="number" min="1" max="600" value={value.duration} onChange={set('duration')} /><select value={value.durationUnit} onChange={set('durationUnit')}><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option><option value="years">Years</option></select></div></Field>
        <Field label="Course fee (₹) *" error={fieldErrors.fee}><input type="number" min="0" step="1" value={value.fee} onChange={set('fee')} /></Field>
        <Field label="Status" error={fieldErrors.status}><select value={value.status} onChange={set('status')}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></Field>
        <Field label="Description" wide><textarea rows="3" value={value.description} onChange={set('description')} /></Field>
      </div>
      <footer className="bc-actions"><button type="button" className="sm-button sm-button--quiet" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="sm-button sm-button--primary" disabled={busy}>{busy ? 'Saving…' : 'Save course'}</button></footer>
    </form>
  </section></div>;
}

function BatchForm({ initial, courses, teachers, busy, error, onClose, onSave }) {
  const [value, setValue] = useState({ ...blankBatch, ...initial });
  const [fieldErrors, setFieldErrors] = useState({});
  const set = (key) => (event) => setValue((current) => ({ ...current, [key]: event.target.value }));
  const toggleDay = (day) => setValue((current) => ({ ...current, daysOfWeek: current.daysOfWeek.includes(day) ? current.daysOfWeek.filter((item) => item !== day) : [...current.daysOfWeek, day] }));
  const submit = async (event) => { event.preventDefault(); setFieldErrors({}); try { await onSave(value); } catch (failure) { setFieldErrors(failure.fields || {}); } };
  return <div className="bc-backdrop"><section className="bc-dialog" role="dialog" aria-modal="true" aria-labelledby="bc-batch-title">
    <header className="bc-dialog__header"><div><p className="ep-eyebrow">BATCH CONFIGURATION</p><h2 id="bc-batch-title">{initial?.documentId ? 'Edit batch' : 'Create batch'}</h2></div><button className="ep-icon-button" aria-label="Close" type="button" disabled={busy} onClick={onClose}><X size={18} /></button></header>
    <form className="bc-form" onSubmit={submit}>
      {error && <p className="bc-alert" role="alert"><AlertCircle size={16} />{error}</p>}
      {initial?.batchId && <p className="bc-idline">Batch ID <strong>{initial.batchId}</strong></p>}
      {!teachers.length && <p className="bc-alert"><AlertCircle size={16} />No approved Trainer accounts were found. Approve a Trainer before creating a batch.</p>}
      <div className="bc-form__grid">
        <Field label="Batch name *" error={fieldErrors.name}><input autoFocus value={value.name} onChange={set('name')} /></Field>
        <Field label="Course *" error={fieldErrors.courseDocId}><select value={value.courseDocId} onChange={set('courseDocId')}><option value="">Select active course</option>{courses.filter((item) => item.status === 'ACTIVE' && !item.isArchived).map((item) => <option key={item.documentId} value={item.documentId}>{item.name} · {item.courseId}</option>)}</select></Field>
        <Field label="Approved Trainer *" error={fieldErrors.teacherId}><select value={value.teacherId} onChange={set('teacherId')}><option value="">Select Trainer</option>{teachers.map((item) => <option key={item.uid} value={item.uid}>{item.name || item.email}</option>)}</select></Field>
        <Field label={`Room / classroom${value.learningModes.includes('OFFLINE') ? ' *' : ''}`} error={fieldErrors.roomNumber}><input value={value.roomNumber} onChange={set('roomNumber')} placeholder={value.learningModes.includes('OFFLINE') ? 'e.g. R-204' : 'Not needed for online-only batch'} /></Field>
        <Field label="Official batch price (₹) *" error={fieldErrors.price}><input type="number" min="0" step="1" value={value.price} onChange={set('price')} /></Field>
        <Field label="Learning modes *" error={fieldErrors.learningModes} wide><div className="bc-days">{[['ONLINE', 'Online'], ['OFFLINE', 'Offline']].map(([mode, label]) => <label key={mode}><input type="checkbox" checked={value.learningModes.includes(mode)} onChange={() => setValue((current) => ({ ...current, learningModes: current.learningModes.includes(mode) ? current.learningModes.filter((item) => item !== mode) : [...current.learningModes, mode] }))} />{label}</label>)}</div></Field>
        {value.learningModes.includes('ONLINE') && <Field label="Online classroom details / link" wide><input value={value.onlineClassDetails} onChange={set('onlineClassDetails')} placeholder="Meeting details (optional)" /></Field>}
        <Field label="Start date *" error={fieldErrors.startDate}><input type="date" value={value.startDate} onChange={set('startDate')} /></Field>
        <Field label="End date *" error={fieldErrors.endDate}><input type="date" value={value.endDate} onChange={set('endDate')} /></Field>
        <Field label="Start time *"><input type="time" value={value.startTime} onChange={set('startTime')} /></Field>
        <Field label="End time *" error={fieldErrors.endTime}><input type="time" value={value.endTime} onChange={set('endTime')} /></Field>
        <Field label="Maximum capacity *" error={fieldErrors.capacity}><input type="number" min="1" max="500" step="1" value={value.capacity} onChange={set('capacity')} /></Field>
        <Field label="Class days *" error={fieldErrors.daysOfWeek} wide><div className="bc-days">{DAYS.map(([key, label]) => <label key={key}><input type="checkbox" checked={value.daysOfWeek.includes(key)} onChange={() => toggleDay(key)} />{label}</label>)}</div></Field>
      </div>
      <footer className="bc-actions"><button type="button" className="sm-button sm-button--quiet" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="sm-button sm-button--primary" disabled={busy || !teachers.length}>{busy ? 'Saving…' : 'Save batch'}</button></footer>
    </form>
  </section></div>;
}

function BatchDetails({ batch, courses, profile, allBatches, onClose, onChanged }) {
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [destination, setDestination] = useState({});
  const [busyId, setBusyId] = useState('');
  const refresh = useCallback(async () => { setLoading(true); setError(''); try { setRoster(await getBatchRoster(batch.documentId, profile.role, profile.uid)); } catch (failure) { setError(message(failure)); } finally { setLoading(false); } }, [batch.documentId, profile.role, profile.uid]);
  useEffect(() => { refresh(); }, [refresh]);
  const course = courses.find((item) => item.documentId === batch.courseDocId);
  const canManageEnrollment = ['OWNER', 'COUNSELOR'].includes(profile.role);
  const targets = allBatches.filter((item) => item.documentId !== batch.documentId && item.courseDocId && !item.isArchived && !['FULL', 'CLOSED', 'COMPLETED'].includes(item.status));
  const transfer = async (student) => {
    if (!destination[student.documentId]) return;
    setBusyId(student.documentId); setError('');
    try { const target = allBatches.find((item) => item.documentId === destination[student.documentId]); await transferStudent(student.documentId, target.courseDocId, target.documentId, profile.uid); await onChanged(); await refresh(); }
    catch (failure) { setError(message(failure)); }
    finally { setBusyId(''); }
  };
  const withdraw = async (student) => {
    if (!window.confirm(`Withdraw ${student.fullName} from ${batch.name}? Their student record will be kept.`)) return;
    setBusyId(student.documentId); setError('');
    try { await withdrawStudent(student.documentId, profile.uid); await onChanged(); await refresh(); }
    catch (failure) { setError(message(failure)); }
    finally { setBusyId(''); }
  };
  return <div className="bc-backdrop"><section className="bc-dialog bc-dialog--wide" role="dialog" aria-modal="true" aria-labelledby="bc-detail-title">
    <header className="bc-dialog__header"><div><p className="ep-eyebrow">BATCH DETAILS</p><h2 id="bc-detail-title">{batch.name}</h2><p className="bc-subtitle">{batch.batchId} · {course?.name || batch.courseName}</p></div><button className="ep-icon-button" aria-label="Close" type="button" onClick={onClose}><X size={18} /></button></header>
    <div className="bc-detail-grid"><div><span>Trainer</span><strong>{batch.teacherName || '—'}</strong></div><div><span>Room</span><strong>{batch.roomNumber || '—'}</strong></div><div><span>Dates</span><strong>{batch.startDate} – {batch.endDate}</strong></div><div><span>Schedule</span><strong>{batch.daysOfWeek?.map((day) => DAYS.find(([key]) => key === day)?.[1] || day).join(', ')} · {batch.startTime}–{batch.endTime}</strong></div><div><span>Capacity</span><strong>{batch.enrolledCount || 0} / {batch.capacity}</strong></div><div><span>Seats available</span><strong>{Math.max(0, Number(batch.capacity || 0) - Number(batch.enrolledCount || 0))}</strong></div><div><span>Price</span><strong>{money(batch.price ?? course?.fee)}</strong></div><div><span>Learning modes</span><strong>{(batch.learningModes || ['OFFLINE']).join(', ')}</strong></div></div>
    {error && <p className="bc-alert" role="alert"><AlertCircle size={16} />{error}</p>}
    <div className="bc-roster-heading"><div><h3>Enrolled students</h3><p>Active enrollment records for this batch.</p></div><button className="sm-button sm-button--quiet" type="button" onClick={refresh} disabled={loading}><RefreshCw size={15} /> Refresh</button></div>
    {loading ? <p className="bc-state">Loading roster…</p> : roster.length === 0 ? <p className="bc-state">No students are currently enrolled in this batch.</p> : <div className="bc-roster">{roster.map((student) => <article className="bc-roster__row" key={student.documentId}><div><strong>{student.fullName}</strong><span>{student.studentId} · {student.email}</span></div>{canManageEnrollment && <div className="bc-roster__actions"><select aria-label={`Transfer ${student.fullName} to batch`} value={destination[student.documentId] || ''} onChange={(event) => setDestination((items) => ({ ...items, [student.documentId]: event.target.value }))}><option value="">Transfer to…</option>{targets.map((item) => <option key={item.documentId} value={item.documentId}>{item.name} · {item.batchId} ({item.enrolledCount}/{item.capacity})</option>)}</select><button type="button" className="sm-button sm-button--quiet" disabled={!destination[student.documentId] || busyId === student.documentId} onClick={() => transfer(student)}>{busyId === student.documentId ? 'Moving…' : 'Move'}</button><button type="button" className="bc-text-danger" disabled={busyId === student.documentId} onClick={() => withdraw(student)}>Withdraw</button></div>}</article>)}</div>}
  </section></div>;
}

function EnrollmentForm({ students, courses, batches, busy, error, onClose, onEnroll }) {
  const [studentDocId, setStudentDocId] = useState('');
  const [courseDocId, setCourseDocId] = useState('');
  const [batchDocId, setBatchDocId] = useState('');
  const [phone, setPhone] = useState('');
  const [admissionDate, setAdmissionDate] = useState(new Date().toISOString().slice(0, 10));
  const selectedStudent = students.find((item) => item.documentId === studentDocId);
  const isAccountOnly = selectedStudent?.source === 'account-profile';
  const eligibleBatches = batches.filter((item) => item.courseDocId === courseDocId && !['FULL', 'CLOSED', 'COMPLETED'].includes(item.status));
  const selectedBatch = eligibleBatches.find((item) => item.documentId === batchDocId);
  return <div className="bc-backdrop"><section className="bc-dialog" role="dialog" aria-modal="true" aria-labelledby="bc-enroll-title">
    <header className="bc-dialog__header"><div><p className="ep-eyebrow">COUNSELLOR WORKSPACE</p><h2 id="bc-enroll-title">Enroll existing student</h2></div><button className="ep-icon-button" aria-label="Close" type="button" disabled={busy} onClick={onClose}><X size={18} /></button></header>
    <div className="bc-form"><p className="bc-help">Choose an existing student record to transfer or re-enroll it. An account-only Student profile is linked to the same account and receives its first Student ID.</p>
      {error && <p className="bc-alert" role="alert"><AlertCircle size={16} />{error}</p>}
      <div className="bc-form__grid">
        <Field label="Student *"><select value={studentDocId} onChange={(event) => setStudentDocId(event.target.value)}><option value="">Select student</option>{students.map((item) => <option key={item.documentId} value={item.documentId}>{item.fullName} · {item.studentId || 'Account profile'}</option>)}</select></Field>
        <Field label="Course *"><select value={courseDocId} onChange={(event) => { setCourseDocId(event.target.value); setBatchDocId(''); }}><option value="">Select course</option>{courses.map((item) => <option key={item.documentId} value={item.documentId}>{item.name} · {item.courseId}</option>)}</select></Field>
        <Field label="Available batch *" wide><select value={batchDocId} onChange={(event) => setBatchDocId(event.target.value)}><option value="">Select batch</option>{eligibleBatches.map((item) => <option key={item.documentId} value={item.documentId}>{item.name} · {item.batchId} · {item.capacity - item.enrolledCount} seats</option>)}</select>{courseDocId && eligibleBatches.length === 0 && <small>No available batches for this course.</small>}</Field>
      </div>
      {isAccountOnly && <div className="bc-form__grid bc-account-details"><Field label="Phone number *"><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Student contact number" required /></Field><Field label="Admission date *"><input type="date" value={admissionDate} onChange={(event) => setAdmissionDate(event.target.value)} required /></Field></div>}
      {selectedBatch && <div className="bc-selection-card"><strong>{selectedBatch.teacherName}</strong><span><MapPin size={14} />{selectedBatch.roomNumber}</span><span><Clock3 size={14} />{selectedBatch.daysOfWeek.join(', ')} · {selectedBatch.startTime}–{selectedBatch.endTime}</span><span>{selectedBatch.startDate} – {selectedBatch.endDate} · {selectedBatch.capacity - selectedBatch.enrolledCount} seats left</span></div>}
      {!students.length && <p className="bc-alert"><AlertCircle size={16} />No Student records or Student accounts are available. Create or approve a Student account first.</p>}
      <footer className="bc-actions"><button type="button" className="sm-button sm-button--quiet" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="sm-button sm-button--primary" disabled={busy || !studentDocId || !courseDocId || !batchDocId || (isAccountOnly && !phone.trim())} onClick={() => onEnroll(selectedStudent, courseDocId, batchDocId, { phone, admissionDate })}>{busy ? 'Enrolling…' : 'Confirm enrollment'}</button></footer>
    </div>
  </section></div>;
}

export default function BatchesCourses({ profile }) {
  const isOwner = profile.role === 'OWNER';
  const canEnroll = ['OWNER', 'COUNSELOR'].includes(profile.role);
  const [tab, setTab] = useState('batches');
  const [courses, setCourses] = useState([]);
  const [batches, setBatches] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [teacherFilter, setTeacherFilter] = useState('');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const [workspace, studentResult] = await Promise.all([
        loadAcademyWorkspace(profile.role, profile.uid),
        canEnroll ? listStudents(profile.role) : Promise.resolve({ records: [] }),
      ]);
      setCourses(workspace.courses); setBatches(workspace.batches); setTeachers(workspace.teachers);
      setStudents(studentResult.records);
    } catch (failure) { setLoadError(message(failure)); }
    finally { setLoading(false); }
  }, [profile.role, profile.uid, canEnroll]);
  useEffect(() => { refresh(); }, [refresh]);

  const visibleCourses = useMemo(() => courses.filter((course) => !course.isArchived)
    .filter((course) => (!search || `${course.name} ${course.courseId}`.toLowerCase().includes(search.toLowerCase()))
      && (!courseFilter || course.category === courseFilter)
      && (!statusFilter || course.status === statusFilter)), [courses, search, courseFilter, statusFilter]);
  const visibleBatches = useMemo(() => batches.filter((batch) => !batch.isArchived)
    .filter((batch) => (!search || `${batch.name} ${batch.batchId} ${batch.courseName} ${batch.teacherName} ${batch.roomNumber} ${batch.daysOfWeek?.join(' ')} ${batch.startTime} ${batch.endTime} ${batch.startDate}`.toLowerCase().includes(search.toLowerCase()))
      && (!courseFilter || batch.courseDocId === courseFilter)
      && (!teacherFilter || batch.teacherId === teacherFilter)
      && (!startDateFilter || batch.startDate >= startDateFilter)
      && (!statusFilter || batch.status === statusFilter)), [batches, search, courseFilter, teacherFilter, startDateFilter, statusFilter]);
  const totalEnrollments = batches.reduce((sum, batch) => sum + Number(batch.enrolledCount || 0), 0);
  const activeBatches = batches.filter((batch) => ['ACTIVE', 'FULL'].includes(batch.status)).length;

  const mutate = async (operation, success) => {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); setModal(null); setNotice(success); await refresh(); }
    catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  };
  const handleCourseSave = (value) => mutate(() => saveCourse(value, profile.uid, modal.course?.documentId || ''), modal.course ? 'Course updated.' : 'Course created.');
  const handleBatchSave = (value) => mutate(() => saveBatch(value, profile.uid, modal.batch?.documentId || ''), modal.batch ? 'Batch updated.' : 'Batch created.');
  const handleExistingEnroll = (student, courseDocId, batchDocId, accountDetails = {}) => mutate(() => (
    student.source === 'account-profile'
      ? saveStudent({
        studentId: '', authUid: student.documentId, fullName: student.fullName, email: student.email,
        phone: accountDetails.phone, admissionDate: accountDetails.admissionDate, status: 'ACTIVE',
        dateOfBirth: '', gender: '', address: '', guardianName: '', guardianPhone: '',
        courseDocId, batchDocId,
      }, profile.uid)
      : transferStudent(student.documentId, courseDocId, batchDocId, profile.uid)
  ), student.source === 'account-profile' ? 'Student account linked and enrolled.' : 'Student enrollment saved.');
  const courseCategories = [...new Set(courses.map((item) => item.category).filter(Boolean))].sort();
  const batchTeachers = [...new Map(batches.map((item) => [item.teacherId, { uid: item.teacherId, name: item.teacherName || item.teacherId }])).values()];
  const coursesByBatch = (courseDocId) => batches.filter((item) => item.courseDocId === courseDocId && !item.isArchived);
  const startEnrollment = async () => {
    setError('');
    const activeCourses = courses.filter((item) => item.status === 'ACTIVE' && !item.isArchived);
    const activeCourseIds = new Set(activeCourses.map((item) => item.documentId));
    const eligibleBatches = batches.filter((item) => activeCourseIds.has(item.courseDocId) && !item.isArchived && !['FULL', 'CLOSED', 'COMPLETED'].includes(item.status));
    setModal({ type: 'enroll', options: { courses: activeCourses, batches: eligibleBatches } });
  };

  return <section className="bc-page">
    <header className="bc-page__header"><div><p className="ep-eyebrow">EDUPILOT ACADEMICS</p><h1>Batches &amp; Courses</h1><p>Manage programs, schedules, teacher allocation, and student enrollment.</p></div><div className="bc-page__buttons">{canEnroll && <button className="sm-button sm-button--quiet" type="button" onClick={startEnrollment}><Users size={16} /> Enroll student</button>}{isOwner && <button className="sm-button sm-button--primary" type="button" onClick={() => { setError(''); setModal(tab === 'courses' ? { type: 'course' } : { type: 'batch' }); }}>{tab === 'courses' ? <><Plus size={16} /> Create course</> : <><Plus size={16} /> Create batch</>}</button>}</div></header>
    <div className="bc-stats">{[['Total courses', courses.filter((item) => !item.isArchived).length, BookOpen], ['Total batches', batches.filter((item) => !item.isArchived).length, GraduationCap], ['Active batches', activeBatches, Check], ['Active enrollments', totalEnrollments, Users]].map(([label, value, Icon]) => <article className="bc-stat" key={label}><span><Icon size={17} /></span><p>{label}</p><strong>{value}</strong></article>)}</div>
    {notice && <p className="sm-notice" role="status">{notice}</p>}{error && !modal && <p className="ep-inline-error" role="alert"><AlertCircle size={17} />{error}</p>}
    <section className="bc-panel">
      <div className="bc-tabs" role="tablist" aria-label="Academic records"><button type="button" role="tab" aria-selected={tab === 'batches'} className={tab === 'batches' ? 'is-active' : ''} onClick={() => { setTab('batches'); setSearch(''); setCourseFilter(''); setTeacherFilter(''); setStartDateFilter(''); setStatusFilter(''); }}>Batches <span>{batches.filter((item) => !item.isArchived).length}</span></button><button type="button" role="tab" aria-selected={tab === 'courses'} className={tab === 'courses' ? 'is-active' : ''} onClick={() => { setTab('courses'); setSearch(''); setCourseFilter(''); setTeacherFilter(''); setStartDateFilter(''); setStatusFilter(''); }}>Courses <span>{courses.filter((item) => !item.isArchived).length}</span></button></div>
      <div className="bc-filters"><label><Search size={16} /><input aria-label={`Search ${tab}`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tab === 'batches' ? 'Search batch, course, trainer, or room' : 'Search course name or ID'} /></label>
        {tab === 'batches' && <select aria-label="Filter courses" value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}><option value="">All courses</option>{courses.map((item) => <option key={item.documentId} value={item.documentId}>{item.name}</option>)}</select>}
        {tab === 'batches' && <select aria-label="Filter teachers" value={teacherFilter} onChange={(event) => setTeacherFilter(event.target.value)}><option value="">All teachers</option>{batchTeachers.map((item) => <option key={item.uid} value={item.uid}>{item.name}</option>)}</select>}
        {tab === 'batches' && <label className="bc-date-filter">Starts on/after<input aria-label="Filter by start date" type="date" value={startDateFilter} onChange={(event) => setStartDateFilter(event.target.value)} /></label>}
        {tab === 'courses' && <select aria-label="Filter category" value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}><option value="">All categories</option>{courseCategories.map((item) => <option key={item}>{item}</option>)}</select>}
        <select aria-label="Filter status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{(tab === 'courses' ? ['ACTIVE', 'INACTIVE'] : ['UPCOMING', 'ACTIVE', 'FULL', 'COMPLETED', 'CLOSED']).map((item) => <option key={item}>{item}</option>)}</select>
        <button type="button" className="sm-button sm-button--quiet" onClick={() => { setSearch(''); setCourseFilter(''); setTeacherFilter(''); setStartDateFilter(''); setStatusFilter(''); }}>Reset</button><button type="button" className="ep-icon-button" aria-label="Refresh courses and batches" onClick={refresh} disabled={loading}><RefreshCw size={16} /></button>
      </div>
      {loadError ? <div className="bc-state bc-state--error"><AlertCircle size={20} /><p>{loadError}</p><button className="sm-button sm-button--quiet" type="button" onClick={refresh}><RefreshCw size={15} /> Retry</button></div>
        : loading ? <div className="bc-state">Loading courses and batches…</div>
          : tab === 'courses' ? visibleCourses.length ? <div className="bc-list">{visibleCourses.map((course) => {
            const linked = coursesByBatch(course.documentId);
            const enrollments = linked.reduce((sum, item) => sum + Number(item.enrolledCount || 0), 0);
            return <article className="bc-course-row" key={course.documentId}><div className="bc-course-icon"><BookOpen size={18} /></div><div className="bc-course-row__body"><div className="bc-course-row__title"><h3>{course.name}</h3><span className={`bc-status bc-status--${course.status.toLowerCase()}`}>{course.status}</span></div><p>{course.courseId} · {course.category} · {course.duration} {course.durationUnit} · {money(course.fee)}</p><small>{linked.length} batches · {enrollments} active enrollments</small></div><div className="bc-row-actions"><button className="sm-button sm-button--quiet" type="button" onClick={() => setModal({ type: 'courseDetail', course })}>View</button>{isOwner && <><button aria-label={`Edit ${course.name}`} className="bc-square-button" type="button" onClick={() => setModal({ type: 'course', course })}><Pencil size={15} /></button><button className="sm-button sm-button--quiet" type="button" onClick={() => mutate(() => saveCourse({ ...course, status: course.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }, profile.uid, course.documentId), `Course ${course.status === 'ACTIVE' ? 'deactivated' : 'activated'}.`)}>{course.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button><button className="bc-square-button" aria-label={`${course.isArchived ? 'Restore' : 'Archive'} ${course.name}`} type="button" onClick={() => { if (window.confirm(`${course.isArchived ? 'Restore' : 'Archive'} ${course.name}?`)) mutate(() => archiveCourse(course.documentId, !course.isArchived), `Course ${course.isArchived ? 'restored' : 'archived'}.`); }}><Archive size={15} /></button></>}</div></article>;
          })}</div> : <div className="bc-state"><BookOpen size={23} /><strong>{courses.length ? 'No matching courses' : 'No courses yet'}</strong><p>{courses.length ? 'Change the search or filters.' : 'An Owner can create the first course.'}</p></div>
            : visibleBatches.length ? <div className="bc-list">{visibleBatches.map((batch) => <article className="bc-batch-row" key={batch.documentId}><div className="bc-batch-row__main"><div className="bc-batch-row__title"><span className="bc-batch-mark"><GraduationCap size={18} /></span><div><h3>{batch.name}</h3><p>{batch.batchId} · {batch.courseName}</p></div><BatchStatus batch={batch} /></div><div className="bc-batch-meta"><span><Users size={14} />{batch.enrolledCount || 0}/{batch.capacity} students · {Math.max(0, batch.capacity - (batch.enrolledCount || 0))} seats</span><span><Clock3 size={14} />{batch.daysOfWeek?.join(', ')} · {batch.startTime}–{batch.endTime}</span><span><MapPin size={14} />{batch.teacherName} · {batch.roomNumber}</span><span>{batch.startDate} – {batch.endDate}</span><span>{money(batch.price ?? courses.find((item) => item.documentId === batch.courseDocId)?.fee)} · {(batch.learningModes || ['OFFLINE']).join('/')}</span></div></div><div className="bc-row-actions"><button className="sm-button sm-button--quiet" type="button" onClick={() => setModal({ type: 'detail', batch })}>Details <ChevronRight size={14} /></button>{isOwner && <><button aria-label={`Edit ${batch.name}`} className="bc-square-button" type="button" onClick={() => setModal({ type: 'batch', batch })}><Pencil size={15} /></button><button className="sm-button sm-button--quiet" type="button" onClick={() => mutate(() => setBatchClosed(batch.documentId, !batch.isClosed, profile.uid), batch.isClosed ? 'Batch reopened.' : 'Batch closed.')}>{batch.isClosed ? 'Reopen' : 'Close'}</button><button className="bc-square-button" aria-label={`${batch.isArchived ? 'Restore' : 'Archive'} ${batch.name}`} type="button" onClick={() => { if (window.confirm(`${batch.isArchived ? 'Restore' : 'Archive'} ${batch.name}?`)) mutate(() => archiveBatch(batch.documentId, !batch.isArchived), `Batch ${batch.isArchived ? 'restored' : 'archived'}.`); }}><Archive size={15} /></button></>}</div></article>)}</div> : <div className="bc-state"><GraduationCap size={23} /><strong>{batches.length ? 'No matching batches' : 'No batches yet'}</strong><p>{batches.length ? 'Change the search or filters.' : isOwner ? 'Create an active course, then create its first batch.' : 'There are no batches available for your account yet.'}</p></div>}
    </section>
    {modal?.type === 'course' && <CourseForm initial={modal.course} busy={busy} error={error} onClose={() => setModal(null)} onSave={handleCourseSave} />}
    {modal?.type === 'batch' && <BatchForm initial={modal.batch} courses={courses} teachers={teachers} busy={busy} error={error} onClose={() => setModal(null)} onSave={handleBatchSave} />}
    {modal?.type === 'detail' && <BatchDetails batch={modal.batch} courses={courses} profile={profile} allBatches={batches} onClose={() => setModal(null)} onChanged={refresh} />}
    {modal?.type === 'enroll' && <EnrollmentForm students={students} courses={modal.options.courses} batches={modal.options.batches} busy={busy} error={error} onClose={() => setModal(null)} onEnroll={handleExistingEnroll} />}
    {modal?.type === 'courseDetail' && <div className="bc-backdrop"><section className="bc-dialog" role="dialog" aria-modal="true" aria-labelledby="bc-course-detail-title"><header className="bc-dialog__header"><div><p className="ep-eyebrow">COURSE DETAILS</p><h2 id="bc-course-detail-title">{modal.course.name}</h2></div><button className="ep-icon-button" aria-label="Close" type="button" onClick={() => setModal(null)}><X size={18} /></button></header><p className="bc-idline">{modal.course.courseId} · {modal.course.category} · {modal.course.duration} {modal.course.durationUnit} · {money(modal.course.fee)}</p><p>{modal.course.description || 'No course description provided.'}</p><h3 className="bc-roster-heading">Batches for this course</h3>{coursesByBatch(modal.course.documentId).length ? coursesByBatch(modal.course.documentId).map((batch) => <p key={batch.documentId} className="bc-linked-batch">{batch.name} · {batch.batchId} · {batch.enrolledCount}/{batch.capacity} enrolled · {batch.status}</p>) : <p className="bc-state">No batches have been created for this course.</p>}</section></div>}
  </section>;
}
