import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  Mail,
} from 'lucide-react';
import AnimatedInput from './AnimatedInput';
import MagneticButton from './MagneticButton';
import PasswordInput from './PasswordInput';
import { login, requestPasswordReset } from '../auth/authService';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const viewVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -12, transition: { duration: 0.2, ease: 'easeIn' } },
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
      className="iq-alert-wrap"
      initial={{ opacity: 0, height: 0, marginTop: 0 }}
      animate={{ opacity: 1, height: 'auto', marginTop: 16 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      style={{ overflow: 'hidden' }}
    >
      <p className={`iq-alert iq-alert--${tone}`} role="alert">
        <Icon className="iq-alert__icon" size={15} strokeWidth={2} aria-hidden="true" />
        <span>{message}</span>
      </p>
    </motion.div>
  );
}

function SuccessPanel() {
  return (
    <motion.div
      className="iq-success"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <svg className="iq-success__check" viewBox="0 0 52 52" role="img" aria-label="Signed in">
        <defs>
          <linearGradient id="iq-success-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#4ade80" />
          </linearGradient>
        </defs>
        <motion.circle
          cx="26"
          cy="26"
          r="23"
          fill="none"
          stroke="url(#iq-success-gradient)"
          strokeWidth="1.6"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0.4 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.7, ease: 'easeInOut' }}
        />
        <motion.path
          d="M15.5 27.2l7.3 7.3L37 20.6"
          fill="none"
          stroke="url(#iq-success-gradient)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.42, delay: 0.5, ease: 'easeOut' }}
        />
      </svg>

      <h2 className="iq-success__title">Signed in</h2>
      <p className="iq-success__text">Preparing your workspace…</p>
    </motion.div>
  );
}

export default function AuthForm({ onAuthenticated }) {
  const [view, setView] = useState('login');
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
    setErrors((previous) =>
      previous[field] ? { ...previous, [field]: undefined } : previous
    );

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
      await login({ email: email.trim(), password, remember });
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
    <div className={`iq-form-body${shake ? ' iq-shake' : ''}`}>
      <div className="iq-brand">
        <span className="iq-brand__mark" aria-hidden="true">
          IQ
        </span>
        <span className="iq-brand__name">InstituteIQ</span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {view === 'success' && <SuccessPanel key="success" />}

        {view === 'login' && (
          <motion.div key="login" variants={viewVariants} initial="hidden" animate="show" exit="exit">
            <header className="iq-form__head">
              <h1 className="iq-form__title">Welcome back.</h1>
              <p className="iq-form__sub">Your institute. One intelligent workspace.</p>
            </header>

            <form className="iq-form" onSubmit={handleLogin} noValidate>
              <AnimatedInput
                label="Email address"
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

              <div className="iq-form__row">
                <label className="iq-check">
                  <input
                    type="checkbox"
                    checked={remember}
                    disabled={busy}
                    onChange={(event) => setRemember(event.target.checked)}
                  />
                  <span className="iq-check__box" aria-hidden="true">
                    <Check size={12} strokeWidth={3.2} />
                  </span>
                  <span className="iq-check__text">Remember me</span>
                </label>

                <button type="button" className="iq-link" onClick={() => goTo('forgot')}>
                  Forgot password?
                </button>
              </div>

              <AnimatePresence initial={false}>
                {status && <StatusAlert key="login-status" tone={status.tone} message={status.message} />}
              </AnimatePresence>

              <MagneticButton type="submit" disabled={busy} className="iq-form__submit">
                {busy ? (
                  <>
                    <Loader2 className="iq-spin" size={17} strokeWidth={2.2} aria-hidden="true" />
                    Signing in…
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight size={17} strokeWidth={2.2} aria-hidden="true" />
                  </>
                )}
              </MagneticButton>
            </form>

            <p className="iq-form__foot">
              Accounts are provisioned by your institute administrator. Need access?{' '}
              <a className="iq-link" href="#support">
                Contact support
              </a>
            </p>

            {process.env.NODE_ENV !== 'production' && (
              <p className="iq-note">
                Auth API not connected yet — this form posts to <code>POST /api/auth/login</code>.
                Set <code>REACT_APP_API_URL</code> to point at your Express server.
              </p>
            )}
          </motion.div>
        )}

        {view === 'forgot' && (
          <motion.div key="forgot" variants={viewVariants} initial="hidden" animate="show" exit="exit">
            <header className="iq-form__head">
              <h1 className="iq-form__title">Reset your password.</h1>
              <p className="iq-form__sub">
                We&apos;ll email a secure reset link if the account exists.
              </p>
            </header>

            <form className="iq-form" onSubmit={handleForgot} noValidate>
              <AnimatedInput
                label="Email address"
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

              <MagneticButton type="submit" disabled={busy} className="iq-form__submit">
                {busy ? (
                  <>
                    <Loader2 className="iq-spin" size={17} strokeWidth={2.2} aria-hidden="true" />
                    Sending…
                  </>
                ) : (
                  'Send reset link'
                )}
              </MagneticButton>

              <MagneticButton
                variant="ghost"
                className="iq-form__back"
                onClick={() => goTo('login')}
                disabled={busy}
              >
                <ArrowLeft size={16} strokeWidth={2.2} aria-hidden="true" />
                Back to sign in
              </MagneticButton>
            </form>
          </motion.div>
        )}

        {view === 'reset-sent' && (
          <motion.div key="reset-sent" variants={viewVariants} initial="hidden" animate="show" exit="exit">
            <header className="iq-form__head">
              <h1 className="iq-form__title">Check your inbox.</h1>
              <p className="iq-form__sub">
                If an account exists for {email.trim()}, a reset link is on its way.
              </p>
            </header>

            <MagneticButton variant="ghost" className="iq-form__back" onClick={() => goTo('login')}>
              <ArrowLeft size={16} strokeWidth={2.2} aria-hidden="true" />
              Back to sign in
            </MagneticButton>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
