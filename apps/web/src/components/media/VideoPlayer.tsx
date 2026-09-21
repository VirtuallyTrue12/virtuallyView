import CastMenu from './CastMenu';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { SubtitleTrack } from './PlyrPlayer';
import { SvgIcon } from '../ui/SvgIcon';

export interface EpisodeGroup {
  label: string;
  items: Array<{ id: string; label: string; active: boolean; disabled?: boolean }>;
}

interface VideoPlayerProps {
  /** Direct-play URL (range requests, native seeking). */
  src: string;
  /** When set, the file is converted live: seeking restarts it at `?start=`. */
  transcodeSrc?: string;
  /** Total length; required for a usable seek bar while transcoding. */
  durationSeconds?: number | null;
  poster?: string;
  title?: string;
  subtitles?: SubtitleTrack[];
  startAt?: number;
  autoPlay?: boolean;
  onProgress?: (position: number, duration: number) => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
  next?: { label: string; onSelect: () => void };
  previous?: { label: string; onSelect: () => void };
  episodes?: { groups: EpisodeGroup[]; onSelect: (id: string) => void };
  /** Converted stream path used when casting to a TV, which is the safest format for any screen. */
  castTranscode?: string;
  /** Watch together: what the others did, and a way to tell them what this viewer did. */
  party?: { remote: { playing: boolean; position: number; seq: number } | null; onLocal: (playing: boolean, position: number) => void };
  /** Audio streams in the file; the menu appears only while converting. */
  audioTracks?: Array<{ index: number; label: string }>;
  /** Picture-based subtitles (PGS, VobSub). They are drawn onto the video, so they need conversion. */
  imageSubtitles?: Array<{ index: number; label: string }>;
  /** Source height in pixels, to offer only lower qualities. */
  sourceHeight?: number | null;
  /** Chapter marks from the file; intro, recap and credits chapters get a skip button. */
  chapters?: Array<{ start: number; end: number; title: string }>;
  /** TV episode: offer a manual skip near the start when the file has no chapters. */
  isEpisode?: boolean;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const HIDE_AFTER_MS = 3200;
const UP_NEXT_SECONDS = 8;

const fmt = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

const Icon = ({ d, size = 22 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={d} /></svg>
);
const ICONS = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  back10: 'M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8zm-1.1 11h-.9v-3.4l-.9.3v-.7l1.7-.6h.1zm3.3-1.8c0 .5-.1.9-.3 1.1-.2.3-.5.4-.9.4s-.7-.1-.9-.4c-.2-.3-.3-.6-.3-1.1v-.6c0-.5.1-.9.3-1.1.2-.3.5-.4.9-.4s.7.1.9.4c.2.3.3.6.3 1.1zm-.9-.7c0-.3 0-.5-.1-.6-.1-.1-.2-.2-.3-.2s-.3.1-.3.2c-.1.1-.1.3-.1.6v.8c0 .3 0 .5.1.6.1.1.2.2.3.2s.3-.1.3-.2c.1-.1.1-.3.1-.6z',
  fwd10: 'M12 5V1l5 5-5 5V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8zm-1.1 11h-.9v-3.4l-.9.3v-.7l1.7-.6h.1zm3.3-1.8c0 .5-.1.9-.3 1.1-.2.3-.5.4-.9.4s-.7-.1-.9-.4c-.2-.3-.3-.6-.3-1.1v-.6c0-.5.1-.9.3-1.1.2-.3.5-.4.9-.4s.7.1.9.4c.2.3.3.6.3 1.1zm-.9-.7c0-.3 0-.5-.1-.6-.1-.1-.2-.2-.3-.2s-.3.1-.3.2c-.1.1-.1.3-.1.6v.8c0 .3 0 .5.1.6.1.1.2.2.3.2s.3-.1.3-.2c.1-.1.1-.3.1-.6z',
  next: 'M6 6l8.5 6L6 18zM16 6h2v12h-2z',
  prev: 'M18 18l-8.5-6L18 6zM6 6h2v12H6z',
  volume: 'M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z',
  mute: 'M16.5 12A4.5 4.5 0 0 0 14 8v2.2l2.5 2.5c0-.2 0-.5 0-.7zM19 12c0 .9-.2 1.8-.5 2.6l1.5 1.5A8.8 8.8 0 0 0 21 12a9 9 0 0 0-7-8.8v2.1c2.9.9 5 3.5 5 6.7zM4.3 3 3 4.3 7.7 9H3v6h4l5 5v-6.7l4.3 4.3c-.7.5-1.4.9-2.3 1.1v2.1a9 9 0 0 0 3.7-1.8l2 2 1.3-1.3L4.3 3zM12 4 9.9 6.1 12 8.2z',
  cc: 'M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1z',
  list: 'M3 13h2v-2H3zm0 4h2v-2H3zm0-8h2V7H3zm4 4h14v-2H7zm0 4h14v-2H7zM7 7v2h14V7z',
  full: 'M7 14H5v5h5v-2H7zm-2-4h2V7h3V5H5zm12 7h-3v2h5v-5h-2zM14 5v2h3v3h2V5z',
  exitFull: 'M5 16h3v3h2v-5H5zm3-8H5v2h5V5H8zm6 11h2v-3h3v-2h-5zm2-11V5h-2v5h5V8z'
};

export default function VideoPlayer({
  src, transcodeSrc, durationSeconds, poster, title, subtitles = [], startAt = 0, autoPlay = true,
  onProgress, onEnded, onError, next, previous, episodes, audioTracks = [], imageSubtitles = [], sourceHeight, chapters = [], isEpisode = false, party, castTranscode
}: VideoPlayerProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  const resumeApplied = useRef(false);
  const wantPlay = useRef(autoPlay);
  const partyRef = useRef(party);
  partyRef.current = party;
  // Set while a remote change is being applied, so it is not echoed back.
  const applyingUntil = useRef(0);
  const positionRef = useRef(0);

  const isTranscode = !!transcodeSrc;
  const [offset, setOffset] = useState(isTranscode ? Math.floor(startAt) : 0);
  const [time, setTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [subIndex, setSubIndex] = useState(-1);
  const [menu, setMenu] = useState<null | 'speed' | 'subs' | 'episodes' | 'audio' | 'quality' | 'cast'>(null);
  const [audioIndex, setAudioIndex] = useState(0);
  const [quality, setQuality] = useState(0);
  const [burnIndex, setBurnIndex] = useState(-1);
  const [visible, setVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [upNext, setUpNext] = useState<number | null>(null);

  const [cast, setCast] = useState<{ token: string; origin: string } | null>(null);
  const baseSrc = isTranscode
    ? `${transcodeSrc}?start=${offset}${audioIndex ? `&audio=${audioIndex}` : ''}${quality ? `&height=${quality}` : ''}${burnIndex >= 0 ? `&burn=${burnIndex}` : ''}`
    : src;
  // A cast receiver has no login cookie: it gets an absolute address with a signed, expiring token.
  const videoSrc = cast ? `${cast.origin}${baseSrc}${baseSrc.includes('?') ? '&' : '?'}st=${cast.token}` : baseSrc;
  const total = isTranscode ? (durationSeconds ?? 0) : mediaDuration;
  const position = isTranscode ? offset + time : time;
  positionRef.current = position;
  const emit = useCallback((playingNow: boolean, at?: number) => {
    const binding = partyRef.current;
    if (!binding || Date.now() < applyingUntil.current) return;
    binding.onLocal(playingNow, at ?? positionRef.current);
  }, []);
  const shown = scrub ?? position;
  const pct = total > 0 ? Math.min(100, (shown / total) * 100) : 0;
  const bufPct = total > 0 ? Math.min(100, ((isTranscode ? offset + buffered : buffered) / total) * 100) : 0;

  const SKIP_RE = /^(intro|introduction|opening|op|recap|previously|prologue|title sequence|credits|end credits|ending|outro|ed)\b/i;
  const skipChapter = chapters.find(c => SKIP_RE.test(c.title.trim()) && position >= c.start && position < c.end - 1);
  const skipIsCredits = skipChapter ? /credit|ending|outro|^ed\b/i.test(skipChapter.title) : false;
  const manualSkip = !skipChapter && isEpisode && chapters.length === 0 && position > 5 && position < 300;
  const currentChapter = chapters.find(c => position >= c.start && position < c.end);

  const wake = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) { setVisible(false); setMenu(null); }
    }, HIDE_AFTER_MS);
  }, []);

  useEffect(() => () => { if (hideTimer.current) window.clearTimeout(hideTimer.current); }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) { wantPlay.current = true; void v.play().catch(() => setPlaying(false)); }
    else { wantPlay.current = false; v.pause(); }
  }, []);

  const seekTo = useCallback((target: number) => {
    const v = videoRef.current;
    if (!v) return;
    const max = total > 0 ? total - 0.5 : Number.POSITIVE_INFINITY;
    const t = Math.max(0, Math.min(target, max));
    setUpNext(null);
    emit(!v.paused, t);
    if (isTranscode) {
      wantPlay.current = !v.paused || wantPlay.current;
      setTime(0);
      setWaiting(true);
      setOffset(Math.floor(t));
    } else {
      v.currentTime = t;
      setTime(t);
    }
  }, [isTranscode, total, emit]);

  // Changing audio track or quality re-runs the conversion from where we are.
  const restartWith = (apply: () => void) => {
    wantPlay.current = videoRef.current ? !videoRef.current.paused || wantPlay.current : true;
    setOffset(Math.floor(position));
    setTime(0);
    setWaiting(true);
    apply();
  };

  const sign = async (path: string) => {
    const res = await fetch('/api/stream-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
    const data = (await res.json()) as { token?: string; origin?: string; message?: string };
    if (!res.ok || !data.token || !data.origin) throw new Error(data.message ?? 'Could not prepare the cast link.');
    return { token: data.token, origin: data.origin };
  };

  const browserCastSupported = typeof HTMLVideoElement !== 'undefined' &&
    ('remotePlayback' in HTMLVideoElement.prototype || 'webkitShowPlaybackTargetPicker' in HTMLVideoElement.prototype);

  // Chromecast (Chrome, Edge) and AirPlay (Safari): the browser finds the devices, we hand it a link they can open.
  const castFromBrowser = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      const link = await sign((isTranscode ? (transcodeSrc ?? src) : src).split('?')[0] ?? src);
      const resumeAt = positionRef.current;
      if (!isTranscode) v.addEventListener('loadedmetadata', () => { v.currentTime = resumeAt; void v.play().catch(() => undefined); }, { once: true });
      setCast(link);
      window.setTimeout(() => {
        const remote = (v as HTMLVideoElement & { remotePlayback?: { prompt: () => Promise<void> } }).remotePlayback;
        if (remote?.prompt) remote.prompt().catch(() => undefined);
        else (v as HTMLVideoElement & { webkitShowPlaybackTargetPicker?: () => void }).webkitShowPlaybackTargetPicker?.();
      }, 500);
    } catch (err) {
      setFailed((err as Error).message);
    }
  };

  // DLNA: the server tells the TV what to play, so this page can be closed.
  const castToDevice = async (device: { id: string; name: string }): Promise<string> => {
    const path = castTranscode ? `${castTranscode}?start=${Math.floor(positionRef.current)}` : src;
    const res = await fetch('/api/cast/play', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: device.id, path, title }) });
    const data = (await res.json()) as { message?: string };
    if (!res.ok) throw new Error(data.message ?? 'The TV did not accept it.');
    videoRef.current?.pause();
    return data.message ?? `Playing on ${device.name}.`;
  };

  const skip = useCallback((delta: number) => seekTo(position + delta), [seekTo, position]);

  // Apply what someone else in the watch party just did.
  const remoteSeq = party?.remote?.seq;
  useEffect(() => {
    const remote = partyRef.current?.remote;
    const v = videoRef.current;
    if (!remote || !v) return;
    applyingUntil.current = Date.now() + 1500;
    if (Math.abs(remote.position - positionRef.current) > 1.5) seekTo(remote.position);
    if (remote.playing) { wantPlay.current = true; void v.play().catch(() => setPlaying(false)); }
    else { wantPlay.current = false; v.pause(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteSeq]);

  // New transcode offset = new URL: reload and keep playing if it was playing.
  const firstSrc = useRef(true);
  useEffect(() => {
    if (firstSrc.current) { firstSrc.current = false; return; }
    const v = videoRef.current;
    if (!v) return;
    setFailed(null);
    v.load();
    if (wantPlay.current) void v.play().catch(() => setPlaying(false));
  }, [videoSrc]);

  // Reset when the item itself changes (next episode).
  useEffect(() => {
    resumeApplied.current = false;
    wantPlay.current = autoPlay;
    setFailed(null);
    setUpNext(null);
    setSubIndex(-1);
    setAudioIndex(0);
    setQuality(0);
    setBurnIndex(-1);
    setOffset(isTranscode ? Math.floor(startAt) : 0);
    setTime(0);
    setWaiting(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, transcodeSrc]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) { v.volume = volume; v.muted = muted; v.playbackRate = rate; }
  }, [volume, muted, rate, videoSrc]);

  const subKey = useMemo(() => `${subtitles.map(s => s.src).join('|')}@${offset}`, [subtitles, offset]);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    for (let i = 0; i < v.textTracks.length; i++) {
      v.textTracks[i].mode = i === subIndex ? 'showing' : 'disabled';
    }
  }, [subIndex, subKey, videoSrc]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const togglePip = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture();
    else void v.requestPictureInPicture?.().catch(() => {});
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft': e.preventDefault(); skip(-10); break;
        case 'ArrowRight': e.preventDefault(); skip(10); break;
        case 'ArrowUp': e.preventDefault(); setVolume(v => Math.min(1, v + 0.1)); setMuted(false); break;
        case 'ArrowDown': e.preventDefault(); setVolume(v => Math.max(0, v - 0.1)); break;
        case 'm': setMuted(m => !m); break;
        case 'f': toggleFullscreen(); break;
        case 'c': if (subtitles.length) setSubIndex(i => (i >= 0 ? -1 : 0)); break;
        case 'n': if (next) next.onSelect(); break;
        default: return;
      }
      wake();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, skip, toggleFullscreen, wake, next, subtitles.length]);

  // Up-next countdown after an episode ends.
  useEffect(() => {
    if (upNext === null) return;
    if (upNext <= 0) { next?.onSelect(); return; }
    const id = window.setTimeout(() => setUpNext(n => (n === null ? null : n - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [upNext, next]);

  const seekFromPointer = (clientX: number) => {
    const bar = barRef.current;
    if (!bar || total <= 0) return null;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return { ratio, t: ratio * total };
  };
  const onBarDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const hit = seekFromPointer(e.clientX);
    if (!hit) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setScrub(hit.t);
  };
  const onBarMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const hit = seekFromPointer(e.clientX);
    if (!hit) return;
    setHover({ x: hit.ratio * 100, t: hit.t });
    if (scrub !== null) setScrub(hit.t);
  };
  const onBarUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (scrub === null) return;
    const hit = seekFromPointer(e.clientX);
    const target = hit ? hit.t : scrub;
    setScrub(null);
    seekTo(target);
  };

  const reportError = (message: string) => {
    setFailed(message);
    setWaiting(false);
    onError?.(message);
  };

  const cls = `vp${visible || !playing ? ' vp--show' : ''}${fullscreen ? ' vp--fs' : ''}`;

  return (
    <div
      ref={wrapRef}
      className={cls}
      onMouseMove={wake}
      onMouseLeave={() => { if (playing) setVisible(false); }}
      onTouchStart={wake}
      tabIndex={-1}
    >
      <video
        ref={videoRef}
        className="vp-video"
        src={videoSrc}
        poster={poster}
        autoPlay={autoPlay}
        playsInline
        crossOrigin="anonymous"
        onClick={() => { if (menu) setMenu(null); else togglePlay(); }}
        onDoubleClick={toggleFullscreen}
        onPlay={() => { setPlaying(true); wake(); emit(true); }}
        onPause={() => { setPlaying(false); setVisible(true); emit(false); }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => { setWaiting(false); setPlaying(true); }}
        onCanPlay={() => setWaiting(false)}
        onLoadedMetadata={e => {
          const v = e.currentTarget;
          setMediaDuration(Number.isFinite(v.duration) ? v.duration : 0);
          v.playbackRate = rate;
          if (!resumeApplied.current) {
            resumeApplied.current = true;
            if (!isTranscode && startAt > 0) { try { v.currentTime = startAt; } catch { /* not seekable yet */ } }
          }
        }}
        onDurationChange={e => { if (Number.isFinite(e.currentTarget.duration)) setMediaDuration(e.currentTarget.duration); }}
        onTimeUpdate={e => {
          const v = e.currentTarget;
          setTime(v.currentTime);
          if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
          const dur = isTranscode ? (durationSeconds ?? 0) : v.duration;
          if (dur > 0) onProgress?.((isTranscode ? offset : 0) + v.currentTime, dur);
        }}
        onEnded={() => {
          setPlaying(false);
          setVisible(true);
          onEnded?.();
          if (next) setUpNext(UP_NEXT_SECONDS);
        }}
        onError={e => {
          const code = e.currentTarget.error?.code;
          reportError(code === 4
            ? 'This browser could not decode the video. Try again, or pick another source.'
            : `Playback error (code ${code ?? 'unknown'}).`);
        }}
      >
        {subtitles.map(track => (
          <track
            key={`${track.src}@${offset}`}
            kind="subtitles"
            src={isTranscode ? `${track.src}?offset=${offset}` : track.src}
            label={track.label}
            srcLang={track.srclang}
          />
        ))}
      </video>

      {waiting && !failed && <div className="vp-spinner" aria-label="Loading" />}
      {!playing && !waiting && !failed && upNext === null && (
        <button className="vp-bigplay" type="button" onClick={togglePlay} aria-label="Play"><Icon d={ICONS.play} size={40} /></button>
      )}

      {failed && (
        <div className="vp-fail" role="alert">
          <p>{failed}</p>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setFailed(null); setWaiting(true); videoRef.current?.load(); void videoRef.current?.play().catch(() => {}); }}>
            Retry
          </button>
        </div>
      )}

      {upNext !== null && next && (
        <div className="vp-upnext" role="status">
          <span>Up next: {next.label}</span>
          <strong>{upNext}s</strong>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => next.onSelect()}>Play now</button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => setUpNext(null)}>Cancel</button>
        </div>
      )}

      {(skipChapter || manualSkip) && !failed && upNext === null && (
        <button
          type="button"
          className="vp-skip"
          onClick={() => {
            if (skipChapter) {
              if (skipIsCredits && next) next.onSelect();
              else seekTo(skipChapter.end);
            } else seekTo(position + 90);
          }}
        >
          {skipChapter ? (skipIsCredits ? (next ? 'Next episode' : 'Skip credits') : /recap|previously/i.test(skipChapter.title) ? 'Skip recap' : 'Skip intro') : 'Skip 90 s'}
        </button>
      )}

      <div className="vp-controls" onClick={e => e.stopPropagation()}>
        {title && <div className="vp-title">{title}</div>}

        <div
          ref={barRef}
          className="vp-bar"
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.floor(total)}
          aria-valuenow={Math.floor(shown)}
          tabIndex={0}
          onPointerDown={onBarDown}
          onPointerMove={onBarMove}
          onPointerUp={onBarUp}
          onPointerLeave={() => setHover(null)}
        >
          <div className="vp-bar-track">
            <div className="vp-bar-buffer" style={{ width: `${bufPct}%` }} />
            <div className="vp-bar-fill" style={{ width: `${pct}%` }} />
            {total > 0 && chapters.slice(1).map(c => <span key={c.start} className="vp-bar-tick" style={{ left: `${(c.start / total) * 100}%` }} />)}
            <div className="vp-bar-thumb" style={{ left: `${pct}%` }} />
          </div>
          {hover && <div className="vp-bar-tip" style={{ left: `${hover.x}%` }}>{fmt(hover.t)}{chapters.find(c => hover.t >= c.start && hover.t < c.end) ? `, ${chapters.find(c => hover.t >= c.start && hover.t < c.end)!.title}` : ''}</div>}
        </div>

        <div className="vp-row">
          <div className="vp-group">
            {previous && <button type="button" className="vp-btn" onClick={previous.onSelect} title={`Previous: ${previous.label}`} aria-label="Previous episode"><Icon d={ICONS.prev} /></button>}
            <button type="button" className="vp-btn" onClick={() => skip(-10)} title="Back 10s (left arrow)" aria-label="Back 10 seconds"><Icon d={ICONS.back10} /></button>
            <button type="button" className="vp-btn vp-btn--main" onClick={togglePlay} title="Play/Pause (space)" aria-label={playing ? 'Pause' : 'Play'}><Icon d={playing ? ICONS.pause : ICONS.play} size={26} /></button>
            <button type="button" className="vp-btn" onClick={() => skip(10)} title="Forward 10s (right arrow)" aria-label="Forward 10 seconds"><Icon d={ICONS.fwd10} /></button>
            {next && <button type="button" className="vp-btn" onClick={next.onSelect} title={`Next: ${next.label} (n)`} aria-label="Next episode"><Icon d={ICONS.next} /></button>}
            <div className="vp-volume">
              <button type="button" className="vp-btn" onClick={() => setMuted(m => !m)} title="Mute (m)" aria-label={muted ? 'Unmute' : 'Mute'}>
                <Icon d={muted || volume === 0 ? ICONS.mute : ICONS.volume} />
              </button>
              <input
                type="range" min={0} max={1} step={0.05}
                value={muted ? 0 : volume}
                aria-label="Volume"
                onChange={e => { setVolume(Number(e.target.value)); setMuted(false); }}
              />
            </div>
            <span className="vp-time">{fmt(shown)} / {total > 0 ? fmt(total) : '--:--'}{currentChapter ? `  ${currentChapter.title}` : ''}</span>
          </div>

          <div className="vp-group">
            {episodes && (
              <div className="vp-menu-wrap">
                <button type="button" className={`vp-btn${menu === 'episodes' ? ' is-on' : ''}`} onClick={() => setMenu(m => (m === 'episodes' ? null : 'episodes'))} title="Episodes" aria-label="Episodes"><Icon d={ICONS.list} /></button>
                {menu === 'episodes' && (
                  <div className="vp-menu vp-menu--episodes" role="menu">
                    {episodes.groups.map(group => (
                      <div key={group.label}>
                        <div className="vp-menu-head">{group.label}</div>
                        {group.items.map(item => (
                          <button
                            key={item.id} type="button" role="menuitem" disabled={item.disabled}
                            className={`vp-menu-item${item.active ? ' is-active' : ''}`}
                            onClick={() => { setMenu(null); if (!item.active) episodes.onSelect(item.id); }}
                          >{item.label}</button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="vp-menu-wrap">
              <button type="button" className={`vp-btn${menu === 'subs' || subIndex >= 0 ? ' is-on' : ''}`} onClick={() => setMenu(m => (m === 'subs' ? null : 'subs'))} title="Subtitles (c)" aria-label="Subtitles"><Icon d={ICONS.cc} /></button>
              {menu === 'subs' && (
                <div className="vp-menu" role="menu">
                  <div className="vp-menu-head">Subtitles</div>
                  <button type="button" role="menuitem" className={`vp-menu-item${subIndex < 0 ? ' is-active' : ''}`} onClick={() => { setSubIndex(-1); setMenu(null); }}>Off</button>
                  {subtitles.map((track, i) => (
                    <button key={track.src} type="button" role="menuitem" className={`vp-menu-item${subIndex === i ? ' is-active' : ''}`} onClick={() => { setSubIndex(i); setMenu(null); }}>{track.label}</button>
                  ))}
                  {isTranscode && imageSubtitles.length > 0 && (
                    <>
                      <div className="vp-menu-head">Picture subtitles (converts the video)</div>
                      {burnIndex >= 0 && (
                        <button type="button" role="menuitem" className="vp-menu-item" onClick={() => { setMenu(null); restartWith(() => setBurnIndex(-1)); }}>Turn picture subtitles off</button>
                      )}
                      {imageSubtitles.map(track => (
                        <button key={track.index} type="button" role="menuitem" className={`vp-menu-item${burnIndex === track.index ? ' is-active' : ''}`} onClick={() => { setMenu(null); if (track.index !== burnIndex) restartWith(() => { setSubIndex(-1); setBurnIndex(track.index); }); }}>{track.label}</button>
                      ))}
                    </>
                  )}
                  {subtitles.length === 0 && imageSubtitles.length === 0 && (
                    <div className="vp-menu-empty">No subtitle files found for this title</div>
                  )}
                </div>
              )}
            </div>
            {isTranscode && audioTracks.length > 1 && (
              <div className="vp-menu-wrap">
                <button type="button" className={`vp-btn vp-btn--text${menu === 'audio' ? ' is-on' : ''}`} onClick={() => setMenu(m => (m === 'audio' ? null : 'audio'))} title="Audio track" aria-label="Audio track">Audio</button>
                {menu === 'audio' && (
                  <div className="vp-menu" role="menu">
                    <div className="vp-menu-head">Audio</div>
                    {audioTracks.map(track => (
                      <button key={track.index} type="button" role="menuitem" className={`vp-menu-item${audioIndex === track.index ? ' is-active' : ''}`} onClick={() => { setMenu(null); if (track.index !== audioIndex) restartWith(() => setAudioIndex(track.index)); }}>{track.label}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {isTranscode && (
              <div className="vp-menu-wrap">
                <button type="button" className={`vp-btn vp-btn--text${menu === 'quality' ? ' is-on' : ''}`} onClick={() => setMenu(m => (m === 'quality' ? null : 'quality'))} title="Quality" aria-label="Quality">{quality ? `${quality}p` : 'Auto'}</button>
                {menu === 'quality' && (
                  <div className="vp-menu" role="menu">
                    <div className="vp-menu-head">Quality</div>
                    {[0, 1080, 720, 480, 360].filter(q => q === 0 || !sourceHeight || q < sourceHeight).map(q => (
                      <button key={q} type="button" role="menuitem" className={`vp-menu-item${quality === q ? ' is-active' : ''}`} onClick={() => { setMenu(null); if (q !== quality) restartWith(() => setQuality(q)); }}>{q === 0 ? 'Auto (original)' : `${q}p`}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="vp-menu-wrap">
              <button type="button" className={`vp-btn vp-btn--text${menu === 'speed' ? ' is-on' : ''}`} onClick={() => setMenu(m => (m === 'speed' ? null : 'speed'))} title="Playback speed" aria-label="Playback speed">{rate}×</button>
              {menu === 'speed' && (
                <div className="vp-menu" role="menu">
                  <div className="vp-menu-head">Speed</div>
                  {SPEEDS.map(s => (
                    <button key={s} type="button" role="menuitem" className={`vp-menu-item${rate === s ? ' is-active' : ''}`} onClick={() => { setRate(s); setMenu(null); }}>{s === 1 ? 'Normal' : `${s}×`}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="vp-menu-wrap">
              <button type="button" className={`vp-btn vp-btn--text${menu === 'cast' ? ' is-on' : ''}`} onClick={() => setMenu(m => (m === 'cast' ? null : 'cast'))} title="Cast to a TV" aria-label="Cast to a TV">Cast</button>
              {menu === 'cast' && (
                <CastMenu browserCast={browserCastSupported} onBrowserCast={() => void castFromBrowser()} onDevice={castToDevice} onClose={() => setMenu(null)} />
              )}
            </div>
            {typeof document !== 'undefined' && document.pictureInPictureEnabled && (
              <button type="button" className="vp-btn" onClick={togglePip} title="Picture in picture" aria-label="Picture in picture"><SvgIcon name="pip" size={20} /></button>
            )}
            <button type="button" className="vp-btn" onClick={toggleFullscreen} title="Fullscreen (f)" aria-label="Fullscreen"><Icon d={fullscreen ? ICONS.exitFull : ICONS.full} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
