import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type VideoResult } from '../lib/api';
import { EmptyState, PageHeader, Seg } from '../components/ui/Page';
import { SvgIcon } from '../components/ui/SvgIcon';

type View = 'search' | 'history';

const duration = (seconds: number) => {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const views = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M views` : n >= 1_000 ? `${Math.round(n / 1_000)}K views` : n ? `${n} views` : '');

function VideoCard({ video, onPlay, onRemove }: { video: VideoResult; onPlay: () => void; onRemove?: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <li className="vid-card">
      <button type="button" className="vid-thumb" onClick={onPlay} aria-label={`Play ${video.title}`}>
        {video.thumbnail && !broken
          ? <img src={`/api/videos/${video.id}/thumbnail`} alt="" loading="lazy" onError={() => setBroken(true)} />
          : <span className="vid-thumb-empty"><SvgIcon name="youtube" size={28} /></span>}
        {video.durationSeconds > 0 && <span className="vid-dur">{duration(video.durationSeconds)}</span>}
      </button>
      <div className="vid-meta">
        <button type="button" className="vid-title" onClick={onPlay} title={video.title}>{video.title}</button>
        <span className="vid-sub">{video.channel}{video.views ? ` · ${views(video.views)}` : ''}</span>
      </div>
      {onRemove && <button type="button" className="vid-remove" onClick={onRemove} aria-label={`Remove ${video.title} from history`}><SvgIcon name="close" size={14} /></button>}
    </li>
  );
}

/** YouTube, through Invidious: search, watch (Invidious embeds and plays it), and a watch history kept only on this server.
 * The local history stays useful even while the video service itself is off or unreachable; only search and playback need it. */
export default function Videos() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>('search');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VideoResult[]>([]);
  const [history, setHistory] = useState<VideoResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(() => { api.videoHistory().then(r => setHistory(r.history)).catch(() => undefined); }, []);
  useEffect(() => { api.videosStatus().then(r => setAvailable(r.available)).catch(() => setAvailable(false)); loadHistory(); }, [loadHistory]);
  useEffect(() => { const t = window.setTimeout(() => setQuery(typed.trim()), 400); return () => window.clearTimeout(t); }, [typed]);

  useEffect(() => {
    if (view !== 'search' || !query || available === false) { setResults([]); return; }
    let alive = true;
    setLoading(true); setError(null);
    api.videosSearch(query).then(r => { if (alive) setResults(r.videos); }).catch(err => { if (alive) { setError((err as Error).message); setResults([]); } }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [view, query, available]);

  const play = (video: VideoResult) => navigate(`/videos/watch/${encodeURIComponent(video.id)}`);

  const removeHistory = (id: string) => { setHistory(h => h.filter(v => v.id !== id)); void api.removeVideoHistory(id).catch(loadHistory); };
  const clearHistory = () => { setHistory([]); void api.clearVideoHistory().catch(loadHistory); };

  const shown = view === 'search' ? results : history;
  const off = available === false;

  return (
    <main className="page">
      <PageHeader
        icon="youtube"
        title="Videos"
        sub="Search happens through your server; playing a video connects your browser straight to the video service (the one bundled here, on your own network, or a public instance if you chose one) so it can send you the stream. Your watch history is kept only in this server's own database."
        actions={<Seg<View> label="Videos view" value={view} onChange={setView} options={[{ value: 'search', label: 'Search' }, { value: 'history', label: 'History', count: history.length }]} />}
      />
      {view === 'search' && (
        <label className="vid-search">
          <SvgIcon name="search" size={18} />
          <input type="search" value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search YouTube" aria-label="Search YouTube" autoFocus disabled={off} />
        </label>
      )}
      {view === 'history' && history.length > 0 && (
        <div className="vid-history-bar"><button type="button" className="mp-link" onClick={clearHistory}>Clear history</button></div>
      )}
      {view === 'search' && off && (
        <EmptyState icon="youtube" title="Not turned on yet"
          text={<>This needs a video service. Run <code>docker compose --profile invidious up -d</code> on the server, or point <code>INVIDIOUS_URL</code> in <code>.env</code> at a public instance and restart. See <a href="https://docs.invidious.io/instances/" target="_blank" rel="noreferrer">public instances</a>. Your history below still works.</>} />
      )}
      {error && <div className="notice notice--err" role="alert">{error} <button type="button" className="mp-link" onClick={() => setError(null)}>Dismiss</button></div>}
      {loading && shown.length === 0 && <div className="loading-state">Searching…</div>}
      {!(view === 'search' && off) && !loading && shown.length === 0 && !error && (
        <EmptyState icon={view === 'history' ? 'clock' : 'search'}
          title={view === 'history' ? 'Nothing watched yet' : query ? 'No videos match' : 'Search for something to watch'}
          text={view === 'history' ? 'Videos you play here are kept so you can find them again.' : 'Try a different word.'} />
      )}
      {shown.length > 0 && (
        <ul className="vid-grid">
          {shown.map(v => <VideoCard key={v.id} video={v} onPlay={() => play(v)} onRemove={view === 'history' ? () => removeHistory(v.id) : undefined} />)}
        </ul>
      )}
    </main>
  );
}
