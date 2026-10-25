import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { TrackItem } from '../../lib/api';
import MusicPlayerUI from '../music/MusicPlayerUI';
import { audioEngine, EQ_BANDS, EQ_PRESETS, lineSeconds, prepareLine, say } from '../../lib/audio-engine';
import { DjBrain, type DjBreak, type DjFrequency, type DjSong } from '../../lib/dj-brain';
import { fetchLyrics } from '../../lib/viz-store';
import type { Lyrics } from '../../lib/api';

export { EQ_BANDS, EQ_PRESETS };

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
  /** The artist's genres, for the DJ (a long run of one genre gets a mention). */
  genres?: string[];
}

export interface CustomPreset { name: string; gains: number[]; preamp: number }

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
  preamp: number;
  balance: number;
  leveller: boolean;
  customPresets: CustomPreset[];
  /** Seconds two tracks overlap when one ends (0 = straight cut). */
  crossfade: number;
  /** A voice says what is coming up between tracks. */
  djMode: boolean;
  djVoice: string;
  /** How often the DJ talks: every few songs (balanced), rarely, or every song. */
  djFrequency: DjFrequency;
  /** The DJ is talking right now. */
  djTalking: boolean;
  playQueue: (queue: QueueEntry[], startIndex?: number) => void;
  /** Play these in a shuffled order that never puts the same artist twice in a row when it can avoid it. */
  shufflePlay: (tracks: QueueEntry[]) => void;
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
  setPreamp: (db: number) => void;
  setBalance: (pan: number) => void;
  setLeveller: (on: boolean) => void;
  saveCustomPreset: (name: string) => void;
  deleteCustomPreset: (name: string) => void;
  setCrossfade: (seconds: number) => void;
  setDjMode: (on: boolean) => void;
  setDjVoice: (name: string) => void;
  setDjFrequency: (f: DjFrequency) => void;
  /** Try DJ mode without waiting: jump near the end of this song and have the host talk at the change. */
  djTryNow: () => void;
}

export type RepeatMode = 'off' | 'all' | 'one';

const MusicContext = createContext<MusicContextValue | null>(null);

function load(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function store(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage disabled (private mode): settings just reset */ }
}
function loadJson<T>(key: string, ok: (v: unknown) => v is T, fallback: T): T {
  try { const v = JSON.parse(load(key) ?? 'null') as unknown; return ok(v) ? v : fallback; } catch { return fallback; }
}
const isGains = (v: unknown): v is number[] => Array.isArray(v) && v.length === EQ_BANDS.length && v.every(n => Number.isFinite(n));

export function useMusicPlayer(): MusicContextValue {
  const value = useContext(MusicContext);
  if (!value) throw new Error('useMusicPlayer must be used inside MusicProvider.');
  return value;
}

/**
 * Shuffles with no artist twice in a row where possible (a plain shuffle of a big library clumps one prolific
 * artist together). Pure so it can be tested.
 */
export function spreadShuffle<T extends { artistTitle?: string }>(items: T[], random = Math.random): T[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const key = (it.artistTitle ?? '').toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  for (const list of groups.values()) {
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j]!, list[i]!]; }
  }
  const out: T[] = [];
  let last = '\u0000';
  while (out.length < items.length) {
    // Weighted by how many each artist has left, so big ones are spread out instead of all landing at the end.
    const options = [...groups.entries()].filter(([k, l]) => l.length && k !== last);
    const pool = options.length ? options : [...groups.entries()].filter(([, l]) => l.length);
    const total = pool.reduce((n, [, l]) => n + l.length, 0);
    const left = items.length - out.length;
    // An artist holding at least half of what is left must go now, or the end becomes that artist back to back.
    const crowded = pool.find(([, l]) => l.length * 2 >= left);
    let chosen = crowded ?? pool[0]!;
    if (!crowded) {
      let r = random() * total;
      for (const g of pool) { r -= g[1].length; if (r <= 0) { chosen = g; break; } }
    }
    out.push(chosen[1].shift()!);
    last = chosen[0];
  }
  return out;
}

/** A queue row as the DJ sees it. */
const songOf = (e: QueueEntry, lyrics?: Lyrics | null): DjSong => ({
  title: e.track.title, artist: e.artistTitle, album: e.albumTitle, genres: e.genres,
  lyrics: lyrics?.synced?.map(l => l.text) ?? lyrics?.plain?.split('\n')
});
const lyricsOf = (e: QueueEntry) => (e.artistTitle ? fetchLyrics(e.artistTitle, e.track.title, e.albumTitle, e.track.durationMs ? e.track.durationMs / 1000 : undefined) : Promise.resolve(null));

const SESSION_KEY = 'vv-music-session';
const SESSION_MS = 24 * 3600 * 1000;
type SavedSession = { queue: QueueEntry[]; index: number; time: number; at: number; shuffle: boolean };
const isSession = (v: unknown): v is SavedSession => !!v && typeof v === 'object' && Array.isArray((v as SavedSession).queue) && Number.isInteger((v as SavedSession).index);

export function MusicProvider({ children }: { children: ReactNode }) {
  // Two decks: the one playing, and the one the next track fades in on. `audioRef` always points at the live one.
  const deckA = useRef<HTMLAudioElement | null>(null);
  const deckB = useRef<HTMLAudioElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const restored = useRef<SavedSession | null>(null);
  if (restored.current === null) {
    const saved = loadJson<SavedSession | null>(SESSION_KEY, (v): v is SavedSession | null => v === null || isSession(v), null);
    restored.current = saved && Date.now() - saved.at < SESSION_MS && saved.queue.length ? saved : { queue: [], index: 0, time: 0, at: 0, shuffle: false };
  }
  const [queue, setQueue] = useState<QueueEntry[]>(restored.current.queue);
  const [index, setIndex] = useState(Math.min(restored.current.index, Math.max(0, restored.current.queue.length - 1)));
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolumeState] = useState(() => {
    const raw = Number(load('vv-music-volume') ?? '1');
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 1;
  });
  const [muted, setMuted] = useState(() => load('vv-music-muted') === '1');
  const [shuffle, setShuffle] = useState(restored.current.shuffle);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  const [buffered, setBuffered] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [expanded, setExpandedState] = useState(false);
  const [eqEnabled, setEqEnabledState] = useState(() => load('vv-eq-enabled') === '1');
  const [eqPreset, setEqPresetState] = useState(() => load('vv-eq10-preset') ?? 'flat');
  const [eqBands, setEqBands] = useState<number[]>(() => loadJson('vv-eq10-bands', isGains, [...EQ_PRESETS.flat!.gains]));
  const [preamp, setPreampState] = useState(() => Number(load('vv-eq-preamp') ?? 0) || 0);
  const [balance, setBalanceState] = useState(() => Number(load('vv-eq-balance') ?? 0) || 0);
  const [leveller, setLevellerState] = useState(() => load('vv-eq-leveller') === '1');
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>(() => loadJson('vv-eq-custom', (v): v is CustomPreset[] => Array.isArray(v), []));
  const [crossfade, setCrossfadeState] = useState(() => Math.max(0, Math.min(12, Number(load('vv-crossfade') ?? 0) || 0)));
  const [djMode, setDjModeState] = useState(() => load('vv-dj') === '1');
  const [djVoice, setDjVoiceState] = useState(() => load('vv-dj-voice') ?? '');
  const [djTalking, setDjTalking] = useState(false);
  const [djFrequency, setDjFrequencyState] = useState<DjFrequency>(() => { const f = load('vv-dj-freq'); return f === 'minimal' || f === 'chatty' ? f : 'balanced'; });

  // Live refs for callbacks that must never close over stale state (the documented "latest ref" pattern).
  const indexRef = useRef(index); indexRef.current = index;
  const queueRef = useRef(queue); queueRef.current = queue;
  const shuffleRef = useRef(shuffle); shuffleRef.current = shuffle;
  const repeatRef = useRef(repeat); repeatRef.current = repeat;
  const crossfadeRef = useRef(crossfade); crossfadeRef.current = crossfade;
  const djRef = useRef({ on: djMode, voice: djVoice }); djRef.current = { on: djMode, voice: djVoice };
  const shuffleOrder = useRef<number[]>([]);
  // True once a shuffled pass has been dealt: when it runs out, repeat decides between a new pass and stopping.
  const shuffleBuilt = useRef(false);
  // The plain (non-transcoded) URL for whatever is loaded now, so onError and seek know what to fall back to.
  const rawSrc = useRef('');
  // True while the person wants sound: a new track then starts by itself instead of waiting for another press.
  const wantPlay = useRef(false);
  // A fade into the next track is under way: no second one, and the outgoing deck's events are ignored.
  const mixing = useRef(false);
  const resumeAt = useRef(restored.current.time);
  // What was played before, so Previous in shuffle goes back to the song you actually heard.
  const history = useRef<number[]>([]);
  // The DJ: what it remembers of the session, and the break planned for the next change (written, voiced and
  // placed half a minute ahead: over the next song's intro, over this one's outro, or over a dipped mix).
  const brain = useRef<DjBrain | null>(null);
  if (!brain.current) brain.current = new DjBrain(djFrequency);
  type DjPlan = { index: number; brk: DjBreak | null; mode: 'intro' | 'outro' | 'over' | 'none'; talkAt: number; speed: number; started: boolean };
  const djPlan = useRef<DjPlan | null>(null);
  const djPreparing = useRef<number | null>(null);
  const djSpeaking = useRef(false);
  const outroBreak = useRef<DjBreak | null>(null);
  const songLyrics = useRef<{ index: number; lyrics: Lyrics | null } | null>(null);

  const live = () => audioRef.current;
  const isLive = (el: EventTarget) => el === audioRef.current;
  const other = () => (audioRef.current === deckA.current ? deckB.current : deckA.current);

  /** Connects both decks to the shared sound path. Only from a user's play (see audio-engine). */
  const ensureGraph = useCallback(() => {
    if (deckA.current && deckB.current && audioEngine.attach([deckA.current, deckB.current])) void audioEngine.resume();
  }, []);

  const urlFor = (e: QueueEntry) => `/api/music/stream/${e.track.id}`;

  const startOn = useCallback((el: HTMLAudioElement, e: QueueEntry, at = 0) => {
    rawSrc.current = urlFor(e);
    el.src = rawSrc.current;
    if (at > 0) el.currentTime = at;
    setCurrentTime(at);
    setDuration(0);
    if (wantPlay.current) void el.play().catch(() => setError('Could not start playback of this track.'));
  }, []);

  const playQueue = useCallback((nextQueue: QueueEntry[], startIndex = 0) => {
    const audio = live();
    if (!audio) return;
    const target = nextQueue.length ? Math.max(0, Math.min(startIndex, nextQueue.length - 1)) : 0;
    ensureGraph();
    mixing.current = false;
    other()?.pause();
    audioEngine.level(audio, 1);
    setQueue(nextQueue);
    setIndex(target);
    shuffleOrder.current = []; shuffleBuilt.current = false;
    history.current = []; djPlan.current = null; djPreparing.current = null;
    setError(null);
    if (nextQueue.length) {
      wantPlay.current = true;
      startOn(audio, nextQueue[target]!);
    }
  }, [ensureGraph, startOn]);

  const shufflePlay = useCallback((tracks: QueueEntry[]) => {
    if (!tracks.length) return;
    setShuffle(false);
    shuffleRef.current = false;
    playQueue(spreadShuffle(tracks), 0);
  }, [playQueue]);

  const toggle = useCallback(() => {
    const audio = live();
    if (!audio) return;
    ensureGraph();
    if (!audio.src && queueRef.current.length) {
      // A restored session: load where it left off.
      wantPlay.current = true;
      startOn(audio, queueRef.current[indexRef.current]!, resumeAt.current);
      resumeAt.current = 0;
      return;
    }
    if (!audio.src) return;
    wantPlay.current = audio.paused;
    if (audio.paused) void audio.play().catch(() => setError('Could not play this track. Check that the file exists on the server.'));
    else { audio.pause(); other()?.pause(); window.speechSynthesis?.cancel(); }
  }, [ensureGraph, startOn]);

  // Close the player: stop audio, drop the queue, hide the bar.
  const stopPlayback = useCallback(() => {
    for (const el of [deckA.current, deckB.current]) {
      if (!el) continue;
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    try { window.speechSynthesis?.cancel(); } catch { /* none */ }
    setDjTalking(false);
    rawSrc.current = '';
    mixing.current = false;
    history.current = []; djPlan.current = null; djPreparing.current = null;
    shuffleOrder.current = []; shuffleBuilt.current = false;
    wantPlay.current = false;
    setQueue([]);
    setIndex(0);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
    setBuffered(0);
    setExpandedState(false);
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }, []);

  /** Which row plays next, without using it up. Null when the queue would stop here. */
  const peekNext = useCallback((auto: boolean): number | null => {
    const q = queueRef.current;
    if (!q.length) return null;
    if (auto && repeatRef.current === 'one') return indexRef.current;
    if (shuffleRef.current) {
      if (!shuffleOrder.current.length) {
        if (auto && shuffleBuilt.current && repeatRef.current === 'off') return null;
        const rest = q.map((_, i) => i).filter(i => i !== indexRef.current);
        for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j]!, rest[i]!]; }
        shuffleOrder.current = rest;
        shuffleBuilt.current = true;
      }
      return shuffleOrder.current[0] ?? null;
    }
    if (auto && indexRef.current >= q.length - 1 && repeatRef.current === 'off') return null;
    return (indexRef.current + 1) % q.length;
  }, []);

  const consume = (next: number) => { if (shuffleRef.current && shuffleOrder.current[0] === next) shuffleOrder.current.shift(); };

  /** The song that just finished, for the DJ's memory (with its lyrics when they were looked up). */
  const noteFinished = useCallback((i: number) => {
    const e = queueRef.current[i];
    if (!e || !djRef.current.on) return;
    brain.current!.noteSong(songOf(e, songLyrics.current?.index === i ? songLyrics.current.lyrics : null));
  }, []);

  const talk = useCallback(async (plan: DjPlan) => {
    if (!plan.brk) return;
    plan.started = true;
    djSpeaking.current = true;
    setDjTalking(true);
    // Over an outro the song is still playing: it counts as heard before the break, so the break is recorded
    // when the song is (see mixIntoNext), or the next break would come one song early.
    if (plan.mode === 'outro') outroBreak.current = plan.brk; else brain.current!.commit(plan.brk);
    // Never let a slow or missing voice hold the music up.
    await Promise.race([say(plan.brk.text, djRef.current.voice || undefined, undefined, plan.speed), new Promise(r => window.setTimeout(r, 20000))]);
    djSpeaking.current = false;
    setDjTalking(false);
  }, []);

  const goNext = useCallback((auto: boolean) => {
    const next = peekNext(auto);
    if (next === null) {
      shuffleBuilt.current = false;
      wantPlay.current = false;
      setPlaying(false);
      return;
    }
    if (auto && repeatRef.current === 'one') {
      const audio = live();
      if (audio) { audio.currentTime = 0; void audio.play().catch(() => undefined); }
      return;
    }
    consume(next);
    if (auto) noteFinished(indexRef.current);
    if (outroBreak.current) { brain.current!.commit(outroBreak.current); outroBreak.current = null; }
    history.current = [...history.current.slice(-200), indexRef.current];
    setIndex(next);
  }, [peekNext, noteFinished]);

  /**
   * DJ mode and crossfade: start the next track on the other deck before this one ends, fade one out and the other
   * in, and (in DJ mode) say what is coming up over a dipped mix. Without Web Audio it is an ordinary cut.
   */
  const mixIntoNext = useCallback(async () => {
    const out = live();
    const inc = other();
    const dj = djRef.current;
    const fade = crossfadeRef.current || (dj.on ? 5 : 0);
    if (!out || !inc || mixing.current || !fade || !audioEngine.ready) return;
    const next = peekNext(true);
    if (next === null || next === indexRef.current) return;
    const q = queueRef.current;
    const to = q[next];
    if (!to) return;
    const plan = dj.on && djPlan.current?.index === next && !djPlan.current.started && djPlan.current.brk ? djPlan.current : null;
    djPlan.current = null;
    mixing.current = true;
    consume(next);
    noteFinished(indexRef.current);
    if (outroBreak.current) { brain.current!.commit(outroBreak.current); outroBreak.current = null; }
    history.current = [...history.current.slice(-200), indexRef.current];
    audioEngine.level(inc, 0);
    rawSrc.current = urlFor(to);
    inc.src = rawSrc.current;
    audioRef.current = inc;
    setIndex(next);
    setCurrentTime(0);
    setDuration(0);
    void inc.play().catch(() => undefined);
    const finish = (after: number) => window.setTimeout(() => {
      if (audioRef.current !== out) { out.pause(); out.removeAttribute('src'); out.load(); }
      mixing.current = false;
    }, after);
    if (plan && plan.mode === 'intro') {
      // Over the next song's intro: it comes in low, the last one fades as usual, and the line ends before the
      // first sung word. Then the new song comes up to full.
      audioEngine.fade(inc, plan.brk!.soft ? 0.45 : 0.32, 1.2);
      audioEngine.fade(out, 0, fade);
      finish((fade + 0.5) * 1000);
      await talk(plan);
      audioEngine.fade(inc, 1, 1.5);
      return;
    }
    if (plan && plan.mode === 'over') {
      audioEngine.fade(out, plan.brk!.soft ? 0.45 : 0.3, 1.5);
      audioEngine.fade(inc, 0.16, 1.5);
      await talk(plan);
      audioEngine.fade(inc, 1, 2.5);
      audioEngine.fade(out, 0, 2.5);
      finish(3000);
      return;
    }
    audioEngine.fade(inc, 1, fade);
    audioEngine.fade(out, 0, fade);
    finish((fade + 0.5) * 1000);
  }, [peekNext, noteFinished, talk]);

  /**
   * In DJ mode, well before the change: decide whether the host talks, voice the line, and find where it fits
   * without covering singing (the timed lyrics say where the vocals start and stop).
   */
  const prepareDj = useCallback(async () => {
    const cur = indexRef.current;
    const next = peekNext(true);
    if (next === null || next === cur || djPlan.current?.index === next || djPreparing.current === next) return;
    djPreparing.current = next;
    const q = queueRef.current;
    const from = q[cur], to = q[next];
    if (!from || !to) return;
    const [curL, nextL] = await Promise.all([lyricsOf(from), lyricsOf(to)]);
    songLyrics.current = { index: cur, lyrics: curL };
    const after = (shuffleRef.current ? shuffleOrder.current.slice(1, 3) : [next + 1, next + 2]).map(i => q[i]).filter((e): e is QueueEntry => !!e);
    const brk = brain.current!.plan(songOf(to, nextL), after.map(e => songOf(e)), new Date(), songOf(from, curL));
    const empty = { index: next, brk: null, mode: 'none' as const, talkAt: 0, speed: 1, started: false };
    if (!brk) { djPlan.current = empty; return; }
    const speed = brk.soft ? 0.88 : 1;
    const voice = djRef.current.voice || undefined;
    const data = voice?.startsWith('browser:') ? null : await prepareLine(brk.text, voice, speed);
    const secs = lineSeconds(data, brk.text);
    const fade = crossfadeRef.current || 5;
    const firstVocal = nextL?.synced?.find(l => l.text.trim())?.time;
    const lastVocal = [...(curL?.synced ?? [])].reverse().find(l => l.text.trim())?.time;
    const length = live()?.duration ?? 0;
    const outroRoom = lastVocal !== undefined && Number.isFinite(length) ? length - (lastVocal + 3) : -1;
    let mode: DjPlan['mode'] = 'none';
    if (firstVocal !== undefined && firstVocal >= secs + 0.8) mode = 'intro';
    else if (outroRoom >= secs + fade + 1) mode = 'outro';
    // No lyrics for either: no way to see the singing, so talk over a dipped mix. A kind word or the hour is
    // worth saying even when both songs are wall-to-wall vocals; anything else waits for a better moment.
    else if ((firstVocal === undefined && lastVocal === undefined) || brk.reason === 'mood' || brk.reason === 'hour' || brain.current!.force) mode = 'over';
    djPlan.current = mode === 'none' ? empty : { index: next, brk, mode, talkAt: fade + secs + 1.2, speed, started: false };
  }, [peekNext]);

  const nextTrack = useCallback(() => goNext(false), [goNext]);

  const prevTrack = useCallback(() => {
    const audio = live();
    if (audio && audio.currentTime > 4) { audio.currentTime = 0; setCurrentTime(0); return; }
    const q = queueRef.current;
    if (!q.length) return;
    const back = history.current.pop();
    if (back !== undefined && back < q.length) {
      // Put the song we leave back at the front of the shuffle, so Next returns to it.
      if (shuffleRef.current) shuffleOrder.current.unshift(indexRef.current);
      setIndex(back);
      return;
    }
    setIndex((indexRef.current - 1 + q.length) % q.length);
  }, []);

  const skipTo = useCallback((i: number) => {
    const q = queueRef.current;
    if (i >= 0 && i < q.length && i !== indexRef.current) { history.current = [...history.current.slice(-200), indexRef.current]; setIndex(i); }
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = live();
    if (!audio || !Number.isFinite(seconds)) return;
    // A transcode is a live, growing stream: there is nothing buffered to jump to, so ffmpeg starts over there.
    if (rawSrc.current && audio.src.includes('/transcode')) {
      const wasPlaying = !audio.paused;
      audio.src = `${rawSrc.current}/transcode?start=${Math.max(0, Math.floor(seconds))}`;
      setCurrentTime(seconds);
      if (wasPlaying || wantPlay.current) void audio.play().catch(() => undefined);
      return;
    }
    audio.currentTime = seconds;
    setCurrentTime(seconds);
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    if (clamped > 0 && muted) setMuted(false);
  }, [muted]);

  const toggleMute = useCallback(() => setMuted(prev => !prev), []);

  const toggleShuffle = useCallback(() => {
    setShuffle(prev => {
      shuffleOrder.current = []; shuffleBuilt.current = false;
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
    shuffleOrder.current = []; shuffleBuilt.current = false;
    setQueue(q.filter((_, at) => at !== i));
    if (i < current) setIndex(current - 1);
    else if (i === current) setIndex(Math.min(current, q.length - 2));
  }, [stopPlayback]);

  const clearUpcoming = useCallback(() => {
    const q = queueRef.current;
    const current = indexRef.current;
    if (current >= q.length - 1) return;
    shuffleOrder.current = []; shuffleBuilt.current = false;
    setQueue(q.slice(0, current + 1));
  }, []);

  const setEqEnabled = useCallback((enabled: boolean) => { setEqEnabledState(enabled); if (enabled) ensureGraph(); }, [ensureGraph]);
  const setEqPreset = useCallback((preset: string) => {
    const builtIn = EQ_PRESETS[preset];
    const custom = customPresets.find(p => `custom:${p.name}` === preset);
    if (!builtIn && !custom) return;
    setEqPresetState(preset);
    setEqBands([...(builtIn?.gains ?? custom!.gains)]);
    if (custom) setPreampState(custom.preamp);
  }, [customPresets]);
  const setEqBand = useCallback((i: number, gain: number) => {
    setEqBands(prev => prev.map((g, idx) => (idx === i ? Math.max(-12, Math.min(12, gain)) : g)));
    setEqPresetState('custom');
  }, []);
  const setPreamp = useCallback((db: number) => setPreampState(Math.max(-12, Math.min(12, db))), []);
  const setBalance = useCallback((pan: number) => setBalanceState(Math.max(-1, Math.min(1, pan))), []);
  const setLeveller = useCallback((on: boolean) => setLevellerState(on), []);
  const saveCustomPreset = useCallback((name: string) => {
    const clean = name.trim().slice(0, 30);
    if (!clean) return;
    setCustomPresets(prev => [...prev.filter(p => p.name !== clean), { name: clean, gains: [...eqBands], preamp }]);
    setEqPresetState(`custom:${clean}`);
  }, [eqBands, preamp]);
  const deleteCustomPreset = useCallback((name: string) => setCustomPresets(prev => prev.filter(p => p.name !== name)), []);
  const setCrossfade = useCallback((s: number) => setCrossfadeState(Math.max(0, Math.min(12, Math.round(s)))), []);
  const setDjMode = useCallback((on: boolean) => { setDjModeState(on); if (on) ensureGraph(); }, [ensureGraph]);
  const setDjVoice = useCallback((name: string) => setDjVoiceState(name), []);
  const setDjFrequency = useCallback((f: DjFrequency) => { setDjFrequencyState(f); brain.current!.frequency = f; djPlan.current = null; djPreparing.current = null; }, []);
  useEffect(() => store('vv-dj-freq', djFrequency), [djFrequency]);
  const djTryNow = useCallback(() => {
    const a = live();
    if (!a || !Number.isFinite(a.duration) || a.duration < 60) return;
    setDjModeState(true);
    brain.current!.force = true;
    djPlan.current = null; djPreparing.current = null;
    a.currentTime = Math.max(0, a.duration - 45);
    if (a.paused) { wantPlay.current = true; void a.play().catch(() => undefined); }
  }, []);

  // Volume and mute apply to both decks (the fades live in the audio graph, not on the element).
  useEffect(() => {
    for (const el of [deckA.current, deckB.current]) { if (el) { el.volume = volume; el.muted = muted; } }
  }, [volume, muted]);

  useEffect(() => { audioEngine.setEq({ enabled: eqEnabled, gains: eqBands, preamp, balance, leveller }); }, [eqEnabled, eqBands, preamp, balance, leveller]);

  const handlePlay = useCallback((e: React.SyntheticEvent<HTMLAudioElement>) => {
    if (!isLive(e.currentTarget)) return;
    wantPlay.current = true;
    ensureGraph();
    setPlaying(true);
  }, [ensureGraph]);

  useEffect(() => store('vv-music-volume', String(volume)), [volume]);
  useEffect(() => store('vv-music-muted', muted ? '1' : '0'), [muted]);
  useEffect(() => store('vv-eq-enabled', eqEnabled ? '1' : '0'), [eqEnabled]);
  useEffect(() => store('vv-eq10-preset', eqPreset), [eqPreset]);
  useEffect(() => store('vv-eq10-bands', JSON.stringify(eqBands)), [eqBands]);
  useEffect(() => store('vv-eq-preamp', String(preamp)), [preamp]);
  useEffect(() => store('vv-eq-balance', String(balance)), [balance]);
  useEffect(() => store('vv-eq-leveller', leveller ? '1' : '0'), [leveller]);
  useEffect(() => store('vv-eq-custom', JSON.stringify(customPresets)), [customPresets]);
  useEffect(() => store('vv-crossfade', String(crossfade)), [crossfade]);
  useEffect(() => store('vv-dj', djMode ? '1' : '0'), [djMode]);
  useEffect(() => store('vv-dj-voice', djVoice), [djVoice]);

  // The queue and position survive a reload for a day (like a streaming app), then are forgotten.
  useEffect(() => {
    if (!queue.length) return;
    const save = () => store(SESSION_KEY, JSON.stringify({ queue: queue.slice(0, 2000), index, time: Math.floor(audioRef.current?.currentTime ?? 0), at: Date.now(), shuffle } satisfies SavedSession));
    save();
    const id = window.setInterval(save, 10000);
    window.addEventListener('pagehide', save);
    return () => { window.clearInterval(id); window.removeEventListener('pagehide', save); };
  }, [queue, index, shuffle]);

  // Reserve room for the floating music bar when a queue is active.
  useEffect(() => {
    document.body.classList.toggle('has-music-bar', queue.length > 0);
    return () => document.body.classList.remove('has-music-bar');
  }, [queue.length]);

  // Move the live deck onto the current track whenever the queue row changes (a fade already did it).
  useEffect(() => {
    const audio = live();
    if (!audio || !queue.length) return;
    const current = queue[Math.min(index, queue.length - 1)] ?? queue[0]!;
    const expected = urlFor(current);
    if (rawSrc.current === expected) return;
    if (!wantPlay.current && !audio.src) return; // a restored session waits for play
    other()?.pause();
    audioEngine.level(audio, 1);
    startOn(audio, current);
  }, [index, queue, startOn]);

  const entry = queue.length ? queue[Math.min(index, queue.length - 1)] ?? queue[0]! : null;

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
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => { wantPlay.current = true; void live()?.play().catch(() => undefined); }],
      ['pause', () => { wantPlay.current = false; live()?.pause(); }],
      ['previoustrack', () => prevTrack()],
      ['nexttrack', () => nextTrack()],
      ['seekbackward', d => seek(Math.max(0, (live()?.currentTime ?? 0) - (d.seekOffset ?? 10)))],
      ['seekforward', d => seek((live()?.currentTime ?? 0) + (d.seekOffset ?? 10))],
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
    queue, index, entry, playing, currentTime, duration, error, volume, muted, shuffle, repeat, buffered, buffering,
    expanded, setExpanded, getTime, removeFromQueue, clearUpcoming, eqEnabled, eqPreset, eqBands, preamp, balance,
    leveller, customPresets, crossfade, djMode, djVoice, djFrequency, djTalking, playQueue, shufflePlay, toggle, stopPlayback,
    nextTrack, prevTrack, skipTo, seek, setVolume, toggleMute, toggleShuffle, toggleRepeat, setEqEnabled, setEqPreset,
    setEqBand, setPreamp, setBalance, setLeveller, saveCustomPreset, deleteCustomPreset, setCrossfade, setDjMode, setDjVoice, setDjFrequency, djTryNow
  };

  const deckProps = {
    preload: 'metadata' as const,
    onPlay: handlePlay,
    onPlaying: (e: React.SyntheticEvent<HTMLAudioElement>) => { if (isLive(e.currentTarget)) setBuffering(false); },
    onWaiting: (e: React.SyntheticEvent<HTMLAudioElement>) => { if (isLive(e.currentTarget)) setBuffering(true); },
    onProgress: (e: React.SyntheticEvent<HTMLAudioElement>) => {
      const a = e.currentTarget;
      if (!isLive(a)) return;
      setBuffered(a.buffered.length ? a.buffered.end(a.buffered.length - 1) : 0);
    },
    onPause: (e: React.SyntheticEvent<HTMLAudioElement>) => { if (isLive(e.currentTarget) && !mixing.current) setPlaying(false); },
    onTimeUpdate: (e: React.SyntheticEvent<HTMLAudioElement>) => {
      const a = e.currentTarget;
      if (!isLive(a)) return;
      setCurrentTime(a.currentTime);
      const fade = crossfadeRef.current || (djRef.current.on ? 5 : 0);
      const left = a.duration - a.currentTime;
      if (fade && !mixing.current && Number.isFinite(a.duration) && a.duration > 30) {
        if (djRef.current.on) {
          if (left <= 40) void prepareDj();
          const plan = djPlan.current;
          // Over this song's outro: after its last sung line, the music dips and the host talks, then the blend.
          if (plan?.mode === 'outro' && plan.brk && !plan.started && plan.index === peekNext(true) && left <= plan.talkAt) {
            audioEngine.fade(a, plan.brk.soft ? 0.5 : 0.35, 1.2);
            void talk(plan).then(() => { if (audioRef.current === a) audioEngine.fade(a, 0.7, 0.8); });
          }
          const lead = plan?.mode === 'over' && !plan.started ? fade + 4 : fade;
          if (left <= lead && !(djSpeaking.current && left > 1)) void mixIntoNext();
        } else if (left <= fade) void mixIntoNext();
      }
    },
    onDurationChange: (e: React.SyntheticEvent<HTMLAudioElement>) => { if (isLive(e.currentTarget)) setDuration(e.currentTarget.duration); },
    onEnded: (e: React.SyntheticEvent<HTMLAudioElement>) => { if (isLive(e.currentTarget) && !mixing.current) goNext(true); },
    onError: (e: React.SyntheticEvent<HTMLAudioElement>) => {
      const audio = e.currentTarget;
      if (!isLive(audio)) return;
      // A plain <audio> element plays a narrower set of formats than a library holds (WMA, ALAC, APE): the
      // first time, fall back to the server's ffmpeg conversion instead of giving up.
      if (rawSrc.current && audio.src && !audio.src.includes('/transcode')) {
        audio.src = `${rawSrc.current}/transcode`;
        void audio.play().catch(() => setError('This track could not be loaded. The file may be missing or unsupported.'));
        return;
      }
      if (audio.src) setError('This track could not be loaded. The file may be missing or unsupported.');
    }
  };

  return (
    <MusicContext.Provider value={value}>
      {children}
      <audio ref={el => { deckA.current = el; if (!audioRef.current) audioRef.current = el; }} {...deckProps} />
      <audio ref={el => { deckB.current = el; }} {...deckProps} />
      {queue.length > 0 && <MusicPlayerUI />}
    </MusicContext.Provider>
  );
}
