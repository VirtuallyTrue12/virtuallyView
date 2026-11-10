import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type VideoChannel, type VideoResult } from '../lib/api';
import { EmptyState, PageHeader, Seg } from '../components/ui/Page';
import { SvgIcon } from '../components/ui/SvgIcon';
import { FeatureOff } from '../components/ui/FeatureOff';
import { toast } from '../components/ui/Toast';
import { ChannelAvatar, ChannelCard, VideoCard, VideoRail, VideoSkeletons } from '../components/videos/VideoCards';
import { useSubscriptions } from '../components/videos/useSubscriptions';
import { channelPath } from '../components/videos/format';

type Tab = 'videos' | 'channels';
const busy = (v: VideoResult) => v.saved && ['queued', 'downloading', 'merging'].includes(v.saved.status);

/** YouTube, through Invidious: rails for what you follow, saved and left half-watched, plus search for videos and channels.
 * Everything kept per person (history, follows, lists, saved files) lives on this server and stays usable while the video
 * service is off; only search, trending and online playback need it. */
export default function Videos() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const tab: Tab = params.get('tab') === 'channels' ? 'channels' : 'videos';
  const [typed, setTyped] = useState(query);
  const [available, setAvailable] = useState<boolean | null>(null);
  const subs = useSubscriptions();

  const [saved, setSaved] = useState<VideoResult[]>();
  const [cont, setCont] = useState<VideoResult[]>();
  const [later, setLater] = useState<VideoResult[]>();
  const [history, setHistory] = useState<VideoResult[]>();
  const [feed, setFeed] = useState<{ videos: VideoResult[]; failed: number; channels: number }>();
  const [trending, setTrending] = useState<VideoResult[]>();
  const [popular, setPopular] = useState<VideoResult[]>();

  const [results, setResults] = useState<VideoResult[] | VideoChannel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  const loadSaved = useCallback(() => api.videoSaved().then(r => setSaved(r.videos)).catch(() => setSaved([])), []);
  const loadFeed = useCallback(() => api.videoFeed().then(setFeed).catch(() => setFeed({ videos: [], failed: 0, channels: 0 })), []);
  useEffect(() => {
    api.videosStatus().then(r => setAvailable(r.available)).catch(() => setAvailable(false));
    void loadSaved();
    api.videoContinue().then(r => setCont(r.videos)).catch(() => setCont([]));
    api.videoLater().then(r => setLater(r.videos)).catch(() => setLater([]));
    api.videoHistory().then(r => setHistory(r.history)).catch(() => setHistory([]));
  }, [loadSaved]);
  useEffect(() => { if (available) void loadFeed(); }, [available, loadFeed, subs.channels?.length]);
  useEffect(() => {
    if (!available) return;
    api.videosTrending().then(r => setTrending(r.videos)).catch(() => setTrending([]));
    api.videosPopular().then(r => setPopular(r.videos)).catch(() => setPopular([]));
  }, [available]);

  // Saved videos still downloading: check again every few seconds until they are done.
  useEffect(() => {
    if (!saved?.some(busy)) return;
    const t = window.setTimeout(() => void loadSaved(), 3000);
    return () => window.clearTimeout(t);
  }, [saved, loadSaved]);

  useEffect(() => { setTyped(query); }, [query]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      const q = typed.trim();
      if (q === query) return;
      const next = new URLSearchParams(params);
      if (q) next.set('q', q); else { next.delete('q'); next.delete('tab'); }
      setParams(next, { replace: true });
    }, 400);
    return () => window.clearTimeout(t);
  }, [typed, query, params, setParams]);

  useEffect(() => {
    if (!query || available === false) { setResults(null); return; }
    let alive = true;
    setResults(null); setError(null);
    (tab === 'channels' ? api.videoChannelsSearch(query).then(r => r.channels) : api.videosSearch(query).then(r => r.videos))
      .then(list => { if (alive) setResults(list); })
      .catch(err => { if (alive) { setError(err instanceof Error ? err.message : 'Search failed.'); setResults([]); } });
    return () => { alive = false; };
  }, [query, tab, available, retry]);

  const setTab = (t: Tab) => { const next = new URLSearchParams(params); next.set('tab', t); setParams(next, { replace: true }); };
  const videosOn = useCallback(() => api.videosStatus().then(r => r.available), []);
  const markOn = useCallback(() => setAvailable(true), []);

  const removeHistory = (v: VideoResult) => { setHistory(h => h?.filter(x => x.id !== v.id)); void api.removeVideoHistory(v.id).catch(() => undefined); };
  const clearHistory = () => { setHistory([]); setCont([]); void api.clearVideoHistory().catch(() => undefined); };
  const removeLater = (v: VideoResult) => { setLater(l => l?.filter(x => x.id !== v.id)); void api.videoRemoveLater(v.id).catch(() => undefined); };
  const removeSaved = (v: VideoResult) => {
    if (!window.confirm(`Delete the saved copy of "${v.title}"? The file is removed from the server.`)) return;
    setSaved(s => s?.filter(x => x.id !== v.id));
    api.videoUnsave(v.id).then(() => toast('Saved copy deleted')).catch(err => { toast(err instanceof Error ? err.message : 'Could not delete it.', { tone: 'err' }); void loadSaved(); });
  };
  const findChannels = () => { setTab('channels'); document.querySelector<HTMLInputElement>('.vd-search input')?.focus(); };

  const off = available === false;
  const searching = !!query && !off;

  return (
    <main className="page vd-page">
      <PageHeader
        icon="youtube"
        title="Videos"
        sub={searching ? `Results for "${query}"` : 'From the channels you follow, and everything you saved. Kept private on this server.'}
        actions={(
          <form className="vd-search" role="search" onSubmit={e => { e.preventDefault(); setTyped(t => t.trim()); }}>
            <SvgIcon name="search" size={18} />
            <input type="search" value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search YouTube" aria-label="Search YouTube" disabled={off} />
            {typed && <button type="button" className="icon-btn icon-btn--sm icon-btn--ghost" onClick={() => setTyped('')} aria-label="Clear search"><SvgIcon name="close" size={14} /></button>}
          </form>
        )}
      />

      {off && (
        <FeatureOff name="Videos" command="docker compose --profile invidious up -d" check={videosOn} onReady={markOn}
          note={<>Or point <code>INVIDIOUS_URL</code> in <code>.env</code> at a public instance. Saved videos and your lists below still work.</>} />
      )}

      {searching ? (
        <section className="vd-results" aria-label="Search results">
          <Seg<Tab> label="Result type" value={tab} onChange={setTab} options={[{ value: 'videos', label: 'Videos' }, { value: 'channels', label: 'Channels' }]} />
          {error && <div className="notice notice--err vd-error" role="alert">{error} <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRetry(n => n + 1)}>Retry</button></div>}
          {!results ? <VideoSkeletons count={8} />
            : results.length === 0 ? !error && <EmptyState icon="search" title={tab === 'channels' ? 'No channels match' : 'No videos match'} text="Try a different word." />
              : tab === 'channels'
                ? <div className="vd-chan-grid">{(results as VideoChannel[]).map(c => <ChannelCard key={c.id} channel={c} subscribed={subs.ids.has(c.id)} onToggle={() => void subs.toggle(c.id, c.name)} />)}</div>
                : <div className="vd-grid">{(results as VideoResult[]).map(v => <VideoCard key={v.id} video={v} />)}</div>}
        </section>
      ) : (
        <div className="vd-rails">
          <VideoRail title="Saved" videos={saved} onRemove={removeSaved} removeLabel="Saved" />
          <VideoRail title="Continue watching" videos={cont} />
          {!off && (
            <VideoRail
              title="Subscriptions"
              videos={subs.channels?.length === 0 ? [] : feed?.videos}
              aside={feed && feed.failed > 0 ? <span className="vd-meta">{feed.failed} channel{feed.failed === 1 ? '' : 's'} could not be reached</span> : undefined}
              empty={subs.channels?.length === 0
                ? <p className="vd-rail-empty">Subscribe to channels to see their new videos here. <button type="button" className="btn btn-secondary btn-sm" onClick={findChannels}>Find channels</button></p>
                : <p className="vd-rail-empty">No new videos from your channels.</p>}
            />
          )}
          {!!subs.channels?.length && (
            <section className="vd-rail" aria-label="Your channels">
              <div className="rail-head"><h2 className="rail-title">Your channels</h2></div>
              <div className="vd-chan-row">
                {subs.channels.map(c => (
                  <Link key={c.id} to={channelPath(c.id)} className="vd-chan-chip"><ChannelAvatar src={c.avatar} name={c.name} size={56} /><span>{c.name}</span></Link>
                ))}
              </div>
            </section>
          )}
          <VideoRail title="Watch later" videos={later} onRemove={removeLater} removeLabel="Watch later" />
          {!off && <VideoRail title="Trending" videos={trending} />}
          {!off && <VideoRail title="Popular" videos={popular} />}
          <VideoRail title="History" videos={history} onRemove={removeHistory} removeLabel="history"
            aside={history?.length ? <button type="button" className="btn btn-ghost btn-sm" onClick={clearHistory}>Clear history</button> : undefined}
            empty={off ? undefined : <p className="vd-rail-empty">Videos you play are kept here so you can find them again.</p>} />
        </div>
      )}
    </main>
  );
}
