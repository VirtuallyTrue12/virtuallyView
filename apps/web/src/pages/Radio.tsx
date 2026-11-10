import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type RadioPlace, type RadioStation } from '../lib/api';
import { EmptyState, PageHeader, Seg } from '../components/ui/Page';
import { ScrollRow } from '../components/ui/ScrollRow';
import { SvgIcon } from '../components/ui/SvgIcon';
import { StationLogo } from '../components/radio/StationLogo';
import { useRadio } from '../components/radio/RadioProvider';
import { Skeleton } from '../components/ui/Skeleton';

type View = 'browse' | 'favorites' | 'recent';
const KEY = 'vv-radio-place';

const flag = (code: string) => (/^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map(c => 0x1f1e6 + c.charCodeAt(0) - 65)) : '🌐');
function remembered(): { country: string; region: string } {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { country?: string; region?: string } | null; if (v?.country) return { country: v.country, region: v.region ?? '' }; } catch { /* first visit */ }
  const fromBrowser = (navigator.language.split('-')[1] ?? '').toUpperCase();
  return { country: /^[A-Z]{2}$/.test(fromBrowser) ? fromBrowser : 'US', region: '' };
}

/** Equalizer bars: they move only while sound is actually coming out. */
const Bars = ({ live }: { live: boolean }) => <span className={`rs-eq${live ? ' is-live' : ''}`} aria-hidden="true"><i /><i /><i /></span>;

function StationCard({ station, playing, sounding, busy, favorite, onPlay, onFavorite }: { station: RadioStation; playing: boolean; sounding: boolean; busy: boolean; favorite: boolean; onPlay: () => void; onFavorite: () => void }) {
  const detail = [station.state, station.country].filter(Boolean).join(', ');
  const meta = [station.tags.slice(0, 2).join(', '), station.codec && station.bitrate ? `${station.bitrate} kbps` : ''].filter(Boolean).join(' · ');
  return (
    <li className={`rs${playing ? ' is-playing' : ''}`}>
      <button type="button" className="rs-main" onClick={onPlay} aria-label={`${playing && busy ? 'Stop' : 'Play'} ${station.name}`} aria-current={playing || undefined}>
        <span className="rs-art">
          <StationLogo station={station} />
          <span className="rs-play" aria-hidden="true">{playing ? (sounding ? <Bars live /> : <SvgIcon name="pause" size={18} />) : <SvgIcon name="play" size={18} />}</span>
          {station.kind === 'playlist' && <span className="rs-kind" title="A fan-made automatic playlist, not a live broadcast">Playlist</span>}
        </span>
        <span className="rs-text">
          <strong>{station.name}</strong>
          <span>{detail || 'Worldwide'}</span>
          {meta && <span className="rs-tags">{meta}</span>}
        </span>
      </button>
      <button type="button" className={`rs-fav${favorite ? ' is-on' : ''}`} onClick={onFavorite} aria-pressed={favorite} aria-label={favorite ? `Remove ${station.name} from favorites` : `Add ${station.name} to favorites`}>
        <SvgIcon name={favorite ? 'heart' : 'heart-outline'} size={16} />
      </button>
    </li>
  );
}

/** A small sideways row (favourites, recent) on the Browse view. */
function StationRow({ title, list, current, sounding, onPlay }: { title: string; list: RadioStation[]; current?: string | undefined; sounding: boolean; onPlay: (s: RadioStation) => void }) {
  if (!list.length) return null;
  return (
    <section className="rd-row" aria-label={title}>
      <h2 className="rd-row-title">{title}</h2>
      <ScrollRow label={title.toLowerCase()} className="rd-row-track">
        {list.map(s => (
          // Named after the station only, so the grid's "Play …" buttons stay unique.
          <button key={s.id} type="button" className={`rd-mini${current === s.id ? ' is-playing' : ''}`} onClick={() => onPlay(s)} aria-current={current === s.id || undefined}>
            <span className="rs-art"><StationLogo station={s} />{current === s.id && <span className="rs-play" aria-hidden="true">{sounding ? <Bars live /> : <SvgIcon name="pause" size={16} />}</span>}</span>
            <span className="rd-mini-name">{s.name}</span>
          </button>
        ))}
      </ScrollRow>
    </section>
  );
}

const StationSkeletons = () => (
  <ul className="rs-grid" role="status" aria-label="Finding stations">
    {Array.from({ length: 12 }, (_, i) => <li key={i} className="rs rs--skel"><Skeleton className="rs-skel-art" /><Skeleton className="skeleton-line" style={{ width: '75%', margin: '12px 0 6px' }} /><Skeleton className="skeleton-line" style={{ width: '50%', opacity: 0.6 }} /></li>)}
  </ul>
);

/** Internet radio: pick a country and region, a genre or a name, and press play. Favorites and recents follow the person. */
export default function Radio() {
  const radio = useRadio();
  const [view, setView] = useState<View>('browse');
  const [place, setPlace] = useState(remembered);
  const [countries, setCountries] = useState<RadioPlace[]>([]);
  const [regions, setRegions] = useState<RadioPlace[]>([]);
  const [tags, setTags] = useState<Array<{ name: string; stations: number }>>([]);
  const [tag, setTag] = useState('');
  // Fan-made playlists sound pre-recorded (no hosts, no news): hidden unless asked for.
  const [liveOnly, setLiveOnly] = useState(() => { try { return localStorage.getItem('vv-radio-live-only') !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('vv-radio-live-only', liveOnly ? '1' : '0'); } catch { /* fine */ } }, [liveOnly]);
  const [query, setQuery] = useState('');
  const [typed, setTyped] = useState('');
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<{ favorites: RadioStation[]; recent: RadioStation[] }>({ favorites: [], recent: [] });

  const loadMine = useCallback(() => { api.radioMe().then(setMine).catch(() => undefined); }, []);
  useEffect(() => { loadMine(); }, [loadMine, radio.station?.id]);
  useEffect(() => {
    api.radioCountries().then(r => setCountries(r.countries)).catch(err => setError((err as Error).message));
    api.radioTags().then(r => setTags(r.tags.slice(0, 40))).catch(() => undefined);
  }, []);
  useEffect(() => {
    setRegions([]);
    if (!place.country) return;
    api.radioRegions(place.country).then(r => setRegions(r.regions)).catch(() => undefined);
    try { localStorage.setItem(KEY, JSON.stringify(place)); } catch { /* not remembered */ }
  }, [place]);
  useEffect(() => { const t = window.setTimeout(() => setQuery(typed.trim()), 350); return () => window.clearTimeout(t); }, [typed]);

  // A search by name looks everywhere; otherwise the chosen country (and region) is used.
  const worldwide = query.length > 0 && !place.country;
  useEffect(() => {
    if (view !== 'browse') return;
    let alive = true;
    setLoading(true); setError(null);
    api.radioStations({ country: place.country, region: place.region, tag, q: query })
      .then(r => { if (alive) { setStations(r.stations); setMore(r.more); } })
      .catch(err => { if (alive) { setError((err as Error).message); setStations([]); setMore(false); } })
      .finally(() => { if (alive) setLoading(false); });
    // Leaving Browse mid-load cancels the answer, so the spinner must stop here too or it never does.
    return () => { alive = false; setLoading(false); };
  }, [view, place, tag, query]);

  const loadMore = () => {
    setLoading(true);
    api.radioStations({ country: place.country, region: place.region, tag, q: query, offset: stations.length })
      .then(r => { setStations(prev => [...prev, ...r.stations.filter(s => !prev.some(p => p.id === s.id))]); setMore(r.more); })
      .catch(err => setError((err as Error).message)).finally(() => setLoading(false));
  };

  const favIds = useMemo(() => new Set(mine.favorites.map(s => s.id)), [mine.favorites]);
  const toggleFav = async (s: RadioStation) => {
    const next = !favIds.has(s.id);
    setMine(m => ({ ...m, favorites: next ? [s, ...m.favorites] : m.favorites.filter(f => f.id !== s.id) }));
    try { await api.radioFavorite(s.id, next); } catch { loadMine(); }
  };

  const listed = view === 'browse' ? stations : view === 'favorites' ? mine.favorites : mine.recent;
  const hiddenPlaylists = view === 'browse' && liveOnly ? listed.filter(s => s.kind === 'playlist').length : 0;
  const shown = hiddenPlaylists ? listed.filter(s => s.kind !== 'playlist') : listed;
  const countryName = countries.find(c => c.code === place.country)?.name ?? '';
  const playingId = radio.state !== 'idle' ? radio.station?.id : undefined;
  const sounding = radio.state === 'playing';
  const playOrStop = (s: RadioStation) => (radio.station?.id === s.id ? radio.toggle() : radio.play(s));
  const filtersOn = !!(tag || typed || place.region);
  const where = place.country ? `${place.region ? `${place.region}, ` : ''}${countryName || place.country}` : 'the whole world';

  return (
    <main className="page radio-page">
      <PageHeader
        icon="radio"
        title="Radio"
        sub={view === 'browse' ? `Live stations from ${where}. Pick a country, a region or a style and press play.` : view === 'favorites' ? 'Stations you saved.' : 'Stations you listened to lately.'}
        actions={<>
          <button type="button" className="btn btn-secondary" disabled={!shown.length} onClick={() => { const pool = shown.filter(st => st.id !== radio.station?.id); const pick = pool[Math.floor(Math.random() * pool.length)]; if (pick) radio.play(pick); }} title="Tune to a random station from this list">
            <SvgIcon name="shuffle" size={16} /> Surprise me
          </button>
          <Seg<View> label="Radio view" value={view} onChange={setView} options={[{ value: 'browse', label: 'Browse' }, { value: 'favorites', label: 'Favorites', count: mine.favorites.length }, { value: 'recent', label: 'Recent' }]} />
        </>}
      />

      {view === 'browse' && (
        <>
          <div className="rd-filters">
            <label className="rd-field">
              <span>Country</span>
              <select value={place.country} onChange={e => setPlace({ country: e.target.value, region: '' })} aria-label="Country">
                <option value="">🌐 Anywhere in the world</option>
                {countries.map(c => <option key={c.code} value={c.code}>{flag(c.code)} {c.name} ({c.stations.toLocaleString()})</option>)}
                {!countries.length && place.country && <option value={place.country}>{flag(place.country)} {place.country}</option>}
              </select>
            </label>
            {regions.length > 0 && (
              <label className="rd-field">
                <span>Region</span>
                <select value={place.region} onChange={e => setPlace(p => ({ ...p, region: e.target.value }))} aria-label="Region">
                  <option value="">All of {countryName || place.country}</option>
                  {regions.map(r => <option key={r.code} value={r.name}>{r.name} ({r.stations})</option>)}
                </select>
              </label>
            )}
            <button type="button" role="switch" aria-checked={liveOnly} className={`toggle rd-live${liveOnly ? ' is-on' : ''}`} onClick={() => setLiveOnly(v => !v)} title="Hide fan-made automatic playlists that sound pre-recorded">
              <span className="toggle-knob" aria-hidden="true" />
              <span>Real broadcasts only{hiddenPlaylists > 0 && <small>{hiddenPlaylists} fan playlists hidden</small>}</span>
            </button>
            <label className="rd-field rd-search">
              <span>Search</span>
              <input type="search" value={typed} onChange={e => setTyped(e.target.value)} placeholder="Station name" aria-label="Search stations by name" />
            </label>
          </div>
          {tags.length > 0 && (
            <ScrollRow label="Genres" className="rd-tags">
              <button type="button" className={`md-chip${tag === '' ? ' is-on' : ''}`} onClick={() => setTag('')}>All styles</button>
              {/* Pinned first regardless of rank: stations that simulcast a real terrestrial FM broadcast,
                  the same "fm" tag Radio Browser itself uses, easy to find without scrolling the genre list. */}
              <button type="button" className={`md-chip${tag === 'fm' ? ' is-on' : ''}`} onClick={() => setTag(tag === 'fm' ? '' : 'fm')}>FM stations</button>
              {tags.filter(t => t.name !== 'fm').map(t => <button key={t.name} type="button" className={`md-chip${tag === t.name ? ' is-on' : ''}`} onClick={() => setTag(tag === t.name ? '' : t.name)}>{t.name}</button>)}
            </ScrollRow>
          )}
          {worldwide && <p className="ui-help">Searching every country.</p>}
        </>
      )}

      {view === 'browse' && !query && !tag && (
        <>
          <StationRow title="Your favorites" list={mine.favorites} current={playingId} sounding={sounding} onPlay={playOrStop} />
          <StationRow title="Recently played" list={mine.recent} current={playingId} sounding={sounding} onPlay={playOrStop} />
        </>
      )}
      {view === 'browse' && shown.length > 0 && <h2 className="rd-row-title">{tag ? `${tag[0]!.toUpperCase()}${tag.slice(1)} stations` : query ? 'Matching stations' : `Stations in ${where}`}</h2>}

      {error && <div className="notice notice--err rd-error" role="alert"><span>Could not reach the station directory. {error}</span> <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPlace(p => ({ ...p }))}>Retry</button></div>}
      {loading && shown.length === 0 && !error && <StationSkeletons />}
      {!loading && !error && shown.length === 0 && (
        <EmptyState icon="radio"
          title={view === 'favorites' ? 'No favorites yet' : view === 'recent' ? 'Nothing played yet' : 'No stations match'}
          text={view === 'favorites' ? 'Press the heart on a station to keep it here.' : view === 'recent' ? 'Stations you play show up here.' : 'Try another region or style, or clear the search.'}
          action={view !== 'browse' ? <button type="button" className="btn btn-primary" onClick={() => setView('browse')}>Browse stations</button>
            : filtersOn ? <button type="button" className="btn btn-secondary" onClick={() => { setTag(''); setTyped(''); setPlace(p => ({ ...p, region: '' })); }}>Clear filters</button> : undefined} />
      )}
      {shown.length > 0 && (
        <ul className="rs-grid">
          {shown.map(s => <StationCard key={s.id} station={s} playing={playingId === s.id} sounding={sounding} busy={radio.state === 'playing' || radio.state === 'loading'} favorite={favIds.has(s.id)} onPlay={() => playOrStop(s)} onFavorite={() => void toggleFav(s)} />)}
        </ul>
      )}
      {view === 'browse' && more && <div className="rd-more"><button type="button" className="btn btn-secondary" onClick={loadMore} disabled={loading}>{loading ? 'Loading…' : 'Show more stations'}</button></div>}
      <p className="ui-help rd-credit">Stations come from the open <a href="https://www.radio-browser.info" target="_blank" rel="noreferrer">Radio Browser</a> directory. Audio is relayed through your server, so a station never sees your address.</p>
    </main>
  );
}
