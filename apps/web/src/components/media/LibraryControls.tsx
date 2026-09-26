import { useEffect, useMemo, useState } from 'react';
import type { MediaItem } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';
import { Dialog } from '../ui/Dialog';

export type SortKey = 'title' | 'added' | 'year' | 'rating' | 'runtime';
export type StateFilter = 'all' | 'available' | 'missing' | 'unwatched' | 'progress' | 'watched' | 'favorites';

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'title', label: 'Title A-Z' },
  { key: 'added', label: 'Recently added' },
  { key: 'year', label: 'Year (newest)' },
  { key: 'rating', label: 'Rating' },
  { key: 'runtime', label: 'Runtime' }
];
const STATES: Array<{ key: StateFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'available', label: 'Available' },
  { key: 'missing', label: 'Not downloaded' },
  { key: 'unwatched', label: 'Unwatched' },
  { key: 'progress', label: 'In progress' },
  { key: 'watched', label: 'Watched' },
  { key: 'favorites', label: 'My List' }
];
const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

interface View { query: string; sort: SortKey; state: StateFilter; genre: string; letter: string; studio: string; collection: string }
const DEFAULT: View = { query: '', sort: 'title', state: 'all', genre: '', letter: '', studio: '', collection: '' };

const stored = (key: string): View => {
  // Studio and collection links from a title page arrive as ?studio= and ?collection=.
  const params = new URLSearchParams(window.location.search);
  const linked = { studio: params.get('studio') ?? '', collection: params.get('collection') ?? '' };
  try { return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(`vv-lib-${key}`) ?? '{}') as Partial<View>), query: '', letter: '', ...linked }; } catch { return { ...DEFAULT, ...linked }; }
};

const firstLetter = (title: string) => {
  const c = title.replace(/^(the|a|an)\s+/i, '').trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
};

/** Sorting, filtering and jump-to-letter shared by Movies, TV and Music. */
export function useLibraryView(items: MediaItem[], key: string) {
  const [view, setView] = useState<View>(() => stored(key));
  useEffect(() => {
    try { localStorage.setItem(`vv-lib-${key}`, JSON.stringify({ sort: view.sort, state: view.state, genre: view.genre })); } catch { /* storage blocked */ }
  }, [key, view.sort, view.state, view.genre]);

  const genres = useMemo(() => [...new Set(items.flatMap(i => i.genres ?? []))].sort((a, b) => a.localeCompare(b)), [items]);
  const studios = useMemo(() => [...new Set(items.map(i => i.studio).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b)), [items]);
  const collections = useMemo(() => [...new Set(items.map(i => i.collection).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b)), [items]);
  const letters = useMemo(() => new Set(items.map(i => firstLetter(i.title))), [items]);

  const shown = useMemo(() => {
    const q = view.query.trim().toLowerCase();
    const list = items.filter(i => {
      if (q && !`${i.title} ${i.year ?? ''}`.toLowerCase().includes(q)) return false;
      if (view.genre && !(i.genres ?? []).includes(view.genre)) return false;
      if (view.studio && i.studio !== view.studio) return false;
      if (view.collection && i.collection !== view.collection) return false;
      if (view.letter && firstLetter(i.title) !== view.letter) return false;
      const pct = i.watchProgress ?? 0;
      switch (view.state) {
        case 'available': return i.status === 'available';
        case 'missing': return i.status !== 'available';
        case 'unwatched': return i.status === 'available' && !i.watched && pct < 1;
        case 'progress': return pct >= 1 && pct < 96;
        case 'watched': return i.watched === true;
        case 'favorites': return i.favorite === true;
        default: return true;
      }
    });
    const by: Record<SortKey, (a: MediaItem, b: MediaItem) => number> = {
      title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }),
      added: (a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
      year: (a, b) => (b.year ?? 0) - (a.year ?? 0),
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
      runtime: (a, b) => (b.runtime ?? 0) - (a.runtime ?? 0)
    };
    return [...list].sort((a, b) => by[view.sort](a, b) || a.title.localeCompare(b.title));
  }, [items, view]);

  return { view, setView, shown, genres, letters, studios, collections };
}

const QUICK: StateFilter[] = ['all', 'available', 'missing', 'favorites'];

export function LibraryControls({ view, setView, genres, letters, total, shown, onSurprise, showRuntime = true, studios = [], collections = [], studioLabel = 'Studio' }: {
  view: View;
  setView: (updater: (prev: View) => View) => void;
  genres: string[];
  studios?: string[];
  collections?: string[];
  letters: Set<string>;
  total: number;
  shown: number;
  onSurprise?: () => void;
  showRuntime?: boolean;
  studioLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const patch = (p: Partial<View>) => setView(prev => ({ ...prev, ...p }));
  const clear = () => patch({ query: '', state: 'all', genre: '', letter: '', studio: '', collection: '' });
  // What the Filters dialog holds (the search box and quick chips are always visible).
  const inDialog = (view.genre ? 1 : 0) + (view.letter ? 1 : 0) + (view.studio ? 1 : 0) + (view.collection ? 1 : 0) + (QUICK.includes(view.state) ? 0 : 1);
  const filtered = view.query !== '' || view.state !== 'all' || inDialog > 0;
  return (
    <div className="lib-controls">
      <div className="lib-row">
        <input className="settings-input lib-search" type="search" placeholder="Filter this library…" value={view.query} onChange={e => patch({ query: e.target.value })} aria-label="Filter this library" />
        <select className="settings-input" value={view.sort} onChange={e => patch({ sort: e.target.value as SortKey })} aria-label="Sort by">
          {SORTS.filter(s => showRuntime || s.key !== 'runtime').map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <button className="btn btn-secondary btn-sm lib-filter-btn" type="button" onClick={() => setOpen(true)}>
          <SvgIcon name="sliders-h" size={16} /> Filters{inDialog > 0 && <span className="ui-badge">{inDialog}</span>}
        </button>
      </div>
      <div className="lib-chips">
        <div className="requests-filters" role="tablist" aria-label="Show">
          {STATES.filter(s => QUICK.includes(s.key) || s.key === view.state).map(s => (
            <button key={s.key} type="button" role="tab" aria-selected={view.state === s.key} className={`season-tab${view.state === s.key ? ' is-active' : ''}`} onClick={() => patch({ state: s.key })}>{s.label}</button>
          ))}
        </div>
        <span className="page-count">{shown === total ? `${total} titles` : `${shown} of ${total} titles`}</span>
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="Filters">
        <div className="lib-dialog">
          <label className="lib-dialog-field"><span>Watch status</span>
            <select className="settings-input" value={view.state} onChange={e => patch({ state: e.target.value as StateFilter })}>
              {STATES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          {genres.length > 0 && (
            <label className="lib-dialog-field"><span>Genre</span>
              <select className="settings-input" value={view.genre} onChange={e => patch({ genre: e.target.value })} aria-label="Genre">
                <option value="">All genres</option>{genres.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
          )}
          {collections.length > 0 && (
            <label className="lib-dialog-field"><span>Collection</span>
              <select className="settings-input" value={view.collection} onChange={e => patch({ collection: e.target.value })} aria-label="Collection">
                <option value="">All collections</option>{collections.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
          {studios.length > 0 && (
            <label className="lib-dialog-field"><span>{studioLabel}</span>
              <select className="settings-input" value={view.studio} onChange={e => patch({ studio: e.target.value })} aria-label={studioLabel}>
                <option value="">{`All ${studioLabel.toLowerCase()}s`}</option>{studios.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
          <div className="lib-dialog-field"><span>Jump to letter</span>
            <div className="lib-letters" aria-label="Jump to letter">
              {LETTERS.map(l => (
                <button key={l} type="button" disabled={!letters.has(l)} className={`lib-letter${view.letter === l ? ' is-active' : ''}`} onClick={() => patch({ letter: view.letter === l ? '' : l })}>{l}</button>
              ))}
            </div>
          </div>
          <div className="dlg-actions">
            <button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>Show {shown} {shown === 1 ? 'title' : 'titles'}</button>
            {onSurprise && <button className="btn btn-secondary" type="button" onClick={() => { setOpen(false); onSurprise(); }} disabled={shown === 0}><SvgIcon name="dice" size={16} /> Surprise me</button>}
            {filtered && <button className="btn btn-secondary" type="button" onClick={clear}>Clear filters</button>}
          </div>
        </div>
      </Dialog>
    </div>
  );
}
