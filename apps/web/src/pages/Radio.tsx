import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type RadioHome, type RadioPlace, type RadioStation } from '../lib/api';
import { EmptyState, PageHeader } from '../components/ui/Page';
import { ScrollRow } from '../components/ui/ScrollRow';
import { SvgIcon } from '../components/ui/SvgIcon';
import { PosterSkeletons } from '../components/ui/Skeleton';
import { StationLogo } from '../components/radio/StationLogo';
import { useRadio } from '../components/radio/RadioProvider';
import { RadioAlarmPanel, RadioRecordings } from '../components/radio/RadioPanels';
import { kindLine } from '../components/radio/info';

const KEY = 'vv-radio-place';

const flag = (code: string) => (/^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map(c => 0x1f1e6 + c.charCodeAt(0) - 65)) : '🌐');
function remembered(): { country: string; region: string } {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { country?: string; region?: string } | null; if (v?.country) return { country: v.country, region: v.region ?? '' }; } catch { /* first visit */ }
  const fromBrowser = (navigator.language.split('-')[1] ?? '').toUpperCase();
  return { country: /^[A-Z]{2}$/.test(fromBrowser) ? fromBrowser : 'US', region: '' };
}

/** Equalizer bars: they move only while sound is actually coming out. */
const Bars = () => <span className="rs-eq" aria-hidden="true"><i /><i /><i /></span>;

interface TileProps { station: RadioStation; hero?: boolean; favorite: boolean; onFavorite: () => void }

function Tile({ station, hero, favorite, onFavorite }: TileProps) {
  const radio = useRadio();
  const current = radio.station?.id === station.id && radio.state !== 'idle';
  const dead = station.health === 'dead';
  const sub = dead ? 'Not answering' : kindLine(station) || [station.state, station.country].filter(Boolean).join(', ') || 'Worldwide';
  return (
    <div className={`rt${hero ? ' rt--hero' : ''}${current ? ' is-playing' : ''}${dead ? ' is-dead' : ''}`}>
      <button type="button" className="rt-main" onClick={() => (current ? radio.setExpanded(true) : radio.play(station))} aria-label={`${current ? 'Now playing' : 'Play'} ${station.name}`}>
        <span className="rt-art">
          {hero && station.logo && <img className="rt-blur" src={`/api/radio/logo/${station.id}`} alt="" aria-hidden="true" loading="lazy" />}
          <StationLogo station={station} />
          {hero && !dead && <span className="rt-live"><i aria-hidden="true" />LIVE</span>}
          {station.kind === 'playlist' && <span className="rt-live rt-live--quiet" title="A fan-made automatic playlist, not a live broadcast">Playlist</span>}
          <span className="rt-play" aria-hidden="true">{current && radio.state === 'playing' ? <Bars /> : <SvgIcon name={current && radio.state !== 'paused' ? 'pause' : 'play'} size={hero ? 22 : 18} />}</span>
        </span>
        <span className="rt-text"><strong>{station.name}</strong><span className={dead ? 'rt-dead' : undefined}>{sub}</span></span>
      </button>
      {/* On a TV the remote would stop on every heart; there favourites are set from Now Playing. */}
      <button type="button" className={`rt-fav${favorite ? ' is-on' : ''}`} onClick={onFavorite} aria-pressed={favorite} tabIndex={document.documentElement.classList.contains('tv') ? -1 : undefined} aria-label={favorite ? `Remove ${station.name} from favorites` : `Add ${station.name} to favorites`}>
        <SvgIcon name={favorite ? 'heart' : 'heart-outline'} size={16} />
      </button>
    </div>
  );
}

/** Internet radio, laid out in sideways rows by topic. Favorites and recents follow the person. */
export default function Radio() {
  const radio = useRadio();
  const [place, setPlace] = useState(remembered);
  const [countries, setCountries] = useState<RadioPlace[]>([]);
  const [regions, setRegions] = useState<RadioPlace[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [home, setHome] = useState<RadioHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<{ favorites: RadioStation[]; recent: RadioStation[] }>({ favorites: [], recent: [] });
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ stations: RadioStation[]; more: boolean } | null>(null);

  const loadMine = useCallback(() => { api.radioMe().then(setMine).catch(() => undefined); }, []);
  useEffect(() => { loadMine(); }, [loadMine, radio.station?.id]);
  useEffect(() => { window.addEventListener('vv-radio-favorites', loadMine); return () => window.removeEventListener('vv-radio-favorites', loadMine); }, [loadMine]);
  useEffect(() => { api.radioCountries().then(r => setCountries(r.countries)).catch(() => undefined); }, []);
  useEffect(() => {
    setRegions([]);
    api.radioRegions(place.country).then(r => setRegions(r.regions)).catch(() => undefined);
    try { localStorage.setItem(KEY, JSON.stringify(place)); } catch { /* not remembered */ }
  }, [place]);
  useEffect(() => { const t = window.setTimeout(() => setQuery(typed.trim()), 350); return () => window.clearTimeout(t); }, [typed]);

  useEffect(() => {
    let alive = true;
    setError(null);
    api.radioHome(place.country, place.region, showAll)
      .then(r => { if (alive) setHome(r); })
      .catch(err => { if (alive) { setHome(null); setError((err as Error).message); } });
    return () => { alive = false; };
  }, [place, showAll]);

  useEffect(() => {
    if (!query) { setFound(null); return; }
    let alive = true;
    api.radioStations({ q: query, live: showAll ? undefined : '1', all: showAll ? '1' : undefined }).then(r => { if (alive) setFound(r); }).catch(err => { if (alive) { setFound({ stations: [], more: false }); setError((err as Error).message); } });
    return () => { alive = false; };
  }, [query, showAll]);
  const showMore = () => api.radioStations({ q: query, offset: found?.stations.length ?? 0, live: showAll ? undefined : '1', all: showAll ? '1' : undefined })
    .then(r => setFound(f => ({ stations: [...(f?.stations ?? []), ...r.stations.filter(s => !f?.stations.some(p => p.id === s.id))], more: r.more }))).catch(() => undefined);

  const favIds = useMemo(() => new Set(mine.favorites.map(s => s.id)), [mine.favorites]);
  const toggleFav = async (s: RadioStation) => {
    const next = !favIds.has(s.id);
    setMine(m => ({ ...m, favorites: next ? [s, ...m.favorites] : m.favorites.filter(f => f.id !== s.id) }));
    try { await api.radioFavorite(s.id, next); } catch { loadMine(); }
  };
  const tile = (s: RadioStation, hero?: boolean) => <Tile key={s.id} station={s} hero={hero} favorite={favIds.has(s.id)} onFavorite={() => void toggleFav(s)} />;

  // Rows with only a couple of stations fold into one tidy row at the end.
  const { rows, small } = useMemo(() => {
    const all = home?.rows ?? [];
    const seen = new Set<string>();
    const tiny = all.filter(r => r.stations.length < 3).flatMap(r => r.stations).filter(s => !seen.has(s.id) && seen.add(s.id));
    return { rows: all.filter(r => r.stations.length >= 3), small: tiny };
  }, [home]);
  const row = (id: string, title: string, list: RadioStation[]) => list.length > 0 && (
    <section key={id} className="rd-row" aria-label={title}>
      <h2 className="rd-row-title">{title}</h2>
      <ScrollRow label={title.toLowerCase()} className="rd-row-track">{list.map(s => tile(s))}</ScrollRow>
    </section>
  );

  const countryName = countries.find(c => c.code === place.country)?.name ?? place.country;
  const known = useMemo(() => [...new Map([...mine.favorites, ...mine.recent, ...(home?.featured ?? []), ...(home?.rows.flatMap(r => r.stations) ?? [])].map(s => [s.id, s])).values()].slice(0, 80), [mine, home]);

  return (
    <main className="page radio-page">
      <PageHeader icon="radio" title="Radio" sub={`Live stations from ${place.region ? `${place.region}, ` : ''}${countryName}. Press play, pause and rewind live radio, or record a show.`} />

      <div className="rd-filters">
        <label className="rd-field">
          <span>Country</span>
          <select value={place.country} onChange={e => setPlace({ country: e.target.value, region: '' })} aria-label="Country">
            {countries.map(c => <option key={c.code} value={c.code}>{flag(c.code)} {c.name}</option>)}
            {!countries.some(c => c.code === place.country) && <option value={place.country}>{flag(place.country)} {place.country}</option>}
          </select>
        </label>
        {regions.length > 0 && (
          <label className="rd-field">
            <span>Near you</span>
            <select value={place.region} onChange={e => setPlace(p => ({ ...p, region: e.target.value }))} aria-label="Region">
              <option value="">All of {countryName}</option>
              {regions.map(r => <option key={r.code} value={r.name}>{r.name}</option>)}
            </select>
          </label>
        )}
        <label className="rd-field rd-search">
          <span>Search</span>
          <input type="search" value={typed} onChange={e => setTyped(e.target.value)} placeholder="Station name" aria-label="Search stations by name" />
        </label>
      </div>

      {error && <div className="notice notice--err rd-error" role="alert"><span>Could not reach the station directory. {error}</span> <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPlace(p => ({ ...p }))}>Retry</button></div>}

      {query ? (
        <section className="rd-row" aria-label="Search results">
          <h2 className="rd-row-title">Matching stations</h2>
          {!found && <PosterSkeletons row count={8} label="Searching stations" />}
          {found?.stations.length === 0 && <EmptyState icon="radio" title="No stations match" text="Try another spelling, or clear the search." />}
          {found && found.stations.length > 0 && <div className="rd-grid">{found.stations.map(s => tile(s))}</div>}
          {found?.more && <div className="rd-more"><button type="button" className="btn btn-secondary" onClick={() => void showMore()}>Show more stations</button></div>}
        </section>
      ) : (
        <>
          {!home && !error && <PosterSkeletons row count={8} label="Finding stations" />}
          {home && (
            <>
              {(home.hidden > 0 || showAll) && (
                <p className="ui-help rd-hidden">
                  {showAll ? 'Showing every station, including the ones that are not answering.' : `${home.hidden} not answering.`}{' '}
                  <button type="button" className="rd-link" onClick={() => setShowAll(v => !v)}>{showAll ? 'Hide them' : 'Show all'}</button>
                </p>
              )}
              {home.featured.length > 0 && (
                <section className="rd-row" aria-label="On air now">
                  <h2 className="rd-row-title">On air now</h2>
                  <ScrollRow label="on air now" className="rd-row-track rd-row-track--hero">{home.featured.map(s => tile(s, true))}</ScrollRow>
                </section>
              )}
              {row('favorites', 'Your favorites', mine.favorites)}
              {row('recent', 'Recently played', mine.recent)}
              {rows.map(r => row(r.id, r.title, r.stations))}
              {row('more', 'More to explore', small)}
              {!home.featured.length && !rows.length && !small.length && <EmptyState icon="radio" title="No stations here yet" text="Try another country or region." />}
            </>
          )}
        </>
      )}

      {radio.canRecord && <RadioRecordings />}
      <RadioAlarmPanel stations={known} />
      <p className="ui-help rd-credit">Stations come from the open <a href="https://www.radio-browser.info" target="_blank" rel="noreferrer">Radio Browser</a> directory. Audio is relayed through your server, so a station never sees your address.</p>
    </main>
  );
}
