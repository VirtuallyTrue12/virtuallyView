import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type LiveChannel, type LivePlaylist, type LiveProgramme, type RecordingRule, type ScheduledRecording } from '../lib/api';
import { EmptyState, PageHeader, Pill, Seg, Switch } from '../components/ui/Page';
import { Dialog } from '../components/ui/Dialog';
import { MenuItem, MoreMenu } from '../components/ui/MoreMenu';
import { SvgIcon } from '../components/ui/SvgIcon';
import { ScrollRow } from '../components/ui/ScrollRow';
import { LivePlayer } from '../components/live/LivePlayer';
import { GuideGrid } from '../components/live/GuideGrid';
import { Highlights, OnNow } from '../components/live/Highlights';
import { Skeleton } from '../components/ui/Skeleton';

interface Recording { id: string; title: string; channel: string; startedAt: string; endsAt: string; state: 'recording' | 'done' | 'failed' | 'stopped'; message?: string; sizeBytes: number }
type View = 'favorites' | 'recent' | 'channels' | 'guide' | 'recordings';
const BASE = 'https://iptv-org.github.io/iptv';
interface Preset { name: string; url: string; only?: string }
// Free public lists from the iptv-org project. The combined list holds everything (and every dead or
// geo-blocked stream); these smaller ones are easier to browse. Channels in several lists show once.
const PRESET_GROUPS: { title: string; items: Preset[] }[] = [
  { title: 'Everything', items: [{ name: 'Free public: Everything', url: `${BASE}/index.m3u` }] },
  { title: 'India and its languages', items: [
    { name: 'India', url: `${BASE}/countries/in.m3u` },
    ...([['Hindi', 'hin'], ['Tamil', 'tam'], ['Telugu', 'tel'], ['Malayalam', 'mal'], ['Kannada', 'kan'], ['Bengali', 'ben'], ['Marathi', 'mar'], ['Gujarati', 'guj'], ['Punjabi', 'pan']] as const).map(([name, code]) => ({ name, url: `${BASE}/languages/${code}.m3u` }))
  ] },
  { title: 'English', items: [{ name: 'English news', url: `${BASE}/languages/eng.m3u`, only: 'News' }] },
  { title: 'Topics', items: [
    ...['News', 'Sports', 'Movies', 'Music', 'Kids', 'Documentary'].map(t => ({ name: `Free public: ${t}`, url: `${BASE}/categories/${t.toLowerCase()}.m3u` })),
    ...['Science', 'Education', 'Entertainment', 'General', 'Family', 'Lifestyle', 'Travel', 'Animation', 'Classic', 'Comedy', 'Outdoor', 'Culture', 'Weather', 'Legislative'].map(t => ({ name: t, url: `${BASE}/categories/${t.toLowerCase()}.m3u` }))
  ] }
];
// Space has no list of its own: it is a word search across the channels you already have.
const SPACE = /nasa|space|cosmos|astronom|\besa\b|universe/i;
const regionName = (code: string) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? code.toUpperCase(); } catch { return code.toUpperCase(); } };
const mb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`);
const PAGE = 120;

async function recJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(body.message ?? `Request failed (${res.status}).`);
  return body;
}

/** What is on now and next for a set of channels, refreshed every few minutes; asks again while a big guide is still loading. */
function useGuide(ids: string[], hours: number, enabled: boolean) {
  const [guide, setGuide] = useState<Record<string, LiveProgramme[]>>({});
  const key = ids.join(',');
  useEffect(() => {
    if (!enabled || !key) return;
    let alive = true;
    let timer: number | undefined;
    let tries = 0;
    const run = () => {
      api.liveGuide(key.split(','), hours).then(r => {
        if (!alive) return;
        setGuide(prev => ({ ...prev, ...r.programmes }));
        if (!r.ready && tries++ < 10) timer = window.setTimeout(run, 5000);
        else timer = window.setTimeout(run, 5 * 60_000);
      }).catch(() => { if (alive && tries++ < 3) timer = window.setTimeout(run, 8000); });
    };
    run();
    return () => { alive = false; if (timer) window.clearTimeout(timer); };
  }, [key, hours, enabled]);
  return guide;
}

const nowNext = (list: LiveProgramme[] | undefined, at = Date.now()) => {
  const i = (list ?? []).findIndex(p => p.stop > at);
  const now = i >= 0 && list![i]!.start <= at ? list![i] : undefined;
  const next = i >= 0 ? (now ? list![i + 1] : list![i]) : undefined;
  return { now, next };
};

function ChannelRow({ c, index, now, playing, fav, dead, onPlay, onFavorite }: { c: LiveChannel; index: number; now?: LiveProgramme | undefined; playing: boolean; fav: boolean; dead: boolean; onPlay: () => void; onFavorite: () => void }) {
  const [logoBad, setLogoBad] = useState(false);
  const pct = now ? Math.min(100, Math.max(0, ((Date.now() - now.start) / (now.stop - now.start)) * 100)) : 0;
  return (
    <li className={`lv-row${playing ? ' is-playing' : ''}${dead ? ' is-dead' : ''}`}>
      <button type="button" className="lv-row-main" onClick={onPlay} aria-label={`Watch ${c.name}`} aria-current={playing || undefined}>
        <span className="lv-idx">{index + 1}</span>
        <span className="lv-logo">{c.logo && !logoBad ? <img src={c.logo} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setLogoBad(true)} /> : <span>{c.name.charAt(0)}</span>}</span>
        <span className="lv-text">
          <strong>{c.name}</strong>
          <span>{now ? <>{now.title}<em> · {Math.max(1, Math.round((now.stop - Date.now()) / 60_000))} min left</em></> : c.group?.split(';')[0] ?? 'Live'}</span>
          {now && <span className="lv-mini"><span style={{ width: `${pct}%` }} /></span>}
        </span>
        {dead ? <Pill tone="bad">May not work</Pill> : c.working && !playing ? <span className="lv-ok" role="img" aria-label="Working" title="Checked: this stream answers" /> : null}
        {playing && <Pill tone="ok">Playing</Pill>}
      </button>
      <button type="button" className={`lv-heart${fav ? ' is-on' : ''}`} onClick={onFavorite} aria-pressed={fav} aria-label={fav ? `Remove ${c.name} from favorites` : `Favorite ${c.name}`}><SvgIcon name={fav ? 'heart' : 'heart-outline'} size={17} /></button>
    </li>
  );
}

/** Live TV from M3U playlists you add: favorites, a program guide, zapping and recording. */
export default function LiveTV() {
  const [params, setParams] = useSearchParams();
  const [playlists, setPlaylists] = useState<LivePlaylist[] | null>(null);
  const [channels, setChannels] = useState<LiveChannel[]>([]);
  const [problem, setProblem] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isKid, setIsKid] = useState(false);
  const [sched, setSched] = useState<{ items: ScheduledRecording[]; series: RecordingRule[] }>({ items: [], series: [] });
  const [prog, setProg] = useState<{ c: LiveChannel; p: LiveProgramme } | null>(null);
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [recent, setRecent] = useState<string[]>([]);
  const [dead, setDead] = useState<Set<string>>(new Set());
  const [hideDead, setHideDead] = useState(true);
  const [current, setCurrent] = useState<LiveChannel | null>(null);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [place, setPlace] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [sources, setSources] = useState(false);
  const [recDialog, setRecDialog] = useState(false);
  const [minutes, setMinutes] = useState(60);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [watching, setWatching] = useState<Recording | null>(null);
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [wide, setWide] = useState(() => { try { return localStorage.getItem('vv-live-wide') === '1'; } catch { return false; } });
  const toggleWide = () => setWide(w => { const n = !w; try { localStorage.setItem('vv-live-wide', n ? '1' : '0'); } catch { /* storage blocked */ } return n; });
  const [digits, setDigits] = useState('');
  const digitTimer = useRef<number | null>(null);

  const requested = params.get('v');
  const wantedChannel = params.get('ch');
  const load = useCallback(async () => {
    try {
      const { playlists: list } = await api.livePlaylists();
      // Channels first, so the page never flashes "No channels match" between the two answers.
      if (list.length) { const r = await api.liveChannels(); setChannels(r.channels); setProblem(r.problems.join(' ')); } else setChannels([]);
      setPlaylists(list);
    } catch (err) { setProblem((err as Error).message); setPlaylists(prev => prev ?? []); }
  }, []);
  const loadMe = useCallback(() => { api.liveMe().then(r => { setFavs(new Set(r.favorites)); setRecent(r.recent); setDead(new Set(r.dead)); }).catch(() => {}); }, []);
  const loadRecordings = useCallback(async () => { try { setRecordings((await recJSON<{ recordings: Recording[] }>('/api/live/recordings')).recordings); } catch { /* offline */ } }, []);
  const loadSchedule = useCallback(async () => { try { const r = await api.liveSchedule(); setSched(r); return r; } catch { return null; } }, []);
  useEffect(() => { void load(); loadMe(); void loadRecordings(); void loadSchedule(); api.authStatus().then(s => { setIsAdmin(s.user?.role === 'admin' || !s.enabled); setIsKid(!!s.user?.isKid); }).catch(() => {}); }, [load, loadMe, loadRecordings, loadSchedule]);
  useEffect(() => { const t = window.setInterval(loadMe, 120_000); return () => window.clearInterval(t); }, [loadMe]);
  useEffect(() => { const t = window.setInterval(() => { void loadSchedule(); void loadRecordings(); }, 30_000); return () => window.clearInterval(t); }, [loadSchedule, loadRecordings]);
  useEffect(() => {
    if (!recordings.some(r => r.state === 'recording')) return;
    const t = window.setInterval(() => void loadRecordings(), 5000);
    return () => window.clearInterval(t);
  }, [recordings, loadRecordings]);

  const byId = useMemo(() => new Map(channels.map(c => [c.id, c])), [channels]);
  // A link from Search (?ch=id) tunes straight to that channel.
  useEffect(() => { const c = wantedChannel && channels.find(x => x.id === wantedChannel); if (c) setCurrent(c); }, [wantedChannel, channels]);
  const view: View = (['favorites', 'recent', 'channels', 'guide', 'recordings'].includes(requested ?? '') ? requested : favs.size ? 'favorites' : 'channels') as View;
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of channels) if (c.group) for (const g of c.group.split(';')) counts.set(g.trim(), (counts.get(g.trim()) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([g]) => g);
  }, [channels]);
  // Where and in what language: India first, the biggest countries, the language lists you added, and Space.
  const places = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of channels) if (c.country) counts.set(c.country, (counts.get(c.country) ?? 0) + 1);
    const top = [...counts].sort((a, b) => (b[0] === 'in' ? 1 : 0) - (a[0] === 'in' ? 1 : 0) || b[1] - a[1]).slice(0, 10).map(([code]) => ({ key: `c:${code}`, label: regionName(code) }));
    const langs = (playlists ?? []).filter(p => p.url.includes('/languages/') && !p.only).map(p => ({ key: `l:${p.id}`, label: p.name }));
    return [...top, ...langs, ...(channels.some(c => SPACE.test(c.name)) ? [{ key: 'space', label: 'Space' }] : [])];
  }, [channels, playlists]);
  const inPlace = useCallback((c: LiveChannel) => !place || (place === 'space' ? SPACE.test(c.name) : place.startsWith('c:') ? c.country === place.slice(2) : (c.lists ?? [c.playlist]).includes(place.slice(2))), [place]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = view === 'favorites' ? channels.filter(c => favs.has(c.id)) : view === 'recent' ? recent.map(id => byId.get(id)).filter((c): c is LiveChannel => !!c) : channels;
    return base.filter(c => inPlace(c) && (!group || (c.group ?? '').split(';').map(g => g.trim()).includes(group)) && (!q || c.name.toLowerCase().includes(q)) && !(hideDead && dead.has(c.id) && view !== 'favorites'));
  }, [channels, favs, recent, byId, view, group, query, hideDead, dead, inPlace]);
  useEffect(() => { setShown(PAGE); }, [view, group, place, query]);
  const visible = filtered.slice(0, shown);

  const guideIds = (view === 'guide' ? filtered.slice(0, 40) : visible.slice(0, 60)).filter(c => c.guide).map(c => c.id);
  const currentGuide = current?.guide ? [current.id] : [];
  // "On now": your favourites and recent channels; with neither yet, the first channels of the list.
  const featured = useMemo(() => {
    const mine = [...new Set([...favs, ...recent])].map(id => byId.get(id)).filter((c): c is LiveChannel => !!c?.guide && !dead.has(c.id));
    return (mine.length || favs.size || recent.length ? mine : channels.filter(c => c.guide && !dead.has(c.id))).slice(0, 16);
  }, [favs, recent, byId, channels, dead]);
  const guide = useGuide([...new Set([...guideIds, ...currentGuide, ...featured.map(c => c.id)])], view === 'guide' ? 6 : 3, view !== 'recordings');
  const onNow = featured.flatMap(c => { const n = nowNext(guide[c.id]).now; return n ? [{ channel: c, now: n }] : []; }).slice(0, 12);
  const hasAnyGuide = channels.some(c => c.guide);

  // Scheduled recordings: red dots in the guide, and the programme dialog's choices.
  const waiting = sched.items.filter(i => i.state === 'scheduled');
  const problems = sched.items.filter(i => i.state === 'failed' || i.state === 'missed' || i.state === 'conflict');
  const scheduledKeys = useMemo(() => new Set(sched.items.filter(i => ['scheduled', 'recording'].includes(i.state)).map(i => `${i.channel_id}|${i.prog_start}`)), [sched.items]);
  const progItem = prog ? sched.items.find(i => i.channel_id === prog.c.id && i.prog_start === prog.p.start && ['scheduled', 'recording'].includes(i.state)) : undefined;
  const clockOf = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const scheduleProg = async (series?: boolean | 'any') => {
    if (!prog) return;
    const { c, p } = prog;
    setProg(null);
    try {
      await api.liveScheduleAdd({ channelId: c.id, start: p.start, stop: p.stop, title: p.title, sub: p.sub, ...(series ? { series } : {}) });
      const r = await loadSchedule();
      const clash = r?.items.find(i => i.channel_id === c.id && i.prog_start === p.start)?.conflict;
      setNote(clash ? { tone: 'err', text: `"${p.title}" overlaps other recordings and will not record unless one of them is cancelled.` } : { tone: 'ok', text: series ? `Recording every "${p.title}"${series === 'any' ? '' : ` on ${c.name}`}. See Recordings.` : `Scheduled "${p.title}" at ${clockOf(p.start)}. See Recordings.` });
    } catch (err) { setNote({ tone: 'err', text: (err as Error).message }); }
  };
  const cancelItem = async (call: () => Promise<unknown>) => { setProg(null); await call().catch(err => setNote({ tone: 'err', text: (err as Error).message })); await loadSchedule(); };

  const play = useCallback((c: LiveChannel) => { setCurrent(c); }, []);
  const zap = useCallback((by: number) => {
    if (!filtered.length) return;
    const at = current ? filtered.findIndex(c => c.id === current.id) : -1;
    const next = filtered[(at + by + filtered.length) % filtered.length];
    if (next) setCurrent(next);
  }, [filtered, current]);
  const numberOf = current ? Math.max(1, filtered.findIndex(c => c.id === current.id) + 1) : 0;

  // Remote-control style zapping: arrows, page keys and typing a channel number.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === 'ArrowUp' && current && e.altKey === false && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); zap(-1); }
      else if (e.key === 'ArrowDown' && current && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); zap(1); }
      else if (e.key === 'PageUp' || e.key === 'ChannelUp') { e.preventDefault(); zap(-1); }
      else if (e.key === 'PageDown' || e.key === 'ChannelDown') { e.preventDefault(); zap(1); }
      else if (/^[0-9]$/.test(e.key) && filtered.length) {
        const next = (digits + e.key).slice(-4);
        setDigits(next);
        if (digitTimer.current) window.clearTimeout(digitTimer.current);
        digitTimer.current = window.setTimeout(() => { const c = filtered[Number(next) - 1]; if (c) setCurrent(c); setDigits(''); }, 1100);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zap, current, filtered, digits]);

  const toggleFavorite = (id: string) => {
    const on = !favs.has(id);
    setFavs(prev => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
    api.liveFavorite(id, on).catch(() => loadMe());
  };

  const record = async () => {
    if (!current) return;
    setRecDialog(false);
    try { await recJSON('/api/live/record', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId: current.id, minutes }) }); setNote({ tone: 'ok', text: `Recording ${current.name} for ${minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`}. Find it under Recordings.` }); await loadRecordings(); }
    catch (err) { setNote({ tone: 'err', text: (err as Error).message }); }
  };
  const recAction = async (path: string, method: 'POST' | 'DELETE') => {
    await recJSON(path, { method }).catch(err => setNote({ tone: 'err', text: (err as Error).message }));
    if (method === 'DELETE') setWatching(null);
    await loadRecordings();
  };

  const checkChannels = async () => {
    const list = filtered.slice(0, 300).map(c => c.id);
    if (!list.length) return;
    setChecking({ done: 0, total: list.length });
    let deadFound = 0;
    try {
      for (let i = 0; i < list.length; i += 40) {
        const r = await api.liveHealth(list.slice(i, i + 40));
        deadFound += r.dead.length;
        setDead(prev => { const n = new Set(prev); r.dead.forEach(id => n.add(id)); r.alive.forEach(id => n.delete(id)); return n; });
        setChecking({ done: Math.min(list.length, i + 40), total: list.length });
      }
      setNote({ tone: 'ok', text: `Checked ${list.length} channels: ${deadFound} did not answer${deadFound ? ' and are hidden now (turn on "Show channels that may not work" to see them)' : ''}.` });
    } catch (err) { setNote({ tone: 'err', text: (err as Error).message }); }
    setChecking(null);
  };

  const setView = (v: View) => setParams(v === 'channels' ? { v } : { v });
  const empty = playlists !== null && playlists.length === 0;
  const cn = current ? nowNext(guide[current.id]) : { now: undefined, next: undefined };

  return (
    <main className={`page lv-page${current ? ' has-player' : ''}${wide ? ' lv-wide' : ''}`}>
      <PageHeader
        title="Live TV"
        sub={channels.length ? `${channels.length.toLocaleString()} channels${favs.size ? ` · ${favs.size} favorite${favs.size === 1 ? '' : 's'}` : ''}${dead.size ? ` · ${dead.size} may not work` : ''}` : undefined}
        actions={isAdmin ? <>
          {!empty && playlists !== null && <button type="button" className="btn btn-secondary" onClick={() => setSources(true)}><SvgIcon name="list" size={17} /> Sources</button>}
          {!empty && playlists !== null && <MoreMenu label="More for Live TV">
            <MenuItem icon="activity" label={checking ? `Checking… ${checking.done}/${checking.total}` : 'Check which channels work'} hint="Tests the channels shown and hides dead ones" disabled={!!checking || filtered.length === 0} onSelect={() => void checkChannels()} />
            <MenuItem icon="refresh" label="Reload channel lists" onSelect={() => void load()} />
          </MoreMenu>}
        </> : undefined}
      />

      {note && <div className={`notice notice--${note.tone}`} role="status">{note.text}</div>}
      {problem && !empty && <div className="notice notice--err" role="alert">{problem}</div>}
      {playlists === null && (
        <div className="lv-skel" role="status" aria-label="Loading channels">
          <div className="lv-skel-row">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="lv-skel-card" />)}</div>
          <Skeleton className="skeleton-line" style={{ width: 320, height: 36, margin: '28px 0 20px' }} />
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="lv-skel-item"><Skeleton className="lv-skel-logo" /><div><Skeleton className="skeleton-line" style={{ width: 180 }} /><Skeleton className="skeleton-line" style={{ width: 260, marginTop: 8, opacity: 0.6 }} /></div></div>)}
        </div>
      )}
      {empty && (
        <EmptyState icon="tv" title="No channels yet" text={isAdmin ? 'Add a channel playlist (M3U) from your tuner box or provider, or pick a free public list. Only add streams you have the right to watch.' : 'An administrator needs to add a channel playlist first.'}
          action={isAdmin ? <button type="button" className="btn btn-primary" onClick={() => setSources(true)}><SvgIcon name="plus" size={17} /> Add a playlist</button> : undefined} />
      )}

      {playlists && playlists.length > 0 && (
        <div className="lv">
          <div className="lv-main">
            {view !== 'recordings' && view !== 'guide' && <OnNow items={onNow} playingId={current?.id} onWatch={play} />}
            {view !== 'recordings' && <Highlights channels={byId} playingId={current?.id} onWatch={play} />}
            <div className="rq-toolbar">
              <Seg<View> label="Live TV views" value={view} onChange={setView} options={[
                { value: 'favorites', label: 'Favorites', count: favs.size }, { value: 'recent', label: 'Recent' }, { value: 'channels', label: 'All channels' },
                { value: 'guide', label: 'Guide' }, { value: 'recordings', label: 'Recordings', count: recordings.length + waiting.length }
              ]} />
              {view !== 'recordings' && <input className="settings-input ph-search" type="search" placeholder="Find a channel" value={query} onChange={e => setQuery(e.target.value)} aria-label="Find a channel" />}
            </div>

            {view !== 'recordings' && places.length > 0 && (
              <ScrollRow className="lv-chips" label="countries and languages"><div className="lv-chips-inner" role="tablist" aria-label="Country or language">
                <button type="button" role="tab" aria-selected={!place} className={`md-chip${!place ? ' is-on' : ''}`} onClick={() => setPlace('')}>Everywhere</button>
                {places.map(p => <button key={p.key} type="button" role="tab" aria-selected={place === p.key} className={`md-chip${place === p.key ? ' is-on' : ''}`} onClick={() => setPlace(place === p.key ? '' : p.key)}>{p.label}</button>)}
              </div></ScrollRow>
            )}
            {view !== 'recordings' && groups.length > 0 && (
              <ScrollRow className="lv-chips" label="categories"><div className="lv-chips-inner" role="tablist" aria-label="Category">
                <button type="button" role="tab" aria-selected={!group} className={`md-chip${!group ? ' is-on' : ''}`} onClick={() => setGroup('')}>All</button>
                {groups.map(g => <button key={g} type="button" role="tab" aria-selected={group === g} className={`md-chip${group === g ? ' is-on' : ''}`} onClick={() => setGroup(group === g ? '' : g)}>{g}</button>)}
              </div></ScrollRow>
            )}
            {view !== 'recordings' && dead.size > 0 && (
              <label className="lv-toggle"><Switch checked={!hideDead} onChange={v => setHideDead(!v)} label="Show channels that may not work" /> <span>Show channels that may not work ({dead.size})</span></label>
            )}

            {view === 'guide' && (hasAnyGuide
              ? <GuideGrid channels={filtered.slice(0, 40)} guide={guide} playingId={current?.id} onPlay={play} favorites={favs} scheduled={scheduledKeys} onProgramme={isKid ? undefined : (c, p) => setProg({ c, p })} />
              : <EmptyState icon="calendar" title="No program guide yet" text={<>The guide needs an XMLTV file. Many playlists include one; if yours does not, add its guide address under <strong>Sources</strong>. Until then you still see every channel in the other tabs.</>} action={isAdmin ? <button className="btn btn-primary" type="button" onClick={() => setSources(true)}>Open sources</button> : undefined} />)}

            {(view === 'favorites' || view === 'recent' || view === 'channels') && (
              filtered.length === 0
                ? <EmptyState icon={view === 'favorites' ? 'heart-outline' : view === 'recent' ? 'clock' : 'search'} title={view === 'favorites' ? 'No favorites yet' : view === 'recent' ? 'Nothing watched yet' : 'No channels match'} text={view === 'favorites' ? 'Tap the heart on any channel to keep it here.' : view === 'recent' ? 'Channels you watch appear here so you can jump back to them.' : 'Try another word or category.'} action={view !== 'channels' ? <button className="btn btn-secondary" type="button" onClick={() => setView('channels')}>Browse all channels</button> : undefined} />
                : <>
                  <ul className="lv-list">
                    {visible.map((c, i) => <ChannelRow key={c.id} c={c} index={i} now={nowNext(guide[c.id]).now} playing={current?.id === c.id} fav={favs.has(c.id)} dead={dead.has(c.id)} onPlay={() => play(c)} onFavorite={() => toggleFavorite(c.id)} />)}
                  </ul>
                  {shown < filtered.length && <button type="button" className="btn btn-secondary lv-more" onClick={() => setShown(n => n + PAGE)}>Show more ({filtered.length - shown} left)</button>}
                </>
            )}

            {view === 'recordings' && (
              <div className="lv-recs">
                {watching && <video className="lv-video lv-video--rec" controls autoPlay playsInline src={`/api/live/recordings/${watching.id}/file`} />}
                {recordings.length + waiting.length + problems.length + sched.series.length === 0 && <EmptyState icon="radio" title="No recordings" text="Pick a programme in the guide to record it, or press Record while watching a channel." action={<button type="button" className="btn btn-primary" onClick={() => setView('guide')}>Open the guide</button>} />}
                {waiting.length > 0 && <h2 className="lv-sec">Scheduled</h2>}
                <ul className="dl-list">
                  {waiting.map(i => (
                    <li key={i.id} className="dl">
                      <div className="rq-poster dl-art"><span className="lv-rec"><SvgIcon name="film" size={22} /></span></div>
                      <div className="dl-main"><div className="rq-title-row"><h3 className="rq-title">{i.title}{i.sub ? `: ${i.sub}` : ''}</h3>{i.conflict && <Pill tone="bad">Will not record</Pill>}</div>
                        <p className="dl-line">{i.channel}<span>{new Date(i.prog_start).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>{i.conflict && <span>Overlaps other recordings</span>}</p></div>
                      <div className="rq-actions"><button type="button" className="btn btn-secondary" aria-label={`Cancel ${i.title}`} onClick={() => void cancelItem(() => api.liveScheduleCancel(i.id))}>Cancel</button></div>
                    </li>
                  ))}
                </ul>
                {sched.series.length > 0 && <h2 className="lv-sec">Series rules</h2>}
                <ul className="dl-list">
                  {sched.series.map(s => (
                    <li key={s.id} className="dl">
                      <div className="dl-main"><div className="rq-title-row"><h3 className="rq-title">{s.title}</h3></div><p className="dl-line">{s.channel ?? 'Any channel'}</p></div>
                      <div className="rq-actions"><button type="button" className="btn btn-secondary" aria-label={`Delete rule for ${s.title}`} onClick={() => void cancelItem(() => api.liveSeriesDelete(s.id))}>Delete rule</button></div>
                    </li>
                  ))}
                </ul>
                {problems.length > 0 && <h2 className="lv-sec">Failed or missed</h2>}
                <ul className="dl-list">
                  {problems.map(i => (
                    <li key={i.id} className="dl">
                      <div className="dl-main"><div className="rq-title-row"><h3 className="rq-title">{i.title}{i.sub ? `: ${i.sub}` : ''}</h3><Pill tone="bad">{i.state === 'missed' ? 'Missed' : i.state === 'conflict' ? 'Conflict' : 'Failed'}</Pill></div>
                        <p className="dl-line">{i.channel}<span>{new Date(i.prog_start).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>{i.message ? <span>{i.message}</span> : null}</p></div>
                      <div className="rq-actions"><button type="button" className="btn btn-secondary" aria-label={`Dismiss ${i.title}`} onClick={() => void cancelItem(() => api.liveScheduleCancel(i.id))}>Dismiss</button></div>
                    </li>
                  ))}
                </ul>
                {recordings.length > 0 && <h2 className="lv-sec">Recorded</h2>}
                <ul className="dl-list">
                  {recordings.map(r => (
                    <li key={r.id} className="dl">
                      <div className="rq-poster dl-art"><span className={r.state === 'recording' ? 'lv-rec' : undefined}><SvgIcon name="film" size={22} /></span></div>
                      <div className="dl-main"><div className="rq-title-row"><h3 className="rq-title">{r.title}</h3><Pill tone={r.state === 'recording' ? 'bad' : r.state === 'done' ? 'ok' : r.state === 'failed' ? 'bad' : 'neutral'}>{r.state === 'recording' ? 'Recording' : r.state === 'done' ? 'Finished' : r.state === 'stopped' ? 'Stopped' : 'Failed'}</Pill></div>
                        <p className="dl-line">{r.state === 'recording' ? `Until ${new Date(r.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : new Date(r.startedAt).toLocaleString()}{r.sizeBytes ? <span>{mb(r.sizeBytes)}</span> : null}{r.message ? <span>{r.message}</span> : null}</p></div>
                      <div className="rq-actions">
                        {r.sizeBytes > 0 && r.state !== 'failed' && <button type="button" className="btn btn-primary" onClick={() => setWatching(r)}><SvgIcon name="play" size={16} /> Watch</button>}
                        {r.state === 'recording' && <button type="button" className="btn btn-secondary" onClick={() => void recAction(`/api/live/record/${r.id}/stop`, 'POST')}>Stop</button>}
                        {isAdmin && <MoreMenu label={`More for ${r.title}`}><MenuItem icon="trash" label="Delete recording" danger onSelect={() => void recAction(`/api/live/recordings/${r.id}`, 'DELETE')} /></MoreMenu>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {current && (
            <aside className="lv-side">
              <LivePlayer channel={current} number={numberOf} now={cn.now} next={cn.next} favorite={favs.has(current.id)} onFavorite={() => toggleFavorite(current.id)} onZap={zap} onRecord={() => setRecDialog(true)} onClose={() => setCurrent(null)} wide={wide} onWide={toggleWide}
                onPlaying={() => { api.liveWatched(current.id).then(() => setRecent(prev => [current.id, ...prev.filter(id => id !== current.id)].slice(0, 20))).catch(() => {}); }} />
            </aside>
          )}
        </div>
      )}

      {digits && <div className="lv-digits" role="status" aria-live="polite">{digits}{byId.size && filtered[Number(digits) - 1] ? ` · ${filtered[Number(digits) - 1]!.name}` : ''}</div>}

      <Dialog open={recDialog} onClose={() => setRecDialog(false)} title={`Record ${current?.name ?? 'this channel'}`}>
        <p className="dlg-help">The recording is saved on the server and appears under Recordings. Free space is your limit.</p>
        <label className="lib-dialog-field"><span>For how long?</span>
          <select className="settings-input" value={minutes} onChange={e => setMinutes(Number(e.target.value))} aria-label="Record for">
            {[15, 30, 60, 120, 180, 240].map(m => <option key={m} value={m}>{m >= 60 ? `${m / 60} hour${m > 60 ? 's' : ''}` : `${m} minutes`}</option>)}
          </select>
        </label>
        <div className="dlg-actions"><button type="button" className="btn btn-primary" onClick={() => void record()}><span className="lv-rec" aria-hidden="true" /> Start recording</button><button type="button" className="btn btn-secondary" onClick={() => setRecDialog(false)}>Cancel</button></div>
      </Dialog>

      <Dialog open={!!prog} onClose={() => setProg(null)} title={prog?.p.title ?? ''}>
        {prog && <>
          <p className="dlg-help">{prog.c.name} · {clockOf(prog.p.start)}–{clockOf(prog.p.stop)}{prog.p.sub ? ` · ${prog.p.sub}` : ''}</p>
          {prog.p.desc && <p className="dlg-help">{prog.p.desc}</p>}
          {progItem?.conflict && <p className="dlg-help">This overlaps other recordings and will not record unless one of them is cancelled.</p>}
          <div className="dlg-actions lv-prog-actions">
            {prog.p.start <= Date.now() && prog.p.stop > Date.now() && <button type="button" className="btn btn-primary" data-autofocus onClick={() => { play(prog.c); setProg(null); }}><SvgIcon name="play" size={16} /> Watch now</button>}
            {prog.p.stop > Date.now() && (progItem
              ? <button type="button" className="btn btn-secondary" data-autofocus onClick={() => void cancelItem(() => api.liveScheduleCancel(progItem.id))}>Cancel recording</button>
              : <button type="button" className="btn btn-secondary" data-autofocus onClick={() => void scheduleProg()}><span className="lv-rec" aria-hidden="true" /> Record</button>)}
            {prog.p.stop > Date.now() && <button type="button" className="btn btn-secondary" onClick={() => void scheduleProg(true)}>Record series</button>}
            {prog.p.stop > Date.now() && <button type="button" className="btn btn-secondary" onClick={() => void scheduleProg('any')}>Record series, any channel</button>}
            <button type="button" className="btn btn-secondary" onClick={() => setProg(null)}>Close</button>
          </div>
        </>}
      </Dialog>

      <SourcesDialog open={sources} onClose={() => setSources(false)} playlists={playlists ?? []} onChanged={() => void load()} />
    </main>
  );
}

function SourcesDialog({ open, onClose, playlists, onChanged }: { open: boolean; onClose: () => void; playlists: LivePlaylist[]; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [epg, setEpg] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const add = async (event: FormEvent, preset?: Preset) => {
    event.preventDefault();
    setBusy(true); setErr('');
    try { await api.addLivePlaylist(preset?.name ?? name, preset?.url ?? url.trim(), epg.trim(), preset?.only); setName(''); setUrl(''); setEpg(''); onChanged(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Channel sources" wide>
      <p className="dlg-help">Add several playlists if you like: channels from all of them appear together. Channels marked geo-blocked only play in their own country, and "not 24/7" ones only at certain hours.</p>
      <ul className="st-list">
        {playlists.map(p => (
          <li className="st-row" key={p.id}><div className="st-row-main">
            <div className="st-row-text"><strong>{p.name}</strong><span>{p.url.replace(/^https?:\/\//, '').slice(0, 70)}</span></div>
            {p.epgUrl && <Pill tone="info">Own guide</Pill>}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void api.removeLivePlaylist(p.id).then(onChanged).catch(e => setErr((e as Error).message))}>Remove</button>
          </div></li>
        ))}
        {playlists.length === 0 && <li className="ui-help">No sources yet.</li>}
      </ul>
      <form className="st-connect" onSubmit={e => void add(e)} style={{ padding: 0, border: 0, marginTop: '1rem' }}>
        <label>Name<input className="settings-input" value={name} onChange={e => setName(e.target.value)} placeholder="My channels" /></label>
        <label>Playlist address (M3U)<input className="settings-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="http://192.168.1.5:9981/playlist" required /></label>
        <label>Program guide address (optional, XMLTV)<input className="settings-input" value={epg} onChange={e => setEpg(e.target.value)} placeholder="Only if the playlist has no guide of its own" /></label>
        {err && <div className="notice notice--err" role="alert">{err}</div>}
        <div className="st-connect-actions">
          <button className="btn btn-primary" type="submit" disabled={busy || !url.trim()}>{busy ? 'Adding…' : 'Add playlist'}</button>
        </div>
      </form>
      <p className="dlg-help" style={{ marginTop: '1rem' }}>Or add free public lists with one click. A channel that is in several lists shows once, and streams that do not answer are hidden after a background check.</p>
      {PRESET_GROUPS.map(g => {
        const items = g.items.filter(s => !playlists.some(p => p.url === s.url));
        return items.length > 0 && (
          <div key={g.title}>
            <h3 className="lv-sec">{g.title}</h3>
            <div className="st-connect-actions">
              {items.map(s => <button key={s.url} type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={e => void add(e as unknown as FormEvent, s)}>{s.name}</button>)}
            </div>
          </div>
        );
      })}
    </Dialog>
  );
}
