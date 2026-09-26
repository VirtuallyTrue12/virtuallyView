import { useEffect, useState } from 'react';
import { api, type ServerSettings, type SettingsChange } from '../../../lib/api';
import { Field } from '../../ui/Page';

const AREA_WORD: Record<string, string> = { General: 'General', Folders: 'Folders', Network: 'Network', Requests: 'Requests', Quality: 'Quality', Backup: 'Backup', People: 'People', System: 'System', Notifications: 'Notifications', Services: 'Services' };

/** The server's own name and behaviour, what version it is, and a trail of what has been changed. */
export default function ServerSection({ settings, onSaved, version }: { settings: ServerSettings | null; onSaved: (s: ServerSettings) => void; version: string }) {
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [changes, setChanges] = useState<SettingsChange[] | null>(null);
  useEffect(() => { if (settings) setName(settings.serverName); }, [settings]);
  useEffect(() => { api.settingsHistory().then(r => setChanges(r.changes)).catch(() => setChanges([])); }, [settings?.updatedAt]);

  const save = async (patch: Partial<ServerSettings>, ok: string) => {
    setMsg(null);
    try { onSaved(await api.saveServerSettings(patch)); setMsg({ tone: 'ok', text: ok }); } catch (err) { setMsg({ tone: 'err', text: (err as Error).message }); }
  };

  return (
    <div className="st-block">
      {msg && <div className={`notice notice--${msg.tone}`} role="status">{msg.text}</div>}
      {settings && (
        <div className="settings-section">
          <Field label="Server name" help="Shown in the browser tab and on other devices.">
            <input className="settings-input" value={name} maxLength={60} onChange={e => setName(e.target.value)} aria-label="Server name" />
            <button className="btn btn-secondary btn-sm" type="button" disabled={!name.trim() || name.trim() === settings.serverName} onClick={() => void save({ serverName: name.trim() }, 'Name saved.')}>Save</button>
          </Field>
          <Field label="Cover art source" help="Where posters come from when your library has none.">
            <select className="settings-input" value={settings.coverSource} onChange={e => void save({ coverSource: e.target.value as ServerSettings['coverSource'] }, 'Cover source saved.')} aria-label="Cover art source">
              <option value="tmdb">TMDB (best quality)</option><option value="wikipedia">Wikipedia</option><option value="duckduckgo">DuckDuckGo images</option>
            </select>
          </Field>
          <Field label="Log detail" help="More detail helps when asking for help; less keeps logs small.">
            <select className="settings-input" value={settings.logLevel} onChange={e => void save({ logLevel: e.target.value as ServerSettings['logLevel'] }, 'Log level saved (applies after a restart).')} aria-label="Log level">
              <option value="error">Only errors</option><option value="warn">Warnings and errors</option><option value="info">Normal</option><option value="debug">Everything</option>
            </select>
          </Field>
        </div>
      )}
      <div className="settings-section">
        <h3 className="section-title">Recent changes</h3>
        <p className="ui-help">Who changed what under Settings. Secrets and passwords are never written here.</p>
        {changes === null && <p className="ui-help">Loading…</p>}
        {changes && changes.length === 0 && <p className="ui-help">Nothing has been changed yet.</p>}
        <ul className="st-history">
          {(changes ?? []).map(c => (
            <li key={c.id}><span className="st-history-area">{AREA_WORD[c.area] ?? c.area}</span><span className="st-history-text">{c.summary}</span><span className="st-history-meta">{c.actor} · {new Date(c.at).toLocaleString()}</span></li>
          ))}
        </ul>
      </div>
      <div className="settings-section">
        <h3 className="section-title">About</h3>
        <p className="ui-help">virtuallyView {version || '…'}. Open source (MIT), self-hosted, no tracking and no cloud account. It sits on top of the media services it sets up for you; trailers come from YouTube and everything else plays from your own files.</p>
        <p className="st-links"><a href="https://github.com/VirtuallyTrue12/virtuallyView" target="_blank" rel="noreferrer">Project on GitHub</a><a href="https://github.com/VirtuallyTrue12/virtuallyView/tree/main/docs" target="_blank" rel="noreferrer">Documentation</a><a href="https://github.com/VirtuallyTrue12/virtuallyView/issues" target="_blank" rel="noreferrer">Report a problem</a></p>
      </div>
    </div>
  );
}
