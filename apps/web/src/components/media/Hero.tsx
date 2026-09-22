import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatusPill } from './StatusPill';
import { api, type HeroCandidate } from '../../lib/api';
import PlyrPlayer from './PlyrPlayer';
import { useRequester } from '../../lib/useRequester';
import { QualitySelect } from '../requests/QualitySelect';
import { SvgIcon } from '../ui/SvgIcon';

const ROTATE_MS = 5000;
const HOVER_PREVIEW_MS = 2500;
const PREVIEW_WINDOW_SECONDS = 60;

type SourceMode = 'preview' | 'trailer';
type TrailerState = 'idle' | 'loading' | 'ready' | 'none';

export function Hero({ items }: { items: HeroCandidate[] }) {
  const navigate = useNavigate();
  const [idx, setIdx] = useState(0);
  const [prev, setPrev] = useState<HeroCandidate | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const [muted, setMuted] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [sourceMode, setSourceMode] = useState<SourceMode>('preview');
  const [trailerState, setTrailerState] = useState<TrailerState>('idle');
  const [youtubeId, setYoutubeId] = useState<string | null>(null);
  const [showTrailer, setShowTrailer] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const endAtRef = useRef(0);
  const endCheckRef = useRef<HTMLMediaElement | null>(null);
  const trailerFor = useRef<string | null>(null);
  // The hero stays inert until the pointer or keyboard has focused it once;
  // nothing rotates, loads, or plays as a side effect of page load.
  const interactedRef = useRef(false);

  // Latest-value refs so timer callbacks never act on stale state.
  const itemRef = useRef<HeroCandidate | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const hoveredRef = useRef(hovered);
  hoveredRef.current = hovered;
  const sourceModeRef = useRef<SourceMode>(sourceMode);
  sourceModeRef.current = sourceMode;
  const trailerStateRef = useRef<TrailerState>(trailerState);
  trailerStateRef.current = trailerState;
  const youtubeIdRef = useRef<string | null>(youtubeId);
  youtubeIdRef.current = youtubeId;

  const item = items[idx] ?? items[0];
  itemRef.current = item;
  const hasVideo = !!item?.streamUrl;

  const showToast = (text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };

  const requester = useRequester(outcome => showToast(outcome.message));

  // Play the local file (muted), from a random one-minute window so the hero
  // previews the movie without spoiling its opening scenes. Runs from a user
  // gesture or the 2.5-second hover timer.
  const startLocalPreview = () => {
    const media = mediaRef.current;
    if (!media) {
      if (itemRef.current) playTrailer(itemRef.current);
      return;
    }
    // Formats a browser cannot decode (e.g. MKV) fail here; fall back to the
    // online trailer instead of leaving the hero silent.
    const bail = () => {
      setPreviewing(false);
      if (itemRef.current) playTrailer(itemRef.current);
    };
    media.addEventListener('error', bail, { once: true });
    const begin = () => {
      const duration = media.duration;
      let offset = 0;
      let endAt: number;
      if (Number.isFinite(duration) && duration > 120) {
        offset = 120 + Math.random() * (duration - 180);
        endAt = offset + PREVIEW_WINDOW_SECONDS;
      } else if (Number.isFinite(duration) && duration > 0) {
        endAt = duration; // short piece: let it play to the end
      } else {
        endAt = Number.POSITIVE_INFINITY;
      }
      endAtRef.current = endAt;
      try { media.currentTime = offset; } catch { /* not seekable yet */ }
      media.muted = mutedRef.current;
      setPreviewing(true);
      void media.play().catch(bail);
    };
    if (media.readyState >= 1) begin();
    else {
      media.addEventListener('loadedmetadata', begin, { once: true });
      // The hero mounts its video with preload="none", so nothing is fetched
      // on page load; start loading now that the preview is genuinely wanted.
      try { media.load(); } catch { /* element not ready to load yet */ }
    }
  };

  // Resolve a trailer for the current title through the server's TMDB scraper
  // and (when the caller is already hovering) start showing it.
  const fetchTrailer = (forId: string, playWhenReady: boolean) => {
    trailerFor.current = forId;
    setTrailerState('loading');
    api.getTrailer(forId)
      .then(res => {
        if (trailerFor.current !== forId) return;
        if (res.youtubeId) {
          setYoutubeId(res.youtubeId);
          setTrailerState('ready');
          if (playWhenReady) setShowTrailer(true);
        } else {
          setTrailerState('none');
          showToast(`No trailer found for "${itemRef.current?.title ?? 'this title'}".`);
        }
      })
      .catch(() => {
        if (trailerFor.current !== forId) return;
        setTrailerState('none');
        showToast('Could not look up a trailer right now.');
      });
  };

  // Trailer path: reuse a resolved id, otherwise look one up and play on arrival.
  const playTrailer = (current: HeroCandidate) => {
    setSourceMode('trailer');
    sourceModeRef.current = 'trailer';
    setPreviewing(false);
    if (trailerStateRef.current === 'none') {
      showToast(`No trailer found for "${current.title}".`);
      return;
    }
    if (youtubeIdRef.current && trailerStateRef.current === 'ready') {
      setShowTrailer(true);
      return;
    }
    if (!trailerFor.current) fetchTrailer(current.id, true);
  };

  // The 2.5-second hover timer fires the freshest possible preview logic.
  const previewStarterRef = useRef<() => void>(() => {});
  previewStarterRef.current = () => {
    const current = itemRef.current;
    if (!current) return;
    // Local file first (random one-minute window); otherwise the online trailer.
    if (current.streamUrl && sourceModeRef.current === 'preview') startLocalPreview();
    else playTrailer(current);
  };

  useEffect(() => {
    // The hero never advances on its own from page load: rotation only begins
    // after the pointer or keyboard has actually focused the hero once. That
    // way the section waits for attention instead of autoplaying.
    if (hovered || items.length <= 1 || !interactedRef.current) return;
    timer.current = setInterval(() => {
      setPrev(items[idx]);
      setIdx(i => (i + 1) % items.length);
    }, ROTATE_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [hovered, items.length, idx, items]);

  // Reset per-item playback state when the hero moves to another title.
  useEffect(() => {
    setPreviewing(false);
    setShowTrailer(false);
    trailerFor.current = null;
    setTrailerState('idle');
    setYoutubeId(null);
    const defaultMode: SourceMode = itemRef.current?.streamUrl ? 'preview' : 'trailer';
    setSourceMode(defaultMode);
    sourceModeRef.current = defaultMode;
    const media = mediaRef.current;
    if (media) { try { media.pause(); } catch { /* already gone */ } }
  }, [idx]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  if (!item) return null;

  const next = items[(idx + 1) % items.length];

  // Mute/unmute the live <video> element directly. Flipping the muted React
  // state alone would rebuild the whole Plyr instance and restart the preview.
  const applyMuted = (m: boolean) => {
    setMuted(m);
    if (mediaRef.current) {
      try { mediaRef.current.muted = m; } catch { /* not ready yet */ }
    }
  };

  // "Pointer focus" covers a mouse, a touchscreen, or a TV remote's focus
  // ring. Any of them counts as entering the hero, and the preview only ever
  // starts after a continuous 2.5 seconds of focus, never on page load.
  const enterHero = () => {
    interactedRef.current = true;
    setHovered(true);
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => previewStarterRef.current(), HOVER_PREVIEW_MS);
  };

  const leaveHero = () => {
    setHovered(false);
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    const media = mediaRef.current;
    if (media) { try { media.pause(); } catch { /* not playing */ } }
    setPreviewing(false);
    setShowTrailer(false);
  };

  const handleFocusEnter = (e: FocusEvent<HTMLElement>) => {
    // Only count focus arriving from outside the hero, not tabbing between
    // the buttons inside it, which would keep re-arming the timer.
    const related = e.relatedTarget;
    if (related && e.currentTarget.contains(related as Node)) return;
    enterHero();
  };

  const handleFocusLeave = (e: FocusEvent<HTMLElement>) => {
    const related = e.relatedTarget;
    if (related && e.currentTarget.contains(related as Node)) return;
    leaveHero();
  };

  const requestMovie = () => {
    void requester.submit({
      title: item.title,
      ...(item.year ? { year: item.year } : {}),
      mediaType: item.type === 'series' ? 'series' : item.type === 'artist' ? 'artist' : 'movie'
    });
  };

  const detailsPath = item.type === 'series' ? `/series/${item.id}` : item.type === 'artist' ? `/music/${item.id}` : `/movies/${item.id}`;
  const goToDetails = () => navigate(detailsPath);

  const play = () => navigate(item.type === 'movie' || !item.type ? `/movies/${item.id}/play` : detailsPath);

  return (
    <section
      className="hero"
      role="region"
      aria-label="Featured"
      tabIndex={0}
      onMouseEnter={enterHero}
      onMouseLeave={leaveHero}
      onFocus={handleFocusEnter}
      onBlur={handleFocusLeave}
    >
      {next.artwork?.backdrop && (
        <link rel="preload" as="image" href={next.artwork.backdrop} />
      )}
      {prev && prev !== item && prev.artwork?.backdrop && (
        <img
          className="hero-backdrop hero-slide--out"
          src={prev.artwork.backdrop}
          alt=""
          onAnimationEnd={() => setPrev(null)}
        />
      )}
      {item.artwork?.backdrop ? (
        <img
          key={idx}
          className={`hero-backdrop hero-slide--in${previewing || showTrailer ? ' hero-backdrop--hidden' : ''}`}
          src={item.artwork.backdrop}
          alt=""
        />
      ) : (
        <div key={idx} className="hero-backdrop hero-backdrop--placeholder" />
      )}
      {hasVideo && sourceMode === 'preview' && (
        <PlyrPlayer
          source={{ type: 'video', src: item.streamUrl!, poster: item.artwork?.backdrop }}
          // preload="none" keeps the hero from fetching the raw library file on
          // page load (and from tripping decode errors on formats like MKV).
          // The element stays invisible until the preview truly starts.
          className={`hero-trailer${previewing ? '' : ' hero-trailer--idle'}`}
          autoPlay={false}
          preload="none"
          // The muted prop stays constant so picking the preview source never
          // rebuilds the player; sound is toggled imperatively on the element.
          muted={true}
          controls={false}
          onReady={(_player, media) => {
            mediaRef.current = media;
            if (media) {
              media.muted = mutedRef.current;
              // Stop the preview when its random one-minute window ends.
              if (endCheckRef.current !== media) {
                endCheckRef.current = media;
                media.addEventListener('timeupdate', () => {
                  const endAt = endAtRef.current;
                  if (endAt > 0 && media.currentTime >= endAt) {
                    media.pause();
                    setPreviewing(false);
                  }
                });
              }
            }
          }}
          onError={msg => showToast(msg)}
        />
      )}
      {sourceMode === 'trailer' && showTrailer && youtubeId && (
        // The frame is sized larger than the hero and centred, so YouTube's own
        // letterboxing falls outside the visible area: the trailer fills edge to edge.
        <div className="hero-trailer hero-trailer-cover">
          <iframe
            key={`${youtubeId}-${muted ? 'm' : 'u'}`}
            src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&mute=${muted ? 1 : 0}&loop=1&playlist=${youtubeId}&controls=0&playsinline=1&modestbranding=1&rel=0`}
            title="Trailer preview"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}
      <div className="hero-overlay" aria-hidden="true" />
      <div className="hero-content">
        <span className="hero-eyebrow">{item.tagline}</span>
        <h1 className="hero-title" key={`t-${idx}`}>
          {item.title}
        </h1>
        <div className="hero-meta">
          {item.year && <span>{item.year}</span>}
          {item.runtime && <span>{item.runtime} min</span>}
          {item.rating ? <span className="rating"><SvgIcon name="star" size={14} /> {item.rating.toFixed(1)}</span> : null}
          {item.genres && item.genres.length > 0 && (
            <span className="genres">
              {item.genres.map(genre => (
                <span key={genre}>{genre}</span>
              ))}
            </span>
          )}
          {item.inLibrary && <StatusPill status={item.status} />}
          {!item.inLibrary && <span className="hero-absent">Not in library</span>}
        </div>
        {item.overview && <p className="hero-overview">{item.overview}</p>}
        <div className="hero-actions">
          {item.inLibrary ? (
            <>
              <button className="btn btn-primary" type="button" onClick={play}>
                Play
              </button>
              <button className="btn btn-secondary" type="button" onClick={goToDetails}>
                Details
              </button>
            </>
          ) : (
            <>
              <QualitySelect mediaType={item.type === 'series' ? 'series' : item.type === 'artist' ? 'artist' : 'movie'} compact />
              <button className="btn btn-primary" type="button" onClick={requestMovie} disabled={requester.busy}>
                {requester.busy ? 'Requesting…' : 'Request'}
              </button>
              <button className="btn btn-secondary" type="button" onClick={() => navigate(`/search?q=${encodeURIComponent(item.title)}`)}>
                Search
              </button>
            </>
          )}
        </div>
        {toast && <div className="hero-toast">{toast}</div>}
      </div>
      {(hasVideo || sourceMode === 'trailer') && (
        <button
          className="hero-mute-btn"
          type="button"
          onClick={e => { e.stopPropagation(); applyMuted(!muted); }}
          aria-label={muted ? 'Unmute preview' : 'Mute preview'}
        >
          <SvgIcon name={muted ? 'volume-mute' : 'volume-high'} size={20} />
        </button>
      )}
      {requester.picker}
      <nav className="hero-dots" aria-label="Featured titles" role="tablist">
        {items.map((candidate, i) => (
          <button
            key={candidate.id}
            className={`hero-dot${i === idx ? ' is-active' : ''}`}
            type="button"
            aria-label={candidate.title}
            aria-selected={i === idx}
            onClick={() => setIdx(i)}
          />
        ))}
      </nav>
    </section>
  );
}