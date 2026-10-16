import { useId } from 'react';

/**
 * Field with a floating label and a focus ring driven purely by CSS
 * (:focus-within and the :placeholder-shown trick).
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
  const inputId = id || `ax-field-${autoId}`;
  const errorId = `${inputId}-error`;
  const filled = value !== undefined && value !== null && String(value).length > 0;

  return (
    <div className={className}>
      <div
        className={[
          'ax-field',
          error ? 'ax-field--error' : '',
          filled ? 'ax-field--filled' : '',
          Icon ? '' : 'ax-field--no-icon',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {Icon && (
          <span className="ax-field__icon">
            <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
          </span>
        )}

        <input
          id={inputId}
          className="ax-field__input"
          type={type}
          value={value}
          placeholder=" "
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
          {...rest}
        />

        <label className="ax-field__label" htmlFor={inputId}>
          {label}
        </label>

        {trailing && <span className="ax-field__trailing">{trailing}</span>}
      </div>

      {error && (
        <p className="ax-field__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
