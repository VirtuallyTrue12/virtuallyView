import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type PullStatus } from '../../lib/api';
import { useAllDownloads, downloadLabel } from '../../lib/useDownloadProgress';

/**
 * "What's happening right now" indicator in the top bar: downloads in
 * progress and AI models being pulled. Complements RequestActivityPill
 * (which only covers the request pipeline) rather than replacing it.
 */
export function SystemActivity() {
  const navigate = useNavigate();
  const downloads = useAllDownloads();
  const [pulls, setPulls] = useState<PullStatus[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await api.aiPullActive();
        if (!cancelled) setPulls(r.jobs ?? []);
      } catch {
        if (!cancelled) setPulls([]);
      }
    };
    void poll();
    const interval = setInterval(() => { if (!document.hidden) void poll(); }, 4000);
    const now = () => void poll();
    window.addEventListener('vv-refresh', now);
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('vv-refresh', now); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [open]);

  const downloadRows = [...downloads.entries()].filter(([, d]) => d.state !== 'failed');
  const total = downloadRows.length + pulls.length;

  if (total === 0) return null;

  return (
    <div className="sys-activity" ref={ref}>
      <button
        type="button"
        className="sys-activity-button"
        aria-label={`${total} active in the background`}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v18M18 8l-6-5-6 5M18 16l-6 5-6-5" />
        </svg>
        <span className="sys-activity-count">{total}</span>
      </button>
      {open && (
        <div className="sys-activity-panel" role="dialog" aria-label="Background activity">
          <div className="sys-activity-head"><strong>Happening now</strong></div>
          <ul>
            {downloadRows.map(([id, d]) => (
              <li key={id}>
                <button type="button" className="sys-activity-item" onClick={() => { setOpen(false); navigate('/downloads'); }}>
                  <span className="sys-activity-title">{downloadLabel(d)}</span>
                  <div className="sys-activity-bar"><div className="sys-activity-fill" style={{ width: `${Math.max(4, d.progress)}%` }} /></div>
                </button>
              </li>
            ))}
            {pulls.map(p => (
              <li key={p.model}>
                <button type="button" className="sys-activity-item" onClick={() => { setOpen(false); navigate('/settings?cat=ai'); }}>
                  <span className="sys-activity-title">Pulling model {p.model}{p.percent != null ? ` · ${p.percent}%` : ''}</span>
                  {p.message && <span className="sys-activity-sub">{p.message}</span>}
                  <div className="sys-activity-bar"><div className="sys-activity-fill" style={{ width: `${Math.max(4, p.percent ?? 8)}%` }} /></div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
