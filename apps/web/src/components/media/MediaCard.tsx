import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { StatusPill } from './StatusPill';
import type { MediaItem } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';

type Props = {
  item: MediaItem;
  showStatus?: boolean;
  progress?: number;
  to?: string;
};

/**
 * Library tile. The watch-progress bar sits on the bottom edge of the artwork
 * like a streaming service, so "how far am I" is readable at a glance.
 *
 * When the item has a local stream URL, hovering or focusing the tile waits a
 * moment and then plays a muted, loopless preview of the actual file over the
 * artwork. The preview is deliberately opt-in per gesture: it only appears
 * after the pointer has been resting on the tile, never on a quick swipe.
 */
export function MediaCard({ item, showStatus = false, progress, to }: Props) {
  const [broken, setBroken] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showImage = !!item.artwork?.poster && !broken;
  const percent = typeof progress === 'number' && progress > 0 ? Math.max(0, Math.min(100, progress)) : 0;

  const armPreview = () => {
    if (!item.streamUrl || previewFailed || timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setPreviewing(true);
    }, 1200);
  };

  const disarmPreview = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (previewing) {
      setPreviewing(false);
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    }
  };

  // Clear any pending preview timer if the card unmounts mid-gesture.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const card = (
    <article
      className="media-card"
      aria-label={item.title}
      onPointerEnter={armPreview}
      onPointerLeave={disarmPreview}
      onFocus={armPreview}
      onBlur={disarmPreview}
    >
      <div className="media-card-artwork">
        {showImage && (
          <img
            src={item.artwork!.poster}
            alt={`${item.title} poster`}
            loading="lazy"
            onError={() => setBroken(true)}
          />
        )}
        {previewing && !previewFailed && (
          <video
            ref={videoRef}
            className="media-card-preview"
            src={item.streamUrl}
            muted
            autoPlay
            playsInline
            onError={() => {
              setPreviewing(false);
              setPreviewFailed(true);
            }}
          />
        )}
        {showStatus && item.status && (
          <div className="media-card-badge"><StatusPill status={item.status} /></div>
        )}
        {(item.favorite || item.watched) && (
          <div className="media-card-flags" aria-hidden="true">
            {item.favorite && <span title="In My List"><SvgIcon name="heart" size={12} /></span>}
            {item.watched && <span title="Watched"><SvgIcon name="check" size={12} /></span>}
          </div>
        )}
        {percent > 0 && (
          <div
            className="media-card-progress-track"
            role="progressbar"
            aria-label={`${item.title} watched ${Math.round(percent)}%`}
            aria-valuenow={Math.round(percent)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="media-card-progress-fill" style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
      <div className="media-card-info">
        <h3 className="media-card-title">{item.title}</h3>
        <p className="media-card-sub">
          {[item.year, item.quality].filter(Boolean).join(' · ')}
        </p>
      </div>
    </article>
  );

  if (to) {
    return (
      <Link className="media-card-link" to={to} aria-label={`View ${item.title}`}>
        {card}
      </Link>
    );
  }
  return card;
}