import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MediaCard } from '../components/media/MediaCard';
import { MediaRail } from '../components/media/MediaRail';
import { BackButton } from '../components/layout/BackButton';
import { QualitySelect } from '../components/requests/QualitySelect';
import { api, type Dashboard, type MediaItem, type SearchAll, type SearchCandidate, type SearchSuggestion } from '../lib/api';
import { addRecentSearch, clearRecentSearches, getRecentSearches, removeRecentSearch } from '../lib/recent-searches';
import { useRequester } from '../lib/useRequester';
import { SvgIcon } from '../components/ui/SvgIcon';

type Filter = 'all' | 'library' | 'movie' | 'series' | 'artist' | 'track';
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'Top results' },
  { key: 'library', label: 'In your library' },
  { key: 'movie', label: 'Movies' },
  { key: 'series', label: 'TV shows' },
  { key: 'artist', label: 'Artists' },
  { key: 'track', label: 'Songs' }
];
const ICON = { movie: 'film', series: 'tv', artist: 'mic' } as const;
const KIND_LABEL = { movie: 'Movie', series: 'TV show', artist: 'Artist' } as const;

function CandidateCard({ c, requested, busy, onRequest }: { c: SearchCandidate; requested: boolean; busy: boolean; onRequest: () => void }) {
  const [poster, setPoster] = useState(c.poster ?? '');
  useEffect(() => {
    if (c.poster) return;
    let alive = true;
    api.searchCover(c.year ? `${c.title} ${c.year}` : c.title).then(r => { if (alive) setPoster(r.cover); }).catch(() => {});
    return () => { alive = false; };
  }, [c.poster, c.title, c.year]);
  return (
    <article className="result-card">
      <div className="result-poster">
        {poster ? <img src={poster} alt="" loading="lazy" onError={() => setPoster('')} /> : <SvgIcon name={ICON[c.type]} size={28} />}
      </div>
      <div className="result-body">
        <span className="result-kind">{KIND_LABEL[c.type]}</span>
        <h3 className="result-title">{c.title}{c.year ? <span className="result-year"> {c.year}</span> : null}</h3>
        {c.overview && <p className="result-overview">{c.overview}</p>}
        {c.requestStatus ? (
          <Link className="btn btn-secondary btn-sm" to="/requests" title="See this request">
            {c.requestStatus === 'available' ? 'In your library' : `Requested · ${c.requestStatus}`}
          </Link>
        ) : (
          <button className={`btn ${requested ? 'btn-secondary' : 'btn-primary'} btn-sm`} type="button" disabled={busy || requested} onClick={onRequest}>
            {requested ? 'Requested' : busy ? 'Requesting…' : c.type === 'artist' ? 'Add to Music' : 'Request'}
          </button>
        )}
      </div>
    </article>
  );
}

export default function Search() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(() => params.get('q') ?? '');
  const [active, setActive] = useState(() => (params.get('q') ?? '').trim());
  const [filter, setFilter] = useState<Filter>('all');
  const [data, setData] = useState<SearchAll | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>(() => getRecentSearches());
  const [trending, setTrending] = useState<Dashboard | null>(null);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [sugOpen, setSugOpen] = useState(false);
  const [sugIndex, setSugIndex] = useState(-1);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const version = useRef(0);

  const requester = useRequester((outcome, base) => {
    setNotice({ tone: outcome.kind === 'ok' ? 'ok' : 'err', text: outcome.message });
    if (outcome.kind === 'ok' && lastKey) setRequested(prev => new Set(prev).add(lastKey));
    void base;
  });

  useEffect(() => { api.dashboard().then(setTrending).catch(() => {}); inputRef.current?.focus(); }, []);

  // "/" jumps to the search box from anywhere on this page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === '/' && t && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setSugOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Full search, debounced while typing.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setActive(''); setData(null); setError(null); return; }
    const timer = setTimeout(() => setActive(q), 450);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!active) return;
    const mine = ++version.current;
    setLoading(true);
    setError(null);
    api.searchAll(active)
      .then(res => {
        if (version.current !== mine) return;
        setData(res);
        setParams(active ? { q: active } : {}, { replace: true });
        // A search that found something is worth remembering, however it was started.
        if (res.library.length + res.movies.length + res.series.length + res.artists.length + res.tracks.length > 0) setRecent(addRecentSearch(active));
      })
      .catch(err => { if (version.current === mine) setError((err as Error).message); })
      .finally(() => { if (version.current === mine) setLoading(false); });
  }, [active, setParams]);

  // Autocomplete (library titles + Wikipedia), quick and separate from the full search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || q === active) { setSuggestions([]); return; }
    let alive = true;
    const timer = setTimeout(() => {
      api.suggestions(q).then(r => { if (alive) { setSuggestions(r.suggestions.slice(0, 7)); setSugIndex(-1); } }).catch(() => {});
    }, 200);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, active]);

  const submit = useCallback((text: string) => {
    const q = text.trim();
    if (q.length < 2) return;
    setQuery(q);
    setActive(q);
    setSugOpen(false);
    setRecent(addRecentSearch(q));
  }, []);

  const request = (c: SearchCandidate) => {
    const key = `${c.type}:${c.providerId}`;
    setLastKey(key);
    setNotice(null);
    void requester.submit({ title: c.title, ...(c.year ? { year: c.year } : {}), mediaType: c.type, selectedProviderId: c.providerId });
  };

  const requestArtist = (name: string) => {
    setLastKey(`artist-name:${name}`);
    setNotice(null);
    void requester.submit({ title: name, mediaType: 'artist' });
  };

  const counts = useMemo(() => ({
    library: data?.library.length ?? 0, movie: data?.movies.length ?? 0, series: data?.series.length ?? 0,
    artist: data?.artists.length ?? 0, track: data?.tracks.length ?? 0
  }), [data]);
  const show = (kind: Exclude<Filter, 'all'>) => filter === 'all' || filter === kind;
  const nothing = data && counts.library + counts.movie + counts.series + counts.artist + counts.track === 0;
  const browsing = !active && query.trim().length < 2;
  const cap = <T,>(list: T[], kind: Exclude<Filter, 'all'>): T[] => (filter === 'all' ? list.slice(0, kind === 'library' ? 12 : 4) : list);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && suggestions.length) { e.preventDefault(); setSugOpen(true); setSugIndex(i => (i + 1) % suggestions.length); }
    else if (e.key === 'ArrowUp' && suggestions.length) { e.preventDefault(); setSugIndex(i => (i <= 0 ? suggestions.length - 1 : i - 1)); }
    else if (e.key === 'Escape') { setSugOpen(false); setSugIndex(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); submit(sugIndex >= 0 ? suggestions[sugIndex]!.title : query); }
  };

  const libraryHref = (i: { id: string; type: string }) => `${i.type === 'series' ? '/series' : i.type === 'artist' ? '/music' : '/movies'}/${i.id}`;

  return (
    <main className="page search-page">
      {requester.picker}
      <BackButton to="/" label="Home" />
      <div className="search-head"><h1>Search</h1></div>

      <div className="search-box search-box--wide" ref={boxRef}>
        <input
          ref={inputRef}
          className="search-input"
          type="search"
          value={query}
          placeholder="Search movies, TV shows, artists, songs…  ( / )"
          aria-label="Search"
          aria-autocomplete="list"
          aria-expanded={sugOpen && suggestions.length > 0}
          onChange={e => { setQuery(e.target.value); setSugOpen(true); }}
          onFocus={() => setSugOpen(true)}
          onKeyDown={onKeyDown}
        />
        {query && <button className="search-clear" type="button" onClick={() => { setQuery(''); inputRef.current?.focus(); }} aria-label="Clear search"><SvgIcon name="close" size={16} /></button>}
        {sugOpen && suggestions.length > 0 && (
          <ul className="suggest-list" role="listbox">
            {suggestions.map((s, i) => (
              <li key={`${s.source}-${s.title}-${i}`} role="option" aria-selected={i === sugIndex}>
                <button type="button" className={`suggest-item${i === sugIndex ? ' is-active' : ''}`} onMouseEnter={() => setSugIndex(i)} onClick={() => submit(s.title)}>
                  <span className="suggest-title">{s.title}{'year' in s && s.year ? <em> {s.year}</em> : null}</span>
                  <span className="suggest-tag">{s.source === 'library' ? 'In library' : 'Suggestion'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(active || query.trim().length >= 2) && (
        <div className="search-filters">
          <div className="requests-filters" role="tablist" aria-label="Result type">
            {FILTERS.map(f => {
              const n = f.key === 'all' ? null : counts[f.key];
              return (
                <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={`season-tab${filter === f.key ? ' is-active' : ''}`} onClick={() => setFilter(f.key)}>
                  {f.label}{n !== null && data ? ` (${n})` : ''}
                </button>
              );
            })}
          </div>
          <QualitySelect mediaType={filter === 'series' ? 'series' : filter === 'artist' ? 'artist' : 'movie'} compact />
        </div>
      )}

      {notice && <div role="status" className={`notice notice--${notice.tone}`}>{notice.text}</div>}
      {loading && <div className="search-progress" role="progressbar" aria-label="Searching" />}
      {error && <div className="error-state" role="alert">Search failed: {error}</div>}

      {browsing && (
        <div className="search-trending">
          {recent.length > 0 && (
            <section className="search-recent" aria-label="Recent searches">
              <div className="rail-head">
                <h2 className="rail-title">Recent</h2>
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => { clearRecentSearches(); setRecent([]); }}>Clear</button>
              </div>
              <div className="recent-chips">
                {recent.map(r => (
                  <span className="recent-chip" key={r}>
                    <button type="button" onClick={() => submit(r)}>{r}</button>
                    <button type="button" aria-label={`Forget ${r}`} onClick={() => setRecent(removeRecentSearch(r))}><SvgIcon name="close" size={12} /></button>
                  </span>
                ))}
              </div>
            </section>
          )}
          <p className="search-hint">Search finds titles in your library and anything you can request. Paste a song name to add its artist.</p>
          {trending?.rails.filter(r => r.kind !== 'download').map(rail => <MediaRail key={rail.id} rail={rail} />)}
          {!trending && <div className="loading-state">Loading what is trending…</div>}
        </div>
      )}

      {nothing && !loading && (
        <div className="empty-state">
          Nothing found for "{data?.query}".
          <span>Check the spelling, try fewer words, or search by the exact title. If your Movies, TV Shows or Music service is offline, requestable results are unavailable.</span>
        </div>
      )}

      {data && counts.library > 0 && show('library') && (
        <section className="search-section" aria-label="In your library">
          <div className="rail-head"><h2 className="rail-title">In your library</h2>
            {filter === 'all' && counts.library > 12 && <button className="btn btn-secondary btn-sm" type="button" onClick={() => setFilter('library')}>Show all {counts.library}</button>}
          </div>
          <div className="media-grid">
            {cap(data.library, 'library').map(i => (
              <MediaCard key={i.id} item={{ id: i.id, title: i.title, ...(i.year ? { year: i.year } : {}), type: i.type, ...(i.status ? { status: i.status } : {}), artwork: i.poster ? { poster: i.poster } : {} } as MediaItem} showStatus to={libraryHref(i)} />
            ))}
          </div>
        </section>
      )}

      {data && (['movie', 'series', 'artist'] as const).map(kind => {
        const list = kind === 'movie' ? data.movies : kind === 'series' ? data.series : data.artists;
        if (list.length === 0 || !show(kind)) return null;
        const title = kind === 'movie' ? 'Request a movie' : kind === 'series' ? 'Request a TV show' : 'Add an artist';
        return (
          <section className="search-section" key={kind} aria-label={title}>
            <div className="rail-head"><h2 className="rail-title">{title}</h2>
              {filter === 'all' && list.length > 4 && <button className="btn btn-secondary btn-sm" type="button" onClick={() => setFilter(kind)}>Show all {list.length}</button>}
            </div>
            <div className="result-grid">
              {cap(list, kind).map(c => {
                const key = `${c.type}:${c.providerId}`;
                return <CandidateCard key={key} c={c} requested={requested.has(key)} busy={requester.busy && lastKey === key} onRequest={() => request(c)} />;
              })}
            </div>
          </section>
        );
      })}

      {data && counts.track > 0 && show('track') && (
        <section className="search-section" aria-label="Songs">
          <div className="rail-head"><h2 className="rail-title">Songs</h2></div>
          <ul className="song-list">
            {(filter === 'all' ? data.tracks.slice(0, 4) : data.tracks).map(t => {
              const key = `artist-name:${t.artist}`;
              return (
                <li className="song-row" key={`${t.title}-${t.artist}`}>
                  <span className="song-main"><strong>{t.title}</strong><span>{t.artist}{t.year ? ` · ${t.year}` : ''}</span></span>
                  <button className="btn btn-secondary btn-sm" type="button" disabled={requested.has(key) || (requester.busy && lastKey === key)} onClick={() => requestArtist(t.artist)}>
                    {requested.has(key) ? 'Added' : `Add ${t.artist}`}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="search-hint">Adding an artist downloads their catalogue; individual songs cannot be requested on their own.</p>
        </section>
      )}

      {data && (
        <p className="search-footnote">
          Looking for something else? <Link to="/requests">See your requests</Link> or <Link to="/downloads">downloads</Link>.
        </p>
      )}
    </main>
  );
}
