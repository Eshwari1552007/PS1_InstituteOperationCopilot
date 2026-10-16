import { useRef } from 'react';
import usePointerGlow from '../hooks/usePointerGlow';

/**
 * Button that leans gently toward the cursor as it approaches.
 * Press feedback stays in CSS so the magnet transform is never overwritten.
 */
export default function MagneticButton({
  children,
  variant = 'primary',
  className = '',
  magnet = 7,
  ...rest
}) {
  const ref = useRef(null);
  usePointerGlow(ref, { magnet, magnetRadius: 2.4 });

  return (
    <button
      ref={ref}
      type="button"
      className={`iq-btn iq-btn--${variant} ${className}`.trim()}
      {...rest}
    >
      <span className="iq-btn__glow" aria-hidden="true" />
      <span className="iq-btn__label">{children}</span>
    </button>
  );
}
