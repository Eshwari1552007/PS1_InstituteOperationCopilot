import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Eye, Pencil, Plus, RefreshCw, Search, Trash2, Users, X } from 'lucide-react';
import { listStudents, removeStudent, saveStudent } from './studentService';
import { getBatchDurationHours, getEnrollmentOptions } from '../batches/academyService';
import './students.css';

const PAGE_SIZE = 10;
const EMPTY_STUDENT = { studentId: '', fullName: '', email: '', phone: '', dateOfBirth: '', gender: '', course: '', batch: '', admissionDate: '', status: 'ACTIVE', address: '', guardianName: '', guardianPhone: '' };

function errorMessage(error) {
  if (error.code === 'student/duplicate-id') return error.message;
  if (error.code === 'permission-denied') return 'Firebase denied this operation. Check the deployed Firestore rules and your approved role.';
  return error.message || 'The request could not be completed.';
}

function displayDate(value) {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00`) : value?.toDate?.();
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : '—';
}

function StudentForm({ initial, mode, busy, error, onClose, onSubmit, options }) {
  const [values, setValues] = useState({ ...EMPTY_STUDENT, ...initial });
  const [errors, setErrors] = useState({});
  const update = (field) => (event) => setValues((current) => ({ ...current, [field]: event.target.value }));
  const batchChoices = options.batches.filter((item) => item.courseDocId === values.courseDocId
    || item.documentId === initial?.batchDocId);
  const selectedBatch = batchChoices.find((item) => item.documentId === values.batchDocId);
  const selectCourse = (event) => {
    const course = options.courses.find((item) => item.documentId === event.target.value);
    setValues((current) => ({ ...current, courseDocId: event.target.value, course: course?.name || '', courseId: course?.courseId || '', batchDocId: '', batch: '', batchId: '' }));
  };
  const selectBatch = (event) => {
    const batch = batchChoices.find((item) => item.documentId === event.target.value);
    setValues((current) => ({ ...current, batchDocId: event.target.value, batch: batch?.name || '', batchId: batch?.batchId || '' }));
  };
  const field = (key, label, type = 'text', required = false, readOnly = false) => (
    <label className="sm-field" key={key}>
      <span>{label}{required && <b aria-hidden="true"> *</b>}</span>
      <input type={type} value={values[key] || ''} onChange={update(key)} required={required} readOnly={readOnly || mode === 'view'} aria-invalid={Boolean(errors[key])} />
      {errors[key] && <small role="alert">{errors[key]}</small>}
    </label>
  );
  const submit = async (event) => {
    event.preventDefault();
    setErrors({});
    try { await onSubmit(values); } catch (error) { setErrors(error.fields || {}); }
  };

  return <div className="sm-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="sm-modal" role="dialog" aria-modal="true" aria-labelledby="sm-form-title">
      <header className="sm-modal__head"><div><p className="ep-eyebrow">STUDENT RECORD</p><h2 id="sm-form-title">{mode === 'view' ? 'Student details' : mode === 'edit' ? 'Edit student' : 'Add student'}</h2></div><button className="ep-icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Close"><X size={18} /></button></header>
      <form className="sm-form" onSubmit={submit}>
        {error && <p className="ep-inline-error" role="alert"><AlertCircle size={17} />{error}</p>}
        {mode === 'view' && initial?.source === 'account-profile' && <p className="sm-profile-note">This is an existing Firebase Student account profile. Course, batch, admission, and contact details are not stored on that account yet.</p>}
        <h3>Personal information</h3><div className="sm-form__grid">
          {field('fullName', 'Full name', 'text', true)}{field('email', 'Email address', 'email', true)}{field('phone', 'Phone number', 'tel', true)}{field('dateOfBirth', 'Date of birth', 'date')}
          <label className="sm-field"><span>Gender</span><select value={values.gender} onChange={update('gender')} disabled={mode === 'view'}><option value="">Select gender</option><option>Female</option><option>Male</option><option>Non-binary</option><option>Prefer not to say</option></select></label>
        </div>
        <h3>Academic information</h3><div className="sm-form__grid">
          <label className="sm-field"><span>Student ID</span><input value={values.studentId || ''} readOnly placeholder={mode === 'create' ? 'Generated after successful registration' : ''} /></label>
          <label className="sm-field"><span>Course / program{mode === 'create' && <b aria-hidden="true"> *</b>}</span><select value={values.courseDocId || ''} onChange={selectCourse} disabled={mode === 'view'} required={mode === 'create'}><option value="">{mode === 'edit' ? 'Keep existing / no active enrollment' : 'Select course'}</option>{options.courses.filter((item) => item.status === 'ACTIVE' || item.documentId === initial?.courseDocId).map((item) => <option key={item.documentId} value={item.documentId}>{item.name} · {item.courseId}</option>)}</select>{errors.courseDocId && <small role="alert">{errors.courseDocId}</small>}</label>
          <label className="sm-field"><span>Batch{mode === 'create' && <b aria-hidden="true"> *</b>}</span><select value={values.batchDocId || ''} onChange={selectBatch} disabled={mode === 'view' || !values.courseDocId} required={mode === 'create'}><option value="">{mode === 'edit' ? 'No active enrollment' : 'Select available batch'}</option>{batchChoices.map((item) => <option key={item.documentId} value={item.documentId}>{item.name} · {item.batchId} ({Math.max(0, Number(item.capacity || 0) - Number(item.enrolledCount || 0))} seats)</option>)}</select>{errors.batchDocId && <small role="alert">{errors.batchDocId}</small>}</label>
          {field('admissionDate', 'Admission date', 'date', true)}
          <label className="sm-field"><span>Account status<b aria-hidden="true"> *</b></span><select value={values.status === 'PENDING' ? 'ACTIVE' : values.status} onChange={update('status')} disabled={mode === 'view'}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>{errors.status && <small role="alert">{errors.status}</small>}</label>
        </div>
        {selectedBatch && <div className="sm-enrollment-preview"><strong>{selectedBatch.teacherName || 'Trainer not assigned'}</strong><span>{selectedBatch.roomNumber || 'Room assigned by timetable'} · {selectedBatch.daysOfWeek?.join(', ')} · {getBatchDurationHours(selectedBatch) || 'Duration missing'} h/session · clock time assigned in timetable</span><span>{selectedBatch.startDate} – {selectedBatch.endDate} · {Math.max(0, Number(selectedBatch.capacity || 0) - Number(selectedBatch.enrolledCount || 0))} seats available</span></div>}
        {values.enrollmentStatus && <p className="sm-enrollment-status">Current enrollment: {values.enrollmentStatus}</p>}
        <h3>Additional information</h3><div className="sm-form__grid">
          {field('guardianName', 'Parent / guardian name')}{field('guardianPhone', 'Parent / guardian contact', 'tel')}
          <label className="sm-field sm-field--wide"><span>Address</span><textarea rows="3" value={values.address} onChange={update('address')} readOnly={mode === 'view'} /></label>
        </div>
        <footer className="sm-modal__actions"><button type="button" className="sm-button sm-button--quiet" onClick={onClose} disabled={busy}>{mode === 'view' ? 'Close' : 'Cancel'}</button>{mode !== 'view' && <button type="submit" className="sm-button sm-button--primary" disabled={busy}>{busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Add student'}</button>}</footer>
      </form>
    </section>
  </div>;
}

function StudentRow({ student, canDelete, onView, onEdit, onDelete }) {
  const name = student.fullName || 'Unnamed student';
  return <tr>
    <td><span className="sm-id">{student.studentId || '—'}</span></td>
    <td><div className="sm-person"><span className="sm-avatar">{name.trim().charAt(0).toUpperCase()}</span><div><strong>{name}</strong>{student.source === 'account-profile' && <small className="sm-account-label">Account profile only</small>}</div></div></td>
    <td>{student.email || '—'}</td><td>{student.phone || '—'}</td><td>{student.enrollments?.length ? student.enrollments.map((item) => item.courseName).join(', ') : student.course || '—'}</td><td>{student.enrollments?.length ? student.enrollments.map((item) => `${item.batchName} · ${item.learningMode}`).join('; ') : student.enrollmentStatus === 'NONE' ? 'Not Enrolled' : student.batch || '—'}</td><td>{displayDate(student.admissionDate)}</td>
    <td><span className={`sm-status sm-status--${String(student.accountStatus || student.status || 'INACTIVE').toLowerCase()}`}>{student.accountStatus || student.status || 'INACTIVE'}</span><small className="sm-account-label">{student.enrollmentStatus === 'NONE' || (!student.enrollments?.length && !student.batch) ? 'Not Enrolled' : student.enrollments?.length ? `${student.enrollments.length} active enrollment(s)` : student.enrollmentStatus || 'Enrolled'}</small></td>
    <td><small>{student.paymentStatus || 'UNPAID'} · Total {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(student.totalFees || 0))} · Paid {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(student.amountPaid || 0))} · Due {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(student.remainingBalance || 0))}</small></td>
    <td><div className="sm-row-actions"><button type="button" aria-label={`View ${name}`} title="View" onClick={onView}><Eye size={16} /></button>{student.source !== 'account-profile' && <button type="button" aria-label={`Edit ${name}`} title="Edit" onClick={onEdit}><Pencil size={16} /></button>}{canDelete && student.source !== 'account-profile' && <button type="button" aria-label={`Archive ${name}`} title="Archive" onClick={onDelete}><Trash2 size={16} /></button>}</div></td>
  </tr>;
}

export default function StudentManagement({ profile }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [sourceWarning, setSourceWarning] = useState('');
  const [notice, setNotice] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [search, setSearch] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null);
  const [formOptions, setFormOptions] = useState({ courses: [], batches: [] });
  const [busy, setBusy] = useState(false);
  const canDelete = profile.role === 'OWNER';

  const refresh = useCallback(async () => {
    setLoading(true); setLoadError(''); setSourceWarning('');
    try {
      const result = await listStudents(profile.role);
      setStudents(result.records);
      setSourceWarning(result.warnings.join(' '));
    }
    catch (error) { setLoadError(errorMessage(error)); }
    finally { setLoading(false); }
  }, [profile.role]);
  useEffect(() => { refresh(); }, [refresh]);

  const courses = useMemo(() => [...new Set(students.map((item) => item.course).filter(Boolean))].sort(), [students]);
  const batches = useMemo(() => [...new Set(students.map((item) => item.batch).filter(Boolean))].sort(), [students]);
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return students.filter((item) => (!term || [item.fullName, item.email, item.studentId].some((value) => String(value || '').toLowerCase().includes(term)))
      && (!courseFilter || item.course === courseFilter) && (!batchFilter || item.batch === batchFilter) && (!statusFilter || item.status === statusFilter))
      .sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || '')));
  }, [students, search, courseFilter, batchFilter, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const rows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const counts = { total: students.length, active: students.filter((item) => item.status === 'ACTIVE').length, notEnrolled: students.filter((item) => !item.enrollments?.length && item.enrollmentStatus !== 'ACTIVE' && !item.batch).length, inactive: students.filter((item) => item.status === 'INACTIVE').length };

  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);
  const resetFilters = () => { setSearch(''); setCourseFilter(''); setBatchFilter(''); setStatusFilter(''); setPage(1); };
  const save = async (values) => {
    setBusy(true); setMutationError(''); setNotice('');
    try {
      await saveStudent(values, profile.uid, dialog.mode === 'edit' ? dialog.student.documentId : '');
      setDialog(null); setNotice(dialog.mode === 'edit' ? 'Student record updated.' : 'Student added successfully.'); await refresh();
    } catch (error) { setMutationError(errorMessage(error)); throw error; }
    finally { setBusy(false); }
  };
  const openForm = async (mode, student) => {
    setMutationError('');
    if (mode === 'view') {
      setFormOptions({ courses: [], batches: [] });
      setDialog({ mode, student });
      return;
    }
    try {
      const options = await getEnrollmentOptions();
      const current = student?.courseDocId ? {
        courses: [{ documentId: student.courseDocId, courseId: student.courseId || '', name: student.course || 'Current course', status: 'ACTIVE' }],
        batches: student.batchDocId ? [{
          documentId: student.batchDocId, batchId: student.batchId || '', name: student.batch || 'Current batch',
          courseDocId: student.courseDocId, capacity: 0, enrolledCount: 0, daysOfWeek: [], startTime: '', endTime: '',
          roomNumber: '', teacherName: '', startDate: '', endDate: '',
        }] : [],
      } : { courses: [], batches: [] };
      const optionCourseIds = new Set(options.courses.map((item) => item.documentId));
      const optionBatchIds = new Set(options.batches.map((item) => item.documentId));
      setFormOptions({
        courses: [...options.courses, ...(current.courses.filter((item) => !optionCourseIds.has(item.documentId)))],
        batches: [...options.batches, ...(current.batches.filter((item) => !optionBatchIds.has(item.documentId)))],
      });
      setDialog({ mode, student });
    } catch (failure) {
      setFormOptions({ courses: [], batches: [] });
      setMutationError(`Could not load active courses and batches: ${errorMessage(failure)}`);
      setDialog({ mode, student });
    }
  };
  const remove = async (student) => {
    setMutationError(''); setNotice(''); setBusy(true);
    try { await removeStudent(student.documentId, profile.uid); setDialog(null); setNotice('Student archived.'); await refresh(); }
    catch (error) { setMutationError(errorMessage(error)); setDialog(null); }
    finally { setBusy(false); }
  };

  return <section className="sm-page">
    <header className="sm-page__header"><div><p className="ep-eyebrow">EDUPILOT DIRECTORY</p><h1>Student Management</h1><p>Manage registered students, enrollments, courses, and batches.</p></div><button className="sm-button sm-button--primary" type="button" onClick={() => openForm('create')}><Plus size={17} /> Add Student</button></header>
    <div className="sm-summary" aria-label="Student summary">
      {[['Total Students', counts.total, Users], ['Active Students', counts.active, Users], ['Not Enrolled', counts.notEnrolled, Users], ['Inactive Students', counts.inactive, Users]].map(([label, count, Icon]) => <article className="sm-summary__card" key={label}><span><Icon size={17} /></span><p>{label}</p><strong>{count}</strong></article>)}
    </div>
    {sourceWarning && <p className="sm-source-warning" role="status"><AlertCircle size={17} />{sourceWarning}</p>}
    {notice && <p className="sm-notice" role="status">{notice}</p>}{mutationError && <p className="ep-inline-error" role="alert"><AlertCircle size={17} />{mutationError}</p>}
    <section className="sm-panel" aria-label="Student records">
      <div className="sm-filters"><label className="sm-search"><Search size={17} /><input aria-label="Search students" placeholder="Search name, email, or student ID" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
        <select aria-label="Filter by course" value={courseFilter} onChange={(event) => { setCourseFilter(event.target.value); setPage(1); }}><option value="">All courses</option>{courses.map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="Filter by batch" value={batchFilter} onChange={(event) => { setBatchFilter(event.target.value); setPage(1); }}><option value="">All batches</option>{batches.map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="Filter by status" value={statusFilter === 'PENDING' ? '' : statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option value="">All account statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>
        <button className="sm-button sm-button--quiet" type="button" onClick={resetFilters}>Reset</button>
      </div>
      {loadError ? <div className="sm-state sm-state--error"><AlertCircle size={20} /><p>{loadError}</p><button className="sm-button sm-button--quiet" type="button" onClick={refresh}><RefreshCw size={15} /> Retry</button></div>
        : loading ? <div className="sm-state" role="status"><span className="sm-spinner" /> Loading students…</div>
          : students.length === 0 ? <div className="sm-state"><Users size={24} /><strong>No students yet</strong><p>Add your first student to populate the directory.</p></div>
            : visible.length === 0 ? <div className="sm-state"><Search size={24} /><strong>No matching students</strong><p>Try another search or reset the filters.</p><button className="sm-button sm-button--quiet" type="button" onClick={resetFilters}>Reset filters</button></div>
              : <><div className="sm-table-wrap"><table className="sm-table"><thead><tr><th>Student ID</th><th>Student</th><th>Email</th><th>Phone</th><th>Course</th><th>Batch &amp; mode</th><th>Registration date</th><th>Account / enrollment status</th><th>Fee summary</th><th>Actions</th></tr></thead><tbody>{rows.map((student) => <StudentRow key={student.documentId} student={student} canDelete={canDelete} onView={() => openForm('view', student)} onEdit={() => openForm('edit', student)} onDelete={() => setDialog({ mode: 'delete', student })} />)}</tbody></table></div>
                <footer className="sm-pagination"><span>Showing {Math.min((page - 1) * PAGE_SIZE + 1, visible.length)}–{Math.min(page * PAGE_SIZE, visible.length)} of {visible.length}</span><div><button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={17} /></button><span>Page {page} of {pageCount}</span><button type="button" aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}><ChevronRight size={17} /></button></div></footer></>}
    </section>
    {dialog && ['create', 'edit', 'view'].includes(dialog.mode) && <StudentForm initial={dialog.student} mode={dialog.mode} busy={busy} error={mutationError} options={formOptions} onClose={() => !busy && setDialog(null)} onSubmit={save} />}
    {dialog?.mode === 'delete' && <div className="sm-modal-backdrop"><section className="sm-confirm" role="alertdialog" aria-modal="true" aria-labelledby="sm-delete-title"><h2 id="sm-delete-title">Archive student?</h2><p>This hides {dialog.student.fullName} ({dialog.student.studentId}) from the directory while preserving their record. Active students must be transferred or withdrawn first.</p><div className="sm-modal__actions"><button className="sm-button sm-button--quiet" type="button" disabled={busy} onClick={() => setDialog(null)}>Cancel</button><button className="sm-button sm-button--danger" type="button" disabled={busy} onClick={() => remove(dialog.student)}>{busy ? 'Archiving…' : 'Archive student'}</button></div></section></div>}
  </section>;
}
