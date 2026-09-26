import { useCallback, useEffect, useState } from 'react';
import { api, type IntegrationStatus } from '../../../lib/api';
import { humanName, secretHint, secretLabel, secretPlaceholder } from '../../../lib/integration-names';
import { Pill, Switch } from '../../ui/Page';
import { SvgIcon } from '../../ui/SvgIcon';

const CONNECTABLE = new Set(['radarr', 'sonarr', 'prowlarr', 'lidarr', 'bazarr', 'qbittorrent', 'nzbget']);
const ROLE: Record<string, string> = {
  radarr: 'Keeps your movies', sonarr: 'Keeps your TV shows', lidarr: 'Keeps your music', prowlarr: 'Finds downloads', bazarr: 'Fetches subtitles', qbittorrent: 'Downloads torrents', nzbget: 'Downloads from Usenet'
};

type Msg = { tone: 'ok' | 'err'; text: string };

export default function ServicesSection() {
  const [items, setItems] = useState<IntegrationStatus[]>([]);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, { url: string; apiKey: string }>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Record<string, Msg>>({});
  const [note, setNote] = useState<Msg | null>(null);
  const [detecting, setDetecting] = useState(false);

  const load = useCallback(() => {
    api.integrations().then(list => {
      setItems(list.filter(i => CONNECTABLE.has(i.adapter)));
      api.serviceConfig().then(config => {
        setSaved(Object.fromEntries(Object.entries(config).map(([k, v]) => [k, Boolean(v.hasCredentials)])));
        setDrafts(prev => ({ ...Object.fromEntries(list.map(i => [i.adapter, { url: config[i.adapter]?.url || i.url || '', apiKey: '' }])), ...prev }));
      }).catch(() => setDrafts(prev => ({ ...Object.fromEntries(list.map(i => [i.adapter, { url: i.url || '', apiKey: '' }])), ...prev })));
    }).catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);

  const draft = (i: IntegrationStatus) => drafts[i.adapter] ?? { url: i.url || '', apiKey: '' };
  const patch = (i: IntegrationStatus, p: Partial<{ url: string; apiKey: string }>) => setDrafts(prev => ({ ...prev, [i.adapter]: { ...draft(i), ...p } }));
  const status = (i: IntegrationStatus): { tone: 'ok' | 'warn' | 'bad' | 'neutral'; text: string } => {
    if (!i.enabled) return { tone: 'neutral', text: 'Off' };
    if (i.setupRequired) return { tone: 'warn', text: 'Needs connecting' };
    if (i.healthStatus === 'online') return { tone: 'ok', text: 'Running' };
    return { tone: 'bad', text: 'Not answering' };
  };

  const toggle = async (i: IntegrationStatus) => {
    setBusy(i.adapter);
    try { const updated = await api.toggleIntegration(i.adapter); setItems(prev => prev.map(x => x.adapter === i.adapter ? updated : x)); } catch { load(); } finally { setBusy(null); }
  };

  const connect = async (i: IntegrationStatus) => {
    const d = draft(i);
    if (!d.url.trim() || (!d.apiKey.trim() && !saved[i.adapter])) { setMsgs(m => ({ ...m, [i.adapter]: { tone: 'err', text: 'Enter the service address and its key to connect.' } })); return; }
    setBusy(i.adapter);
    try {
      const updated = await api.saveIntegrationConfig(i.adapter, { url: d.url.trim(), apiKey: d.apiKey.trim() });
      setItems(prev => prev.map(x => x.adapter === i.adapter ? { ...updated } : x));
      setMsgs(m => ({ ...m, [i.adapter]: { tone: 'ok', text: `Connected. ${humanName(i.adapter)} is live.` } }));
      patch(i, { apiKey: '' });
      load();
    } catch (err) { setMsgs(m => ({ ...m, [i.adapter]: { tone: 'err', text: (err as Error).message } })); } finally { setBusy(null); }
  };

  const startStop = async (i: IntegrationStatus) => {
    const running = i.healthStatus === 'online';
    setNote({ tone: 'ok', text: `${running ? 'Stopping' : 'Starting'} ${humanName(i.adapter)}…` });
    try { await (running ? api.stopService(i.adapter) : api.startService(i.adapter)); setTimeout(load, 2000); } catch (err) { setNote({ tone: 'err', text: (err as Error).message || 'That did not work.' }); }
  };

  const find = async () => {
    setDetecting(true);
    try {
      const found = (await api.integrationsDetect()).filter(r => r.reachable);
      for (const r of found) setDrafts(prev => ({ ...prev, [r.adapter]: { url: r.url, apiKey: prev[r.adapter]?.apiKey ?? '' } }));
      setNote({ tone: 'ok', text: found.length ? `Found ${found.length} service${found.length === 1 ? '' : 's'} on this computer and filled in the addresses. Open one and press Connect.` : 'Nothing found on the usual addresses. Enter the address of each service you run.' });
    } catch { setNote({ tone: 'err', text: 'Could not search for services. Try again in a moment.' }); } finally { setDetecting(false); }
  };

  const online = items.filter(i => i.healthStatus === 'online').length;
  return (
    <div className="st-block">
      <div className="st-toolbar">
        <span className="st-count">{items.length ? `${online} of ${items.length} running` : 'No services reported yet'}</span>
        <div className="st-tools">
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => void find()} disabled={detecting}><SvgIcon name="search" size={15} /> {detecting ? 'Searching…' : 'Find on this computer'}</button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={async () => { try { const r = await api.checkUpdate(); setNote({ tone: 'ok', text: r.available ? `Update available: ${r.latestVersion} (you have ${r.currentVersion}).` : (r.message ?? 'You are on the latest version.') }); } catch (err) { setNote({ tone: 'err', text: (err as Error).message || 'Could not check for updates.' }); } }}><SvgIcon name="refresh" size={15} /> Check for updates</button>
          <button className="btn btn-primary btn-sm" type="button" onClick={async () => { try { const r = await api.launchServices(); setNote({ tone: r.launched ? 'ok' : 'err', text: r.message }); } catch (err) { setNote({ tone: 'err', text: (err as Error).message || 'Failed to launch services.' }); } }}><SvgIcon name="play" size={15} /> Start all</button>
        </div>
      </div>
      {note && <div className={`notice notice--${note.tone}`} role="status">{note.text}</div>}
      <ul className="st-list">
        {items.map(i => {
          const st = status(i);
          const canConfigure = CONNECTABLE.has(i.adapter);
          const isOpen = open === i.adapter;
          const d = draft(i);
          const m = msgs[i.adapter];
          return (
            <li className="st-row" key={i.adapter}>
              <div className="st-row-main">
                <span className={`st-dot st-dot--${st.tone}`} aria-hidden="true" />
                <div className="st-row-text">
                  <strong>{humanName(i.adapter)}</strong>
                  <span>{i.name.replace(/ \(.*$/, '')} · {ROLE[i.adapter] ?? ''}</span>
                </div>
                <Pill tone={st.tone}>{st.text}</Pill>
                <div className="st-row-actions">
                  {canConfigure && <button className="btn btn-secondary btn-sm" type="button" onClick={() => void startStop(i)}>{i.healthStatus === 'online' ? 'Stop' : 'Start'}</button>}
                  {canConfigure && <Switch checked={i.enabled} onChange={() => void toggle(i)} label={`Turn ${humanName(i.adapter)} on or off`} disabled={busy === i.adapter} />}
                  {canConfigure && <button className="btn btn-secondary btn-sm" type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i.adapter)}>{isOpen ? 'Hide' : 'Connection'}</button>}
                </div>
              </div>
              {isOpen && (
                <form className="st-connect" onSubmit={e => { e.preventDefault(); void connect(i); }}>
                  <label>Address<input className="settings-input" type="text" placeholder={i.url || 'http://localhost:7878'} value={d.url} onChange={e => patch(i, { url: e.target.value })} aria-label={`${i.name} URL`} /></label>
                  <label>{secretLabel(i.adapter)}<input className="settings-input" type="password" placeholder={secretPlaceholder(i.adapter, Boolean(saved[i.adapter]))} value={d.apiKey} onChange={e => patch(i, { apiKey: e.target.value })} aria-label={`${humanName(i.adapter)} ${secretLabel(i.adapter).toLowerCase()}`} /></label>
                  <p className="ui-help">{secretHint(i.adapter)}</p>
                  <div className="st-connect-actions">
                    <button type="submit" className="btn btn-primary btn-sm" disabled={busy === i.adapter}>{busy === i.adapter ? 'Connecting…' : 'Connect'}</button>
                    {m && <span className={`st-msg st-msg--${m.tone}`}>{m.text}</span>}
                  </div>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
