import { useEffect, useState } from 'react';
import { api, type ActivityEvent } from '../lib/api';
import { BackButton } from '../components/layout/BackButton';

export default function Activity() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    api.activity().then(setEvents).catch(() => setEvents([])).finally(() => setLoading(false));
  }, []);

  return (
    <main className="page">

      <BackButton to="/" label="Home" />
      <div className="page-head">
        <h1>Activity</h1>
        {!loading && <span className="page-count">{events.length} events</span>}
      </div>

      {loading && <div className="loading-state">Loading activity...</div>}
      {!loading && events.length === 0 && (
        <div className="loading-state">Nothing has happened yet. Request a movie or ask the assistant something.</div>
      )}

      <div className="activity-list">
        {events.map(e => (
          <div className="activity-row" key={e.id}>
            <span className={`integration-dot${e.status === 'ok' || e.status === 'available' ? ' integration-dot--online' : ''}`} />
            <div className="activity-body">
              <span className="activity-text">{e.humanReadable}</span>
              <span className="activity-meta">
                {new Date(e.timestamp).toLocaleString()} · {e.service}
                {e.technicalDetails && (
                  <button
                    type="button"
                    className="activity-details-toggle"
                    onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  >
                    {expanded === e.id ? 'Hide details' : 'Details'}
                  </button>
                )}
              </span>
              {expanded === e.id && e.technicalDetails && (
                <div className="activity-details">
                  {Object.entries(e.technicalDetails).map(([key, value]) => (
                    <div className="activity-detail-row" key={key}>
                      <span className="activity-detail-key">{key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}</span>
                      <span className="activity-detail-value">{typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
