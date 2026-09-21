import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/** Start a watch party for what is playing, or show the code for the one already open. */
export default function WatchTogether({ title, code, watching }: { title: string; code: string | null; watching: number }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/watch-party', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, link: location.pathname })
      });
      const data = (await res.json()) as { code?: string; message?: string };
      if (!res.ok || !data.code) throw new Error(data.message ?? 'Could not start a watch party.');
      navigate(`${location.pathname}?party=${data.code}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const link = code ? `${window.location.origin}/party/${code}` : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked: the link is shown */ }
  };

  return (
    <div className="watch-together">
      {code ? (
        <>
          <span>Watching together, code <strong>{code}</strong> ({watching} here)</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy invite link'}</button>
          <span className="watch-together-link">{link}</span>
        </>
      ) : (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void start()} disabled={busy}>{busy ? 'Starting...' : 'Watch together'}</button>
      )}
      {error && <span className="notice notice--err">{error}</span>}
    </div>
  );
}
