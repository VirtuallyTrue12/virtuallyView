import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type YoutubeJob, type YoutubeResult } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';
import { youtubeIdFromText } from '../../lib/youtube-link';

const clock = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
const views = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M views` : n >= 1e3 ? `${Math.round(n / 1e3)}K views` : n > 0 ? `${n} views` : '');
const ACTIVE = new Set(['queued', 'downloading', 'merging']);

/**
 * Find a concert or music video on YouTube and save it under the artist.
 * Needs the optional YouTube service; says how to turn it on when it is off.
 */
export function YoutubeFinder({ initialQuery, fixedArtist, onDownloaded }: { initialQuery: string; fixedArtist?: string; onDownloaded?: () => void }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<YoutubeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [artist, setArtist] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [jobs, setJobs] = useState<YoutubeJob[]>([]);
  const wasActive = useRef(false);

  useEffect(() => { api.youtubeStatus().then(s => setAvailable(s.available)).catch(() => setAvailable(false)); }, []);

  const loadJobs = useCallback(() => {
    api.youtubeJobs().then(r => setJobs(r.jobs)).catch(() => setJobs([]));
  }, []);
  useEffect(() => { if (available) loadJobs(); }, [available, loadJobs]);

  // Keep the progress fresh while something is downloading, and tell the page when it finishes.
  const active = jobs.some(j => ACTIVE.has(j.status));
  useEffect(() => {
    if (wasActive.current && !active) onDownloaded?.();
    wasActive.current = active;
    if (!active) return;
    const timer = window.setInterval(loadJobs, 3000);
    return () => window.clearInterval(timer);
  }, [active, loadJobs, onDownloaded]);

  // A pasted link is not a search: read that one video and show everything about it.
  const [pasted, setPasted] = useState<YoutubeResult & { description?: string; uploadDate?: string } | null>(null);
  const lastLink = useRef('');
  const search = async () => {
    if (query.trim().length < 2 || searching) return;
    setSearching(true); setNote(null); setPasted(null);
    const linked = youtubeIdFromText(query);
    try {
      if (linked) {
        const video = await api.youtubeVideo(linked);
        setPasted(video); setResults([video]);
        if (video.isLive) setNote({ text: 'That is a live stream; it cannot be saved until it ends.', ok: false });
      } else {
        setResults((await api.youtubeSearch(query.trim())).results);
      }
    } catch (err) {
      setResults(null); setNote({ text: err instanceof Error ? err.message : 'Search failed.', ok: false });
    } finally { setSearching(false); }
  };

  const download = async (r: YoutubeResult) => {
    setBusy(r.id); setNote(null);
    const who = (fixedArtist ?? artist).trim();
    try {
      const out = await api.youtubeDownload({ id: r.id, title: r.title, ...(who ? { artist: who } : {}), kind: r.kind });
      setNote({ text: out.message, ok: true });
      loadJobs();
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : 'Could not start it.', ok: false });
    } finally { setBusy(null); }
  };

  const cancel = (id: string) => { void api.youtubeCancel(id).then(loadJobs).catch(() => undefined); };

  // Recognise a link the moment it is pasted or typed, without pressing Search.
  useEffect(() => {
    const id = youtubeIdFromText(query);
    if (!available || !id || lastLink.current === id) return;
    lastLink.current = id;
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, available]);

  if (available === null) return <p className="release-picker-help">Checking...</p>;
  if (!available) {
    return (
      <p className="release-picker-help">
        YouTube downloads are off. Turn them on with <code>docker compose --profile youtube up -d</code>, then come back here.
        Only save videos you have the right to keep (see the notes in docs/concerts-and-videos.md).
      </p>
    );
  }

  return (
    <div className="release-picker yt-finder">
      <div className="release-picker-search">
        <input className="settings-input" value={query} maxLength={200} aria-label="Search YouTube"
          onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void search(); }} />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void search()} disabled={searching || query.trim().length < 2}>{searching ? 'Searching...' : 'Search'}</button>
      </div>
      {fixedArtist
        ? <p className="release-picker-help">Saved under <strong>{fixedArtist}</strong>.</p>
        : (
          <label className="release-picker-fileas">
            <span>Artist (leave empty to use the name in the video's title)</span>
            <input className="settings-input" value={artist} maxLength={120} placeholder="For example: Linkin Park" onChange={e => setArtist(e.target.value)} />
          </label>
        )}
      {pasted && <p className="release-picker-help">Recognised a YouTube link.</p>}
      {note && <p className={`release-picker-note${note.ok ? '' : ' is-error'}`} role="status">{note.text}</p>}
      {results && results.length === 0 && <p className="release-picker-help">Nothing found. Try different words.</p>}
      {results && results.length > 0 && (
        <ul className="release-list">
          {results.map(r => (
            <li key={r.id} className="release-row yt-row">
              <img className="yt-thumb" src={r.thumbnail} alt="" loading="lazy" />
              <div className="release-row-main">
                <span className="release-row-title" title={r.title}>{r.title}</span>
                <span className="release-row-meta">
                  {[r.channel, (pasted?.id === r.id && pasted.uploadDate) || '', r.durationSeconds ? clock(r.durationSeconds) : '', views(r.views), r.kind === 'Concerts' ? 'concert' : 'video', !fixedArtist && !artist && r.artistGuess ? `artist: ${r.artistGuess}` : ''].filter(Boolean).join(' · ')}
                </span>
                {pasted?.id === r.id && pasted.description && <p className="yt-desc">{pasted.description}</p>}
              </div>
              <button type="button" className="btn btn-primary btn-sm yt-download" disabled={busy !== null} onClick={() => void download(r)}><SvgIcon name="plus" size={15} />{busy === r.id ? 'Starting…' : 'Save'}</button>
            </li>
          ))}
        </ul>
      )}
      {jobs.length > 0 && (
        <div className="yt-jobs" aria-label="YouTube downloads">
          {jobs.slice(0, 6).map(j => (
            <div key={j.id} className="yt-job">
              <span className="yt-job-title" title={j.title}>{j.title}</span>
              <span className="yt-job-state">
                {j.status === 'done' ? 'Done' : j.status === 'error' ? `Failed: ${j.error ?? 'unknown error'}` : j.status === 'cancelled' ? 'Cancelled'
                  : j.status === 'queued' ? 'Waiting' : j.status === 'merging' ? 'Finishing up...' : `${Math.round(j.percent)}%${j.speed ? ` · ${j.speed}` : ''}${j.eta ? ` · ${j.eta} left` : ''}`}
              </span>
              {ACTIVE.has(j.status) && <button type="button" className="mp-link" onClick={() => cancel(j.id)}>Cancel</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
