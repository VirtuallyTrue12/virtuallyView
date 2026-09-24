import Hls from 'hls.js';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { BackButton } from '../components/layout/BackButton';

interface Playlist { id: string; name: string; url: string }
interface Channel { id: string; name: string; logo?: string; group?: string; playlist: string }
interface Recording { id: string; title: string; channel: string; startedAt: string; endsAt: string; state: 'recording' | 'done' | 'failed' | 'stopped'; message?: string; sizeBytes: number }
const mb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`);

const PUBLIC_LIST = 'https://iptv-org.github.io/iptv/index.m3u';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(body.message ?? `Request failed (${res.status}).`);
  return body;
}

/** Live TV from M3U playlists you add. Channels play through this server. */
export default function LiveTV() {
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [problem, setProblem] = useState('');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [current, setCurrent] = useState<Channel | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [minutes, setMinutes] = useState(60);
  const [watching, setWatching] = useState<Recording | null>(null);

  const loadRecordings = async () => {
    try { setRecordings((await json<{ recordings: Recording[] }>('/api/live/recordings')).recordings); } catch { /* offline */ }
  };
  useEffect(() => { void loadRecordings(); }, []);
  useEffect(() => {
    if (!recordings.some(r => r.state === 'recording')) return;
    const t = window.setInterval(() => void loadRecordings(), 5000);
    return () => window.clearInterval(t);
  }, [recordings]);
  const record = async () => {
    if (!current) return;
    setProblem('');
    try { await json('/api/live/record', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId: current.id, minutes }) }); await loadRecordings(); }
    catch (err) { setProblem((err as Error).message); }
  };
  const recAction = async (path: string, method: 'POST' | 'DELETE') => {
    await json(path, { method }).catch(err => setProblem((err as Error).message));
    if (method === 'DELETE') setWatching(null);
    await loadRecordings();
  };

  const load = async () => {
    try {
      const { playlists: list } = await json<{ playlists: Playlist[] }>('/api/live/playlists');
      setPlaylists(list);
      if (list.length) {
        const result = await json<{ channels: Channel[]; problems: string[] }>('/api/live/channels');
        setChannels(result.channels);
        setProblem(result.problems.join(' '));
      } else {
        setChannels([]);
      }
    } catch (err) {
      setProblem((err as Error).message);
      setPlaylists(prev => prev ?? []);
    }
  };
  useEffect(() => { void load(); }, []);

  // Play the chosen channel: HLS through hls.js, anything else as a plain converted stream.
  useEffect(() => {
    const el = video.current;
    if (!current || !el) return;
    setError('');
    const src = `/api/live/stream/${current.id}`;
    let hls: Hls | null = null;
    fetch(src, { headers: { Range: 'bytes=0-0' } }).then(async res => {
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok) { const b = (await res.json().catch(() => ({}))) as { message?: string }; throw new Error(b.message ?? 'The channel did not answer.'); }
      void res.body?.cancel();
      if (/mpegurl/i.test(type)) {
        if (Hls.isSupported()) {
          hls = new Hls({ lowLatencyMode: true });
          hls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) setError('This channel stopped or could not be played.'); });
          hls.loadSource(src);
          hls.attachMedia(el);
        } else {
          el.src = src;
        }
      } else {
        el.src = src;
      }
      void el.play().catch(() => undefined);
    }).catch(err => setError((err as Error).message));
    // Free public channels go offline often. Say so instead of sitting at 0:00.
    const watchdog = window.setTimeout(() => {
      if (el.currentTime === 0) setError('This channel is not answering. Free public channels often go offline or only broadcast at certain hours: try another one.');
    }, 15000);
    const clear = () => { window.clearTimeout(watchdog); setError(''); };
    el.addEventListener('playing', clear, { once: true });
    return () => { window.clearTimeout(watchdog); el.removeEventListener('playing', clear); hls?.destroy(); el.removeAttribute('src'); el.load(); };
  }, [current]);

  const groups = useMemo(() => [...new Set(channels.map(c => c.group).filter((g): g is string => !!g))].sort(), [channels]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return channels.filter(c => (!group || c.group === group) && (!q || c.name.toLowerCase().includes(q))).slice(0, 300);
  }, [channels, query, group]);

  const add = async (event: FormEvent, preset?: { name: string; url: string }) => {
    event.preventDefault();
    setBusy(true);
    setProblem('');
    try {
      await json('/api/live/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preset ?? { name, url }) });
      setName(''); setUrl('');
      await load();
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await json(`/api/live/playlists/${id}`, { method: 'DELETE' }).catch(err => setProblem((err as Error).message));
    await load();
  };

  return (
    <main className="page">
      <BackButton to="/" label="Home" />
      <div className="page-head"><h1>Live TV</h1><span className="page-count">{channels.length ? `${channels.length} channels` : ''}</span></div>

      {current && (
        <section className="live-player">
          <video ref={video} controls autoPlay playsInline className="live-video" />
          <div className="live-now"><strong>{current.name}</strong>{current.group ? ` · ${current.group}` : ''}
            <span className="live-record">
              <select className="settings-input" value={minutes} onChange={e => setMinutes(Number(e.target.value))} aria-label="Record for">
                {[15, 30, 60, 120, 180, 240].map(m => <option key={m} value={m}>{m >= 60 ? `${m / 60} h` : `${m} min`}</option>)}
              </select>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void record()}>Record</button>
            </span>
          </div>
          {error && <div className="notice notice--err" role="alert">{error}</div>}
        </section>
      )}

      {playlists && playlists.length > 0 && (
        <div className="lib-row">
          <input className="settings-input lib-search" type="search" placeholder="Find a channel" value={query} onChange={e => setQuery(e.target.value)} aria-label="Find a channel" />
          {groups.length > 0 && (
            <select className="settings-input" value={group} onChange={e => setGroup(e.target.value)} aria-label="Category">
              <option value="">All categories</option>
              {groups.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          )}
        </div>
      )}
      {problem && <div className="notice notice--err" role="alert">{problem}</div>}
      {playlists === null && <div className="loading-state">Loading...</div>}
      {playlists?.length === 0 && <div className="empty-state">No channels yet. Add an M3U playlist below. Only add streams you have the right to watch.</div>}

      <div className="channel-grid">
        {shown.map(c => (
          <button key={c.id} type="button" className={`channel-card${current?.id === c.id ? ' is-active' : ''}`} onClick={() => setCurrent(c)}>
            {c.logo ? <img src={c.logo} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="channel-fallback">{c.name.charAt(0)}</span>}
            <span className="channel-name">{c.name}</span>
          </button>
        ))}
      </div>

      {(recordings.length > 0 || watching) && (
        <section className="settings-section">
          <h3>Recordings</h3>
          {watching && <video className="live-video" controls autoPlay playsInline src={`/api/live/recordings/${watching.id}/file`} />}
          <ul className="users-list">
            {recordings.map(r => (
              <li key={r.id} className="users-row">
                <span className="users-name">{r.title}
                  <small style={{ display: 'block', opacity: 0.7 }}>
                    {r.state === 'recording' ? `Recording until ${new Date(r.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : r.state === 'done' ? 'Finished' : r.state === 'stopped' ? 'Stopped' : `Failed${r.message ? `: ${r.message}` : ''}`}
                    {r.sizeBytes ? ` · ${mb(r.sizeBytes)}` : ''}
                  </small>
                </span>
                <span className="users-actions">
                  {r.sizeBytes > 0 && r.state !== 'failed' && <button type="button" className="btn btn-primary btn-sm" onClick={() => setWatching(r)}>Watch</button>}
                  {r.state === 'recording' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => void recAction(`/api/live/record/${r.id}/stop`, 'POST')}>Stop</button>}
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void recAction(`/api/live/recordings/${r.id}`, 'DELETE')}>Delete</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="settings-section">
        <h3>Playlists</h3>
        <p className="settings-help">Channels marked Geo-blocked only play in their own country, and Not 24/7 ones only at certain hours.</p>
        <p className="settings-help">An M3U or M3U8 address from your TV tuner box (such as TVHeadend), your provider, or a free public list. Only an administrator can add or remove them.</p>
        <ul className="users-list">
          {playlists?.map(p => (
            <li key={p.id} className="users-row"><span className="users-name">{p.name}<small style={{ display: 'block', opacity: 0.7 }}>{p.url}</small></span>
              <span className="users-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={() => void remove(p.id)}>Remove</button></span></li>
          ))}
        </ul>
        <form className="users-add" onSubmit={e => void add(e)}>
          <label className="login-field"><span>Name</span><input className="settings-input" value={name} onChange={e => setName(e.target.value)} placeholder="My channels" /></label>
          <label className="login-field"><span>Address</span><input className="settings-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="http://192.168.1.5:9981/playlist" required /></label>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Adding...' : 'Add playlist'}</button>
        </form>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={e => void add(e as unknown as FormEvent, { name: 'Free public channels (iptv-org)', url: PUBLIC_LIST })}>
          Add the free public iptv-org list
        </button>
      </section>
    </main>
  );
}
