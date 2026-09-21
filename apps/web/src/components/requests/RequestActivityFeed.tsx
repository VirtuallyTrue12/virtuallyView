import { useEffect, useState } from 'react';

export interface RequestEvent {
  at: string;
  text: string;
}

/**
 * Rolling activity feed for a request: shows the most recent real pipeline
 * events. The pulsing cursor is pure CSS; when the request finishes, the
 * animation stops instead of faking activity.
 */
export function RequestActivityFeed({ events, status }: { events?: RequestEvent[]; status: string }) {
  const [showCount, setShowCount] = useState(3);

  useEffect(() => {
    setShowCount(3);
  }, [events?.length]);

  if (!events?.length) {
    return <p className="request-detail">Waiting for the first status update from your media services.</p>;
  }

  const active = !['available', 'failed', 'cancelled'].includes(status);
  const shown = events.slice(-showCount);

  return (
    <div className="request-activity" aria-live="polite" aria-label="Request activity">
      <ul className="request-activity-list">
        {shown.map((event, index) => {
          const isLatest = index === shown.length - 1;
          return (
            <li key={`${event.at}-${index}`} className={isLatest && active ? 'request-activity-line is-latest' : 'request-activity-line'}>
              <span className="request-activity-time">{new Date(event.at).toLocaleTimeString()}</span>
              <span className="request-activity-text">{event.text}</span>
              {isLatest && active && <span className="request-activity-cursor" aria-hidden="true" />}
            </li>
          );
        })}
      </ul>
      {events.length > showCount && (
        <button type="button" className="request-activity-more" onClick={() => setShowCount(count => count + 6)}>
          Show earlier activity ({events.length - showCount} more)
        </button>
      )}
    </div>
  );
}
