import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MediaCard } from '../components/media/MediaCard';
import { MediaRail } from '../components/media/MediaRail';
import { PageHeader, Seg, SubNav } from '../components/ui/Page';
import { QualitySelect } from '../components/requests/QualitySelect';
import { api, type Dashboard, type MediaItem, type SearchCandidate, type SearchSourceName, type SearchSources } from '../lib/api';
import { addRecentSearch, clearRecentSearches, getRecentSearches, removeRecentSearch } from '../lib/recent-searches';
import { useRequester } from '../lib/useRequester';
import { useRadio } from '../components/radio/RadioProvider';
import { SvgIcon } from '../components/ui/SvgIcon';
import { Skeleton } from '../components/ui/Skeleton';
import { VoiceSearchButton, getSpeechRecognition } from '../components/search/VoiceSearchButton';
import { LoadError, SkeletonRail } from '../components/home/Skeletons';

type Section = 'library' | 'music' | 'people' | 'live' | 'radio' | 'videos' | 'channels' | 'request';
type Filter = 'all' | Section;
const SECTIONS: Array<{ key: Section; label: string; cap: number }> = [
  { key: 'library', label: 'In your library', cap: 12 },
  { key: 'music', label: 'Music', cap: 4 },
  { key: 'people', label: 'People', cap: 4 },
  { key: 'live', label: 'Live TV', cap: 4 },
  { key: 'radio', label: 'Radio', cap: 4 },
  { key: 'videos', label: 'Videos', cap: 4 },
  { key: 'channels', label: 'Channels', cap: 4 },
  { key: 'request', label: 'Available to request', cap: 4 }
];
const SOURCES: SearchSourceName[] = ['library', 'people', 'live', 'radio', 'videos', 'channels', 'request'];
type Answers = { [K in SearchSourceName]?: SearchSources[K] | null };
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

/** One compact result: a picture, two lines of text, and one real link or button. */
function Row({ pic, round, title, sub, to, onClick, label }: { pic?: string | undefined; round?: boolean; title: string; sub?: string | undefined; to?: string; onClick?: () => void; label?: string }) {
  const inner = (
    <>
      <span className={`sx-pic${round ? ' sx-pic--round' : ''}`}>{pic ? <img src={pic} alt="" loading="lazy" onError={e => { e.currentTarget.remove(); }} /> : null}</span>
      <span className="sx-text"><strong>{title}</strong>{sub && <span>{sub}</span>}</span>
      {label && <span className="sx-act">{label}</span>}
    </>
  );
  return to ? <Link className="sx-row" to={to}>{inner}</Link> : <button className="sx-row" type="button" onClick={onClick}>{inner}</button>;
}

/** Holds a slow source's place (videos, request lookups) so the page does not jump when it answers. */
function SectionSkeleton() {
  return (
    <section className="search-section" aria-hidden="true">
      <div className="rail-head"><Skeleton className="sx-skel-title" /></div>
      <div className="sx-grid">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="sx-skel-row" />)}</div>
    </section>
  );
}

const isTv = () => document.documentElement.classList.contains('tv');

export default function Search() {
  const [params, setParams] = useSearchParams();
  const radio = useRadio();
  const [query, setQuery] = useState(() => params.get('q') ?? '');
  const [active, setActive] = useState(() => (params.get('q') ?? '').trim());
  const [filter, setFilter] = useState<Filter>('all');
  const [quality, setQuality] = useState<Partial<Record<'movie' | 'series' | 'artist', string>>>({});
  const [answers, setAnswers] = useState<Answers>({});
  const [pending, setPending] = useState<Set<SearchSourceName>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => getRecentSearches());
  const [trending, setTrending] = useState<Dashboard | null>(null);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  // A ref, not state: the requester's done callback is created in the same render that sets it, and with
  // state it read the previous key - marking the wrong card as Requested.
  const lastKey = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  // Only browsers with speech recognition get the mic, and their search box leaves room for it.
  const [voiceOn] = useState(() => getSpeechRecognition() !== null);
  const onlyArtists = (answers.request?.artists.length ?? 0) > 0 && !answers.request?.movies.length && !answers.request?.series.length;
  const qualityKind = onlyArtists ? 'artist' : 'movie';

  const requester = useRequester((outcome, base) => {
    setNotice({ tone: outcome.kind === 'ok' ? 'ok' : 'err', text: outcome.message });
    const key = lastKey.current;
    if (outcome.kind === 'ok' && key) setRequested(prev => new Set(prev).add(key));
    setQuality(q => ({ ...q, [base.mediaType]: '' }));
  });

  useEffect(() => {
    api.dashboard().then(setTrending).catch(() => {});
    // Not on a TV: focusing the box there throws the on-screen keyboard over the page before anyone asked.
    if (!isTv()) inputRef.current?.focus();
  }, []);

  // "/" jumps to the search box from anywhere on this page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === '/' && t && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Search as you type, after a short pause.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setActive(''); return; }
    const timer = setTimeout(() => setActive(q), 250);
    return () => clearTimeout(timer);
  }, [query]);

  // One streamed search; a newer one cancels the older, so stale answers never land.
  useEffect(() => {
    setAnswers({});
    setError(null);
    setFilter('all');
    if (!active) { setPending(new Set()); return; }
    const ctl = new AbortController();
    setPending(new Set(SOURCES));
    let got = 0;
    api.searchEverything(active, ctl.signal, (source, data) => {
      if (ctl.signal.aborted) return;
      setAnswers(a => ({ ...a, [source]: data as never }));
      setPending(p => { const n = new Set(p); n.delete(source); return n; });
      if (data) got++;
    }).then(() => {
      if (ctl.signal.aborted) return;
      setPending(new Set());
      if (got === 0) setError('Search is not answering right now.');
    }).catch(err => { if (!ctl.signal.aborted) { setPending(new Set()); setError((err as Error).message); } });
    setParams({ q: active }, { replace: true });
    return () => ctl.abort();
  }, [active, retry, setParams]);

  // A search that found something is worth remembering, once everything has answered.
  const hasAny = Object.values(answers).some(a => a && Object.values(a).some(v => Array.isArray(v) && v.length));
  useEffect(() => { if (active && pending.size === 0 && hasAny) setRecent(addRecentSearch(active)); }, [active, pending.size, hasAny]);

  const submit = useCallback((text: string) => {
    const q = text.trim();
    if (q.length < 2) return;
    setQuery(q);
    setActive(q);
    setRetry(n => n + 1);
  }, []);

  const clear = () => { setQuery(''); setActive(''); inputRef.current?.focus(); };

  const request = (c: SearchCandidate) => {
    const key = `${c.type}:${c.providerId}`;
    lastKey.current = key;
    setNotice(null);
    const q = quality[c.type as 'movie' | 'series' | 'artist'];
    void requester.submit({ title: c.title, ...(c.year ? { year: c.year } : {}), mediaType: c.type, selectedProviderId: c.providerId, ...(c.poster ? { poster: c.poster } : {}), ...(q ? { qualityProfile: q } : {}) });
  };

  const requestArtist = (name: string) => {
    lastKey.current = `artist-name:${name}`;
    setNotice(null);
    void requester.submit({ title: name, mediaType: 'artist', ...(quality.artist ? { qualityProfile: quality.artist } : {}) });
  };

  // Arrows walk every result in page order, across sections; Escape clears. A TV remote uses lib/dpad.ts instead.
  const stops = () => [...(resultsRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])].filter(el => el.tabIndex !== -1);
  const onBoxKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); clear(); return; }
    if (e.key === 'ArrowDown' && !isTv() && e.target === inputRef.current) { const first = stops()[0]; if (first) { e.preventDefault(); first.focus(); } }
  };
  const onResultsKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); clear(); return; }
    if (isTv() || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    const list = stops();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    if (e.key === 'ArrowUp' && i === 0) inputRef.current?.focus();
    else list[Math.min(Math.max(i + (e.key === 'ArrowDown' ? 1 : -1), 0), list.length - 1)]?.focus();
  };

  // Each section's items, from whatever has answered so far.
  const lib = answers.library?.library ?? [];
  const personTitles = (answers.people?.people ?? []).flatMap(p => p.titles);
  const libraryItems = [...lib.filter(i => i.type !== 'artist'), ...personTitles].filter((i, n, all) => all.findIndex(o => o.id === i.id) === n);
  const artists = lib.filter(i => i.type === 'artist');
  const tracks = answers.request?.tracks ?? [];
  const cands = [...(answers.request?.movies ?? []), ...(answers.request?.series ?? []), ...(answers.request?.artists ?? [])];
  const count: Record<Section, number> = {
    library: libraryItems.length, music: artists.length + tracks.length, people: answers.people?.people.length ?? 0,
    live: answers.live?.total ?? 0, radio: answers.radio?.stations.length ?? 0, videos: answers.videos?.videos.length ?? 0,
    channels: answers.channels?.channels.length ?? 0, request: cands.length
  };
  const show = (k: Section) => filter === 'all' || filter === k;
  const cap = <T,>(list: T[], k: Section): T[] => (filter === 'all' ? list.slice(0, SECTIONS.find(s => s.key === k)!.cap) : list);
  const head = (k: Section) => {
    const sec = SECTIONS.find(s => s.key === k)!;
    return (
      <div className="rail-head"><h2 className="rail-title">{sec.label} <span className="sx-count">{count[k]}</span></h2>
        {filter === 'all' && count[k] > sec.cap && <button className="btn btn-secondary btn-sm" type="button" onClick={() => setFilter(k)}>See all {count[k]}</button>}
      </div>
    );
  };
  const browsing = !active && query.trim().length < 2;
  const searching = !!active && pending.size > 0;
  const nothing = !!active && !searching && !error && SECTIONS.every(s => count[s.key] === 0);
  const libraryHref = (i: { id: string; type: string }) => `${i.type === 'series' ? '/series' : '/movies'}/${i.id}`;

  return (
    <main className="page search-page">
      {requester.picker}
      <PageHeader title="Search" sub="Your library, music, live TV, videos, and anything you can request" />
      <SubNav label="Requests and downloads" items={[{ to: '/search', label: 'Find', icon: 'search' }, { to: '/requests', label: 'Requests', icon: 'list' }, { to: '/downloads', label: 'Downloads', icon: 'download' }]} />

      <div className={`search-box search-box--wide${voiceOn ? ' search-box--voice' : ''}`} onKeyDown={onBoxKey}>
        <input
          ref={inputRef}
          className="search-input"
          type="search"
          value={query}
          placeholder="Search movies, shows, music, people, live TV, videos…  ( / )"
          aria-label="Search"
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(query); } }}
        />
        {query && <button className="search-clear" type="button" onClick={clear} aria-label="Clear search"><SvgIcon name="close" size={16} /></button>}
        {voiceOn && <VoiceSearchButton onResult={submit} />}
      </div>

      {active && (
        <div className="search-filters">
          <Seg<Filter> label="Result type" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, ...SECTIONS.filter(s => count[s.key] > 0).map(s => ({ value: s.key as Filter, label: s.label, count: count[s.key] }))]} />
          {filter === 'request' && <QualitySelect mediaType={qualityKind} value={quality[qualityKind] ?? ''} onChange={v => setQuality(q => ({ ...q, [qualityKind]: v }))} compact />}
        </div>
      )}

      {notice && <div role="status" className={`notice notice--${notice.tone}`}>{notice.text}</div>}
      {error && <LoadError what="Results" message={error} onRetry={() => setRetry(n => n + 1)} />}

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
          <p className="search-hint">Search finds titles in your library, people, music, live TV, radio, videos, and anything you can request. Paste a song name to add its artist.</p>
          {trending?.rails.filter(r => r.kind !== 'download').map(rail => <MediaRail key={rail.id} rail={rail} />)}
          {!trending && <><SkeletonRail /><SkeletonRail /></>}
        </div>
      )}

      {nothing && (
        <div className="empty-state">
          Nothing found for "{active}".
          <span>Check the spelling or try fewer words.</span>
        </div>
      )}

      <div className="search-results" ref={resultsRef} onKeyDown={onResultsKey} aria-busy={searching}>
        {show('library') && count.library === 0 && pending.has('library') && <SectionSkeleton />}
        {show('library') && count.library > 0 && (
          <section className="search-section" aria-label="In your library">
            {head('library')}
            <div className="media-grid browse-grid">
              {cap(libraryItems, 'library').map(i => (
                <MediaCard key={i.id} item={{ id: i.id, title: i.title, ...(i.year ? { year: i.year } : {}), type: i.type, ...(i.status ? { status: i.status } : {}), artwork: i.poster ? { poster: i.poster } : {} } as MediaItem} showStatus to={libraryHref(i)} />
              ))}
            </div>
          </section>
        )}

        {show('music') && count.music > 0 && (
          <section className="search-section" aria-label="Music">
            {head('music')}
            <div className="sx-grid">
              {cap(artists, 'music').map(a => <Row key={a.id} round pic={a.poster} title={a.title} sub="Artist" to={`/music/${a.id}`} />)}
            </div>
            {tracks.length > 0 && (
              <ul className="song-list">
                {(filter === 'all' ? tracks.slice(0, 3) : tracks).map(t => {
                  const key = `artist-name:${t.artist}`;
                  return (
                    <li className="song-row" key={`${t.title}-${t.artist}`}>
                      <span className="song-main"><strong>{t.title}</strong><span>{t.artist}{t.year ? ` · ${t.year}` : ''}</span></span>
                      <button className="btn btn-secondary btn-sm" type="button" disabled={requested.has(key) || (requester.busy && lastKey.current === key)} onClick={() => requestArtist(t.artist)}>
                        {requested.has(key) ? 'Added' : `Add ${t.artist}`}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {show('people') && count.people > 0 && (
          <section className="search-section" aria-label="People">
            {head('people')}
            <div className="sx-grid">
              {cap(answers.people!.people, 'people').map(p => <Row key={p.name} round pic={p.photo} title={p.name} sub={`${p.titles.length} ${p.titles.length === 1 ? 'title' : 'titles'} in your library`} to={`/people/${encodeURIComponent(p.name)}`} />)}
            </div>
          </section>
        )}

        {show('live') && count.live > 0 && (
          <section className="search-section" aria-label="Live TV">
            {head('live')}
            <div className="sx-grid">
              {cap(answers.live!.channels, 'live').map(c => <Row key={c.id} pic={c.logo} title={c.name} sub={c.group ?? 'Live TV'} to={`/live?ch=${encodeURIComponent(c.id)}`} label="Watch" />)}
            </div>
          </section>
        )}

        {show('radio') && count.radio > 0 && (
          <section className="search-section" aria-label="Radio">
            {head('radio')}
            <div className="sx-grid">
              {cap(answers.radio!.stations, 'radio').map(s => (
                <Row key={s.id} pic={s.logo ? `/api/radio/logo/${s.id}` : undefined} title={s.name} sub={[s.country, s.tags[0]].filter(Boolean).join(' · ')} onClick={() => radio.play(s)} label={radio.station?.id === s.id ? 'Playing' : 'Play'} />
              ))}
            </div>
          </section>
        )}

        {show('videos') && count.videos === 0 && pending.has('videos') && <SectionSkeleton />}
        {show('videos') && count.videos > 0 && (
          <section className="search-section" aria-label="Videos">
            {head('videos')}
            <div className="sx-grid">
              {cap(answers.videos!.videos, 'videos').map(v => <Row key={v.id} pic={v.thumbnail} title={v.title} sub={v.channel} to={`/videos/watch/${v.id}`} />)}
            </div>
          </section>
        )}

        {show('channels') && count.channels > 0 && (
          <section className="search-section" aria-label="Channels">
            {head('channels')}
            <div className="sx-grid">
              {cap(answers.channels!.channels, 'channels').map(c => <Row key={c.id} round pic={c.avatar} title={c.name} sub={c.subscribers ? `${new Intl.NumberFormat('en', { notation: 'compact' }).format(c.subscribers)} subscribers` : 'Channel'} to={`/videos/channel/${c.id}`} />)}
            </div>
          </section>
        )}

        {show('request') && count.request === 0 && pending.has('request') && <SectionSkeleton />}
        {show('request') && count.request > 0 && (
          <section className="search-section" aria-label="Available to request">
            {head('request')}
            <div className="result-grid">
              {cap(cands, 'request').map(c => {
                const key = `${c.type}:${c.providerId}`;
                return <CandidateCard key={key} c={c} requested={requested.has(key)} busy={requester.busy && lastKey.current === key} onRequest={() => request(c)} />;
              })}
            </div>
          </section>
        )}
      </div>

      {active && !searching && !nothing && (
        <p className="search-footnote">
          Looking for something else? <Link to="/requests">See your requests</Link> or <Link to="/downloads">downloads</Link>.
        </p>
      )}
    </main>
  );
}
