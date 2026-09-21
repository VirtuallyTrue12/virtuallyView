import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';

// Same statuses the Requests page treats as "in progress".
const ACTIVE = ['pending', 'searching', 'downloading', 'importing'];

/**
 * Floating badge that appears while any request pipeline is running. It polls
 * the live request ledger every 15 seconds and links to the Requests page.
 * It stays mounted so show/hide is a smooth CSS fade, and it never renders on
 * the Requests page itself.
 */
export default function RequestActivityPill() {
  const navigate = useNavigate();
  const location = useLocation();
  const [active, setActive] = useState(0);
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const items = await api.requests();
        if (cancelled) return;
        const running = items.filter(r => ACTIVE.includes(r.status));
        setActive(running.length);
        setLatest(running[0]?.title ?? null);
      } catch {
        if (!cancelled) setActive(0);
      }
    };
    void poll();
    const interval = setInterval(poll, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const onRequestsPage = location.pathname === '/requests';
  const visible = !onRequestsPage && active > 0;

  return (
    <button
      type="button"
      className={`request-activity-pill${visible ? ' is-visible' : ''}`}
      onClick={() => navigate('/requests')}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
    >
      <span className="request-activity-dot" />
      <span className="request-activity-text">
        {active === 1 ? '1 request active' : `${active} requests active`}
        {latest ? ` · ${latest}` : ''}
      </span>
    </button>
  );
}