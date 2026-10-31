import { useEffect, useState } from 'react';

/**
 * True while the phone or laptop has no connection, or the server does not answer its health check.
 * Starts from navigator.onLine so an airplane-mode launch shows the offline view at once.
 */
export function useOfflineMode(): boolean {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (navigator.onLine === false) { if (!cancelled) setOffline(true); return; }
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (!cancelled) setOffline(!res.ok);
      } catch {
        if (!cancelled) setOffline(true);
      }
    };
    const goOffline = () => setOffline(true);
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    window.addEventListener('online', check);
    window.addEventListener('offline', goOffline);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('online', check);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return offline;
}
