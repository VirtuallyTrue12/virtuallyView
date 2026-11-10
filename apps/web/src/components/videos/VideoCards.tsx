import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { VideoChannel, VideoResult } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';
import { Skeleton } from '../ui/Skeleton';
import { ScrollRow } from '../ui/ScrollRow';
import { age, channelPath, duration, subscribers, views, watchPath } from './format';

/** A channel's picture, or its first letter when there is none (or it will not load). */
export function ChannelAvatar({ src, name, size = 36 }: { src?: string; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="vd-avatar" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
      {src && !broken ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} /> : (name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

function Thumb({ video }: { video: VideoResult }) {
  const [broken, setBroken] = useState(false);
  const left = video.position && video.duration ? Math.min(100, (video.position / video.duration) * 100) : 0;
  const saving = video.saved && video.saved.status !== 'ready' ? video.saved : null;
  return (
    <>
      {!broken
        ? <img src={`/api/videos/${video.id}/thumbnail`} alt="" loading="lazy" onError={() => setBroken(true)} />
        : <span className="vd-thumb-empty"><SvgIcon name="youtube" size={28} /></span>}
      {video.durationSeconds > 0 && <span className="vd-dur">{duration(video.durationSeconds)}</span>}
      {video.saved?.status === 'ready' && <span className="vd-badge"><SvgIcon name="check" size={12} /> Saved</span>}
      {saving && (
        <span className="vd-badge vd-badge--busy">
          {saving.status === 'error' || saving.status === 'missing' || saving.status === 'cancelled' ? 'Not saved' : `Saving ${saving.percent}%`}
        </span>
      )}
      {left > 0 && <span className="vd-progress" aria-hidden="true"><span style={{ width: `${left}%` }} /></span>}
    </>
  );
}

/** One video: 16:9 picture with its length, then the channel's picture, title, channel, views and age. */
export function VideoCard({ video, onRemove, removeLabel = 'list', row = false, showChannel = true }: { video: VideoResult; onRemove?: () => void; removeLabel?: string; row?: boolean; showChannel?: boolean }) {
  const meta = [views(video.views), age(video.published)].filter(Boolean).join(' · ');
  return (
    <article className={`vd-card${row ? ' vd-card--row' : ''}`}>
      <Link to={watchPath(video.id)} className="vd-thumb" aria-label={`Play ${video.title}`}>
        <Thumb video={video} />
      </Link>
      <div className="vd-info">
        {!row && showChannel && <ChannelAvatar src={video.channelThumb} name={video.channel || video.title} />}
        <div className="vd-text">
          <Link to={watchPath(video.id)} className="vd-title" tabIndex={-1} title={video.title}>{video.title}</Link>
          {!showChannel ? null : video.channelId
            ? <Link to={channelPath(video.channelId)} className="vd-channel">{video.channel}</Link>
            : video.channel && <span className="vd-channel">{video.channel}</span>}
          {meta && <span className="vd-meta">{meta}</span>}
          {video.saved?.status === 'error' && video.saved.error && <span className="vd-meta vd-meta--err">{video.saved.error}</span>}
        </div>
      </div>
      {onRemove && (
        <button type="button" className="vd-remove" onClick={onRemove} aria-label={`Remove ${video.title} from ${removeLabel}`} title="Remove">
          <SvgIcon name="close" size={14} />
        </button>
      )}
    </article>
  );
}

export function VideoSkeletons({ count = 6, row = false }: { count?: number; row?: boolean }) {
  return (
    <div className={row ? 'vd-skel-row' : 'vd-grid'} role="status" aria-label="Loading videos">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="vd-skel">
          <Skeleton className="vd-skel-thumb" />
          <Skeleton className="skeleton-line" style={{ width: '85%', marginTop: 12 }} />
          <Skeleton className="skeleton-line" style={{ width: '50%', marginTop: 8 }} />
        </div>
      ))}
    </div>
  );
}

/** A titled sideways row of videos. Shows skeletons while `videos` is undefined, and `empty` (or nothing) when there are none. */
export function VideoRail({ title, videos, aside, empty, onRemove, removeLabel }: {
  title: string; videos: VideoResult[] | undefined; aside?: ReactNode; empty?: ReactNode; onRemove?: (v: VideoResult) => void; removeLabel?: string;
}) {
  if (videos && videos.length === 0 && !empty) return null;
  return (
    <section className="vd-rail" aria-label={title}>
      <div className="rail-head"><h2 className="rail-title">{title}</h2>{aside && <div className="vd-rail-aside">{aside}</div>}</div>
      {!videos ? <VideoSkeletons row count={5} />
        : videos.length === 0 ? empty
          : (
            <ScrollRow label={title} className="vd-row">
              {videos.map(v => <VideoCard key={v.id} video={v} {...(onRemove ? { onRemove: () => onRemove(v), removeLabel } : {})} />)}
            </ScrollRow>
          )}
    </section>
  );
}

export function SubscribeButton({ subscribed, busy, onToggle, name }: { subscribed: boolean; busy?: boolean; onToggle: () => void; name: string }) {
  return (
    <button type="button" className={`btn ${subscribed ? 'btn-secondary' : 'btn-primary'} vd-sub-btn`} onClick={onToggle} disabled={busy} aria-pressed={subscribed}
      aria-label={subscribed ? `Unsubscribe from ${name}` : `Subscribe to ${name}`}>
      <SvgIcon name={subscribed ? 'check' : 'plus'} size={16} /> {subscribed ? 'Subscribed' : 'Subscribe'}
    </button>
  );
}

export function ChannelCard({ channel, subscribed, onToggle }: { channel: VideoChannel; subscribed: boolean; onToggle: () => void }) {
  return (
    <article className="vd-chan-card">
      <Link to={channelPath(channel.id)} className="vd-chan-link" aria-label={`Open ${channel.name}`}>
        <ChannelAvatar src={channel.avatar} name={channel.name} size={88} />
        <span className="vd-chan-name">{channel.name}</span>
        <span className="vd-meta">{subscribers(channel.subscribers) || 'Channel'}</span>
      </Link>
      <SubscribeButton subscribed={subscribed} onToggle={onToggle} name={channel.name} />
    </article>
  );
}
