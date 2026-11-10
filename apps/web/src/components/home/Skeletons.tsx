/** Placeholders shaped like the content they stand in for, so nothing jumps when it arrives. */
export function SkeletonGrid({ count = 12, className = 'media-grid browse-grid' }: { count?: number; className?: string }) {
  return (
    <div className={className} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="browse-skel-card" aria-hidden="true">
          <div className="skeleton browse-skel-poster" />
          <div className="skeleton skeleton-line browse-skel-line" />
          <div className="skeleton skeleton-line skeleton-line--short browse-skel-line" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonRail({ count = 7 }: { count?: number }) {
  return (
    <section className="rail browse-skel-rail" aria-hidden="true">
      <div className="skeleton browse-skel-heading" />
      <div className="browse-skel-row">
        {Array.from({ length: count }, (_, i) => <div key={i} className="skeleton browse-skel-poster" />)}
      </div>
    </section>
  );
}

export function SkeletonList({ count = 4 }: { count?: number }) {
  return (
    <div className="rq-list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="browse-skel-row-item" aria-hidden="true">
          <div className="skeleton browse-skel-thumb" />
          <div>
            <div className="skeleton skeleton-line" style={{ width: '40%' }} />
            <div className="skeleton skeleton-line skeleton-line--short" style={{ width: '25%' }} />
            <div className="skeleton skeleton-line" style={{ width: '70%', marginTop: 12 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Plain words plus the one button that might fix it. */
export function LoadError({ what, message, onRetry }: { what: string; message: string; onRetry: () => void }) {
  return (
    <div className="browse-error" role="alert">
      <p><strong>{what} could not be loaded.</strong> <span>{message}</span></p>
      <button type="button" className="btn btn-secondary" onClick={onRetry}>Retry</button>
    </div>
  );
}
