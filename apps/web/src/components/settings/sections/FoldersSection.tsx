import { useEffect, useState } from 'react';
import { api, type ServerSettings } from '../../../lib/api';

type Roots = ServerSettings['mediaRoots'];
const LABEL: Record<keyof Roots, string> = { movies: 'Movies', tv: 'TV shows', music: 'Music', staging: 'Downloads (staging)' };
const PHRASE: Record<keyof Roots, string> = { movies: 'change movie folder', tv: 'change tv folder', music: 'change music folder', staging: 'change staging folder' };

/** Where the library lives on disk. A change redirects everything, so it asks for a typed phrase. */
export default function FoldersSection({ settings, onSaved }: { settings: ServerSettings | null; onSaved: (s: ServerSettings) => void }) {
  const [draft, setDraft] = useState<Roots | null>(null);
  const [phrase, setPhrase] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (settings && !draft) setDraft({ ...settings.mediaRoots }); }, [settings, draft]);

  if (!settings || !draft) return <div className="loading-state">Loading current folders...</div>;
  const changed = (Object.keys(draft) as Array<keyof Roots>).filter(k => (draft[k] ?? '').trim() !== (settings.mediaRoots[k] ?? '').trim());

  const save = async () => {
    if (changed.length !== 1) { setMsg({ tone: 'err', text: changed.length === 0 ? 'Nothing changed.' : 'Save one folder at a time; each change needs its own confirmation phrase.' }); return; }
    const key = changed[0]!;
    if (phrase.trim().toLowerCase() !== PHRASE[key]) { setMsg({ tone: 'err', text: `Type the exact phrase "${PHRASE[key]}" to confirm.` }); return; }
    setSaving(true); setMsg(null);
    try {
      const updated = await api.saveServerSettings({ mediaRoots: { [key]: draft[key].trim() } as Roots, confirm: phrase });
      onSaved(updated); setDraft({ ...updated.mediaRoots }); setPhrase('');
      setMsg({ tone: 'ok', text: 'Folder updated. New files are read from the new place.' });
    } catch (err) { setMsg({ tone: 'err', text: (err as Error).message ?? 'Could not save the folder.' }); } finally { setSaving(false); }
  };

  return (
    <div className="st-block">
      <p className="ui-help">Where your files live on this machine. Everything you watch or listen to is read from these folders, so changing one redirects that whole part of the library.</p>
      {(Object.keys(LABEL) as Array<keyof Roots>).map(key => (
        <div className="ui-field" key={key}>
          <div className="ui-field-text"><label htmlFor={`root-${key}`}>{LABEL[key]}</label></div>
          <div className="ui-field-control">
            <input id={`root-${key}`} className="settings-input" type="text" value={draft[key]} aria-label={`${key} folder`} onChange={e => { setDraft(prev => prev ? { ...prev, [key]: e.target.value } : prev); setPhrase(''); }} />
          </div>
        </div>
      ))}
      {changed.length === 1 && (
        <div className="notice notice--err" role="alert">
          This is a breaking change to where your library is stored. Type <strong>{PHRASE[changed[0]!]}</strong> to confirm.
          <input className="settings-input" style={{ marginTop: 8 }} value={phrase} onChange={e => setPhrase(e.target.value)} placeholder={`type: ${PHRASE[changed[0]!]}`} aria-label="Confirmation phrase" />
        </div>
      )}
      {changed.length > 1 && <div className="notice notice--err" role="alert">Save one folder at a time; each change needs its own confirmation phrase.</div>}
      {msg && <div className={`notice notice--${msg.tone}`} role="status">{msg.text}</div>}
      <button className="btn btn-primary" type="button" onClick={() => void save()} disabled={saving || changed.length === 0}>{saving ? 'Saving…' : 'Save folder'}</button>
    </div>
  );
}
