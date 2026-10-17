import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import './toast.css';

const ToastContext = createContext(null);
let sequence = 0;

const ICONS = { success: CheckCircle2, error: AlertCircle, warning: TriangleAlert, info: Info };

function ToastItem({ toast, onDismiss }) {
  const Icon = ICONS[toast.tone] || Info;
  return <article className={`ep-toast ep-toast--${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
    <Icon size={17} aria-hidden="true" />
    <div className="ep-toast__body">
      {toast.title && <strong>{toast.title}</strong>}
      {toast.message && <span>{toast.message}</span>}
    </div>
    <button type="button" className="ep-toast__close" aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}><X size={14} /></button>
  </article>;
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
    setToasts((list) => list.filter((item) => item.id !== id));
  }, []);

  const push = useCallback((toast) => {
    const id = (sequence += 1);
    const entry = { id, tone: 'info', title: '', message: '', duration: 5000, ...toast };
    setToasts((list) => (list.some((item) => item.key && item.key === entry.key) ? list : [...list, entry]).slice(-4));
    if (entry.duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), entry.duration));
    return id;
  }, [dismiss]);

  const api = useMemo(() => ({
    push,
    dismiss,
    success: (message, title = 'Done') => push({ tone: 'success', title, message }),
    error: (message, title = 'Something went wrong') => push({ tone: 'error', title, message, duration: 0 }),
    warning: (message, title = 'Check this') => push({ tone: 'warning', title, message }),
    info: (message, title = 'Notice') => push({ tone: 'info', title, message }),
  }), [push, dismiss]);

  useEffect(() => () => { timers.current.forEach((timer) => clearTimeout(timer)); timers.current.clear(); }, []);

  return <ToastContext.Provider value={api}>
    {children}
    <div className="ep-toasts" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />)}
    </div>
  </ToastContext.Provider>;
}

const noop = () => 0;
// Components can be rendered in isolation (unit tests) without a provider; degrade gracefully.
const FALLBACK = { push: noop, dismiss: noop, success: noop, error: noop, warning: noop, info: noop };

export function useToast() {
  return useContext(ToastContext) || FALLBACK;
}

export default ToastProvider;
