import { useEffect, useRef } from 'react';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';

export interface SubtitleTrack {
  src: string;
  label: string;
  srclang: string;
  default?: boolean;
}

const NO_SUBTITLES: SubtitleTrack[] = [];

interface PlyrPlayerProps {
  source: { type: 'youtube'; videoId: string } | { type: 'video'; src: string; poster?: string };
  className?: string;
  autoPlay?: boolean;
  muted?: boolean;
  /** Nothing fetched until play() is called; useful for preview players. */
  preload?: HTMLMediaElement['preload'];
  controls?: boolean;
  subtitles?: SubtitleTrack[];
  /** Called once the underlying media element exists and is ready. */
  onReady?: (player: Plyr, media: HTMLMediaElement | null) => void;
  onError?: (msg: string) => void;
}

/**
 * Thin wrapper around Plyr. Re-creates the player when the source or subtitle
 * list changes so tracks and state never leak between items.
 */
export default function PlyrPlayer({
  source,
  className,
  autoPlay = false,
  muted = false,
  preload,
  controls = true,
  subtitles = NO_SUBTITLES,
  onReady,
  onError,
}: PlyrPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Plyr | null>(null);
  const readyFired = useRef(false);

  const sourceSrc = source.type === 'video' ? source.src : source.videoId;
  const sourcePoster = source.type === 'video' ? source.poster : undefined;
  const subtitlesKey = subtitles.map(t => t.src).join('|');

  // Create / recreate player only when source or subtitles change.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = '';
    readyFired.current = false;

    let media: HTMLVideoElement | HTMLDivElement;
    if (source.type === 'video') {
      const video = document.createElement('video');
      video.src = source.src;
      if (source.poster) video.poster = source.poster;
      if (preload) video.preload = preload;
      video.muted = muted;
      video.autoplay = autoPlay;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      for (const track of subtitles) {
        const t = document.createElement('track');
        t.kind = 'subtitles';
        t.src = track.src;
        t.label = track.label;
        t.srclang = track.srclang;
        (t as HTMLTrackElement).default = track.default === true;
        video.append(t);
      }
      media = video;
    } else {
      const embed = document.createElement('div');
      embed.dataset.plyrProvider = 'youtube';
      embed.dataset.plyrEmbedId = source.videoId;
      media = embed;
    }

    if (media instanceof HTMLVideoElement) {
      media.addEventListener('error', () => {
        const code = media.error?.code;
        const detail = code === 4 ? 'media source failed to load or is a format this browser cannot decode' : `error code ${code ?? 'unknown'}`;
        onError?.(`Could not play this video (${detail}).`);
      }, { once: true });
    }
    container.append(media);

    const player = new Plyr(media, {
      controls: controls ? undefined : [],
      autoplay: autoPlay,
      muted,
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
      // Only populate the settings menu with menus that have real options.
      // Plyr throws on an empty "quality" pane when no source sizes exist and
      // on an empty "captions" pane without track elements, which is what made
      // the controls appear broken on this page.
      settings: controls
        ? [
            ...(subtitles.length > 0 ? (['captions'] as const) : []),
            'speed'
          ]
        : [],
      captions: { active: subtitles.some(s => s.default), language: 'auto', update: true },
    });
    playerRef.current = player;

    // Plyr fires 'ready' on the media element; we also listen on the player's
    // event bus via the underlying element where available. A short guard
    // covers builds that resolve readiness before listeners attach.
    const fireReady = () => {
      if (readyFired.current) return;
      readyFired.current = true;
      const vid = media instanceof HTMLVideoElement ? media : null;
      onReady?.(player, vid);
    };
    const guard = window.setTimeout(fireReady, 90);
    media.addEventListener('canplay', fireReady, { once: true });
    media.addEventListener('loadedmetadata', fireReady, { once: true });
    return () => {
      window.clearTimeout(guard);
      try { player.destroy(); } catch { /* already gone */ }
      if (playerRef.current === player) playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSrc, sourcePoster, controls, autoPlay, muted, preload, subtitlesKey]);

  useEffect(() => {
    return () => {
      try { playerRef.current?.destroy(); } catch { /* already gone */ }
      playerRef.current = null;
      readyFired.current = false;
    };
  }, []);

  return <div ref={containerRef} className={className} />;
}