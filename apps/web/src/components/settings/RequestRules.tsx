import { useState } from 'react';
import { api, type ServerSettings } from '../../lib/api';

/** Who can request what: optional approval by an administrator and a per-person limit. */
export default function RequestRules({ settings, onSaved }: { settings: ServerSettings | null; onSaved: (s: ServerSettings) => void }) {
  const rules = settings?.requests ?? { approval: 'off' as const, limit: 0, window: 'week' as const };
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const save = async (patch: Partial<typeof rules>) => {
    setNote(null);
    try { onSaved(await api.saveServerSettings({ requests: { ...rules, ...patch } })); setNote({ tone: 'ok', text: 'Saved.' }); }
    catch (e) { setNote({ tone: 'err', text: (e as Error).message }); }
  };

  return (
    <div className="settings-section" style={{ marginTop: 'var(--spacing-md)' }}>
      <h3 className="section-title">Requests from other people</h3>
      <p className="model-suggest-meta">Administrators are never limited. These rules apply to regular accounts.</p>
      <label className="settings-row" style={{ gap: 8 }}>
        <input type="checkbox" checked={rules.approval === 'users'} onChange={e => void save({ approval: e.target.checked ? 'users' : 'off' })} aria-label="Require approval" />
        <span>An administrator must approve a request before anything is downloaded</span>
      </label>
      <div className="settings-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span>Limit each person to</span>
        <input className="settings-input" type="number" min={0} max={1000} style={{ width: 90 }} value={rules.limit} onChange={e => void save({ limit: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} aria-label="Requests allowed per period" />
        <span>requests per</span>
        <select className="settings-input" value={rules.window} onChange={e => void save({ window: e.target.value as 'day' | 'week' })} aria-label="Limit period">
          <option value="day">day</option>
          <option value="week">week</option>
        </select>
        <span className="model-suggest-meta">(0 means no limit)</span>
      </div>
      {note && <div className={`notice notice--${note.tone}`}>{note.text}</div>}
    </div>
  );
}
