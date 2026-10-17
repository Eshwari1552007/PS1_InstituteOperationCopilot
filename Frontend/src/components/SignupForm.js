import { useState } from 'react';
import { ArrowLeft, ArrowRight, Mail, Phone, UserRound } from 'lucide-react';
import { motion } from 'framer-motion';
import AnimatedInput from './AnimatedInput';
import Button from './Button';
import PasswordInput from './PasswordInput';
import { register } from '../auth/authService';
import { useToast } from './Toast';

const ROLE_OPTIONS = [
  { value: 'STUDENT', label: 'Student' },
  { value: 'COUNSELOR', label: 'Counselor (Owner approval)' },
  { value: 'TRAINER', label: 'Trainer (Owner approval)' },
  { value: 'ACCOUNTS', label: 'Accounts (Owner approval)' },
];

export default function SignupForm({ onBack }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('STUDENT');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    const reject = (text) => { setError(text); toast.warning(text, 'Check your details'); };
    if (name.trim().length < 2) return reject('Enter your full name.');
    if (role === 'STUDENT' && !phone.trim()) return reject('Enter your phone number.');
    if (password.length < 6) return reject('Choose a password with at least 6 characters.');
    if (password !== confirmPassword) return reject('Passwords do not match.');
    setBusy(true);
    try {
      await register({ name: name.trim(), email: email.trim(), phone, password, role });
      toast.success(role === 'STUDENT' ? 'Your student account is ready. Setting up your home page…' : 'Account created. Staff access stays pending until an Owner approves it.', 'Welcome to EDUPILOT');
    } catch (failure) {
      setError(failure.message);
      toast.error(failure.message, 'Could not create account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <header className="ax-form__head">
        <h1 className="ax-form__title">Create your account</h1>
        <p className="ax-form__sub">Register for EDUPILOT. Staff access requires Owner approval.</p>
      </header>
      <form className="ax-form" onSubmit={handleSubmit} noValidate>
        <AnimatedInput label="Full name" icon={UserRound} value={name} autoComplete="name" disabled={busy} onChange={(event) => setName(event.target.value)} />
        <AnimatedInput label="Email" icon={Mail} type="email" value={email} autoComplete="email" disabled={busy} onChange={(event) => setEmail(event.target.value)} />
        {role === 'STUDENT' && <AnimatedInput label="Phone number" icon={Phone} type="tel" value={phone} autoComplete="tel" disabled={busy} onChange={(event) => setPhone(event.target.value)} />}
        <label className="ax-select-wrap">
          <span>Requested role</span>
          <select className="ax-select" value={role} disabled={busy} onChange={(event) => setRole(event.target.value)}>
            {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <PasswordInput label="Password" value={password} disabled={busy} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} />
        <PasswordInput label="Confirm password" value={confirmPassword} disabled={busy} autoComplete="new-password" onChange={(event) => setConfirmPassword(event.target.value)} />
        {error && <p className="ax-alert ax-alert--error" role="alert">{error}</p>}
        <Button type="submit" disabled={busy} className="ax-form__submit">
          {busy ? 'Creating account…' : <>Create account <ArrowRight size={17} aria-hidden="true" /></>}
        </Button>
        <p className="ax-form__foot">
          Already have an account?{' '}
          <button type="button" className="ax-link" disabled={busy} onClick={onBack}>Sign in</button>
        </p>
        <Button variant="ghost" className="ax-form__back" disabled={busy} onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" /> Back to sign in
        </Button>
      </form>
    </motion.div>
  );
}
