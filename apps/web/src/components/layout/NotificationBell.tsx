import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type AppNotification } from '../../lib/api';
import { showDesktopNotification } from '../../lib/desktop-notifications';

const ago = (iso: string) => {
  const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

/** Bell in the top bar: what happened to your requests, plus desktop pop-ups when enabled. */
export function NotificationBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const seen = useRef<Set<number> | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.notifications();
      // The first load only records what already exists; later loads announce new arrivals.
      if (seen.current) for (const n of r.items) if (!n.read && !seen.current.has(n.id)) showDesktopNotification(n.title, n.body, n.link);
      seen.current = new Set(r.items.map(n => n.id));
      setItems(r.items);
      setUnread(r.unread);
    } catch { /* offline: try again on the next tick */ }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 20000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [open]);

  const openItem = async (n: AppNotification) => {
    setOpen(false);
    if (!n.read) { const r = await api.markNotificationsRead({ ids: [n.id] }).catch(() => null); if (r) { setItems(r.items); setUnread(r.unread); } }
    if (n.link) navigate(n.link);
  };

  return (
    <div className="bell" ref={ref}>
      <button type="button" className="bell-button" aria-label={unread ? `${unread} unread notifications` : 'Notifications'} aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {unread > 0 && <span className="bell-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <strong>Notifications</strong>
            {unread > 0 && <button type="button" onClick={() => void api.markNotificationsRead({ all: true }).then(r => { setItems(r.items); setUnread(r.unread); })}>Mark all read</button>}
          </div>
          <ul>
            {items.map(n => (
              <li key={n.id}>
                <button type="button" className={`bell-item${n.read ? '' : ' is-unread'}`} onClick={() => void openItem(n)}>
                  <span className="bell-title">{n.title}</span>
                  {n.body && <span className="bell-body">{n.body}</span>}
                  <span className="bell-time">{ago(n.createdAt)}</span>
                </button>
              </li>
            ))}
            {items.length === 0 && <li className="bell-empty">Nothing yet. Request something and updates land here.</li>}
          </ul>
          <Link className="bell-foot" to="/settings?cat=notifications" onClick={() => setOpen(false)}>Notification settings</Link>
        </div>
      )}
    </div>
  );
}
