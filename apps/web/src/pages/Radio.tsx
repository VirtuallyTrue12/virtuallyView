import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type RadioPlace, type RadioStation } from '../lib/api';
import { EmptyState, PageHeader, Seg } from '../components/ui/Page';
import { ScrollRow } from '../components/ui/ScrollRow';
import { SvgIcon } from '../components/ui/SvgIcon';
import { StationLogo } from '../components/radio/StationLogo';
import { useRadio } from '../components/radio/RadioProvider';

type View = 'browse' | 'favorites' | 'recent';
const KEY = 'vv-radio-place';

const flag = (code: string) => (/^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map(c => 0x1f1e6 + c.charCodeAt(0) - 65)) : '🌐');
function remembered(): { country: string; region: string } {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { country?: string; region?: string } | null; if (v?.country) return { country: v.country, region: v.region ?? '' }; } catch { /* first visit */ }
  const fromBrowser = (navigator.language.split('-')[1] ?? '').toUpperCase();
  return { country: /^[A-Z]{2}$/.test(fromBrowser) ? fromBrowser : 'US', region: '' };
}

function StationCard({ station, playing, favorite, onPlay, onFavorite }: { station: RadioStation; playing: boolean; favorite: boolean; onPlay: () => void; onFavorite: () => void }) {
  const detail = [station.state, station.country].filter(Boolean).join(', ');
  const meta = [station.language, station.codec && station.bitrate ? `${station.codec} ${station.bitrate} kbps` : station.codec].filter(Boolean).join(' · ');
  return (
    <li className={`rs${playing ? ' is-playing' : ''}`}>
      <button type="button" className="rs-main" onClick={onPlay} aria-label={`${playing ? 'Playing' : 'Play'} ${station.name}`} aria-current={playing || undefined}>
        <StationLogo station={station} />
        <span className="rs-text">
          <strong>{station.name}</strong>
          <span>{detail}{meta ? ` · ${meta}` : ''}</span>
          {station.tags.length > 0 && <span className="rs-tags">{station.tags.join(' · ')}</span>}
        </span>
        <span className="rs-play" aria-hidden="true">{playing ? <span className="rs-eq"><i /><i /><i /></span> : <SvgIcon name="play" size={16} />}</span>
      </button>
      <button type="button" className={`rs-fav${favorite ? ' is-on' : ''}`} onClick={onFavorite} aria-pressed={favorite} aria-label={favorite ? `Remove ${station.name} from favorites` : `Add ${station.name} to favorites`}>
        <SvgIcon name={favorite ? 'heart' : 'heart-outline'} size={18} />
      </button>
    </li>
  );
}

/** Internet radio: pick a country and region, a genre or a name, and press play. Favorites and recents follow the person. */
export default function Radio() {
  const radio = useRadio();
  const [view, setView] = useState<View>('browse');
  const [place, setPlace] = useState(remembered);
  const [countries, setCountries] = useState<RadioPlace[]>([]);
  const [regions, setRegions] = useState<RadioPlace[]>([]);
  const [tags, setTags] = useState<Array<{ name: string; stations: number }>>([]);
  const [tag, setTag] = useState('');
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
    return () => { alive = false; };
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

  const shown = view === 'browse' ? stations : view === 'favorites' ? mine.favorites : mine.recent;
  const countryName = countries.find(c => c.code === place.country)?.name ?? '';
  const where = place.country ? `${place.region ? `${place.region}, ` : ''}${countryName || place.country}` : 'the whole world';

  return (
    <main className="page radio-page">
      <PageHeader
        icon="radio"
        title="Radio"
        sub={view === 'browse' ? `Live stations from ${where}. Pick a country, a region or a style and press play.` : view === 'favorites' ? 'Stations you saved.' : 'Stations you listened to lately.'}
        actions={<Seg<View> label="Radio view" value={view} onChange={setView} options={[{ value: 'browse', label: 'Browse' }, { value: 'favorites', label: 'Favorites', count: mine.favorites.length }, { value: 'recent', label: 'Recent' }]} />}
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
            <label className="rd-field rd-search">
              <span>Search</span>
              <input type="search" value={typed} onChange={e => setTyped(e.target.value)} placeholder="Station name" aria-label="Search stations by name" />
            </label>
          </div>
          {tags.length > 0 && (
            <ScrollRow label="Genres" className="rd-tags">
              <button type="button" className={`rd-chip${tag === '' ? ' is-on' : ''}`} onClick={() => setTag('')}>All styles</button>
              {tags.map(t => <button key={t.name} type="button" className={`rd-chip${tag === t.name ? ' is-on' : ''}`} onClick={() => setTag(tag === t.name ? '' : t.name)}>{t.name}</button>)}
            </ScrollRow>
          )}
          {worldwide && <p className="ui-help">Searching every country.</p>}
        </>
      )}

      {error && <div className="notice notice--err" role="alert">{error} <button type="button" className="mp-link" onClick={() => setPlace(p => ({ ...p }))}>Try again</button></div>}
      {loading && shown.length === 0 && !error && <div className="loading-state">Finding stations…</div>}
      {!loading && !error && shown.length === 0 && (
        <EmptyState icon="radio"
          title={view === 'favorites' ? 'No favorites yet' : view === 'recent' ? 'Nothing played yet' : 'No stations match'}
          text={view === 'favorites' ? 'Press the heart on a station to keep it here.' : view === 'recent' ? 'Stations you play show up here.' : 'Try another region or style, or clear the search.'} />
      )}
      {shown.length > 0 && (
        <ul className="rs-grid">
          {shown.map(s => <StationCard key={s.id} station={s} playing={radio.station?.id === s.id && radio.state !== 'idle'} favorite={favIds.has(s.id)} onPlay={() => (radio.station?.id === s.id ? radio.toggle() : radio.play(s))} onFavorite={() => void toggleFav(s)} />)}
        </ul>
      )}
      {view === 'browse' && more && <div className="rd-more"><button type="button" className="btn btn-secondary" onClick={loadMore} disabled={loading}>{loading ? 'Loading…' : 'Show more stations'}</button></div>}
      <p className="ui-help rd-credit">Stations come from the open <a href="https://www.radio-browser.info" target="_blank" rel="noreferrer">Radio Browser</a> directory. Audio is relayed through your server, so a station never sees your address.</p>
    </main>
  );
}
