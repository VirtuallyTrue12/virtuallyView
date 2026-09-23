import { useEffect, useState, type FormEvent } from 'react';
import { BackButton } from '../components/layout/BackButton';

interface AppStatus { id: string; name: string; what: string; keyHelp: string; connected: boolean; url: string | null; healthy: boolean; hasKey: boolean; headline?: string }

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(body.message ?? `Request failed (${res.status}).`);
  return body;
}

function AppCard({ app, onSaved }: { app: AppStatus; onSaved: (apps: AppStatus[]) => void }) {
  const [editing, setEditing] = useState(!app.connected);
  const [url, setUrl] = useState(app.url ?? '');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (event: FormEvent, clear = false) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await json<{ apps: AppStatus[] }>(`/api/apps/${app.id}/config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: clear ? '' : url, apiKey: clear ? '' : apiKey })
      });
      onSaved(r.apps); setApiKey(''); setEditing(clear);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className="settings-section">
      <h3>{app.name} <small style={{ opacity: 0.7, fontWeight: 400 }}>{app.what}</small></h3>
      {app.connected && (
        <p className="settings-help">
          <span className={`ai-status ${app.healthy ? 'is-online' : 'is-offline'}`}>{app.healthy ? 'Online' : 'Not answering'}</span>
          {app.headline ? ` · ${app.headline}` : ''}
        </p>
      )}
      {app.connected && !editing && (
        <div className="users-actions">
          {app.healthy && app.url && <a className="btn btn-primary btn-sm" href={app.url} target="_blank" rel="noreferrer noopener">Open {app.name}</a>}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>Change</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={e => void save(e, true)}>Disconnect</button>
        </div>
      )}
      {editing && (
        <form className="users-add" onSubmit={e => void save(e)}>
          <label className="login-field"><span>Address</span><input className="settings-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="http://192.168.1.5:2283" required /></label>
          <label className="login-field"><span>Key (optional)</span><input className="settings-input" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={app.hasKey ? 'Saved. Leave blank to keep it' : ''} autoComplete="off" /></label>
          <p className="settings-help">{app.keyHelp}</p>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Connecting...' : 'Connect'}</button>
        </form>
      )}
      {error && <div className="notice notice--err" role="alert">{error}</div>}
    </section>
  );
}

/** Other self-hosted apps you already run, linked from here. Only an administrator can change them. */
export default function HomeLabApps() {
  const [apps, setApps] = useState<AppStatus[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { json<{ apps: AppStatus[] }>('/api/apps').then(r => setApps(r.apps)).catch(err => setError((err as Error).message)); }, []);

  return (
    <main className="page">
      <BackButton to="/" label="Home" />
      <div className="page-head"><h1>Apps</h1></div>
      <p className="settings-help">Connect other self-hosted apps you already run, like your photo library or audiobook server, and check on them from here. Each keeps its own interface; this links to it.</p>
      {error && <div className="notice notice--err" role="alert">{error}</div>}
      {!apps && !error && <div className="loading-state">Loading...</div>}
      {apps?.map(app => <AppCard key={`${app.id}-${app.connected}`} app={app} onSaved={setApps} />)}
    </main>
  );
}
