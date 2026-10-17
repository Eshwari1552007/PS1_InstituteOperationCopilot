import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CircleDollarSign, RefreshCw, Search } from 'lucide-react';
import { collection, doc, getDocs, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useToast } from '../components/Toast';
import './fees.css';

const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
const minor = (value) => Math.round((Number(value) + Number.EPSILON) * 100);
const accepted = (payment) => ['VERIFIED', 'DEMO_CONFIRMED'].includes(payment.status);
const category = (fee, payments) => {
  const total = minor(fee.totalFee);
  const paid = payments.filter(accepted).reduce((sum, item) => sum + minor(item.amount), 0);
  const safePaid = Math.min(total, Math.max(paid, minor(fee.amountPaid || 0)));
  const balance = Math.max(0, total - safePaid);
  const emi = fee.emiStatus === 'ACTIVE' || fee.emiPlan?.status === 'ACTIVE';
  if (balance === 0) return { label: 'Fully Paid', paid: safePaid, balance };
  if (emi) return { label: 'EMI Active', paid: safePaid, balance };
  if (safePaid === 0 || safePaid * 2 < total) return { label: 'Advance Pending', paid: safePaid, balance };
  const successfulPayments = payments.filter(accepted);
  if (successfulPayments.length === 1 && successfulPayments[0].purpose === 'ADVANCE') return { label: 'Advance Paid', paid: safePaid, balance };
  return { label: 'Partially Paid', paid: safePaid, balance };
};
const displayDate = (value) => {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : '—';
};

export default function FeesWorkspace({ profile }) {
  const toast = useToast();
  const [fees, setFees] = useState([]); const [payments, setPayments] = useState({});
  const [amounts, setAmounts] = useState({}); const [references, setReferences] = useState({});
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(''); const [courseFilter, setCourseFilter] = useState(''); const [batchFilter, setBatchFilter] = useState(''); const [statusFilter, setStatusFilter] = useState(''); const [modeFilter, setModeFilter] = useState('');
  const refresh = useCallback(async () => {
    if (!['OWNER', 'ACCOUNTS'].includes(profile.role)) {
      setFees([]); setPayments({}); setError('Financial records are not available to your role.'); setLoading(false); return;
    }
    setLoading(true); setError('');
    try {
      const [feeSnapshot, paymentSnapshot] = await Promise.all([getDocs(collection(db, 'feeRecords')), getDocs(collection(db, 'payments'))]);
      const allPayments = paymentSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      const grouped = allPayments.reduce((result, payment) => { (result[payment.feeRecordId] ||= []).push(payment); return result; }, {});
      setFees(feeSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      setPayments(grouped);
    } catch (failure) { const text = failure.code === 'permission-denied' ? 'Firestore denied fee access. Confirm you are signed in as an approved Owner or Accounts user and deploy the current rules.' : failure.message; setError(text); toast.error(text, 'Could not load fees'); }
    finally { setLoading(false); }
  }, [profile.role, toast]);
  useEffect(() => { refresh(); }, [refresh]);

  const rows = useMemo(() => fees.map((fee) => ({ fee, payments: payments[fee.id] || [], status: category(fee, payments[fee.id] || []) }))
    .filter(({ fee, status }) => {
      const text = `${fee.studentName || ''} ${fee.studentId || ''} ${fee.courseName || ''} ${fee.batchName || fee.batchId || ''}`.toLowerCase();
      return (!search || text.includes(search.toLowerCase()))
        && (!courseFilter || fee.courseDocId === courseFilter)
        && (!batchFilter || fee.batchDocId === batchFilter)
        && (!statusFilter || status.label === statusFilter)
        && (!modeFilter || (fee.learningMode || 'OFFLINE') === modeFilter);
    }).sort((a, b) => String(a.fee.studentName || '').localeCompare(String(b.fee.studentName || ''))), [fees, payments, search, courseFilter, batchFilter, statusFilter, modeFilter]);
  const courseOptions = [...new Map(fees.map((fee) => [fee.courseDocId, fee.courseName || fee.courseDocId]).filter(([id]) => id)).entries()];
  const batchOptions = [...new Map(fees.filter((fee) => !courseFilter || fee.courseDocId === courseFilter).map((fee) => [fee.batchDocId, fee.batchName || fee.batchId || fee.batchDocId]).filter(([id]) => id)).entries()];
  const courseSummary = rows.filter(({ fee }) => !courseFilter || fee.courseDocId === courseFilter);
  const advanceCount = courseSummary.filter(({ status }) => status.label !== 'Advance Pending').length;
  const outstandingCount = courseSummary.filter(({ status }) => status.balance > 0).length;

  const recordPayment = async (fee) => {
    const amount = Number(amounts[fee.id]);
    const currentStatus = category(fee, payments[fee.id] || []);
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(minor(amount) - amount * 100) > 1e-7 || minor(amount) > currentStatus.balance) {
      const text = `Enter a positive amount up to the current ${money(currentStatus.balance / 100)} balance.`;
      setError(text); toast.warning(text, 'Check the amount'); return;
    }
    setBusy(fee.id); setError(''); setNotice('');
    const paymentRef = doc(collection(db, 'payments')); const feeRef = doc(db, 'feeRecords', fee.id);
    try {
      await runTransaction(db, async (transaction) => {
        const current = await transaction.get(feeRef);
        if (!current.exists()) throw new Error('Fee record not found.');
        const currentFee = current.data(); const balance = minor(currentFee.remainingBalance);
        const amountMinor = minor(amount);
        if (amountMinor > balance) throw new Error('The balance changed. Refresh and record an amount within the current balance.');
        const paid = minor(currentFee.amountPaid) + amountMinor; const remaining = minor(currentFee.totalFee) - paid;
        transaction.set(paymentRef, { feeRecordId: fee.id, enrollmentId: currentFee.enrollmentId, studentDocId: currentFee.studentDocId, studentId: currentFee.studentId, amount: amountMinor / 100, remainingBalance: remaining / 100, method: 'MANUAL', purpose: 'TUITION', status: 'VERIFIED', isDemo: false, reference: String(references[fee.id] || '').trim() || null, recordedBy: profile.uid, createdAt: serverTimestamp() });
        transaction.update(feeRef, { amountPaid: paid / 100, remainingBalance: remaining / 100, paymentStatus: remaining === 0 ? 'PAID' : 'PARTIALLY_PAID', updatedAt: serverTimestamp(), updatedBy: profile.uid, lastPaymentId: paymentRef.id });
      });
      const text = `Recorded ${money(amount)} as a staff-verified manual payment. This is not a gateway payment.`;
      setNotice(text); toast.success(text, 'Payment recorded');
      setAmounts((current) => ({ ...current, [fee.id]: '' })); await refresh();
    } catch (failure) { const text = failure.code === 'permission-denied' ? 'Your role cannot record manual payments under the current Firestore rules.' : failure.message; setError(text); toast.error(text, 'Payment not recorded'); }
    finally { setBusy(''); }
  };

  return <section className="ep-content-card ep-fees"><header className="ep-content-card__head"><div><p className="ep-eyebrow">FINANCE</p><h1>Fees &amp; EMI</h1><p>Balances use saved fee records and the payment ledger. No real payment gateway is connected.</p></div><button className="sm-button sm-button--quiet" onClick={refresh} disabled={loading}><RefreshCw size={15}/> Refresh</button></header>
    {error && <p className="ep-inline-error" role="alert"><AlertCircle size={17}/>{error}</p>}{notice && <p className="ep-portal__success" role="status">{notice}</p>}
    <div className="ep-fees__summary"><article><span>Students with fee records</span><strong>{fees.length}</strong></article><article><span>50% advance paid</span><strong>{advanceCount}</strong></article><article><span>Outstanding accounts</span><strong>{outstandingCount}</strong></article><article><span>Outstanding balance</span><strong>{money(rows.reduce((sum, row) => sum + row.status.balance, 0) / 100)}</strong></article></div>
    <div className="ep-fees__filters"><label><Search size={16}/><input aria-label="Search student fees" placeholder="Search student, ID, course, or batch" value={search} onChange={(event) => setSearch(event.target.value)}/></label><select aria-label="Filter fees by course" value={courseFilter} onChange={(event) => { setCourseFilter(event.target.value); setBatchFilter(''); }}><option value="">All courses</option>{courseOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><select aria-label="Filter fees by batch" value={batchFilter} onChange={(event) => setBatchFilter(event.target.value)}><option value="">All batches</option>{batchOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><select aria-label="Filter fees by payment status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All payment statuses</option>{['Advance Pending', 'Advance Paid', 'Partially Paid', 'Fully Paid', 'EMI Active'].map((status) => <option key={status}>{status}</option>)}</select><select aria-label="Filter fees by learning mode" value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}><option value="">All modes</option><option value="ONLINE">Online</option><option value="OFFLINE">Offline</option></select></div>
    {loading ? <p>Loading fee records…</p> : !['OWNER', 'ACCOUNTS'].includes(profile.role) ? <p className="ep-portal__empty">Financial records are not available to your role.</p> : rows.length ? <div className="ep-fees__tablewrap"><table className="ep-fees__table"><thead><tr><th>Student</th><th>Course / batch</th><th>Mode</th><th>Enrolled</th><th>Total fee</th><th>Paid</th><th>Balance</th><th>Status</th><th>EMI</th><th>Action</th><th>History</th></tr></thead><tbody>{rows.map(({ fee, payments: history, status }) => <tr key={fee.id}><td><strong>{fee.studentName || fee.studentId}</strong><small>{fee.studentId || fee.studentDocId}</small></td><td>{fee.courseName}<small>{fee.batchName || fee.batchId}</small></td><td>{fee.learningMode || 'OFFLINE'}</td><td>{displayDate(fee.enrolledAt || fee.createdAt)}</td><td>{money(fee.totalFee)}</td><td>{money(status.paid / 100)}</td><td>{money(status.balance / 100)}</td><td><span className={`ep-fees__status ep-fees__status--${status.label.toLowerCase().replaceAll(' ', '-')}`}>{status.label}</span></td><td>{fee.emiPlan?.status === 'ACTIVE' || fee.emiStatus === 'ACTIVE' ? 'Active' : 'Not configured'}</td><td>{status.balance > 0 && <div className="ep-fees__record"><label className="sr-only" htmlFor={`fee-amount-${fee.id}`}>Manual payment received amount</label><input id={`fee-amount-${fee.id}`} type="number" min="0.01" max={status.balance / 100} step="0.01" value={amounts[fee.id] || ''} onChange={(event) => setAmounts((current) => ({ ...current, [fee.id]: event.target.value }))}/><label className="sr-only" htmlFor={`fee-reference-${fee.id}`}>Optional receipt reference</label><input id={`fee-reference-${fee.id}`} type="text" maxLength="120" placeholder="Optional receipt ref" value={references[fee.id] || ''} onChange={(event) => setReferences((current) => ({ ...current, [fee.id]: event.target.value }))}/><button className="sm-button sm-button--primary" disabled={busy === fee.id || !['OWNER', 'ACCOUNTS'].includes(profile.role)} onClick={() => recordPayment(fee)}><CircleDollarSign size={14}/>{busy === fee.id ? 'Saving…' : 'Record received'}</button></div>}</td><td className="ep-fees__historycell"><details><summary>History ({history.length})</summary>{history.length ? history.map((item) => <p key={item.id}>{displayDate(item.createdAt)} · {money(item.amount)} · {item.purpose || item.method} · {item.status}{item.isDemo ? ' · DEMO: no funds transferred' : ' · staff verified'} · balance {money(item.remainingBalance ?? status.balance / 100)}{item.reference ? ` · ${item.reference}` : ''}</p>) : <p>No payment entries.</p>}</details></td></tr>)}</tbody></table></div> : <p className="ep-portal__empty">No enrolled student fee records match these filters.</p>}
    <p className="ep-fees__note">Demo payments authorize enrollment only in the simulation and are never represented as received funds. Staff-entered manual receipts are explicitly marked staff-verified. EMI plans are shown only when a saved plan exists.</p>
  </section>;
}
