import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../../lib/api';

/**
 * Refresh in the top bar of every page: the server forgets its short-lived
 * caches and re-checks requests (and, for administrators, the download queues),
 * then the page you are on is loaded again and the live indicators update now.
 * Hidden while a video is playing, because reloading the page would stop it.
 */
export function RefreshButton({ onRefresh }: { onRefresh: () => void }) {
  const { pathname } = useLocation();
  const [busy, setBusy] = useState(false);
  if (/\/play\b|\/watch\//.test(pathname)) return null;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    const minimum = new Promise(resolve => setTimeout(resolve, 600));
    // A "too soon" answer or an offline server still reloads the page: the person asked to see fresh data.
    await api.refresh().catch(() => undefined);
    onRefresh();
    window.dispatchEvent(new Event('vv-refresh'));
    await minimum;
    setBusy(false);
  };

  return (
    <button type="button" className={`refresh-button${busy ? ' is-busy' : ''}`} aria-label="Refresh this page" title="Refresh this page" disabled={busy} onClick={() => void run()}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
      </svg>
    </button>
  );
}
