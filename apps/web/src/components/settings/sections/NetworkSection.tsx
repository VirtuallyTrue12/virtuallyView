import { useEffect, useState } from 'react';
import { api, type ServerSettings } from '../../../lib/api';
import ConnectDevices from '../ConnectDevices';
import { Field, Switch } from '../../ui/Page';

/** How other devices reach this server, and how it reaches the internet. */
export default function NetworkSection({ settings, onSaved }: { settings: ServerSettings | null; onSaved: (s: ServerSettings) => void }) {
  const [draft, setDraft] = useState<{ enabled: boolean; kind: 'tor' | 'socks5' | 'http'; host: string; port: string } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    if (settings && !draft) setDraft({ enabled: settings.outboundProxy.enabled, kind: settings.outboundProxy.kind, host: settings.outboundProxy.host, port: String(settings.outboundProxy.port) });
  }, [settings, draft]);

  const save = async () => {
    if (!draft) return;
    if (!draft.host.trim()) { setMsg({ tone: 'err', text: 'Enter the proxy host address.' }); return; }
    const port = Number(draft.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) { setMsg({ tone: 'err', text: 'The port must be a whole number from 1 to 65535.' }); return; }
    setMsg(null);
    try {
      onSaved(await api.saveServerSettings({ outboundProxy: { enabled: draft.enabled, kind: draft.kind, host: draft.host.trim(), port } }));
      setMsg({ tone: 'ok', text: `Outbound proxy ${draft.enabled ? 'on: Wikipedia, MusicBrainz and cover lookups go through it' : 'off: those lookups go direct'}.` });
    } catch (err) { setMsg({ tone: 'err', text: (err as Error).message ?? 'Could not save the proxy settings.' }); }
  };
  const test = async () => {
    setTesting(true); setMsg(null);
    try { const r = await api.testOutboundProxy(); setMsg({ tone: r.ok ? 'ok' : 'err', text: r.ok ? `${r.detail} (${r.latencyMs} ms)` : r.detail }); } catch (err) { setMsg({ tone: 'err', text: `Proxy test failed: ${(err as Error).message}` }); } finally { setTesting(false); }
  };

  return (
    <div className="st-block">
      <ConnectDevices settings={settings} onSaved={onSaved} />
      <div className="settings-section">
        <h3 className="section-title">Outbound proxy</h3>
        <p className="ui-help">Sends the server's public internet lookups (Wikipedia, MusicBrainz, cover art) through Tor, SOCKS5 or HTTP. Your own media services never go through it. For the bundled Tor proxy use host <code>tor</code>, port 9050.</p>
        {draft && (
          <>
            <Field label="Use a proxy" help="Off means the server connects directly."><Switch checked={draft.enabled} onChange={v => setDraft({ ...draft, enabled: v })} label="Use an outbound proxy" /></Field>
            <Field label="Kind">
              <select className="settings-input" value={draft.kind} aria-label="Proxy kind" onChange={e => { const kind = e.target.value as 'tor' | 'socks5' | 'http'; setDraft({ ...draft, kind, ...(kind === 'tor' && !draft.host && !draft.port ? { host: 'tor', port: '9050' } : {}) }); }}>
                <option value="tor">Tor (bundled: host "tor", port 9050)</option><option value="socks5">SOCKS5</option><option value="http">HTTP</option>
              </select>
            </Field>
            <Field label="Host"><input className="settings-input" value={draft.host} onChange={e => setDraft({ ...draft, host: e.target.value })} aria-label="Proxy host" /></Field>
            <Field label="Port"><input className="settings-input" type="number" value={draft.port} onChange={e => setDraft({ ...draft, port: e.target.value })} aria-label="Proxy port" /></Field>
            <div className="st-connect-actions">
              <button className="btn btn-primary btn-sm" type="button" onClick={() => void save()}>Save proxy</button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => void test()} disabled={testing}>{testing ? 'Testing…' : 'Test connection'}</button>
            </div>
          </>
        )}
        {msg && <div className={`notice notice--${msg.tone}`} role="status">{msg.text}</div>}
      </div>
    </div>
  );
}
