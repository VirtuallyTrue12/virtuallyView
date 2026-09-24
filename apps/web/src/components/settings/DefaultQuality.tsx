import { useEffect, useState } from 'react';
import { api, type ServerSettings } from '../../lib/api';

const KINDS = [
  { key: 'movie', label: 'Movies' },
  { key: 'series', label: 'TV shows' },
  { key: 'artist', label: 'Music' }
] as const;

/** Server-wide default quality profile per media type (people can still pick per request). */
export default function DefaultQuality({ settings, onSaved }: { settings: ServerSettings | null; onSaved: (s: ServerSettings) => void }) {
  const [profiles, setProfiles] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    for (const { key } of KINDS) {
      api.qualityProfiles(key)
        .then(r => setProfiles(p => ({ ...p, [key]: r.profiles.map(x => x.name) })))
        .catch(() => setProfiles(p => ({ ...p, [key]: [] })));
    }
  }, []);

  const save = async (kind: string, name: string) => {
    setNote(null);
    try {
      onSaved(await api.saveServerSettings({ defaultQuality: { ...(settings?.defaultQuality ?? { movie: '', series: '', artist: '' }), [kind]: name } as NonNullable<ServerSettings['defaultQuality']> }));
      setNote({ tone: 'ok', text: 'Default quality saved.' });
    } catch (err) {
      setNote({ tone: 'err', text: (err as Error).message });
    }
  };

  return (
    <div className="settings-section" style={{ marginTop: 'var(--spacing-md)' }}>
      <h3 className="section-title">Default download quality</h3>
      <p className="model-suggest-meta">
        What a request uses when nobody picks a quality. Choose an Ultra-HD/4K profile only if your screens and storage can use it;
        each person can still choose per request, and an admin can change a title later.
      </p>
      {KINDS.map(({ key, label }) => (
        <div className="settings-row" key={key} style={{ gap: 12 }}>
          <span style={{ minWidth: 90 }}>{label}</span>
          <select className="settings-input" value={settings?.defaultQuality?.[key] ?? ''} onChange={e => void save(key, e.target.value)} disabled={!profiles[key]?.length} aria-label={`Default quality for ${label}`}>
            <option value="">{key === 'artist' ? 'Standard' : 'HD-1080p'} (built-in default)</option>
            {(profiles[key] ?? []).map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
      ))}
      {note && <div className={`notice notice--${note.tone}`}>{note.text}</div>}
    </div>
  );
}
