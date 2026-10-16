import { useId } from 'react';

/**
 * Glass input with a floating label, focus icon animation and a luminous
 * gradient ring on focus. Uses the :placeholder-shown trick so the label
 * position is driven purely by CSS.
 */
export default function AnimatedInput({
  label,
  icon: Icon,
  error,
  id,
  type = 'text',
  value,
  trailing,
  className = '',
  ...rest
}) {
  const autoId = useId();
  const inputId = id || `iq-field-${autoId}`;
  const errorId = `${inputId}-error`;
  const filled = value !== undefined && value !== null && String(value).length > 0;

  return (
    <div className={className}>
      <div
        className={[
          'iq-field',
          error ? 'iq-field--error' : '',
          filled ? 'iq-field--filled' : '',
          Icon ? '' : 'iq-field--no-icon',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {Icon && (
          <span className="iq-field__icon">
            <Icon size={17} strokeWidth={1.9} aria-hidden="true" />
          </span>
        )}

        <input
          id={inputId}
          className="iq-field__input"
          type={type}
          value={value}
          placeholder=" "
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
          {...rest}
        />

        <label className="iq-field__label" htmlFor={inputId}>
          {label}
        </label>

        <span className="iq-field__ring" aria-hidden="true" />

        {trailing && <span className="iq-field__trailing">{trailing}</span>}
      </div>

      {error && (
        <p className="iq-field__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
