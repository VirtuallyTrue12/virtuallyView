import { useEffect, useState, type FormEvent } from 'react';
import { Troubleshooter } from '../components/settings/Troubleshooter';
import { EmptyState, PageHeader, Pill, Section } from '../components/ui/Page';
import { Dialog } from '../components/ui/Dialog';
import { MenuDivider, MenuItem, MoreMenu } from '../components/ui/MoreMenu';
import { SvgIcon, type IconName } from '../components/ui/SvgIcon';

interface AppStatus { id: string; name: string; what: string; keyHelp: string; install: string; port: number; bundled?: boolean; connected: boolean; url: string | null; healthy: boolean; hasKey: boolean; headline?: string }

const ICON: Record<string, IconName> = { immich: 'camera', audiobookshelf: 'mic', kavita: 'book' };

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(body.message ?? `Request failed (${res.status}).`);
  return body;
}

const openUrl = (app: AppStatus) => (app.bundled ? `${window.location.protocol}//${window.location.hostname}:${app.port}` : app.url ?? '');

function AppTile({ app, onEdit, onDisconnect, busy }: { app: AppStatus; onEdit: () => void; onDisconnect: () => void; busy: boolean }) {
  const [copied, setCopied] = useState(false);
  const state = !app.connected ? { tone: 'neutral' as const, text: 'Not set up' } : app.healthy ? { tone: 'ok' as const, text: 'Online' } : { tone: 'bad' as const, text: 'Not answering' };
  return (
    <article className={`ap${app.connected ? '' : ' is-empty'}`}>
      <div className="ap-top">
        <span className="ap-icon"><SvgIcon name={ICON[app.id] ?? 'grid'} size={24} /></span>
        <Pill tone={state.tone}>{state.text}</Pill>
      </div>
      <h3>{app.name}</h3>
      <p className="ap-what">{app.what}</p>
      {app.connected && app.headline && <p className="ap-head">{app.headline}</p>}
      {app.connected && !app.healthy && <p className="ap-warn">It does not answer at {app.url}. Check that it is running.</p>}
      {!app.connected && (
        <div className="ap-install">
          <span>Install next to this server:</span>
          <code>{app.install}</code>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void navigator.clipboard?.writeText(app.install); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }}>{copied ? 'Copied' : 'Copy command'}</button>
          <span className="ap-note">It connects here by itself a few seconds after it starts.</span>
        </div>
      )}
      <div className="ap-actions">
        {app.connected && app.healthy && app.url && <a className="btn btn-primary" href={openUrl(app)} target="_blank" rel="noreferrer noopener"><SvgIcon name="external" size={16} /> Open {app.name}</a>}
        {!app.connected && <button type="button" className="btn btn-secondary" onClick={onEdit}>Already running it? Connect</button>}
        {app.connected && (
          <MoreMenu label={`More for ${app.name}`}>
            <MenuItem icon="edit" label="Change address or key" onSelect={onEdit} />
            <MenuDivider />
            <MenuItem icon="close" label="Disconnect" danger disabled={busy} onSelect={onDisconnect} />
          </MoreMenu>
        )}
      </div>
    </article>
  );
}

/** Other self-hosted apps you already run, linked from here. Only an administrator can change them. */
export default function HomeLabApps() {
  const [apps, setApps] = useState<AppStatus[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<AppStatus | null>(null);
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  useEffect(() => { json<{ apps: AppStatus[] }>('/api/apps').then(r => setApps(r.apps)).catch(err => setError((err as Error).message)); }, []);

  const post = async (app: AppStatus, body: { url: string; apiKey: string }) => {
    const r = await json<{ apps: AppStatus[] }>(`/api/apps/${app.id}/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setApps(r.apps);
  };
  const edit = (app: AppStatus) => { setEditing(app); setUrl(app.url ?? ''); setApiKey(''); setFormError(''); };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setBusy(true); setFormError('');
    try { await post(editing, { url, apiKey }); setEditing(null); } catch (err) { setFormError((err as Error).message); } finally { setBusy(false); }
  };
  const disconnect = async (app: AppStatus) => { setBusy(true); try { await post(app, { url: '', apiKey: '' }); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } };

  const connected = apps?.filter(a => a.connected).length ?? 0;
  return (
    <main className="page">
      <PageHeader title="Apps" sub={apps ? `${connected} of ${apps.length} connected. Each keeps its own interface; this page links to it.` : undefined}
        actions={<a className="btn btn-secondary" href="#apps-health"><SvgIcon name="wrench" size={17} /> Check health</a>} />
      {error && <div className="notice notice--err" role="alert">{error}</div>}
      {!apps && !error && <div className="loading-state">Loading...</div>}
      {apps && apps.length === 0 && <EmptyState icon="grid" title="No apps available" text="Nothing else can be connected on this server." />}
      {apps && apps.length > 0 && <div className="ap-grid">{apps.map(app => <AppTile key={app.id} app={app} busy={busy} onEdit={() => edit(app)} onDisconnect={() => void disconnect(app)} />)}</div>}

      <Section title="Something not working?" help="Checks the internet, search, downloads, media services and these apps, and tells you what to try.">
        <div id="apps-health"><Troubleshooter /></div>
      </Section>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing ? `Connect ${editing.name}` : ''}>
        {editing && (
          <form className="st-connect" onSubmit={e => void save(e)} style={{ padding: 0, border: 0 }}>
            <label>Address<input className="settings-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="http://192.168.1.5:2283" required autoFocus /></label>
            <label>Key (optional)<input className="settings-input" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={editing.hasKey ? 'Saved. Leave blank to keep it' : ''} autoComplete="off" /></label>
            <p className="ui-help">{editing.keyHelp}</p>
            {formError && <div className="notice notice--err" role="alert">{formError}</div>}
            <div className="st-connect-actions"><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button><button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button></div>
          </form>
        )}
      </Dialog>
    </main>
  );
}
