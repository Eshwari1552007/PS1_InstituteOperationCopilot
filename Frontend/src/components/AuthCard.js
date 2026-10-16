/**
 * Solid-surface login card.
 */
export default function AuthCard({ children, className = '' }) {
  return <div className={`ax-card ${className}`.trim()}>{children}</div>;
}
