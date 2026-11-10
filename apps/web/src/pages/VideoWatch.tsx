import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type VideoDetails, type VideoResult, type VideoState } from '../lib/api';
import { BackButton } from '../components/layout/BackButton';
import VideoPlayer from '../components/media/VideoPlayer';
import { EmptyState } from '../components/ui/Page';
import { Skeleton } from '../components/ui/Skeleton';
import { SvgIcon } from '../components/ui/SvgIcon';
import { toast } from '../components/ui/Toast';
import { ChannelAvatar, SubscribeButton, VideoCard } from '../components/videos/VideoCards';
import { useSubscriptions } from '../components/videos/useSubscriptions';
import { age, channelPath, duration, views, watchPath } from '../components/videos/format';

type Online = Awaited<ReturnType<typeof api.video>>;
const SAVE_EVERY_MS = 5000;
const busy = (s: VideoState['saved']) => !!s && ['queued', 'downloading', 'merging'].includes(s.status);

/** Saves where the video is every few seconds and when leaving, for Continue watching. */
function useVideoProgress(id: string) {
  const latest = useRef<{ position: number; duration: number } | null>(null);
  const sentAt = useRef(0);
  const flush = useCallback(() => {
    const v = latest.current;
    if (!v) return;
    sentAt.current = Date.now();
    void api.videoProgress(id, v.position, v.duration).catch(() => undefined);
  }, [id]);
  useEffect(() => {
    latest.current = null; sentAt.current = 0;
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, [flush]);
  return useCallback((position: number, total: number) => {
    if (!Number.isFinite(position) || !(total > 0)) return;
    latest.current = { position, duration: total };
    if (Date.now() - sentAt.current >= SAVE_EVERY_MS) flush();
  }, [flush]);
}

/** Its own page (not a popup) so a video can be linked to, reloaded, and left with the browser's own back button.
 * Plays the saved copy when there is one (full quality, and it works with the video service off), otherwise the
 * instance's stream in this app's own player (speed, captions, chapters, keys, remote), with the instance's own
 * player one click away for higher quality. */
export default function VideoWatch() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [online, setOnline] = useState<Online | null>(null);
  const [state, setState] = useState<VideoState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [embedMode, setEmbedMode] = useState(false);
  const [openDesc, setOpenDesc] = useState(false);
  const subs = useSubscriptions();
  const onProgress = useVideoProgress(id);

  useEffect(() => {
    let alive = true;
    setOnline(null); setState(null); setLoaded(false); setError(null); setEmbedMode(false); setOpenDesc(false);
    void Promise.allSettled([api.video(id), api.videoState(id)]).then(([o, s]) => {
      if (!alive) return;
      const local = s.status === 'fulfilled' ? s.value : { position: 0, later: false, saved: null, video: null, subscribed: false };
      setState(local);
      if (o.status === 'fulfilled') {
        setOnline(o.value);
        void api.videoWatched(id).catch(() => undefined);
      } else if (local.saved?.status !== 'ready') {
        setError(o.reason instanceof Error ? o.reason.message : 'Could not load this video.');
      }
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [id, attempt]);

  // While it is being saved, follow the download's progress.
  useEffect(() => {
    if (!busy(state?.saved ?? null)) return;
    const t = window.setTimeout(() => { api.videoState(id).then(setState).catch(() => undefined); }, 3000);
    return () => window.clearTimeout(t);
  }, [state, id]);

  if (error) {
    return (
      <main className="page vd-page">
        <BackButton to="/videos" label="Back to Videos" />
        <EmptyState icon="alert" title="This video could not be played" text={error}
          action={<button type="button" className="btn btn-primary" onClick={() => setAttempt(n => n + 1)}>Retry</button>} />
      </main>
    );
  }

  const details: VideoDetails | null = online?.video ?? null;
  const video: VideoResult | null = details ?? state?.video ?? null;
  if (!loaded || !video || !state) {
    return (
      <main className="page vd-page vd-watch" aria-busy="true">
        <BackButton to="/videos" label="Back to Videos" />
        <div className="vd-watch-grid">
          <div className="vd-watch-main"><Skeleton className="vd-skel-player" /><Skeleton className="skeleton-title" style={{ marginTop: 20, width: '60%' }} /><Skeleton className="skeleton-line" style={{ marginTop: 12, width: '35%' }} /></div>
        </div>
      </main>
    );
  }

  const local = state.saved?.status === 'ready';
  const src = local ? `/api/videos/saved/${encodeURIComponent(id)}/file` : online?.stream ?? null;
  const showEmbed = !!online?.embed && (embedMode || !src);
  const subscribed = video.channelId ? subs.ids.has(video.channelId) : false;
  const related = details?.related ?? [];
  const chapters = (details?.chapters ?? []).map((c, i, all) => ({ ...c, end: all[i + 1]?.start ?? (video.durationSeconds || c.start + 1) }));
  const captions = (details?.captions ?? []).map(c => ({ src: `/api/videos/${encodeURIComponent(id)}/captions?label=${encodeURIComponent(c.label)}`, label: c.label, srclang: c.code || 'en' }));
  // The instance's own "3 days ago" text comes in its own language, so the age is worked out here.
  const meta = [views(video.views), age(video.published), details?.likes ? `${views(details.likes).replace(' views', '')} likes` : ''].filter(Boolean).join(' · ');

  const seek = (t: number) => {
    const el = document.querySelector<HTMLVideoElement>('.vd-player video');
    if (el) { el.currentTime = t; void el.play().catch(() => undefined); el.closest<HTMLElement>('.vp')?.focus(); }
  };

  const toggleLater = () => {
    const was = state.later;
    setState({ ...state, later: !was });
    (was ? api.videoRemoveLater(id) : api.videoAddLater(id))
      .then(() => toast(was ? 'Removed from Watch later' : 'Added to Watch later', { tone: 'ok' }))
      .catch(err => { setState(s => (s ? { ...s, later: was } : s)); toast(err instanceof Error ? err.message : 'Could not change that.', { tone: 'err' }); });
  };

  const save = () => {
    const s = state.saved;
    if (s && s.status !== 'error' && s.status !== 'missing' && s.status !== 'cancelled') {
      const msg = s.status === 'ready' ? 'Delete the saved copy? The file is removed from the server.' : 'Stop saving this video?';
      if (!window.confirm(msg)) return;
      api.videoUnsave(id).then(() => { setState(st => (st ? { ...st, saved: null } : st)); toast(s.status === 'ready' ? 'Saved copy deleted' : 'Stopped saving'); })
        .catch(err => toast(err instanceof Error ? err.message : 'Could not delete it.', { tone: 'err' }));
      return;
    }
    setState({ ...state, saved: { status: 'queued', percent: 0 } });
    api.videoSave(id).then(r => { setState(st => (st ? { ...st, saved: r.saved } : st)); toast('Saving to your library. It plays from there once it is done.', { tone: 'ok' }); })
      .catch(err => { setState(st => (st ? { ...st, saved: null } : st)); toast(err instanceof Error ? err.message : 'Could not save it.', { tone: 'err' }); });
  };

  const saveLabel = !state.saved ? 'Save' : state.saved.status === 'ready' ? 'Saved'
    : busy(state.saved) ? `Saving ${state.saved.percent}%` : 'Save again';

  return (
    <main className="page vd-page vd-watch">
      <BackButton to="/videos" label="Back to Videos" />
      <div className="vd-watch-grid">
        <div className="vd-watch-main">
          <div className="vd-player">
            {showEmbed ? (
              <div className="vd-embed">
                <iframe
                  src={`${online!.embed}${state.position > 5 ? `&t=${Math.floor(state.position)}` : ''}`} title={video.title}
                  allow="autoplay; fullscreen; picture-in-picture" allowFullScreen
                  sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" referrerPolicy="no-referrer"
                />
              </div>
            ) : src ? (
              <VideoPlayer
                key={src}
                src={src}
                title={video.title}
                startAt={state.position > 5 && state.position < (video.durationSeconds || Infinity) - 10 ? state.position : 0}
                subtitles={captions}
                chapters={chapters}
                onProgress={onProgress}
                // The instance's stream can be refused upstream; its own player usually still gets through.
                {...(online?.embed && !local ? { onError: () => setEmbedMode(true) } : {})}
                {...(related[0] ? { next: { label: related[0].title, onSelect: () => navigate(watchPath(related[0]!.id)) } } : {})}
              />
            ) : (
              <div className="vd-embed vd-embed--off"><p>This video cannot be played while the video service is off.</p></div>
            )}
          </div>

          <h1 className="vd-watch-title">{video.title}</h1>
          {meta && <p className="vd-watch-meta">{meta}{local && <span className="vd-pill"><SvgIcon name="check" size={12} /> Playing your saved copy</span>}</p>}

          <div className="vd-watch-bar">
            <div className="vd-watch-channel">
              {video.channelId
                ? <Link to={channelPath(video.channelId)} className="vd-watch-chan-link"><ChannelAvatar src={video.channelThumb} name={video.channel} size={44} /><span><strong>{video.channel}</strong>{details?.subscribersText && <small>{details.subscribersText} subscribers</small>}</span></Link>
                : <span className="vd-watch-chan-link"><ChannelAvatar name={video.channel} size={44} /><span><strong>{video.channel}</strong></span></span>}
              {video.channelId && online && <SubscribeButton subscribed={subscribed} busy={subs.busy === video.channelId} onToggle={() => void subs.toggle(video.channelId!, video.channel)} name={video.channel} />}
            </div>
            <div className="vd-watch-actions">
              {online?.library && (
                <Link to={online.library.href} className="btn btn-secondary vd-lib-chip"><SvgIcon name="film-tab" size={16} /> In your library</Link>
              )}
              <button type="button" className={`btn btn-secondary${state.saved?.status === 'ready' ? ' is-on' : ''}`} onClick={save} disabled={!online && !state.saved}
                aria-label={state.saved?.status === 'ready' ? 'Delete saved copy' : busy(state.saved) ? `Stop saving (${state.saved!.percent}%)` : 'Save to library'}>
                <SvgIcon name={state.saved?.status === 'ready' ? 'check' : 'download'} size={16} /> {saveLabel}
              </button>
              <button type="button" className={`btn btn-secondary${state.later ? ' is-on' : ''}`} onClick={toggleLater} aria-pressed={state.later}>
                <SvgIcon name={state.later ? 'check' : 'clock'} size={16} /> Watch later
              </button>
              {online?.embed && src && (
                <button type="button" className="btn btn-ghost" onClick={() => setEmbedMode(m => !m)} aria-pressed={embedMode}
                  title={embedMode ? 'Back to this app\'s player (speed, captions, resume)' : 'The video service\'s own player can play higher quality'}>
                  <SvgIcon name="sliders-h" size={16} /> {embedMode ? 'Standard player' : 'Higher quality'}
                </button>
              )}
            </div>
          </div>
          {state.saved?.status === 'error' && state.saved.error && <p className="notice notice--err" role="alert">Saving failed: {state.saved.error}</p>}

          {video.description && (
            <div className={`vd-desc${openDesc ? ' is-open' : ''}`}>
              <p>{video.description}</p>
              {video.description.length > 220 && (
                <button type="button" className="btn btn-ghost btn-sm vd-more-btn" onClick={() => setOpenDesc(o => !o)} aria-expanded={openDesc}>{openDesc ? 'Show less' : 'Show more'}</button>
              )}
            </div>
          )}

          {chapters.length > 0 && !showEmbed && (
            <section className="vd-chapters" aria-label="Chapters">
              <h2 className="rail-title">Chapters</h2>
              <ol>
                {chapters.map(c => (
                  <li key={c.start}><button type="button" onClick={() => seek(c.start)}><span className="vd-chapter-time">{duration(c.start) || '0:00'}</span>{c.title}</button></li>
                ))}
              </ol>
            </section>
          )}
        </div>

        {related.length > 0 && (
          <aside className="vd-watch-side" aria-label="Related videos">
            <h2 className="rail-title">Up next</h2>
            <div className="vd-related">{related.map(v => <VideoCard key={v.id} video={v} row />)}</div>
          </aside>
        )}
      </div>
    </main>
  );
}
