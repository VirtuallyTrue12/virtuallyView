import { useEffect, useState } from 'react';
import { api, type UnmappedFolder } from '../../lib/api';
import { Dialog } from '../ui/Dialog';
import { SvgIcon } from '../ui/SvgIcon';

type Kind = 'movies' | 'series' | 'artists';
const WORD: Record<Kind, [string, string]> = { movies: ['movie', 'movies'], series: ['show', 'shows'], artists: ['artist', 'artists'] };

/**
 * Files put into the library folders by hand are invisible until each title is added. This finds those folders, guesses the
 * title of each from its name, and adds them with the folder as their home so their files are imported and nothing is downloaded.
 * Shown only to administrators, and only when there is something waiting.
 */
export function ImportExisting({ kind, onImported }: { kind: Kind; onImported: () => void }) {
  const [found, setFound] = useState<UnmappedFolder[]>([]);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Array<{ path: string; success: boolean; message: string }> | null>(null);

  const load = () => {
    api.unmappedFolders(kind).then(r => {
      setFound(r.items);
      setChoice(Object.fromEntries(r.items.map(f => [f.path, f.best?.providerId ?? ''])));
      setSkip(new Set(r.items.filter(f => !f.best).map(f => f.path)));
    }).catch(() => setFound([]));
  };
  useEffect(() => { let alive = true; api.authStatus().then(s => { if (alive && (s.user?.role === 'admin' || !s.enabled)) load(); }).catch(() => undefined); return () => { alive = false; }; }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  if (found.length === 0 && !results) return null;
  const [one, many] = WORD[kind];
  const chosen = found.filter(f => !skip.has(f.path) && choice[f.path]);

  const run = async () => {
    setBusy(true);
    try {
      const items = chosen.map(f => { const c = f.options.find(o => o.providerId === choice[f.path])!; return { path: f.path, providerId: c.providerId, title: c.title, ...(c.year ? { year: c.year } : {}) }; });
      setResults((await api.importFolders(kind, items)).results);
      onImported();
    } catch (err) { setResults([{ path: '', success: false, message: (err as Error).message }]); } finally { setBusy(false); }
  };

  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => { setOpen(true); setResults(null); }}><SvgIcon name="folder" size={17} /> Import {found.length} found</button>
      <Dialog open={open} onClose={() => { setOpen(false); if (results) load(); }} title={`Your existing ${many}`} wide>
        {results ? (
          <div className="ie">
            <ul className="ie-list">{results.map((r, i) => <li key={i} className={r.success ? 'is-ok' : 'is-bad'}><SvgIcon name={r.success ? 'check' : 'alert'} size={16} /><span>{r.message}</span></li>)}</ul>
            <div className="dlg-actions"><button type="button" className="btn btn-primary" onClick={() => { setOpen(false); setResults(null); load(); }}>Done</button></div>
          </div>
        ) : (
          <div className="ie">
            <p className="dlg-help">These folders are in your library folder but are not in the library yet. Check the guess for each, then import: their files are added as they are and nothing is downloaded.</p>
            <ul className="ie-list">
              {found.map(f => (
                <li key={f.path}>
                  <label className="ie-row">
                    <input type="checkbox" checked={!skip.has(f.path) && !!choice[f.path]} disabled={!choice[f.path]} onChange={e => setSkip(prev => { const n = new Set(prev); if (e.target.checked) n.delete(f.path); else n.add(f.path); return n; })} aria-label={`Import ${f.folder}`} />
                    <span className="ie-name"><strong>{f.folder}</strong><em>{f.best ? 'Looks like:' : f.options.length ? 'Pick the right one:' : 'No match found. Rename the folder to the exact title, then check again.'}</em></span>
                    {f.options.length > 0 && (
                      <select className="settings-input" value={choice[f.path] ?? ''} onChange={e => { setChoice(prev => ({ ...prev, [f.path]: e.target.value })); setSkip(prev => { const n = new Set(prev); if (e.target.value) n.delete(f.path); else n.add(f.path); return n; }); }} aria-label={`Match for ${f.folder}`}>
                        {!f.best && <option value="">Not sure: skip</option>}
                        {f.options.map(o => <option key={o.providerId} value={o.providerId}>{o.title}{o.year ? ` (${o.year})` : ''}</option>)}
                      </select>
                    )}
                  </label>
                </li>
              ))}
            </ul>
            <div className="dlg-actions">
              <button type="button" className="btn btn-primary" disabled={busy || chosen.length === 0} onClick={() => void run()}>{busy ? 'Importing…' : `Import ${chosen.length} ${chosen.length === 1 ? one : many}`}</button>
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Not now</button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
