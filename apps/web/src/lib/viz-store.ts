import { useEffect, useState, useSyncExternalStore } from 'react';
import { api, type Lyrics } from './api';

/**
 * Visualizer settings shared by every place that shows one (the bottom bar, the Music page, Now Playing and the
 * full-screen stage), so a choice made in one shows in all of them.
 */
/** A scene id from components/music/viz-scenes, or 'cycle'. */
export type SceneId = string;
export type LyricStyle = 'off' | 'karaoke' | 'roll';
export type VizState = {
  scene: SceneId;
  lyricStyle: LyricStyle;
  /** Full-screen visualizer after a minute without input while music plays. */
  screensaver: boolean;
  /** Show the visualizer in place of the cover in Now Playing. */
  inPlayer: boolean;
  /** Frames a second: 24 like film, 30 like video, 60 smooth. Capped so motion stays even. */
  fps: 24 | 30 | 60;
  /** The full-screen stage: closed, opened by the person, or opened by the screensaver. */
  stage: 'closed' | 'open' | 'auto';
};

const KEY = 'vv-viz';
const read = (): VizState => {
  const base: VizState = { fps: 60, scene: 'mood', lyricStyle: 'karaoke', screensaver: true, inPlayer: true, stage: 'closed' };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<VizState>;
    return {
      ...base,
      scene: typeof saved.scene === 'string' && /^[a-z]+$/.test(saved.scene) ? saved.scene : base.scene,
      lyricStyle: (['off', 'karaoke', 'roll'] as const).includes(saved.lyricStyle as LyricStyle) ? saved.lyricStyle! : base.lyricStyle,
      screensaver: saved.screensaver ?? base.screensaver,
      inPlayer: saved.inPlayer ?? base.inPlayer,
      fps: saved.fps === 24 || saved.fps === 30 ? saved.fps : base.fps
    };
  } catch { return base; }
};

let state = read();
const listeners = new Set<() => void>();

export function setViz(next: Partial<VizState>): void {
  state = { ...state, ...next };
  try {
    const { stage: _stage, ...keep } = state;
    localStorage.setItem(KEY, JSON.stringify(keep));
  } catch { /* private window: works for this visit */ }
  listeners.forEach(l => l());
}

/** The current settings outside React (the drawing loops read it every frame). */
export const vizNow = (): VizState => state;

export function useViz(): VizState {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => state, () => state);
}

// One lookup per song for everything on screen.
const lyricCache = new Map<string, Promise<Lyrics | null>>();
const lyricKey = (artist: string, title: string) => `${artist}|${title}`.toLowerCase();

/** Lyrics for a song, shared with everything else on screen (one lookup per song). */
export function fetchLyrics(artist: string, title: string, album?: string, duration?: number): Promise<Lyrics | null> {
  const key = lyricKey(artist, title);
  let hit = lyricCache.get(key);
  if (!hit) {
    hit = api.lyrics(artist, title, album, duration).then(l => l ?? null).catch(() => null);
    lyricCache.set(key, hit);
  }
  return hit;
}

/** Lyrics for the playing song: undefined while loading, null when there are none. */
export function useLyrics(artist: string | undefined, title: string | undefined, album?: string, duration?: number, on = true): Lyrics | null | undefined {
  const [value, setValue] = useState<Lyrics | null | undefined>(undefined);
  useEffect(() => {
    setValue(undefined);
    if (!on || !artist || !title) { setValue(null); return; }
    let alive = true;
    void fetchLyrics(artist, title, album, duration).then(l => { if (alive) setValue(l); });
    return () => { alive = false; };
  }, [artist, title, album, duration, on]);
  return value;
}

export type LyricLine = { prev: string; now: string; next: string; progress: number };
const EMPTY: LyricLine = { prev: '', now: '', next: '', progress: 0 };

/** The line being sung right now, polled from the player's clock (cheap: a few times a second). */
export function useLyricLine(lyrics: Lyrics | null | undefined, getTime: () => number, on = true): LyricLine {
  const [line, setLine] = useState<LyricLine>(EMPTY);
  useEffect(() => {
    const synced = lyrics?.synced;
    if (!on || !synced?.length) { setLine(EMPTY); return; }
    const tick = () => {
      const now = getTime() + 0.2;
      let i = -1;
      for (let k = 0; k < synced.length; k++) if (synced[k]!.time <= now) i = k; else break;
      const cur = synced[i], nxt = synced[i + 1];
      const span = cur && nxt ? Math.max(0.5, nxt.time - cur.time) : 4;
      setLine(prev => {
        const next = { prev: synced[i - 1]?.text ?? '', now: cur?.text ?? '', next: nxt?.text ?? '', progress: cur ? Math.min(1, (now - cur.time) / span) : 0 };
        return prev.now === next.now && Math.abs(prev.progress - next.progress) < 0.02 ? prev : next;
      });
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [lyrics, getTime, on]);
  return line;
}
