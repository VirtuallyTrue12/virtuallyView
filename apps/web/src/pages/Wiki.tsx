import { useEffect, useState, type FormEvent } from 'react';
import { BackButton } from '../components/layout/BackButton';

interface KiwixStatus { configured: boolean; url: string | null; healthy: boolean }

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(body.message ?? `Request failed (${res.status}).`);
  return body;
}

/**
 * Kiwix: offline Wikipedia and other ZIM-file wikis, either a Kiwix server
 * you already run elsewhere or the bundled kiwix-serve container. This page
 * just stores the address and embeds Kiwix's own reader - it already has a
 * full search and browsing UI, no need to rebuild one.
 */
export default function Wiki() {
  const [status, setStatus] = useState<KiwixStatus | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const result = await json<KiwixStatus>('/api/kiwix/status');
      setStatus(result);
      setUrl(result.url ?? '');
    } catch (err) {
      setError((err as Error).message);
    }
  };
  useEffect(() => { void load(); }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await json<KiwixStatus>('/api/kiwix/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() })
      });
      setStatus(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const result = await json<KiwixStatus>('/api/kiwix/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: '' })
      });
      setStatus(result);
      setUrl('');
    } finally {
      setBusy(false);
    }
  };

  if (status?.configured && status.healthy) {
    return (
      <main className="page wiki-page">
        <BackButton to="/" label="Home" />
        <div className="page-head">
          <h1>Wiki</h1>
          <div className="page-head-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void disconnect()} disabled={busy}>Disconnect</button>
          </div>
        </div>
        <iframe src={status.url ?? ''} title="Kiwix" className="wiki-frame" />
      </main>
    );
  }

  return (
    <main className="page">
      <BackButton to="/" label="Home" />
      <div className="page-head"><h1>Wiki</h1></div>
      {status?.configured && !status.healthy && (
        <div className="notice notice--err" role="alert">Could not reach {status.url}. Check that it's running and the address is correct.</div>
      )}
      {error && <div className="notice notice--err" role="alert">{error}</div>}

      <section className="settings-section">
        <h3>Offline Wikipedia and other wikis</h3>
        <p className="settings-help">
          Kiwix (open source) reads ZIM files - full offline copies of Wikipedia, Wiktionary, Project Gutenberg
          and hundreds of others, downloadable from <a href="https://library.kiwix.org" target="_blank" rel="noreferrer noopener">library.kiwix.org</a>.
          Only an administrator can change this.
        </p>
        <p className="settings-help">
          Already run a Kiwix server? Enter its address below. Otherwise, turn on the bundled one with
          <code> docker compose --profile kiwix up -d</code>, put .zim files in its data folder, then enter
          <code> http://kiwix:8080</code>. See docs/kiwix.md.
        </p>
        <form className="users-add" onSubmit={e => void save(e)}>
          <label className="login-field"><span>Address</span><input className="settings-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="http://192.168.1.5:8080 or http://kiwix:8080" required /></label>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Connecting...' : 'Connect'}</button>
        </form>
      </section>
    </main>
  );
}
