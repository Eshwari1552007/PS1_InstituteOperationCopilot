/**
 * Action button with primary, outline and ghost variants.
 */
export default function Button({ children, variant = 'primary', className = '', ...rest }) {
  return (
    <button
      type="button"
      className={`ax-btn ax-btn--${variant} ${className}`.trim()}
      {...rest}
    >
      <span className="ax-btn__label">{children}</span>
    </button>
  );
}
