import { useRef } from 'react';
import usePointerGlow from '../hooks/usePointerGlow';

/**
 * Translucent glass surface with a pointer-tracked reflection and a restrained
 * 3D tilt. Motion is written to the node as CSS custom properties, never through
 * React state, so hovering stays off the render path.
 */
export default function GlassCard({ children, className = '', tilt = 5, ...rest }) {
  const ref = useRef(null);
  usePointerGlow(ref, { tilt });

  return (
    <div ref={ref} className={`iq-glass iq-tiltable ${className}`.trim()} {...rest}>
      <span className="iq-glass__sheen" aria-hidden="true" />
      <span className="iq-glass__edge" aria-hidden="true" />
      {children}
    </div>
  );
}
