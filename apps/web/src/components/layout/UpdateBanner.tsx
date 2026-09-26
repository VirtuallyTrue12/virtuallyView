import { useEffect, useRef, useState } from 'react';
import { SvgIcon } from '../ui/SvgIcon';

/**
 * A tab that stays open across an update keeps running the old version of the page. This asks the server which build
 * it is serving now (on a timer and whenever the tab comes back into view) and offers a one-click reload when it changed.
 */
export function UpdateBanner() {
  const first = useRef<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        const body = (await res.json()) as { build?: string };
        if (!alive || !body.build) return;
        if (first.current === null) first.current = body.build;
        else if (body.build !== first.current) setStale(true);
      } catch { /* offline: try again later */ }
    };
    void check();
    const timer = window.setInterval(() => void check(), 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  if (!stale) return null;
  return (
    <div className="update-banner" role="status">
      <SvgIcon name="sparkle" size={16} />
      <span>A new version of virtuallyView is ready.</span>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>Reload</button>
    </div>
  );
}
