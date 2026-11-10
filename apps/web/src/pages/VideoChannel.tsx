import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type VideoChannel as Channel, type VideoResult } from '../lib/api';
import { BackButton } from '../components/layout/BackButton';
import { EmptyState } from '../components/ui/Page';
import { Skeleton } from '../components/ui/Skeleton';
import { ChannelAvatar, SubscribeButton, VideoCard, VideoSkeletons } from '../components/videos/VideoCards';
import { useSubscriptions } from '../components/videos/useSubscriptions';
import { subscribers } from '../components/videos/format';

/** One channel: banner, picture, Subscribe, and its uploads newest first. */
export default function VideoChannel() {
  const { id = '' } = useParams<{ id: string }>();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [videos, setVideos] = useState<VideoResult[]>();
  const [more, setMore] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [bannerOk, setBannerOk] = useState(true);
  const [openAbout, setOpenAbout] = useState(false);
  const subs = useSubscriptions();

  useEffect(() => {
    let alive = true;
    setChannel(null); setVideos(undefined); setError(null); setMore(undefined); setBannerOk(true);
    api.videoChannel(id).then(r => {
      if (!alive) return;
      setChannel(r.channel ?? null); setVideos(r.videos); setMore(r.continuation);
    }).catch(err => { if (alive) setError(err instanceof Error ? err.message : 'Could not load this channel.'); });
    return () => { alive = false; };
  }, [id, attempt]);

  const loadMore = () => {
    if (!more) return;
    setLoadingMore(true);
    api.videoChannel(id, more).then(r => {
      setVideos(v => [...(v ?? []), ...r.videos.filter(n => !(v ?? []).some(o => o.id === n.id))]);
      setMore(r.continuation);
    }).catch(() => setMore(undefined)).finally(() => setLoadingMore(false));
  };

  if (error) {
    return (
      <main className="page vd-page">
        <BackButton to="/videos" label="Back to Videos" />
        <EmptyState icon="alert" title="This channel could not be loaded" text={error}
          action={<button type="button" className="btn btn-primary" onClick={() => setAttempt(n => n + 1)}>Retry</button>} />
      </main>
    );
  }

  return (
    <main className="page vd-page vd-channel-page">
      <BackButton to="/videos" label="Back to Videos" />
      <header className="vd-chan-head">
        <div className="vd-banner" aria-hidden="true">
          {channel?.banner && bannerOk && <img src={channel.banner} alt="" onError={() => setBannerOk(false)} />}
        </div>
        <div className="vd-chan-id">
          {channel ? <ChannelAvatar src={channel.avatar} name={channel.name} size={104} /> : <Skeleton className="vd-skel-avatar" />}
          <div className="vd-chan-text">
            {channel ? <h1 className="page-title">{channel.name}</h1> : <Skeleton className="skeleton-title" />}
            {channel && (
              <p className="page-subtitle">
                {[subscribers(channel.subscribers), channel.videoCount ? `${channel.videoCount} videos` : ''].filter(Boolean).join(' · ') || 'Channel'}
              </p>
            )}
            {channel?.description && (
              <p className={`vd-chan-about${openAbout ? ' is-open' : ''}`}>
                {channel.description}
              </p>
            )}
            {channel?.description && channel.description.length > 140 && (
              <button type="button" className="btn btn-ghost btn-sm vd-more-btn" onClick={() => setOpenAbout(o => !o)} aria-expanded={openAbout}>{openAbout ? 'Show less' : 'Show more'}</button>
            )}
          </div>
          {channel && <div className="page-actions"><SubscribeButton subscribed={subs.ids.has(channel.id)} busy={subs.busy === channel.id} onToggle={() => void subs.toggle(channel.id, channel.name)} name={channel.name} /></div>}
        </div>
      </header>

      <section aria-label="Uploads" className="vd-section">
        <div className="rail-head"><h2 className="rail-title">Uploads</h2></div>
        {!videos ? <VideoSkeletons count={8} />
          : videos.length === 0 ? <EmptyState icon="youtube" title="No videos yet" text="This channel has not uploaded anything public." />
            : <div className="vd-grid">{videos.map(v => <VideoCard key={v.id} video={v} showChannel={false} />)}</div>}
        {more && (
          <div className="vd-load-more">
            <button type="button" className="btn btn-secondary" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Show more'}</button>
          </div>
        )}
      </section>
    </main>
  );
}
