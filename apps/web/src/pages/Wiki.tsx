import { useEffect, useState, type FormEvent } from 'react';
import { PageHeader, Pill } from '../components/ui/Page';
import { Dialog } from '../components/ui/Dialog';
import { MenuItem, MoreMenu } from '../components/ui/MoreMenu';
import { SvgIcon } from '../components/ui/SvgIcon';

interface KiwixStatus { configured: boolean; url: string | null; healthy: boolean; bundled?: boolean }

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
  const [changing, setChanging] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const readerUrl = status?.bundled ? `${window.location.protocol}//${window.location.hostname}:8888` : status?.url ?? '';
  const command = 'docker compose --profile kiwix up -d';

  const form = (
    <form className="st-connect" onSubmit={e => { void save(e).then(() => setChanging(false)); }} style={{ padding: 0, border: 0 }}>
      <label>Address of your Kiwix server<input className="settings-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="http://192.168.1.5:8080 or http://kiwix:8080" required /></label>
      <div className="st-connect-actions"><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button></div>
    </form>
  );

  if (status?.configured && status.healthy) {
    return (
      <main className="page wiki-page">
        <PageHeader title="Wiki" sub={<>Offline reading from your own Kiwix library <Pill tone="ok">Connected</Pill></>}
          actions={<>
            <a className="btn btn-secondary" href={readerUrl} target="_blank" rel="noreferrer noopener"><SvgIcon name="external" size={17} /> Open in a new tab</a>
            <MoreMenu label="More for the wiki">
              <MenuItem icon="edit" label="Change the address" onSelect={() => setChanging(true)} />
              <MenuItem icon="close" label="Disconnect" danger disabled={busy} onSelect={() => void disconnect()} />
            </MoreMenu>
          </>} />
        <iframe src={readerUrl} title="Kiwix" className="wiki-frame" />
        <Dialog open={changing} onClose={() => setChanging(false)} title="Change the Kiwix address">{form}</Dialog>
      </main>
    );
  }

  return (
    <main className="page">
      <PageHeader title="Wiki" sub="Wikipedia and other reference libraries that work without the internet" />
      {status?.configured && !status.healthy && (
        <div className="notice notice--err" role="alert">Could not reach {status.url}. Check that it is running and the address is correct.</div>
      )}
      {error && <div className="notice notice--err" role="alert">{error}</div>}

      <div className="wk-steps">
        <section className="wk-card">
          <span className="wk-num">1</span>
          <h2>Start the built-in library</h2>
          <p>Run this once on the server. It downloads a starter set (Wikipedia, wikibooks, travel, medicine, water and more) and this page connects by itself.</p>
          <code>{command}</code>
          <div className="st-connect-actions">
            <button type="button" className="btn btn-secondary" onClick={() => { void navigator.clipboard?.writeText(command); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }}><SvgIcon name="copy" size={16} /> {copied ? 'Copied' : 'Copy command'}</button>
            <a className="ui-help" href="https://github.com/VirtuallyTrue12/virtuallyView/blob/main/docs/kiwix.md" target="_blank" rel="noreferrer noopener">Bigger packs</a>
          </div>
        </section>
        <section className="wk-card">
          <span className="wk-num">2</span>
          <h2>Or connect one you already run</h2>
          <p>Kiwix reads ZIM files: full offline copies of Wikipedia, Wiktionary, Project Gutenberg and hundreds more from <a href="https://library.kiwix.org" target="_blank" rel="noreferrer noopener">library.kiwix.org</a>. Only an administrator can change this.</p>
          {form}
        </section>
      </div>
    </main>
  );
}
