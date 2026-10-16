/**
 * Minimal academic mark: stylized three-petal leaf icon.
 */
export default function Logo({ size = 32, className = '' }) {
  return (
    <span className={`ax-logo ${className}`.trim()} style={{ width: size, height: size }}>
      <svg viewBox="0 0 32 32" role="img" aria-label="EDUPILOT" focusable="false">
        <path
          d="M16 26c0-7.7 5.4-14 12-14-6.6 0-12 6.3-12 14ZM16 26c0-7.7-5.4-14-12-14 6.6 0 12 6.3 12 14ZM16 18c0-5.5 2.5-10 5.5-10-3 0-5.5 4.5-5.5 10ZM16 18c0-5.5-2.5-10-5.5-10 3 0 5.5 4.5 5.5 10Z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}
