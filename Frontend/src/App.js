import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { AlertCircle, LoaderCircle } from 'lucide-react';
import LoginPage from './components/LoginPage';
import OwnerApprovals from './components/OwnerApprovals';
import RoleSidebar from './components/RoleSidebar';
import StudentManagement from './students/StudentManagement';
import BatchesCourses from './batches/BatchesCourses';
import StudentPortal from './students/StudentPortal';
import AttendanceWorkspace from './students/AttendanceWorkspace';
import FeesWorkspace from './students/FeesWorkspace';
import Timetable from './timetable/Timetable';
import { PUBLIC_ROLES, completeProfile, logout, observeAuth } from './auth/authService';
import { db } from './firebase';
import './App.css';

function ProfileRecovery({ account, onComplete, onLogout }) {
  const [name, setName] = useState(account.displayName || '');
  const [role, setRole] = useState('STUDENT');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (name.trim().length < 2) return setError('Enter your full name.');
    setBusy(true);
    try {
      await completeProfile({ user: account, name: name.trim(), role, phone });
      onComplete();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  return <section className="ep-recovery-card">
    <p className="ep-eyebrow">EDUPILOT ACCOUNT RECOVERY</p>
    <h1>Finish setting up your profile</h1>
    <p>Your sign-in account exists, but its Firestore profile is missing. Complete this step to retry registration; you do not need to create another account.</p>
    <form onSubmit={submit}>
      <label>Full name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>
      <label>Requested role<select value={role} onChange={(event) => setRole(event.target.value)}>{PUBLIC_ROLES.map((value) => <option value={value} key={value}>{value[0] + value.slice(1).toLowerCase()}</option>)}</select></label>
      {role === 'STUDENT' && <label>Phone number<input type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>}
      {error && <p className="ep-inline-error"><AlertCircle size={17} />{error}</p>}
      <button className="ep-approve" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Retry profile setup'}</button>
    </form>
    <button className="ep-text-button" type="button" onClick={onLogout}>Sign out</button>
  </section>;
}

function AccountState({ profile, onLogout }) {
  const rejected = profile.status === 'REJECTED';
  return <section className="ep-recovery-card">
    <p className="ep-eyebrow">EDUPILOT ACCESS</p>
    <h1>{rejected ? 'Registration not approved' : 'Waiting for Owner approval'}</h1>
    <p>{rejected ? (profile.rejectionReason || 'Contact the institute Owner for more information.') : 'Your staff request has been submitted. You can sign out and return after the Owner reviews it.'}</p>
    <p className="ep-profile-chip">{profile.email} · {profile.role}</p>
    <button className="ep-approve" type="button" onClick={onLogout}>Sign out</button>
  </section>;
}

function Dashboard({ profile }) {
  return <section className="ep-content-card">
    <p className="ep-eyebrow">{profile.role} WORKSPACE</p>
    <h1>{profile.role === 'STUDENT' ? 'Student Home' : 'Dashboard'}</h1>
    <p>Welcome, {profile.name || profile.email}. Your verified EDUPILOT role is {profile.role}.</p>
    {profile.role === 'OWNER' && <p>Use Approvals in the sidebar to review staff registrations.</p>}
  </section>;
}

export default function App() {
  const [account, setAccount] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [route, setRoute] = useState(() => window.location.hash.replace(/^#\/?/, '') || 'dashboard');

  useEffect(() => {
    const syncRoute = () => setRoute(window.location.hash.replace(/^#\/?/, '') || 'dashboard');
    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, []);

  useEffect(() => {
    let stopProfile = null;
    const stopAuth = observeAuth((user) => {
      if (stopProfile) stopProfile();
      setProfile(null);
      setProfileError('');
      setAccount(user);
      if (!user) {
        setLoading(false);
        return;
      }
      setLoading(true);
      stopProfile = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
        setProfile(snapshot.exists() ? { uid: user.uid, ...snapshot.data() } : null);
        setLoading(false);
      }, (error) => {
        setProfileError(error.code === 'permission-denied'
          ? 'Firestore denied access to your profile. Check that the project Security Rules are deployed.'
          : `Could not load your profile: ${error.message}`);
        setLoading(false);
      });
    }, (error) => {
      setProfileError(error.message);
      setLoading(false);
    });
    return () => { stopAuth(); if (stopProfile) stopProfile(); };
  }, []);

  const handleLogout = async () => {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    setRoute('dashboard');
    await logout();
  };

  const navigate = (nextRoute) => {
    const allowed = nextRoute === 'dashboard'
      || (nextRoute === 'approvals' && profile?.role === 'OWNER')
      || (nextRoute === 'students' && ['OWNER', 'COUNSELOR'].includes(profile?.role))
      || (nextRoute === 'batches' && ['OWNER', 'COUNSELOR', 'TRAINER'].includes(profile?.role));
    const permitted = allowed
      || (nextRoute === 'attendance' && ['OWNER', 'COUNSELOR', 'TRAINER'].includes(profile?.role))
      || (nextRoute === 'fees' && ['OWNER', 'COUNSELOR', 'ACCOUNTS'].includes(profile?.role));
    const withTimetable = permitted || (nextRoute === 'timetable' && ['OWNER', 'TRAINER'].includes(profile?.role));
    const safeRoute = withTimetable ? nextRoute : 'dashboard';
    window.location.hash = safeRoute === 'dashboard' ? '' : `/${safeRoute}`;
    setRoute(safeRoute);
  };

  if (loading) return <main className="ep-loading"><LoaderCircle className="ax-spin" size={28} /> <span>Loading EDUPILOT…</span></main>;
  if (profileError) return <main className="ep-loading ep-loading--error"><p><AlertCircle size={18} /> {profileError}</p>{account && <button className="ep-text-button" onClick={handleLogout}>Sign out</button>}</main>;
  if (!account) return <LoginPage />;
  if (!profile) return <ProfileRecovery account={account} onComplete={() => setLoading(true)} onLogout={handleLogout} />;
  if (profile.status === 'PENDING' || profile.status === 'REJECTED') return <AccountState profile={profile} onLogout={handleLogout} />;
  if (profile.status !== 'APPROVED') return <AccountState profile={{ ...profile, status: 'REJECTED', rejectionReason: 'This account is not active. Contact the institute Owner.' }} onLogout={handleLogout} />;

  const authorizedRoute = route === 'approvals' && profile.role === 'OWNER'
    ? 'approvals'
    : route === 'students' && ['OWNER', 'COUNSELOR'].includes(profile.role)
      ? 'students'
      : route === 'batches' && ['OWNER', 'COUNSELOR', 'TRAINER'].includes(profile.role)
        ? 'batches'
      : route === 'attendance' && ['OWNER', 'COUNSELOR', 'TRAINER'].includes(profile.role)
        ? 'attendance'
      : route === 'fees' && ['OWNER', 'COUNSELOR', 'ACCOUNTS'].includes(profile.role)
        ? 'fees'
      : route === 'timetable' && ['OWNER', 'TRAINER'].includes(profile.role)
        ? 'timetable'
      : 'dashboard';
  return <div className="ep-app">
    <RoleSidebar profile={profile} active={authorizedRoute} onNavigate={navigate} onLogout={handleLogout} />
    <main className="ep-main">
      {authorizedRoute === 'approvals' ? <OwnerApprovals ownerUid={account.uid} /> : authorizedRoute === 'students' ? <StudentManagement profile={profile} /> : authorizedRoute === 'batches' ? <BatchesCourses profile={profile} /> : authorizedRoute === 'attendance' ? <AttendanceWorkspace profile={profile} /> : authorizedRoute === 'fees' ? <FeesWorkspace profile={profile} /> : authorizedRoute === 'timetable' ? <Timetable profile={profile} /> : profile.role === 'STUDENT' ? <StudentPortal profile={profile} /> : <Dashboard profile={profile} />}
    </main>
  </div>;
}
