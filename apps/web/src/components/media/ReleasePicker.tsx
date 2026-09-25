import { useState } from 'react';
import { api, type ReleaseChoice } from '../../lib/api';
import { YoutubeFinder } from './YoutubeFinder';

const size = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);
const age = (days: number) => (days < 1 ? 'today' : days < 60 ? `${Math.round(days)} d` : days < 730 ? `${Math.round(days / 30)} mo` : `${Math.round(days / 365)} y`);

/**
 * Pick a download by hand. For when the automatic search finds nothing, which
 * is common for concerts and unusual titles: search with your own words, see
 * everything the sources have, start the one you want. Administrators only.
 */
export function ReleasePicker({ initialQuery }: { initialQuery: string }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<'torrents' | 'youtube'>('torrents');
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<ReleaseChoice[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [fileAs, setFileAs] = useState<'auto' | 'concert' | 'video' | 'none'>('auto');
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  const search = async () => {
    if (query.trim().length < 2 || searching) return;
    setSearching(true); setNote(null);
    try { setResults((await api.searchReleases(query.trim())).releases); } catch (err) {
      setResults(null); setNote({ text: err instanceof Error ? err.message : 'Search failed.', ok: false });
    } finally { setSearching(false); }
  };

  const grab = async (r: ReleaseChoice) => {
    setBusy(r.id); setNote(null);
    try { setNote({ text: (await api.grabRelease(r.id, fileAs)).message, ok: true }); } catch (err) {
      setNote({ text: err instanceof Error ? err.message : 'Could not start it.', ok: false });
    } finally { setBusy(null); }
  };

  if (!open) return <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>Find a release myself</button>;

  return (
    <div className="release-picker">
      <div className="np-tabs" role="tablist" aria-label="Where to look">
        <button type="button" role="tab" aria-selected={source === 'torrents'} className={`np-tab${source === 'torrents' ? ' is-active' : ''}`} onClick={() => setSource('torrents')}>Torrents</button>
        <button type="button" role="tab" aria-selected={source === 'youtube'} className={`np-tab${source === 'youtube' ? ' is-active' : ''}`} onClick={() => setSource('youtube')}>YouTube</button>
      </div>
      {source === 'youtube' && <YoutubeFinder initialQuery={initialQuery} />}
      {source === 'torrents' && <>
      <div className="release-picker-search">
        <input className="settings-input" value={query} maxLength={200} aria-label="Search words"
          onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void search(); }} />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void search()} disabled={searching || query.trim().length < 2}>
          {searching ? 'Searching...' : 'Search'}
        </button>
      </div>
      <p className="release-picker-help">Try the artist and event without extra words, for example "Linkin Park Rock am Ring 2004". Searching every source can take up to a minute.</p>
      <label className="release-picker-fileas">
        <span>When it finishes</span>
        <select className="settings-input" value={fileAs} onChange={e => setFileAs(e.target.value as typeof fileAs)}>
          <option value="auto">File under the artist if it looks like a concert or video</option>
          <option value="concert">It is a concert: file under the artist</option>
          <option value="video">It is a music video: file under the artist</option>
          <option value="none">Just download it</option>
        </select>
      </label>
      {note && <p className={`release-picker-note${note.ok ? '' : ' is-error'}`} role="status">{note.text}</p>}
      {results && results.length === 0 && <p className="release-picker-help">Nothing with seeders was found. Try fewer or different words.</p>}
      {results && results.length > 0 && (
        <ul className="release-list">
          {results.map(r => (
            <li key={r.id} className="release-row">
              <div className="release-row-main">
                <span className="release-row-title" title={r.title}>{r.cleanTitle || r.title}</span>
                <span className="release-row-meta">
                  {[size(r.sizeBytes), `${r.seeders} seeders`, r.quality, r.indexer, age(r.ageDays), r.filesUnder ? `files under artist / ${r.filesUnder}` : ''].filter(Boolean).join(' · ')}
                </span>
              </div>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => void grab(r)}>
                {busy === r.id ? 'Starting...' : 'Download'}
              </button>
            </li>
          ))}
        </ul>
      )}
      </>}
    </div>
  );
}
