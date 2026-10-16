import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Calculator,
  Check,
  CheckCircle2,
  GraduationCap,
  Loader2,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import AnimatedInput from './AnimatedInput';
import Button from './Button';
import Logo from './Logo';
import PasswordInput from './PasswordInput';
import { login, requestPasswordReset } from '../auth/authService';
import SignupForm from './SignupForm';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLES = [
  { id: 'STUDENT', label: 'Student', icon: GraduationCap },
  { id: 'COUNSELOR', label: 'Counselor', icon: ShieldCheck },
  { id: 'TRAINER', label: 'Trainer', icon: Briefcase },
  { id: 'ACCOUNTS', label: 'Accounts', icon: Calculator },
  { id: 'OWNER', label: 'Owner', icon: ShieldCheck },
];

const viewVariants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.18, ease: 'easeIn' } },
};

const ALERT_ICONS = {
  error: AlertCircle,
  warn: AlertTriangle,
  ok: CheckCircle2,
};

function StatusAlert({ tone, message }) {
  const Icon = ALERT_ICONS[tone] || AlertCircle;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0, marginTop: 0 }}
      animate={{ opacity: 1, height: 'auto', marginTop: 16 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      style={{ overflow: 'hidden' }}
    >
      <p className={`ax-alert ax-alert--${tone}`} role="alert">
        <Icon className="ax-alert__icon" size={15} strokeWidth={2} aria-hidden="true" />
        <span>{message}</span>
      </p>
    </motion.div>
  );
}

function SuccessPanel() {
  return (
    <motion.div
      className="ax-success"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <svg className="ax-success__check" viewBox="0 0 52 52" role="img" aria-label="Signed in">
        <defs>
          <linearGradient id="ax-success-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7d5a44" />
            <stop offset="100%" stopColor="#b2967d" />
          </linearGradient>
        </defs>
        <motion.circle
          cx="26"
          cy="26"
          r="23"
          fill="none"
          stroke="url(#ax-success-gradient)"
          strokeWidth="1.6"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0.4 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.7, ease: 'easeInOut' }}
        />
        <motion.path
          d="M15.5 27.2l7.3 7.3L37 20.6"
          fill="none"
          stroke="url(#ax-success-gradient)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.42, delay: 0.5, ease: 'easeOut' }}
        />
      </svg>

      <h2 className="ax-success__title">Signed in</h2>
      <p className="ax-success__text">Preparing your workspace…</p>
    </motion.div>
  );
}

export default function AuthForm({ onAuthenticated }) {
  const [view, setView] = useState('login');
  const [role, setRole] = useState('STUDENT');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [shake, setShake] = useState(false);

  const handoffTimer = useRef(0);
  const shakeTimer = useRef(0);

  useEffect(
    () => () => {
      window.clearTimeout(handoffTimer.current);
      window.clearTimeout(shakeTimer.current);
    },
    []
  );

  const triggerShake = () => {
    setShake(true);
    window.clearTimeout(shakeTimer.current);
    shakeTimer.current = window.setTimeout(() => setShake(false), 480);
  };

  const clearFieldError = (field) =>
    setErrors((previous) => (previous[field] ? { ...previous, [field]: undefined } : previous));

  const goTo = (nextView) => {
    setView(nextView);
    setStatus(null);
    setErrors({});
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    if (submitting) return;

    const nextErrors = {};
    if (!email.trim()) nextErrors.email = 'Email is required.';
    else if (!EMAIL_PATTERN.test(email.trim())) nextErrors.email = 'Enter a valid email address.';
    if (!password) nextErrors.password = 'Password is required.';

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setStatus(null);
      triggerShake();
      return;
    }

    setSubmitting(true);
    setStatus(null);

    try {
      await login({ email: email.trim(), password, remember, role });
      setView('success');
      handoffTimer.current = window.setTimeout(() => onAuthenticated?.(), 1300);
    } catch (error) {
      const tone = error.code === 'rejected' ? 'error' : 'warn';
      setStatus({ tone, message: error.message });
      triggerShake();
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgot = async (event) => {
    event.preventDefault();
    if (submitting) return;

    if (!email.trim() || !EMAIL_PATTERN.test(email.trim())) {
      setErrors({ email: 'Enter the email address on your account.' });
      triggerShake();
      return;
    }

    setErrors({});
    setSubmitting(true);
    setStatus(null);

    try {
      await requestPasswordReset(email.trim());
      goTo('reset-sent');
    } catch (error) {
      const tone = error.code === 'rejected' ? 'error' : 'warn';
      setStatus({ tone, message: error.message });
    } finally {
      setSubmitting(false);
    }
  };

  const busy = submitting;

  return (
    <div className={`ax-form-body${shake ? ' ax-shake' : ''}`}>
      <div className="ax-card__brand">
        <Logo size={32} />
        <span className="ax-brand__name">
          EDUPILOT
        </span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {view === 'success' && <SuccessPanel key="success" />}

        {view === 'signup' && (
          <motion.div key="signup" variants={viewVariants} initial="hidden" animate="show" exit="exit">
            <SignupForm onBack={() => goTo('login')} />
          </motion.div>
        )}

        {view === 'login' && (
          <motion.div key="login" variants={viewVariants} initial="hidden" animate="show" exit="exit">
            <header className="ax-form__head">
              <h1 className="ax-form__title">Welcome Back</h1>
              <p className="ax-form__sub">Sign in to your EDUPILOT account.</p>
            </header>

            <form className="ax-form" onSubmit={handleLogin} noValidate>
              <fieldset className="ax-roles" disabled={busy}>
                <legend className="ax-roles__legend">Sign in as</legend>
                <div className="ax-roles__grid">
                  {ROLES.map(({ id, label, icon: Icon }) => (
                    <label
                      key={id}
                      className={`ax-role${role === id ? ' ax-role--active' : ''}`}
                    >
                      <input
                        className="ax-role__input"
                        type="radio"
                        name="role"
                        value={id}
                        checked={role === id}
                        onChange={() => setRole(id)}
                      />
                      <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <AnimatedInput
                label="Email"
                icon={Mail}
                type="email"
                name="email"
                autoComplete="username"
                value={email}
                disabled={busy}
                onChange={(event) => {
                  setEmail(event.target.value);
                  clearFieldError('email');
                }}
                error={errors.email}
              />

              <PasswordInput
                label="Password"
                name="password"
                value={password}
                disabled={busy}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearFieldError('password');
                }}
                error={errors.password}
              />

              <div className="ax-form__row">
                <label className="ax-check">
                  <input
                    type="checkbox"
                    checked={remember}
                    disabled={busy}
                    onChange={(event) => setRemember(event.target.checked)}
                  />
                  <span className="ax-check__box" aria-hidden="true">
                    <Check size={12} strokeWidth={3.2} />
                  </span>
                  <span className="ax-check__text">Remember me</span>
                </label>

                <button type="button" className="ax-link" onClick={() => goTo('forgot')}>
                  Forgot password?
                </button>
              </div>

              <AnimatePresence initial={false}>
                {status && <StatusAlert key="login-status" tone={status.tone} message={status.message} />}
              </AnimatePresence>

              <Button type="submit" disabled={busy} className="ax-form__submit">
                {busy ? (
                  <>
                    <Loader2 className="ax-spin" size={17} strokeWidth={2.2} aria-hidden="true" />
                    Signing in…
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight size={17} strokeWidth={2.2} aria-hidden="true" />
                  </>
                )}
              </Button>
            </form>

            <p className="ax-form__foot">
              Don&apos;t have an account?{' '}
              <button type="button" className="ax-link" onClick={() => goTo('signup')}>Sign up</button>
            </p>
          </motion.div>
        )}

        {view === 'forgot' && (
          <motion.div key="forgot" variants={viewVariants} initial="hidden" animate="show" exit="exit">
            <header className="ax-form__head">
              <h1 className="ax-form__title">Reset your password</h1>
              <p className="ax-form__sub">
                We&apos;ll email a secure reset link if the account exists.
              </p>
            </header>

            <form className="ax-form" onSubmit={handleForgot} noValidate>
              <AnimatedInput
                label="Email"
                icon={Mail}
                type="email"
                name="email"
                autoComplete="username"
                value={email}
                disabled={busy}
                onChange={(event) => {
                  setEmail(event.target.value);
                  clearFieldError('email');
                }}
                error={errors.email}
              />

              <AnimatePresence initial={false}>
                {status && <StatusAlert key="forgot-status" tone={status.tone} message={status.message} />}
              </AnimatePresence>

              <Button type="submit" disabled={busy} className="ax-form__submit">
                {busy ? (
                  <>
                    <Loader2 className="ax-spin" size={17} strokeWidth={2.2} aria-hidden="true" />
                    Sending…
                  </>
                ) : (
                  'Send reset link'
                )}
              </Button>

              <Button
                variant="ghost"
                className="ax-form__back"
                onClick={() => goTo('login')}
                disabled={busy}
              >
                <ArrowLeft size={16} strokeWidth={2.2} aria-hidden="true" />
                Back to sign in
              </Button>
            </form>
          </motion.div>
        )}

        {view === 'reset-sent' && (
          <motion.div key="reset-sent" variants={viewVariants} initial="hidden" animate="show" exit="exit">
            <header className="ax-form__head">
              <h1 className="ax-form__title">Check your inbox</h1>
              <p className="ax-form__sub">
                If an account exists for {email.trim()}, a reset link is on its way.
              </p>
            </header>

            <Button variant="ghost" className="ax-form__back" onClick={() => goTo('login')}>
              <ArrowLeft size={16} strokeWidth={2.2} aria-hidden="true" />
              Back to sign in
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
