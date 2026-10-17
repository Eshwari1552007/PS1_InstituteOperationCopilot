import { useEffect, useState } from 'react';
import { AlertCircle, BookOpen, CalendarDays, CircleDollarSign, ClipboardCheck, GraduationCap, LoaderCircle, Users } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';

const records = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
const active = (item) => item.status === 'ACTIVE';
const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value) || 0);

function buildMetrics(role, data) {
  if (role === 'ACCOUNTS') {
    const balance = data.fees.reduce((sum, fee) => sum + (Number(fee.remainingBalance) || 0), 0);
    const paid = data.fees.reduce((sum, fee) => sum + (Number(fee.amountPaid) || 0), 0);
    return [
      ['Fee records', data.fees.length, CircleDollarSign], ['Outstanding balance', money(balance), CircleDollarSign],
      ['Recorded payments', money(paid), ClipboardCheck], ['Accounts needing follow-up', data.fees.filter((fee) => Number(fee.remainingBalance) > 0).length, AlertCircle],
    ];
  }
  if (role === 'TRAINER') return [
    ['Assigned batches', data.batches.length, BookOpen], ['Active enrollments', data.enrollments.filter(active).length, GraduationCap],
    ['Saved attendance marks', data.attendance.length, ClipboardCheck], ['Scheduled sessions', data.sessions.length, CalendarDays],
  ];
  const uniqueStudents = new Set(data.enrollments.filter(active).map((item) => item.studentDocId).filter(Boolean)).size;
  const attending = data.attendance.filter((item) => ['PRESENT', 'LATE'].includes(item.status)).length;
  const attendanceRate = data.attendance.length ? `${Math.round(attending / data.attendance.length * 100)}%` : '—';
  return [
    ['Students', data.students.length, GraduationCap], ['Active batches', data.batches.filter((item) => item.status === 'ACTIVE').length, BookOpen],
    ['Active enrollments', data.enrollments.filter(active).length, Users], [role === 'OWNER' ? 'Recorded attendance' : 'Active students', role === 'OWNER' ? attendanceRate : uniqueStudents, ClipboardCheck],
    ...(role === 'OWNER' ? [['Courses', data.courses.length, BookOpen]] : []),
  ];
}

export default function Dashboard({ profile, onNavigate }) {
  const [data, setData] = useState({ students: [], batches: [], courses: [], enrollments: [], attendance: [], sessions: [], fees: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true); setError('');
      try {
        let result;
        if (profile.role === 'OWNER' || profile.role === 'COUNSELOR') {
          const [students, batches, courses, enrollments, attendance] = await Promise.all([
            getDocs(collection(db, 'students')), getDocs(collection(db, 'batches')), getDocs(collection(db, 'courses')),
            getDocs(collection(db, 'enrollments')), getDocs(collection(db, 'attendanceRecords')),
          ]);
          result = { students: records(students), batches: records(batches), courses: records(courses), enrollments: records(enrollments), attendance: records(attendance) };
        } else if (profile.role === 'TRAINER') {
          const assigned = where('teacherId', '==', profile.uid);
          const [batches, enrollments, attendance, sessions] = await Promise.all([
            getDocs(query(collection(db, 'batches'), assigned)), getDocs(query(collection(db, 'enrollments'), assigned)),
            getDocs(query(collection(db, 'attendanceRecords'), assigned)), getDocs(query(collection(db, 'timetableSessions'), assigned)),
          ]);
          result = { batches: records(batches), enrollments: records(enrollments), attendance: records(attendance), sessions: records(sessions) };
        } else if (profile.role === 'ACCOUNTS') {
          const [fees] = await Promise.all([getDocs(collection(db, 'feeRecords'))]);
          result = { fees: records(fees) };
        } else result = {};
        if (!cancelled) setData((current) => ({ ...current, ...result }));
      } catch (failure) {
        if (!cancelled) setError(failure.code === 'permission-denied' ? 'Firestore denied a dashboard read for this role. Check the deployed rules and sign-in role.' : `Dashboard data could not be loaded: ${failure.message}`);
      } finally { if (!cancelled) setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [profile.role, profile.uid]);

  const metrics = buildMetrics(profile.role, data);
  const subtitle = profile.role === 'OWNER' ? 'Institute overview from current Firestore records.'
    : profile.role === 'COUNSELOR' ? 'Admissions and student activity. Financial records are restricted to Owner and Accounts roles.'
      : profile.role === 'TRAINER' ? 'Your assigned batches, attendance, and teaching schedule.' : 'Finance totals from saved fee records.';
  return <section className="ep-content-card ep-dashboard">
    <header className="ep-content-card__head"><div><p className="ep-eyebrow">{profile.role} WORKSPACE</p><h1>{profile.role === 'STUDENT' ? 'Student Home' : 'Dashboard'}</h1><p>Welcome, {profile.name || profile.email}. {subtitle}</p></div></header>
    {loading ? <p className="ep-dashboard__state"><LoaderCircle className="ax-spin" size={18}/> Loading current records…</p> : null}
    {error && <p className="ep-inline-error" role="alert"><AlertCircle size={17}/>{error}</p>}
    {!loading && <div className="ep-dashboard__metrics">{metrics.map(([label, value, Icon]) => <article className="ep-dashboard__metric" key={label}><span><Icon size={17}/></span><div><small>{label}</small><strong>{value}</strong></div></article>)}</div>}
    <nav className="ep-dashboard__links" aria-label="Dashboard shortcuts">
      {profile.role === 'OWNER' && <><button onClick={() => onNavigate('students')}><GraduationCap size={16}/> Students</button><button onClick={() => onNavigate('batches')}><BookOpen size={16}/> Batches &amp; Courses</button><button onClick={() => onNavigate('fees')}><CircleDollarSign size={16}/> Fees &amp; EMI</button><button onClick={() => onNavigate('attendance')}><ClipboardCheck size={16}/> Attendance</button></>}
      {profile.role === 'COUNSELOR' && <><button onClick={() => onNavigate('students')}><GraduationCap size={16}/> Admissions &amp; Students</button><button onClick={() => onNavigate('batches')}><BookOpen size={16}/> Batches &amp; Courses</button><button onClick={() => onNavigate('attendance')}><ClipboardCheck size={16}/> Attendance overview</button></>}
      {profile.role === 'TRAINER' && <><button onClick={() => onNavigate('batches')}><BookOpen size={16}/> My batches</button><button onClick={() => onNavigate('attendance')}><ClipboardCheck size={16}/> Take attendance</button><button onClick={() => onNavigate('timetable')}><CalendarDays size={16}/> Timetable</button></>}
      {profile.role === 'ACCOUNTS' && <button onClick={() => onNavigate('fees')}><CircleDollarSign size={16}/> Fees &amp; EMI</button>}
    </nav>
  </section>;
}
