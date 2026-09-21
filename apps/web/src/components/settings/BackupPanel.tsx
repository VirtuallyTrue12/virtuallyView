import { useEffect, useRef, useState } from 'react';
import { api, type BackupInfo, type ServerSettings } from '../../lib/api';

const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Accounts, watch history, requests, settings and themes in one file you can keep anywhere. */
export default function BackupPanel({ settings, onSaved }: { settings: ServerSettings | null; onSaved: (s: ServerSettings) => void }) {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ name?: string; file?: File } | null>(null);
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => api.backups().then(r => setBackups(r.backups)).catch(() => {});
  useEffect(() => { void load(); }, []);

  const create = async () => {
    setBusy('create'); setNote(null);
    try { const r = await api.createBackup(); setBackups(r.backups); setNote({ tone: 'ok', text: `Created ${r.backup.name}.` }); }
    catch (e) { setNote({ tone: 'err', text: (e as Error).message }); }
    finally { setBusy(null); }
  };

  const restore = async () => {
    if (!confirm) return;
    setBusy('restore'); setNote(null);
    try {
      const r = confirm.file ? await api.uploadRestore(confirm.file) : await api.restoreBackup(confirm.name!);
      setNote({ tone: 'ok', text: r.message });
      setTimeout(() => window.location.assign('/'), 6000);
    } catch (e) { setNote({ tone: 'err', text: (e as Error).message }); setBusy(null); }
  };

  const toggleAuto = async (on: boolean) => {
    try { onSaved(await api.saveServerSettings({ autoBackup: on })); } catch (e) { setNote({ tone: 'err', text: (e as Error).message }); }
  };

  return (
    <section className="settings-section">
      <h3 className="section-title">Backup and restore</h3>
      <p className="model-suggest-meta">
        A backup holds accounts, watch history, My Lists, requests, settings and custom themes. It does not hold your media, and sessions are left out, so everyone signs in again after a restore.
        Keep a copy somewhere other than this machine.
      </p>
      <label className="settings-row" style={{ gap: 8 }}>
        <input type="checkbox" checked={settings?.autoBackup !== false} onChange={e => void toggleAuto(e.target.checked)} aria-label="Back up automatically" />
        <span>Back up automatically every day (keeps the last 7)</span>
      </label>
      <div className="settings-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" type="button" onClick={() => void create()} disabled={busy === 'create'}>{busy === 'create' ? 'Creating...' : 'Back up now'}</button>
        <input ref={fileRef} type="file" accept=".gz,.tar.gz,application/gzip" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setConfirm({ file: f }); setTyped(''); } }} />
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => fileRef.current?.click()}>Restore from a file</button>
      </div>
      {note && <div className={`notice notice--${note.tone}`} role="status">{note.text}</div>}

      {confirm && (
        <div className="notice notice--err" role="alert">
          <p style={{ margin: '0 0 8px' }}>Restoring replaces the current accounts, history and settings with {confirm.file ? `"${confirm.file.name}"` : `"${confirm.name}"`}. A safety backup of the current data is made first, then the server restarts.</p>
          <div className="settings-row" style={{ gap: 8 }}>
            <input className="settings-input" placeholder='Type "restore" to continue' value={typed} onChange={e => setTyped(e.target.value)} aria-label="Type restore to confirm" />
            <button className="btn btn-danger btn-sm" type="button" disabled={typed.trim().toLowerCase() !== 'restore' || busy === 'restore'} onClick={() => void restore()}>{busy === 'restore' ? 'Restoring...' : 'Restore'}</button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </div>
      )}

      <ul className="users-list">
        {backups.map(b => (
          <li className="users-row" key={b.name}>
            <span className="users-name">{b.name}<small style={{ display: 'block', opacity: 0.7 }}>{new Date(b.createdAt).toLocaleString()}, {size(b.size)}{b.kind === 'auto' ? ', automatic' : b.kind === 'pre-restore' ? ', safety copy' : ''}</small></span>
            <span className="users-actions">
              <a className="btn btn-secondary btn-sm" href={`/api/backup/${encodeURIComponent(b.name)}`} download>Download</a>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setConfirm({ name: b.name }); setTyped(''); }}>Restore</button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => void api.deleteBackup(b.name).then(r => setBackups(r.backups))}>Delete</button>
            </span>
          </li>
        ))}
        {backups.length === 0 && <li className="users-row"><span className="users-name">No backups yet.</span></li>}
      </ul>
    </section>
  );
}
