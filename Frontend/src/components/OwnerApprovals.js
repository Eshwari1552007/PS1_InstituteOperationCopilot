import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { AlertCircle, Check, RefreshCw, X } from 'lucide-react';
import { STAFF_ROLES, reviewRegistration } from '../auth/authService';
import { useToast } from './Toast';
import { db } from '../firebase';

const TABS = ['PENDING', 'APPROVED', 'REJECTED'];

function formatDate(value) {
  if (!value?.toDate) return 'Just now';
  return value.toDate().toLocaleString();
}

export default function OwnerApprovals({ ownerUid }) {
  const toast = useToast();
  const [records, setRecords] = useState([]);
  const [tab, setTab] = useState('PENDING');
  const [reasons, setReasons] = useState({});
  const [busyUid, setBusyUid] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      setRecords(snapshot.docs.map((item) => ({ uid: item.id, ...item.data() })).filter((item) => STAFF_ROLES.includes(item.role)));
    } catch (failure) {
      const text = failure.code === 'permission-denied'
        ? 'Only the approved Owner profile can view registration requests. Confirm this account is provisioned as OWNER.'
        : `Could not load registration requests: ${failure.message}`;
      setError(text); toast.error(text, 'Approvals');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const visible = useMemo(() => records.filter((item) => item.status === tab).sort((a, b) => {
    const left = a.createdAt?.toMillis?.() || 0;
    const right = b.createdAt?.toMillis?.() || 0;
    return right - left;
  }), [records, tab]);

  const handleReview = async (record, approve) => {
    setBusyUid(record.uid);
    setError('');
    try {
      await reviewRegistration({ uid: record.uid, approve, reason: reasons[record.uid] || '', ownerUid });
      toast.success(`${record.name || record.email} ${approve ? 'approved' : 'rejected'}.`, 'Registration review');
      await loadRequests();
    } catch (failure) {
      const text = `Could not ${approve ? 'approve' : 'reject'} this request: ${failure.message}`;
      setError(text); toast.error(text, 'Review failed');
    } finally {
      setBusyUid('');
    }
  };

  return (
    <section className="ep-content-card">
      <header className="ep-content-card__head">
        <div><p className="ep-eyebrow">OWNER WORKSPACE</p><h1>Registration approvals</h1><p>Review staff access requests from the institute.</p></div>
        <button className="ep-icon-button" type="button" onClick={loadRequests} disabled={loading} aria-label="Refresh requests"><RefreshCw size={17} /></button>
      </header>
      <div className="ep-approval-tabs" role="tablist" aria-label="Request status">
        {TABS.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? 'is-active' : ''} onClick={() => setTab(item)}>{item[0] + item.slice(1).toLowerCase()} <span>{records.filter((record) => record.status === item).length}</span></button>)}
      </div>
      {error && <p className="ep-inline-error" role="alert"><AlertCircle size={17} /> {error}</p>}
      {loading ? <p className="ep-empty-state">Loading requests…</p> : visible.length === 0 ? <p className="ep-empty-state">No {tab.toLowerCase()} staff requests.</p> : (
        <div className="ep-request-list">
          {visible.map((record) => <article className="ep-request" key={record.uid}>
            <div className="ep-request__top"><div><h2>{record.name || 'Unnamed applicant'}</h2><p>{record.email}</p></div><span className={`ep-status ep-status--${record.status.toLowerCase()}`}>{record.status}</span></div>
            <dl><div><dt>Requested role</dt><dd>{record.role}</dd></div><div><dt>Request date</dt><dd>{formatDate(record.createdAt)}</dd></div></dl>
            {record.status === 'REJECTED' && record.rejectionReason && <p className="ep-rejection-note">Reason: {record.rejectionReason}</p>}
            {record.status === 'PENDING' && <div className="ep-request__actions">
              <input aria-label={`Rejection reason for ${record.email}`} value={reasons[record.uid] || ''} placeholder="Optional rejection reason" disabled={busyUid === record.uid} onChange={(event) => setReasons((previous) => ({ ...previous, [record.uid]: event.target.value }))} />
              <button type="button" className="ep-reject" disabled={Boolean(busyUid)} onClick={() => handleReview(record, false)}><X size={16} /> Reject</button>
              <button type="button" className="ep-approve" disabled={Boolean(busyUid)} onClick={() => handleReview(record, true)}><Check size={16} /> Approve</button>
            </div>}
          </article>)}
        </div>
      )}
    </section>
  );
}
