import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type AppNotification, type PullStatus, type RequestItem } from '../../lib/api';
import { showDesktopNotification } from '../../lib/desktop-notifications';
import { useAllDownloads, downloadLabel } from '../../lib/useDownloadProgress';
import { toast } from '../ui/Toast';

/**
 * The one place in the top bar for what is going on: what is happening right now (downloads, requests being
 * looked for, AI models being fetched, with live progress) and what happened (ready to watch, failed, backups,
 * updates). Every line opens the page it is about. The ring around the bell means something is in progress.
 */

const ago = (iso: string) => {
  const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

const ACTIVE = ['pending', 'searching', 'downloading', 'importing'];

type Tone = 'ok' | 'err' | 'info';
const toneOf = (n: AppNotification): Tone =>
  n.type === 'request.failed' || n.type === 'request.declined' || /failed|no working copy/i.test(n.title) ? 'err'
    : n.type === 'request.available' || n.type === 'request.approved' || n.type === 'downloads.fixed' || n.type === 'system.updated' || (n.type === 'backup' && !/failed/i.test(n.title)) ? 'ok'
      : 'info';

const PATHS: Record<string, string> = {
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  check: 'M20 6 9 17l-5-5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 16v-4M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
  down: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  search: 'M21 21l-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z',
  spark: 'M12 3l1.9 5.8L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.2z'
};
const Glyph = ({ name, size = 16 }: { name: keyof typeof PATHS; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name]} /></svg>
);

/** "Premature.2014.1080p.BluRay.x264-GROUP" reads as "Premature 2014"; an episode keeps its S01E02. */
export const releaseName = (raw: string) => {
  const spaced = raw.replace(/[._]+/g, ' ').trim();
  return (/^.*?\bS\d{2}(E\d{2})?\b/i.exec(spaced)?.[0] ?? /^.*?\b(19|20)\d{2}\b\)?/.exec(spaced)?.[0] ?? spaced).trim();
};

const pageFor = (r: RequestItem) =>
  r.providerId?.startsWith('radarr-') ? `/movies/${r.providerId}` : r.providerId?.startsWith('sonarr-') ? `/series/${r.providerId}` : r.providerId?.startsWith('lidarr-') ? `/music/${r.providerId}` : '/requests';

/** Polls `fn` every `ms` while the page is visible, and at once on a manual refresh. */
function usePoll(fn: () => Promise<void>, ms: number) {
  useEffect(() => {
    void fn();
    const t = setInterval(() => { if (!document.hidden) void fn(); }, ms);
    const now = () => void fn();
    window.addEventListener('vv-refresh', now);
    return () => { clearInterval(t); window.removeEventListener('vv-refresh', now); };
  }, [fn, ms]);
}

export function NotificationBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [pulls, setPulls] = useState<PullStatus[]>([]);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const downloads = useAllDownloads();
  const seen = useRef<Set<number> | null>(null);
  const lastStatus = useRef<Map<string, string> | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const loadNotices = useCallback(async () => {
    try {
      const r = await api.notifications();
      // The first load only records what already exists; later loads announce new arrivals.
      if (seen.current) for (const n of r.items) if (!n.read && !seen.current.has(n.id)) showDesktopNotification(n.title, n.body, n.link);
      seen.current = new Set(r.items.map(n => n.id));
      setItems(r.items);
      setUnread(r.unread);
    } catch { /* offline: try again on the next tick */ }
  }, []);

  const loadPulls = useCallback(async () => {
    try { setPulls((await api.aiPullActive()).jobs ?? []); } catch { setPulls([]); }
  }, []);

  const loadRequests = useCallback(async () => {
    try {
      const list = await api.requests();
      // Something asked for became ready (or could not be found): say so once, with a way straight to it.
      const before = lastStatus.current;
      for (const r of list) {
        const was = before?.get(r.id);
        if (!was || !ACTIVE.includes(was)) continue;
        if (r.status === 'available') toast(`${r.title} is ready`, { action: { label: r.mediaType === 'artist' ? 'Listen' : 'Watch', run: () => navigate(pageFor(r)) } });
        else if (r.status === 'failed') toast(`${r.title} could not be found yet`, { tone: 'err', action: { label: 'See why', run: () => navigate('/requests') } });
      }
      lastStatus.current = new Map(list.map(r => [r.id, r.status]));
      setRequests(list.filter(r => ACTIVE.includes(r.status)));
    } catch { setRequests([]); }
  }, [navigate]);

  usePoll(loadNotices, 20_000);
  usePoll(loadPulls, 4_000);
  usePoll(loadRequests, 15_000);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down);
    document.addEventListener('touchstart', down);
    window.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('touchstart', down); window.removeEventListener('keydown', key); };
  }, [open]);

  const go = (to: string) => { setOpen(false); navigate(to); };
  const openNotice = async (n: AppNotification) => {
    setOpen(false);
    if (!n.read) { const r = await api.markNotificationsRead({ ids: [n.id] }).catch(() => null); if (r) { setItems(r.items); setUnread(r.unread); } }
    navigate(n.link || '/activity');
  };
  const markAll = () => void api.markNotificationsRead({ all: true }).then(r => { setItems(r.items); setUnread(r.unread); }).catch(() => undefined);

  const downloadRows = [...downloads.entries()].filter(([, d]) => d.state !== 'failed');
  // A request that is downloading already shows as a download; list the others once.
  const waiting = requests.filter(r => r.status !== 'downloading' && r.status !== 'importing');
  const active = downloadRows.length + pulls.length + waiting.length;
  const fresh = items.filter(n => !n.read);
  const earlier = items.filter(n => n.read);

  const label = [unread ? `${unread} new` : '', active ? `${active} in progress` : ''].filter(Boolean).join(', ');

  const Notice = ({ n }: { n: AppNotification }) => {
    const tone = toneOf(n);
    return (
      <li>
        <button type="button" className={`nb-row${n.read ? '' : ' is-unread'}`} onClick={() => void openNotice(n)}>
          <span className={`nb-icon nb-icon--${tone}`}><Glyph name={tone === 'ok' ? 'check' : tone === 'err' ? 'alert' : n.type === 'ai.digest' ? 'spark' : 'info'} /></span>
          <span className="nb-text">
            <span className="nb-title">{n.title}</span>
            {n.body && <span className="nb-body">{n.body}</span>}
          </span>
          <span className="nb-time">{ago(n.createdAt)}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="nb" ref={ref}>
      <button type="button" className={`nb-button${active ? ' is-busy' : ''}`} aria-label={label ? `Notifications: ${label}` : 'Notifications'} aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Glyph name="bell" size={20} />
        {unread > 0 && <span className="nb-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="nb-panel" role="dialog" aria-label="Notifications">
          <div className="nb-head">
            <strong>Notifications</strong>
            {unread > 0 && <button type="button" className="nb-link" onClick={markAll}>Mark all read</button>}
          </div>

          {active > 0 && (
            <section className="nb-section">
              <h3 className="nb-section-title">Happening now</h3>
              <ul>
                {downloadRows.map(([id, d]) => (
                  <li key={id}>
                    <button type="button" className="nb-row" onClick={() => go('/downloads')}>
                      <span className="nb-icon nb-icon--busy"><Glyph name="down" /></span>
                      <span className="nb-text">
                        <span className="nb-title">{d.title ? releaseName(d.title) : downloadLabel(d)}</span>
                        <span className="nb-body">{[d.title ? downloadLabel(d) : '', d.eta ? `${d.eta} left` : ''].filter(Boolean).join(' · ')}</span>
                        <span className="nb-bar"><span className="nb-fill" style={{ width: `${Math.max(4, d.progress)}%` }} /></span>
                      </span>
                    </button>
                  </li>
                ))}
                {waiting.map(r => (
                  <li key={r.id}>
                    <button type="button" className="nb-row" onClick={() => go('/requests')}>
                      <span className="nb-icon nb-icon--busy"><Glyph name="search" /></span>
                      <span className="nb-text">
                        <span className="nb-title">{r.title}</span>
                        <span className="nb-body">{r.status === 'pending' ? 'Waiting for approval' : 'Looking for a download'}</span>
                      </span>
                    </button>
                  </li>
                ))}
                {pulls.map(p => (
                  <li key={p.model}>
                    <button type="button" className="nb-row" onClick={() => go('/settings?cat=ai')}>
                      <span className="nb-icon nb-icon--busy"><Glyph name="spark" /></span>
                      <span className="nb-text">
                        <span className="nb-title">Getting AI model {p.model}</span>
                        <span className="nb-bar"><span className="nb-fill" style={{ width: `${Math.max(4, p.percent ?? 8)}%` }} /></span>
                      </span>
                      {p.percent != null && <span className="nb-time">{p.percent}%</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {fresh.length > 0 && (
            <section className="nb-section">
              <h3 className="nb-section-title">New</h3>
              <ul>{fresh.map(n => <Notice key={n.id} n={n} />)}</ul>
            </section>
          )}
          {earlier.length > 0 && (
            <section className="nb-section">
              <h3 className="nb-section-title">Earlier</h3>
              <ul>{earlier.slice(0, 12).map(n => <Notice key={n.id} n={n} />)}</ul>
            </section>
          )}
          {items.length === 0 && active === 0 && (
            <p className="nb-empty">You're all caught up. When something you asked for is ready, it shows up here.</p>
          )}

          <div className="nb-foot">
            <Link to="/activity" onClick={() => setOpen(false)}>All activity</Link>
            <Link to="/settings?cat=notifications" onClick={() => setOpen(false)}>Settings</Link>
          </div>
        </div>
      )}
    </div>
  );
}
