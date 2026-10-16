import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Eye, EyeOff, Lock } from 'lucide-react';
import AnimatedInput from './AnimatedInput';

const iconMotion = {
  initial: { opacity: 0, scale: 0.7, rotate: -18 },
  animate: { opacity: 1, scale: 1, rotate: 0 },
  exit: { opacity: 0, scale: 0.7, rotate: 18 },
  transition: { duration: 0.16 },
};

export default function PasswordInput({ label = 'Password', ...props }) {
  const [visible, setVisible] = useState(false);

  return (
    <AnimatedInput
      {...props}
      label={label}
      icon={Lock}
      type={visible ? 'text' : 'password'}
      autoComplete={props.autoComplete || 'current-password'}
      trailing={
        <button
          type="button"
          className="iq-field__toggle"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={visible ? 'visible' : 'hidden'} {...iconMotion} className="iq-field__toggle-icon">
              {visible ? (
                <EyeOff size={17} strokeWidth={1.9} aria-hidden="true" />
              ) : (
                <Eye size={17} strokeWidth={1.9} aria-hidden="true" />
              )}
            </motion.span>
          </AnimatePresence>
        </button>
      }
    />
  );
}
