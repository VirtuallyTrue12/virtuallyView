/** Grey placeholders shaped like the content that is loading. */
export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}

/** A grid (or one sideways row) of poster placeholders, announced once to screen readers. */
export function PosterSkeletons({ count = 12, row = false, label = 'Loading' }: { count?: number; row?: boolean; label?: string }) {
  return (
    <div className={row ? 'skeleton-row' : 'skeleton-grid'} role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => <div key={i}><Skeleton className="skeleton-card" /><Skeleton className="skeleton-line" style={{ width: '70%', marginTop: 10 }} /></div>)}
    </div>
  );
}
