import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { TrackItem } from '../../lib/api';
import MusicPlayerUI from '../music/MusicPlayerUI';

/**
 * One track in a play queue. Album/artist context is carried along so the
 * player bar can show what is playing without a live Music service call.
 */
export interface QueueEntry {
  track: Pick<TrackItem, 'id' | 'title' | 'quality' | 'durationMs'>;
  albumTitle?: string;
  artistTitle?: string;
  albumId?: string;
  cover?: string;
}

/** Five-band equalizer. Shelves at the ends, parametric in the middle. */
export const EQ_BANDS = [
  { label: '60 Hz', freq: 60, type: 'lowshelf', q: 0.7 },
  { label: '230 Hz', freq: 230, type: 'peaking', q: 0.8 },
  { label: '910 Hz', freq: 910, type: 'peaking', q: 0.9 },
  { label: '3.6 kHz', freq: 3600, type: 'peaking', q: 0.9 },
  { label: '12 kHz', freq: 12000, type: 'highshelf', q: 0.7 }
] as const;

export const EQ_PRESETS: Record<string, { name: string; gains: number[] }> = {
  flat: { name: 'Flat', gains: [0, 0, 0, 0, 0] },
  bass: { name: 'Bass boost', gains: [7, 5, 2, 0, 0] },
  treble: { name: 'Treble boost', gains: [0, 0, 2, 4, 6] },
  rock: { name: 'Rock', gains: [5, 3, -1, 2, 4] },
  pop: { name: 'Pop', gains: [-2, 2, 4, 2, -1] },
  vocal: { name: 'Vocal', gains: [-1, -1, 2, 3, 4] }
};

interface MusicContextValue {
  queue: QueueEntry[];
  index: number;
  entry: QueueEntry | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  error: string | null;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  /** How far the file has loaded, in seconds. */
  buffered: number;
  /** Waiting for data (the first bytes of a track, or after a seek). */
  buffering: boolean;
  /** The full-screen Now Playing view. */
  expanded: boolean;
  setExpanded: (open: boolean) => void;
  /** The exact position right now, read from the audio element (state only updates a few times a second). */
  getTime: () => number;
  removeFromQueue: (i: number) => void;
  clearUpcoming: () => void;
  eqEnabled: boolean;
  eqPreset: string;
  eqBands: number[];
  playQueue: (queue: QueueEntry[], startIndex?: number) => void;
  toggle: () => void;
  stopPlayback: () => void;
  nextTrack: () => void;
  prevTrack: () => void;
  skipTo: (i: number) => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  setEqEnabled: (enabled: boolean) => void;
  setEqPreset: (preset: string) => void;
  setEqBand: (index: number, gain: number) => void;
}

export type RepeatMode = 'off' | 'all' | 'one';

const MusicContext = createContext<MusicContextValue | null>(null);

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage disabled (private mode): playback still works, EQ just resets
  }
}

export function useMusicPlayer(): MusicContextValue {
  const value = useContext(MusicContext);
  if (!value) throw new Error('useMusicPlayer must be used inside MusicProvider.');
  return value;
}

interface EqGraph {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  filters: BiquadFilterNode[];
}

export function MusicProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolumeState] = useState(() => {
    const raw = Number(load('vv-music-volume') ?? '1');
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 1;
  });
  const [muted, setMuted] = useState(() => load('vv-music-muted') === '1');
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  const [buffered, setBuffered] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [expanded, setExpandedState] = useState(false);
  const [eqEnabled, setEqEnabledState] = useState(() => load('vv-eq-enabled') === '1');
  const [eqPreset, setEqPresetState] = useState(() => {
    const raw = load('vv-eq-preset');
    return raw && raw in EQ_PRESETS ? raw : 'flat';
  });
  const [eqBands, setEqBands] = useState<number[]>(() => {
    const raw = load('vv-eq-bands');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as number[];
        if (Array.isArray(parsed) && parsed.length === EQ_BANDS.length && parsed.every(n => Number.isFinite(n))) {
          return parsed;
        }
      } catch { /* fall through to default */ }
    }
    return [...(EQ_PRESETS.flat?.gains ?? [0, 0, 0, 0, 0])];
  });

  // Live refs for callbacks that must never close over stale state. This is
  // the documented "latest ref" pattern, so updating during render is fine.
  const indexRef = useRef(index);
  indexRef.current = index;
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const shuffleRef = useRef(shuffle);
  shuffleRef.current = shuffle;
  const repeatRef = useRef(repeat);
  repeatRef.current = repeat;
  const eqEnabledRef = useRef(eqEnabled);
  eqEnabledRef.current = eqEnabled;
  const eqBandsRef = useRef(eqBands);
  eqBandsRef.current = eqBands;
  const eqGraph = useRef<EqGraph | null>(null);
  const shuffleOrder = useRef<number[]>([]);
  // True while the person wants sound: a new track then starts by itself instead of waiting for another press.
  const wantPlay = useRef(false);

  /**
   * Wire the existing graph for the current mode. Enabled routes the media
   * element through the band filters; disabled routes straight to the
   * destination so "off" always means the original sound.
   */
  const wireGraph = useCallback(() => {
    const graph = eqGraph.current;
    if (!graph) return;
    const { ctx, source, filters } = graph;
    try { source.disconnect(); } catch { /* nothing connected */ }
    try { filters[filters.length - 1].disconnect(); } catch { /* nothing connected */ }
    if (eqEnabledRef.current) {
      filters.forEach((filter, i) => { filter.gain.value = eqBandsRef.current[i] ?? 0; });
      source.connect(filters[0]);
      for (let i = 1; i < filters.length; i++) filters[i - 1].connect(filters[i]);
      filters[filters.length - 1].connect(ctx.destination);
      void ctx.resume();
    } else {
      source.connect(ctx.destination);
    }
  }, []);

  /**
   * Build the media-element graph exactly once. Must be called from a user
   * gesture (play click or EQ toggle): an AudioContext created without one
   * starts suspended and would silently swallow the audio until interaction.
   */
  const ensureGraph = useCallback(() => {
    if (eqGraph.current) {
      wireGraph();
      return;
    }
    if (!eqEnabledRef.current) return;
    const audio = audioRef.current;
    if (!audio) return;
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(audio);
      const filters = EQ_BANDS.map(def => {
        const filter = ctx.createBiquadFilter();
        filter.type = def.type as BiquadFilterType;
        filter.frequency.value = def.freq;
        filter.Q.value = def.q;
        filter.gain.value = 0;
        return filter;
      });
      eqGraph.current = { ctx, source, filters };
      wireGraph();
    } catch {
      // Web Audio unavailable: playback simply continues without EQ.
    }
  }, [wireGraph]);

  const kickGraph = useCallback(() => {
    const graph = eqGraph.current;
    if (graph && graph.ctx.state === 'suspended') void graph.ctx.resume();
  }, []);

  const playQueue = useCallback((nextQueue: QueueEntry[], startIndex = 0) => {
    const audio = audioRef.current;
    if (!audio) return;
    const target = nextQueue.length ? Math.max(0, Math.min(startIndex, nextQueue.length - 1)) : 0;
    setQueue(nextQueue);
    setIndex(target);
    shuffleOrder.current = [];
    setError(null);
    if (nextQueue.length) {
      wantPlay.current = true;
      audio.src = `/api/music/stream/${nextQueue[target].track.id}`;
      audio.currentTime = 0;
      setCurrentTime(0);
      setDuration(0);
      void audio.play().catch(() => setError('Could not start playback of this track.'));
    }
    kickGraph();
  }, [kickGraph]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.src) return;
    kickGraph();
    wantPlay.current = audio.paused;
    if (audio.paused) {
      void audio.play().catch(() => setError('Could not play this track. Check that the file exists on the server.'));
    } else {
      audio.pause();
    }
  }, [kickGraph]);

  // Close the player: stop audio, drop the queue, hide the bar.
  const stopPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    shuffleOrder.current = [];
    wantPlay.current = false;
    setQueue([]);
    setIndex(0);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
    setBuffered(0);
    setExpandedState(false);
  }, []);

  const goNext = useCallback((auto: boolean) => {
    const q = queueRef.current;
    if (!q.length) return;
    if (shuffleRef.current) {
      if (!shuffleOrder.current.length) {
        const rest = q.map((_, i) => i).filter(i => i !== indexRef.current);
        for (let i = rest.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        shuffleOrder.current = rest;
      }
      const nextIdx = shuffleOrder.current.shift();
      if (nextIdx === undefined) {
        setPlaying(false);
        return;
      }
      setIndex(nextIdx);
      return;
    }
    if (auto && repeatRef.current === 'one') {
      const audio = audioRef.current;
      if (audio) { audio.currentTime = 0; void audio.play().catch(() => undefined); }
      return;
    }
    if (auto && indexRef.current >= q.length - 1 && repeatRef.current === 'off') {
      // Queue finished and repeat is off: stop instead of looping forever.
      wantPlay.current = false;
      setPlaying(false);
      return;
    }
    setIndex((indexRef.current + 1) % q.length);
  }, []);

  const nextTrack = useCallback(() => goNext(false), [goNext]);

  const prevTrack = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 4) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    const q = queueRef.current;
    if (!q.length) return;
    setIndex((indexRef.current - 1 + q.length) % q.length);
  }, []);

  const skipTo = useCallback((i: number) => {
    const q = queueRef.current;
    if (i >= 0 && i < q.length) setIndex(i);
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(seconds)) return;
    audio.currentTime = seconds;
    setCurrentTime(seconds);
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    const audio = audioRef.current;
    if (audio) audio.volume = clamped;
    if (clamped > 0 && muted) setMuted(false);
  }, [muted]);

  const toggleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev;
      const audio = audioRef.current;
      if (audio) audio.muted = next;
      return next;
    });
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffle(prev => {
      if (!prev) shuffleOrder.current = [];
      return !prev;
    });
  }, []);

  const toggleRepeat = useCallback(() => setRepeat(prev => (prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off')), []);

  const setExpanded = useCallback((open: boolean) => setExpandedState(open), []);
  const getTime = useCallback(() => audioRef.current?.currentTime ?? 0, []);

  // Take one track out of the queue. Removing the playing one moves on to the next.
  const removeFromQueue = useCallback((i: number) => {
    const q = queueRef.current;
    if (i < 0 || i >= q.length) return;
    if (q.length === 1) { stopPlayback(); return; }
    const current = indexRef.current;
    shuffleOrder.current = [];
    setQueue(q.filter((_, at) => at !== i));
    if (i < current) setIndex(current - 1);
    else if (i === current) setIndex(Math.min(current, q.length - 2));
  }, [stopPlayback]);

  const clearUpcoming = useCallback(() => {
    const q = queueRef.current;
    const current = indexRef.current;
    if (current >= q.length - 1) return;
    shuffleOrder.current = [];
    setQueue(q.slice(0, current + 1));
  }, []);

  const setEqEnabled = useCallback((enabled: boolean) => {
    eqEnabledRef.current = enabled;
    setEqEnabledState(enabled);
    if (enabled) ensureGraph();
    else wireGraph();
  }, [ensureGraph, wireGraph]);

  const setEqPreset = useCallback((preset: string) => {
    const target = preset in EQ_PRESETS ? preset : 'flat';
    setEqPresetState(target);
    setEqBands([...(EQ_PRESETS[target]?.gains ?? [0, 0, 0, 0, 0])]);
  }, []);

  const setEqBand = useCallback((i: number, gain: number) => {
    setEqBands(prev => prev.map((g, idx) => (idx === i ? Math.max(-12, Math.min(12, gain)) : g)));
    setEqPresetState('custom');
  }, []);

  // Keep the audio element's volume/mute in sync with state changes.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
      audio.muted = muted;
    }
  }, [volume, muted]);

  // Re-wire an existing graph when the mode or band gains change. The graph
  // itself is only built from a user gesture (see ensureGraph), so a persisted
  // "EQ on" cannot mute playback before the user interacts.
  useEffect(() => {
    wireGraph();
  }, [wireGraph, eqEnabled, eqBands]);

  // First play of any kind is a gesture: build the graph now if EQ is on.
  const handlePlay = useCallback(() => {
    wantPlay.current = true;
    ensureGraph();
    setPlaying(true);
  }, [ensureGraph]);

  useEffect(() => store('vv-music-volume', String(volume)), [volume]);
  useEffect(() => store('vv-music-muted', muted ? '1' : '0'), [muted]);
  useEffect(() => store('vv-eq-enabled', eqEnabled ? '1' : '0'), [eqEnabled]);
  useEffect(() => store('vv-eq-preset', eqPreset), [eqPreset]);
  useEffect(() => store('vv-eq-bands', JSON.stringify(eqBands)), [eqBands]);

  // Reserve room for the floating music bar when a queue is active, so the
  // fixed bar never covers page footer content.
  useEffect(() => {
    const hasBar = queue.length > 0;
    document.body.classList.toggle('has-music-bar', hasBar);
    return () => document.body.classList.remove('has-music-bar');
  }, [queue.length]);

  // Move the element onto the current track whenever the queue row changes.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !queue.length) return;
    const current = queue[Math.min(index, queue.length - 1)] ?? queue[0];
    const expected = `/api/music/stream/${current.track.id}`;
    if (!audio.src || !audio.src.endsWith(expected)) {
      audio.src = expected;
      if (wantPlay.current) void audio.play().catch(() => undefined);
    }
  }, [index, queue]);

  const entry = queue.length ? queue[Math.min(index, queue.length - 1)] ?? queue[0] : null;

  // Keyboard media keys, headphone buttons and the lock screen show and control what is playing.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    if (!entry) { session.metadata = null; return; }
    try {
      session.metadata = new MediaMetadata({
        title: entry.track.title, artist: entry.artistTitle ?? '', album: entry.albumTitle ?? '',
        ...(entry.cover ? { artwork: [{ src: entry.cover, sizes: '512x512' }] } : {})
      });
    } catch { /* unsupported artwork type: the title still shows */ }
  }, [entry]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const audio = () => audioRef.current;
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => { wantPlay.current = true; void audio()?.play().catch(() => undefined); }],
      ['pause', () => { wantPlay.current = false; audio()?.pause(); }],
      ['previoustrack', () => prevTrack()],
      ['nexttrack', () => nextTrack()],
      ['seekbackward', d => seek(Math.max(0, (audio()?.currentTime ?? 0) - (d.seekOffset ?? 10)))],
      ['seekforward', d => seek((audio()?.currentTime ?? 0) + (d.seekOffset ?? 10))],
      ['seekto', d => { if (typeof d.seekTime === 'number') seek(d.seekTime); }],
      ['stop', () => stopPlayback()]
    ];
    for (const [action, fn] of handlers) { try { session.setActionHandler(action, fn); } catch { /* not supported here */ } }
    return () => { for (const [action] of handlers) { try { session.setActionHandler(action, null); } catch { /* ignore */ } } };
  }, [prevTrack, nextTrack, seek, stopPlayback]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = queue.length ? (playing ? 'playing' : 'paused') : 'none';
  }, [playing, queue.length]);

  const value: MusicContextValue = {
    queue,
    index,
    entry,
    playing,
    currentTime,
    duration,
    error,
    volume,
    muted,
    shuffle,
    repeat,
    buffered,
    buffering,
    expanded,
    setExpanded,
    getTime,
    removeFromQueue,
    clearUpcoming,
    eqEnabled,
    eqPreset,
    eqBands,
    playQueue,
    toggle,
    stopPlayback,
    nextTrack,
    prevTrack,
    skipTo,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    toggleRepeat,
    setEqEnabled,
    setEqPreset,
    setEqBand
  };

  return (
    <MusicContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={handlePlay}
        onPlaying={() => setBuffering(false)}
        onWaiting={() => setBuffering(true)}
        onProgress={e => {
          const a = e.target as HTMLAudioElement;
          const last = a.buffered.length ? a.buffered.end(a.buffered.length - 1) : 0;
          setBuffered(last);
        }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={e => setCurrentTime((e.target as HTMLAudioElement).currentTime)}
        onDurationChange={e => setDuration((e.target as HTMLAudioElement).duration)}
        onEnded={() => goNext(true)}
        onError={() => setError('This track could not be loaded. The file may be missing or unsupported.')}
      />
      {queue.length > 0 && <MusicPlayerUI />}
    </MusicContext.Provider>
  );
}
