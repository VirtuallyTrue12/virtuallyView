import Hls from 'hls.js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type RadioStation } from '../../lib/api';
import { useMusicPlayer } from '../media/MusicProvider';
import { RadioBar } from './RadioBar';
import { RadioNowPlaying } from './RadioNowPlaying';

export type RadioState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
interface RadioContextValue {
  station: RadioStation | null;
  state: RadioState;
  error: string | null;
  /** What the station says is playing (artist and title), when it tells. */
  nowTitle: string | null;
  volume: number;
  /** The full-screen Now Playing view, same idea as the music player's. */
  expanded: boolean;
  setExpanded: (open: boolean) => void;
  play: (station: RadioStation) => void;
  toggle: () => void;
  stop: () => void;
  setVolume: (v: number) => void;
}

const RadioContext = createContext<RadioContextValue | null>(null);
export function useRadio(): RadioContextValue {
  const value = useContext(RadioContext);
  if (!value) throw new Error('useRadio must be used inside RadioProvider.');
  return value;
}

const readVolume = (): number => { try { const v = Number(localStorage.getItem('vv-radio-volume') ?? '1'); return v >= 0 && v <= 1 ? v : 1; } catch { return 1; } };

/** One radio station at a time, playing through the server so any station works on any page and keeps playing as you browse. */
export function RadioProvider({ children }: { children: ReactNode }) {
  const music = useMusicPlayer();
  const audio = useRef<HTMLAudioElement | null>(null);
  const hls = useRef<Hls | null>(null);
  const [station, setStation] = useState<RadioStation | null>(null);
  const [state, setState] = useState<RadioState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [nowTitle, setNowTitle] = useState<string | null>(null);
  const [volume, setVolumeState] = useState(readVolume);
  const [expanded, setExpanded] = useState(false);
  const retried = useRef(false);

  const release = useCallback(() => {
    hls.current?.destroy(); hls.current = null;
    const el = audio.current;
    if (el) { el.pause(); el.removeAttribute('src'); el.load(); }
  }, []);

  const load = useCallback((s: RadioStation) => {
    const el = audio.current;
    if (!el) return;
    release();
    const src = `/api/radio/stream/${s.id}`;
    if (s.hls && Hls.isSupported()) {
      const h = new Hls({ liveSyncDurationCount: 3 });
      hls.current = h;
      h.loadSource(src); h.attachMedia(el);
      h.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) { setState('error'); setError('This station stopped answering. It may be off the air.'); } });
    } else el.src = src;
    void el.play().catch(() => undefined);
  }, [release]);

  const play = useCallback((s: RadioStation) => {
    music.stopPlayback();
    retried.current = false;
    setStation(s); setState('loading'); setError(null); setNowTitle(null);
    load(s);
    void api.radioPlayed(s.id).catch(() => undefined);
  }, [music, load]);

  const stop = useCallback(() => { release(); setStation(null); setState('idle'); setError(null); setNowTitle(null); setExpanded(false); }, [release]);
  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el || !station) return;
    if (state === 'playing' || state === 'loading') { release(); setState('paused'); }
    else { setState('loading'); setError(null); load(station); }
  }, [station, state, release, load]);
  const setVolume = useCallback((v: number) => { setVolumeState(v); try { localStorage.setItem('vv-radio-volume', String(v)); } catch { /* fine */ } }, []);

  useEffect(() => { if (audio.current) audio.current.volume = volume; }, [volume]);

  // Starting a song stops the radio, so two sounds never overlap.
  useEffect(() => { if (music.playing && station) stop(); }, [music.playing, station, stop]);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const onPlaying = () => setState('playing');
    const onWaiting = () => setState(s => (s === 'playing' ? 'loading' : s));
    const onError = () => {
      if (!station || !el.getAttribute('src')) return;
      if (!retried.current) { retried.current = true; window.setTimeout(() => load(station), 1500); return; }
      setState('error'); setError('This station did not answer. It may be off the air. Try another.');
    };
    el.addEventListener('playing', onPlaying); el.addEventListener('waiting', onWaiting); el.addEventListener('error', onError);
    return () => { el.removeEventListener('playing', onPlaying); el.removeEventListener('waiting', onWaiting); el.removeEventListener('error', onError); };
  }, [station, load]);

  // What is playing now, read from the station itself every half minute.
  useEffect(() => {
    if (!station || state !== 'playing') return;
    let alive = true;
    const ask = () => api.radioNow(station.id).then(r => { if (alive) setNowTitle(r.title); }).catch(() => undefined);
    void ask();
    const timer = window.setInterval(ask, 30_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [station, state]);

  useEffect(() => {
    document.body.classList.toggle('has-music-bar', !!station);
    if (!station) return () => undefined;
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: nowTitle ?? station.name, artist: nowTitle ? station.name : station.country, album: 'Radio' });
      navigator.mediaSession.setActionHandler('play', () => toggle());
      navigator.mediaSession.setActionHandler('pause', () => toggle());
      navigator.mediaSession.setActionHandler('stop', () => stop());
    }
    return () => { document.body.classList.remove('has-music-bar'); };
  }, [station, nowTitle, toggle, stop]);

  const value = useMemo<RadioContextValue>(
    () => ({ station, state, error, nowTitle, volume, expanded, setExpanded, play, toggle, stop, setVolume }),
    [station, state, error, nowTitle, volume, expanded, play, toggle, stop, setVolume]
  );
  return (
    <RadioContext.Provider value={value}>
      {children}
      <audio ref={audio} preload="none" />
      {station && <RadioNowPlaying />}
      {station && <RadioBar />}
    </RadioContext.Provider>
  );
}
