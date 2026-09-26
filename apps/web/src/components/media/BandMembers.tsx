import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { CastRow, type Person } from './CastRow';
import { SvgIcon } from '../ui/SvgIcon';

type View = 'all' | 'current' | 'former';

function load(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function save(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* private mode: the choice lasts until reload */ } }

/**
 * Band members, the way each person likes them: only current members, only
 * former ones, or everyone; and individual people can be hidden just for you.
 * Administrators can also correct the list for everybody (current or former,
 * take someone off, add someone missing).
 */
export function BandMembers({ artistId, people, removed, isAdmin, loading, onChanged }: {
  artistId: string; people: Person[]; removed: string[]; isAdmin: boolean; loading: boolean; onChanged: () => void;
}) {
  const [view, setView] = useState<View>(() => (['all', 'current', 'former'].includes(load('vv-band-view') ?? '') ? load('vv-band-view') as View : 'all'));
  const [hidden, setHidden] = useState<string[]>(() => { try { return JSON.parse(load(`vv-band-hidden-${artistId}`) ?? '[]') as string[]; } catch { return []; } });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState({ name: '', role: '', current: true });

  useEffect(() => { try { setHidden(JSON.parse(load(`vv-band-hidden-${artistId}`) ?? '[]') as string[]); } catch { setHidden([]); } setEditing(false); }, [artistId]);

  const chooseView = (v: View) => { setView(v); save('vv-band-view', v); };
  const toggleHidden = (name: string) => {
    const next = hidden.includes(name) ? hidden.filter(n => n !== name) : [...hidden, name];
    setHidden(next); save(`vv-band-hidden-${artistId}`, JSON.stringify(next));
  };

  const counts = useMemo(() => ({ all: people.length, current: people.filter(p => p.current !== false).length, former: people.filter(p => p.current === false).length }), [people]);
  const shown = useMemo(() => people
    .filter(p => view === 'all' || (view === 'current' ? p.current !== false : p.current === false))
    .filter(p => editing || !hidden.includes(p.name))
    .map(p => ({ ...p, dim: hidden.includes(p.name) })), [people, view, hidden, editing]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); onChanged(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not save that.'); } finally { setBusy(false); }
  };

  const tabs: Array<[View, string]> = [['all', 'Everyone'], ['current', 'Current'], ['former', 'Former']];
  const toolbar = (
    <>
      <div className="seg" role="radiogroup" aria-label="Which members to show">
        {tabs.map(([v, label]) => (
          <button key={v} type="button" role="radio" aria-checked={view === v} className={`seg-btn${view === v ? ' is-on' : ''}`} onClick={() => chooseView(v)}>
            {label} <span className="seg-count">{counts[v]}</span>
          </button>
        ))}
      </div>
      <button type="button" className={`mp-link band-edit${editing ? ' is-on' : ''}`} onClick={() => setEditing(v => !v)} aria-pressed={editing}>
        <SvgIcon name="edit" size={14} /> {editing ? 'Done' : 'Edit'}
      </button>
    </>
  );

  const extra = editing ? (p: Person) => (
    <div className="person-tools">
      <button type="button" className="person-tool" onClick={() => toggleHidden(p.name)} title={hidden.includes(p.name) ? 'Show for me again' : 'Hide for me'} aria-label={`${hidden.includes(p.name) ? 'Show' : 'Hide'} ${p.name} for me`}>
        <SvgIcon name={hidden.includes(p.name) ? 'eye' : 'eye-off'} size={15} />
      </button>
      {isAdmin && (
        <>
          <button type="button" className="person-tool person-tool--text" disabled={busy} onClick={() => void run(() => api.editMember(artistId, { name: p.name, action: 'set', current: p.current === false }))} title="Change for everyone">
            {p.current === false ? 'Current' : 'Former'}
          </button>
          <button type="button" className="person-tool" disabled={busy} onClick={() => void run(() => api.editMember(artistId, { name: p.name, action: 'remove' }))} title="Remove for everyone" aria-label={`Remove ${p.name} for everyone`}>
            <SvgIcon name="close" size={14} />
          </button>
        </>
      )}
    </div>
  ) : undefined;

  return (
    <>
      <CastRow title="Band members" people={shown} loading={loading} toolbar={toolbar} cardExtra={extra}
        empty={people.length > 0 ? 'No one matches this view.' : undefined} />
      {shown.length === 0 && people.length > 0 && !loading && null}
      {editing && (
        <div className="band-edit-panel">
          <p className="dlg-help">Hiding someone only hides them for you.{isAdmin ? ' Changes marked "for everyone" are seen by all.' : ''}</p>
          {hidden.length > 0 && <button type="button" className="mp-link" onClick={() => { setHidden([]); save(`vv-band-hidden-${artistId}`, '[]'); }}>Show everyone I hid again</button>}
          {isAdmin && removed.length > 0 && (
            <p className="dlg-help">Removed for everyone: {removed.map(n => <button key={n} type="button" className="mp-link" disabled={busy} onClick={() => void run(() => api.undoMemberEdit(artistId, n))}>{n} (restore)</button>)}</p>
          )}
          {isAdmin && (
            <form className="band-add" onSubmit={e => { e.preventDefault(); if (adding.name.trim()) void run(async () => { await api.editMember(artistId, { name: adding.name.trim(), action: 'add', role: adding.role.trim() || 'Member', current: adding.current }); setAdding({ name: '', role: '', current: true }); }); }}>
              <input className="settings-input" placeholder="Add a member: name" aria-label="New member name" maxLength={100} value={adding.name} onChange={e => setAdding(a => ({ ...a, name: e.target.value }))} />
              <input className="settings-input" placeholder="Role (vocals, drums…)" aria-label="New member role" maxLength={80} value={adding.role} onChange={e => setAdding(a => ({ ...a, role: e.target.value }))} />
              <label className="band-add-check"><input type="checkbox" checked={adding.current} onChange={e => setAdding(a => ({ ...a, current: e.target.checked }))} /> Current</label>
              <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !adding.name.trim()}>Add</button>
            </form>
          )}
          {error && <div className="notice notice--err" role="alert">{error}</div>}
        </div>
      )}
    </>
  );
}
