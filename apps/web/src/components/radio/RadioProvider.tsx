import Hls from 'hls.js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type RadioNow, type RadioStation } from '../../lib/api';
import { useMusicPlayer } from '../media/MusicProvider';
import { toast } from '../ui/Toast';
import { RadioBar } from './RadioBar';
import { RadioNowPlaying } from './RadioNowPlaying';

export type RadioState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
/** Where playback sits in the rewind window, in seconds. `behind` is 0 at the live edge. */
export interface Timeshift { pos: number; start: number; end: number; behind: number }
export interface RadioAlarm { time: string; station: RadioStation }

interface RadioContextValue {
  station: RadioStation | null;
  state: RadioState;
  error: string | null;
  /** What the station says is on now (song, artist, cover), when it tells. */
  now: RadioNow | null;
  volume: number;
  /** The full-screen Now Playing view, same idea as the music player's. */
  expanded: boolean;
  setExpanded: (open: boolean) => void;
  play: (station: RadioStation) => void;
  toggle: () => void;
  stop: () => void;
  setVolume: (v: number) => void;
  /** Only while playing through the rewind buffer; null when the station plays plain live. */
  timeshift: Timeshift | null;
  skip: (seconds: number) => void;
  seekTo: (seconds: number) => void;
  goLive: () => void;
  /** When the sleep timer stops the radio (ms since epoch), or null. */
  sleepAt: number | null;
  setSleep: (minutes: number | null) => void;
  alarm: RadioAlarm | null;
  setAlarm: (alarm: RadioAlarm | null) => void;
  canRecord: boolean;
  record: (minutes: number) => Promise<void>;
  /** Goes up when a recording starts, so the Radio page reloads its list. */
  recordTick: number;
}

const RadioContext = createContext<RadioContextValue | null>(null);

export function useRadio(): RadioContextValue {
  const value = useContext(RadioContext);
  if (!value) throw new Error('useRadio must be used inside RadioProvider.');
  return value;
}

const readVolume = (): number => { try { const v = Number(localStorage.getItem('vv-radio-volume') ?? '1'); return v >= 0 && v <= 1 ? v : 1; } catch { return 1; } };
const ALARM_KEY = 'vv-radio-alarm';
const readAlarm = (): RadioAlarm | null => {
  try { const v = JSON.parse(localStorage.getItem(ALARM_KEY) ?? 'null') as RadioAlarm | null; return v && /^\d\d:\d\d$/.test(v.time) && v.station?.id ? v : null; } catch { return null; }
};
const clock = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const LIVE_SLACK = 8; // seconds: closer than this to the live point counts as live

/** One radio station at a time, playing through the server so any station works on any page and keeps playing as you browse. */
export function RadioProvider({ children }: { children: ReactNode }) {
  const music = useMusicPlayer();
  const audio = useRef<HTMLAudioElement | null>(null);
  const hls = useRef<Hls | null>(null);
  // "shift": played from the rewind buffer; "plain": the station's own live stream, no rewind.
  const mode = useRef<'shift' | 'plain'>('plain');
  const fade = useRef(0);
  const retried = useRef(false);
  const [station, setStation] = useState<RadioStation | null>(null);
  const [state, setState] = useState<RadioState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<RadioNow | null>(null);
  const [volume, setVolumeState] = useState(readVolume);
  const [expanded, setExpanded] = useState(false);
  const [timeshift, setTimeshift] = useState<Timeshift | null>(null);
  const [sleepAt, setSleepAt] = useState<number | null>(null);
  const [alarm, setAlarmState] = useState(readAlarm);
  const [recordTick, setRecordTick] = useState(0);
  const volumeRef = useRef(volume); volumeRef.current = volume;

  const release = useCallback(() => {
    hls.current?.destroy(); hls.current = null;
    const el = audio.current;
    if (el) { el.pause(); el.removeAttribute('src'); el.load(); }
  }, []);

  // A browser that refuses to start sound by itself (an alarm with no recent tap) leaves the station ready to press play.
  const start = useCallback(() => { void audio.current?.play().catch((e: Error) => { if (e.name === 'NotAllowedError') setState('paused'); }); }, []);

  const playPlain = useCallback((s: RadioStation) => {
    const el = audio.current;
    if (!el) return;
    release(); mode.current = 'plain'; setTimeshift(null);
    const src = `/api/radio/stream/${s.id}`;
    if (s.hls && Hls.isSupported()) {
      const h = new Hls({ liveSyncDurationCount: 3 });
      hls.current = h;
      h.loadSource(src); h.attachMedia(el);
      h.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) { setState('error'); setError('This station stopped answering. It may be off the air.'); } });
    } else el.src = src;
    start();
  }, [release, start]);

  const load = useCallback((s: RadioStation) => {
    const el = audio.current;
    if (!el) return;
    const live = `/api/radio/live/${s.id}/index.m3u8`;
    if (Hls.isSupported()) {
      release(); mode.current = 'shift'; setTimeshift(null);
      const h = new Hls({ liveSyncDurationCount: 3, manifestLoadingTimeOut: 20000 });
      hls.current = h;
      h.loadSource(live); h.attachMedia(el);
      // Any trouble with the rewind buffer (busy server, no disk, a station it cannot read): play the plain stream instead.
      h.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) playPlain(s); });
      start();
    } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
      release(); mode.current = 'shift'; setTimeshift(null);
      el.src = live; start();
    } else playPlain(s);
  }, [release, playPlain, start]);

  const fadeIn = useCallback((ms: number) => {
    window.clearInterval(fade.current);
    const el = audio.current;
    if (!el) return;
    const t0 = Date.now();
    el.volume = 0;
    fade.current = window.setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / ms);
      el.volume = volumeRef.current * k;
      if (k >= 1) window.clearInterval(fade.current);
    }, 250);
  }, []);

  const play = useCallback((s: RadioStation) => {
    music.stopPlayback();
    retried.current = false;
    window.clearInterval(fade.current);
    if (audio.current) audio.current.volume = volumeRef.current;
    setStation(s); setState('loading'); setError(null); setNow(null);
    load(s);
    void api.radioPlayed(s.id).catch(() => undefined);
  }, [music, load]);

  // Pause keeps the rewind buffer so play resumes at the same spot; plain live just lets go of the stream.
  const halt = useCallback(() => { if (mode.current === 'shift') audio.current?.pause(); else release(); setState('paused'); }, [release]);

  const stop = useCallback(() => {
    window.clearInterval(fade.current);
    release(); setStation(null); setState('idle'); setError(null); setNow(null); setTimeshift(null); setSleepAt(null); setExpanded(false);
    if (audio.current) audio.current.volume = volumeRef.current;
  }, [release]);

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el || !station) return;
    if (state === 'playing' || state === 'loading') halt();
    else if (mode.current === 'shift' && state === 'paused' && (hls.current || el.getAttribute('src'))) { setState('loading'); start(); }
    else { setState('loading'); setError(null); load(station); }
  }, [station, state, halt, load, start]);

  const setVolume = useCallback((v: number) => { window.clearInterval(fade.current); setVolumeState(v); try { localStorage.setItem('vv-radio-volume', String(v)); } catch { /* fine */ } }, []);
  useEffect(() => { if (audio.current) audio.current.volume = volume; }, [volume]);

  const setSleep = useCallback((minutes: number | null) => setSleepAt(minutes ? Date.now() + minutes * 60000 : null), []);
  // Sleep timer: fade out over the last 10 seconds, then pause.
  useEffect(() => {
    if (!sleepAt) return;
    const id = window.setInterval(() => {
      const left = sleepAt - Date.now();
      const el = audio.current;
      if (el && left < 10000 && left > 0) el.volume = volumeRef.current * (left / 10000);
      if (left <= 0) { window.clearInterval(id); setSleepAt(null); halt(); if (el) el.volume = volumeRef.current; }
    }, 500);
    return () => window.clearInterval(id);
  }, [sleepAt, halt]);

  const setAlarm = useCallback((a: RadioAlarm | null) => {
    setAlarmState(a);
    try { if (a) localStorage.setItem(ALARM_KEY, JSON.stringify(a)); else localStorage.removeItem(ALARM_KEY); } catch { /* the alarm still works until the page closes */ }
  }, []);
  // Wake alarm: needs this page open. One go: it clears itself when it fires.
  useEffect(() => {
    if (!alarm) return;
    const id = window.setInterval(() => {
      if (clock(new Date()) !== alarm.time) return;
      window.clearInterval(id);
      setAlarm(null);
      play(alarm.station); fadeIn(30000);
    }, 5000);
    return () => window.clearInterval(id);
  }, [alarm, play, fadeIn, setAlarm]);

  // Starting a song stops the radio, so two sounds never overlap.
  useEffect(() => { if (music.playing && station) stop(); }, [music.playing, station, stop]);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const onPlaying = () => setState('playing');
    const onWaiting = () => setState(s => (s === 'playing' ? 'loading' : s));
    const onError = () => {
      if (!station || !el.getAttribute('src')) return;
      if (mode.current === 'shift') { playPlain(station); return; }
      if (!retried.current) { retried.current = true; window.setTimeout(() => load(station), 1500); return; }
      setState('error'); setError('This station did not answer. It may be off the air. Try another.');
    };
    el.addEventListener('playing', onPlaying); el.addEventListener('waiting', onWaiting); el.addEventListener('error', onError);
    return () => { el.removeEventListener('playing', onPlaying); el.removeEventListener('waiting', onWaiting); el.removeEventListener('error', onError); };
  }, [station, load, playPlain]);

  // Where we are in the rewind window, once a second.
  useEffect(() => {
    if (!station) return;
    const id = window.setInterval(() => {
      const el = audio.current;
      if (!el || mode.current !== 'shift' || !el.seekable.length) return;
      const start = el.seekable.start(0), end = el.seekable.end(el.seekable.length - 1);
      const live = hls.current?.liveSyncPosition ?? end;
      const gap = Math.round(live - el.currentTime);
      const next = { pos: Math.round(el.currentTime), start: Math.round(start), end: Math.round(end), behind: gap < LIVE_SLACK ? 0 : gap };
      setTimeshift(t => (t && t.pos === next.pos && t.start === next.start && t.end === next.end && t.behind === next.behind ? t : next));
    }, 1000);
    return () => window.clearInterval(id);
  }, [station]);

  const seekTo = useCallback((t: number) => {
    const el = audio.current;
    if (!el || !el.seekable.length) return;
    const live = hls.current?.liveSyncPosition ?? el.seekable.end(el.seekable.length - 1);
    el.currentTime = Math.min(Math.max(t, el.seekable.start(0) + 1), live);
  }, []);
  const skip = useCallback((seconds: number) => { if (audio.current) seekTo(audio.current.currentTime + seconds); }, [seekTo]);
  const goLive = useCallback(() => {
    const el = audio.current;
    if (!el || !el.seekable.length) return;
    el.currentTime = hls.current?.liveSyncPosition ?? el.seekable.end(el.seekable.length - 1);
    if (state === 'paused') { setState('loading'); start(); }
  }, [state, start]);

  // What is on now, from the station itself every 25 seconds while it plays and this tab is in view.
  const sounding = state === 'playing';
  useEffect(() => {
    if (!station || !sounding) return;
    let alive = true;
    const ask = () => { if (document.visibilityState === 'visible') api.radioNow(station.id).then(r => { if (alive) setNow(r); }).catch(() => undefined); };
    ask();
    const timer = window.setInterval(ask, 25_000);
    document.addEventListener('visibilitychange', ask);
    return () => { alive = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', ask); };
  }, [station, sounding]);

  const record = useCallback(async (minutes: number) => {
    if (!station) return;
    try {
      await api.radioRecord(station.id, minutes);
      toast(`Recording ${station.name} for ${minutes} minutes.`, { tone: 'ok' });
      setRecordTick(t => t + 1);
    } catch (err) { toast((err as Error).message, { tone: 'err' }); }
  }, [station]);

  useEffect(() => {
    document.body.classList.toggle('has-music-bar', !!station);
    if (!station) return () => undefined;
    if ('mediaSession' in navigator) {
      const art = now?.art ?? (station.logo ? `/api/radio/logo/${station.id}` : undefined);
      navigator.mediaSession.metadata = new MediaMetadata({ title: now?.song ?? now?.title ?? station.name, artist: now?.artist ?? (now?.title ? station.name : station.country), album: 'Radio', artwork: art ? [{ src: art }] : [] });
      navigator.mediaSession.setActionHandler('play', () => toggle());
      navigator.mediaSession.setActionHandler('pause', () => toggle());
      navigator.mediaSession.setActionHandler('stop', () => stop());
      navigator.mediaSession.setActionHandler('seekbackward', () => skip(-30));
      navigator.mediaSession.setActionHandler('seekforward', () => skip(30));
    }
    return () => { document.body.classList.remove('has-music-bar'); };
  }, [station, now, toggle, stop, skip]);

  const canRecord = !document.documentElement.classList.contains('kids');
  const value = useMemo<RadioContextValue>(
    () => ({ station, state, error, now, volume, expanded, setExpanded, play, toggle, stop, setVolume, timeshift, skip, seekTo, goLive, sleepAt, setSleep, alarm, setAlarm, canRecord, record, recordTick }),
    [station, state, error, now, volume, expanded, play, toggle, stop, setVolume, timeshift, skip, seekTo, goLive, sleepAt, setSleep, alarm, setAlarm, canRecord, record, recordTick]
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
