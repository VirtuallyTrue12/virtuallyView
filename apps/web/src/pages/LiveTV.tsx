import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type LiveChannel, type LivePlaylist, type LiveProgramme } from '../lib/api';
import { EmptyState, PageHeader, Pill, Seg, Switch } from '../components/ui/Page';
import { Dialog } from '../components/ui/Dialog';
import { MenuItem, MoreMenu } from '../components/ui/MoreMenu';
import { SvgIcon } from '../components/ui/SvgIcon';
import { LivePlayer } from '../components/live/LivePlayer';
import { GuideGrid } from '../components/live/GuideGrid';

interface Recording { id: string; title: string; channel: string; startedAt: string; endsAt: string; state: 'recording' | 'done' | 'failed' | 'stopped'; message?: string; sizeBytes: number }
type View = 'favorites' | 'recent' | 'channels' | 'guide' | 'recordings';
const PUBLIC_LIST = 'https://iptv-org.github.io/iptv/index.m3u';
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
  const pct = now ? Math.min(100, Math.max(0, ((Date.now() - now.start) / (now.stop - now.start)) * 100)) : 0;
  return (
    <li className={`lv-row${playing ? ' is-playing' : ''}${dead ? ' is-dead' : ''}`}>
      <button type="button" className="lv-row-main" onClick={onPlay} aria-label={`Watch ${c.name}`} aria-current={playing || undefined}>
        <span className="lv-idx">{index + 1}</span>
        <span className="lv-logo">{c.logo ? <img src={c.logo} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{c.name.charAt(0)}</span>}</span>
        <span className="lv-text">
          <strong>{c.name}</strong>
          <span>{now ? now.title : c.group ?? 'Live'}</span>
          {now && <span className="lv-mini"><span style={{ width: `${pct}%` }} /></span>}
        </span>
        {dead && <Pill tone="bad">Offline</Pill>}
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
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [recent, setRecent] = useState<string[]>([]);
  const [dead, setDead] = useState<Set<string>>(new Set());
  const [hideDead, setHideDead] = useState(true);
  const [current, setCurrent] = useState<LiveChannel | null>(null);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [sources, setSources] = useState(false);
  const [recDialog, setRecDialog] = useState(false);
  const [minutes, setMinutes] = useState(60);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [watching, setWatching] = useState<Recording | null>(null);
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [digits, setDigits] = useState('');
  const digitTimer = useRef<number | null>(null);

  const requested = params.get('v');
  const load = useCallback(async () => {
    try {
      const { playlists: list } = await api.livePlaylists();
      setPlaylists(list);
      if (list.length) { const r = await api.liveChannels(); setChannels(r.channels); setProblem(r.problems.join(' ')); } else setChannels([]);
    } catch (err) { setProblem((err as Error).message); setPlaylists(prev => prev ?? []); }
  }, []);
  const loadMe = useCallback(() => { api.liveMe().then(r => { setFavs(new Set(r.favorites)); setRecent(r.recent); setDead(new Set(r.dead)); }).catch(() => {}); }, []);
  const loadRecordings = useCallback(async () => { try { setRecordings((await recJSON<{ recordings: Recording[] }>('/api/live/recordings')).recordings); } catch { /* offline */ } }, []);
  useEffect(() => { void load(); loadMe(); void loadRecordings(); api.authStatus().then(s => setIsAdmin(s.user?.role === 'admin' || !s.enabled)).catch(() => {}); }, [load, loadMe, loadRecordings]);
  useEffect(() => {
    if (!recordings.some(r => r.state === 'recording')) return;
    const t = window.setInterval(() => void loadRecordings(), 5000);
    return () => window.clearInterval(t);
  }, [recordings, loadRecordings]);

  const byId = useMemo(() => new Map(channels.map(c => [c.id, c])), [channels]);
  const view: View = (['favorites', 'recent', 'channels', 'guide', 'recordings'].includes(requested ?? '') ? requested : favs.size ? 'favorites' : 'channels') as View;
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of channels) if (c.group) for (const g of c.group.split(';')) counts.set(g.trim(), (counts.get(g.trim()) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([g]) => g);
  }, [channels]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = view === 'favorites' ? channels.filter(c => favs.has(c.id)) : view === 'recent' ? recent.map(id => byId.get(id)).filter((c): c is LiveChannel => !!c) : channels;
    return base.filter(c => (!group || (c.group ?? '').split(';').map(g => g.trim()).includes(group)) && (!q || c.name.toLowerCase().includes(q)) && !(hideDead && dead.has(c.id) && view !== 'favorites'));
  }, [channels, favs, recent, byId, view, group, query, hideDead, dead]);
  useEffect(() => { setShown(PAGE); }, [view, group, query]);
  const visible = filtered.slice(0, shown);

  const guideIds = (view === 'guide' ? filtered.slice(0, 40) : visible.slice(0, 60)).filter(c => c.guide).map(c => c.id);
  const currentGuide = current?.guide ? [current.id] : [];
  const guide = useGuide([...new Set([...guideIds, ...currentGuide])], view === 'guide' ? 6 : 3, view !== 'recordings');
  const hasAnyGuide = channels.some(c => c.guide);

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
      setNote({ tone: 'ok', text: `Checked ${list.length} channels: ${deadFound} did not answer${deadFound ? ' and are hidden now (turn on "Show offline channels" to see them)' : ''}.` });
    } catch (err) { setNote({ tone: 'err', text: (err as Error).message }); }
    setChecking(null);
  };

  const setView = (v: View) => setParams(v === 'channels' ? { v } : { v });
  const empty = playlists !== null && playlists.length === 0;
  const cn = current ? nowNext(guide[current.id]) : { now: undefined, next: undefined };

  return (
    <main className={`page lv-page${current ? ' has-player' : ''}`}>
      <PageHeader
        title="Live TV"
        sub={channels.length ? `${channels.length.toLocaleString()} channels${favs.size ? ` · ${favs.size} favorite${favs.size === 1 ? '' : 's'}` : ''}${dead.size ? ` · ${dead.size} offline` : ''}` : undefined}
        actions={isAdmin ? <>
          <button type="button" className="btn btn-primary" onClick={() => setSources(true)}><SvgIcon name="plus" size={17} /> {empty ? 'Add channels' : 'Sources'}</button>
          {!empty && <MoreMenu label="More for Live TV">
            <MenuItem icon="activity" label={checking ? `Checking… ${checking.done}/${checking.total}` : 'Check which channels work'} hint="Tests the channels shown and hides dead ones" disabled={!!checking || filtered.length === 0} onSelect={() => void checkChannels()} />
            <MenuItem icon="refresh" label="Reload channel lists" onSelect={() => void load()} />
          </MoreMenu>}
        </> : undefined}
      />

      {note && <div className={`notice notice--${note.tone}`} role="status">{note.text}</div>}
      {problem && !empty && <div className="notice notice--err" role="alert">{problem}</div>}
      {playlists === null && <div className="loading-state">Loading…</div>}
      {empty && (
        <EmptyState icon="radio" title="No channels yet" text={isAdmin ? 'Add an M3U playlist from your TV tuner box or provider, or start with a free public list. Only add streams you have the right to watch.' : 'An administrator needs to add a channel list first.'}
          action={isAdmin ? <><button type="button" className="btn btn-primary" onClick={() => void api.addLivePlaylist('Free public channels (iptv-org)', PUBLIC_LIST).then(load).catch(err => setNote({ tone: 'err', text: (err as Error).message }))}>Add the free public list</button><button type="button" className="btn btn-secondary" onClick={() => setSources(true)}>Add my own playlist</button></> : undefined} />
      )}

      {playlists && playlists.length > 0 && (
        <div className="lv">
          <div className="lv-main">
            <div className="rq-toolbar">
              <Seg<View> label="Live TV views" value={view} onChange={setView} options={[
                { value: 'favorites', label: 'Favorites', count: favs.size }, { value: 'recent', label: 'Recent' }, { value: 'channels', label: 'All channels' },
                { value: 'guide', label: 'Guide' }, ...(recordings.length ? [{ value: 'recordings' as View, label: 'Recordings', count: recordings.length }] : [])
              ]} />
              {view !== 'recordings' && <input className="settings-input ph-search" type="search" placeholder="Find a channel" value={query} onChange={e => setQuery(e.target.value)} aria-label="Find a channel" />}
            </div>

            {view !== 'recordings' && groups.length > 0 && (
              <div className="lv-chips" role="tablist" aria-label="Category">
                <button type="button" role="tab" aria-selected={!group} className={`season-tab${!group ? ' is-active' : ''}`} onClick={() => setGroup('')}>All</button>
                {groups.map(g => <button key={g} type="button" role="tab" aria-selected={group === g} className={`season-tab${group === g ? ' is-active' : ''}`} onClick={() => setGroup(group === g ? '' : g)}>{g}</button>)}
              </div>
            )}
            {view !== 'recordings' && dead.size > 0 && (
              <label className="lv-toggle"><Switch checked={!hideDead} onChange={v => setHideDead(!v)} label="Show offline channels" /> <span>Show offline channels ({dead.size})</span></label>
            )}

            {view === 'guide' && (hasAnyGuide
              ? <GuideGrid channels={filtered.slice(0, 40)} guide={guide} playingId={current?.id} onPlay={play} favorites={favs} />
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
                {recordings.length === 0 && <EmptyState icon="radio" title="No recordings" text="Press Record while watching a channel." />}
                <ul className="dl-list">
                  {recordings.map(r => (
                    <li key={r.id} className="dl">
                      <div className="rq-poster dl-art"><span className={r.state === 'recording' ? 'lv-rec' : undefined}><SvgIcon name="film" size={22} /></span></div>
                      <div className="dl-main"><div className="rq-title-row"><h3 className="rq-title">{r.title}</h3><Pill tone={r.state === 'recording' ? 'bad' : r.state === 'done' ? 'ok' : r.state === 'failed' ? 'bad' : 'neutral'}>{r.state === 'recording' ? 'Recording' : r.state === 'done' ? 'Finished' : r.state === 'stopped' ? 'Stopped' : 'Failed'}</Pill></div>
                        <p className="dl-line">{r.state === 'recording' ? `Until ${new Date(r.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : new Date(r.startedAt).toLocaleString()}{r.sizeBytes ? <span>{mb(r.sizeBytes)}</span> : null}{r.message ? <span>{r.message}</span> : null}</p></div>
                      <div className="rq-actions">
                        {r.sizeBytes > 0 && r.state !== 'failed' && <button type="button" className="btn btn-primary" onClick={() => setWatching(r)}><SvgIcon name="play" size={16} /> Watch</button>}
                        {r.state === 'recording' && <button type="button" className="btn btn-secondary" onClick={() => void recAction(`/api/live/record/${r.id}/stop`, 'POST')}>Stop</button>}
                        <MoreMenu label={`More for ${r.title}`}><MenuItem icon="trash" label="Delete recording" danger onSelect={() => void recAction(`/api/live/recordings/${r.id}`, 'DELETE')} /></MoreMenu>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {current && (
            <aside className="lv-side">
              <LivePlayer channel={current} number={numberOf} now={cn.now} next={cn.next} favorite={favs.has(current.id)} onFavorite={() => toggleFavorite(current.id)} onZap={zap} onRecord={() => setRecDialog(true)} onClose={() => setCurrent(null)}
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
  const add = async (event: FormEvent, preset?: { name: string; url: string }) => {
    event.preventDefault();
    setBusy(true); setErr('');
    try { await api.addLivePlaylist(preset?.name ?? name, preset?.url ?? url.trim(), epg.trim()); setName(''); setUrl(''); setEpg(''); onChanged(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
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
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={e => void add(e as unknown as FormEvent, { name: 'Free public channels (iptv-org)', url: PUBLIC_LIST })}>Add the free public list</button>
        </div>
      </form>
    </Dialog>
  );
}
