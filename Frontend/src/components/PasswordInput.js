import { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import AnimatedInput from './AnimatedInput';

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
          className="ax-field__toggle"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          <span className="ax-field__toggle-icon">
            {visible ? (
              <EyeOff size={17} strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <Eye size={17} strokeWidth={1.8} aria-hidden="true" />
            )}
          </span>
        </button>
      }
    />
  );
}
