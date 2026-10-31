import { useEffect, useRef } from 'react';

/**
 * Listen together and play on another device. The player (MusicProvider) does the
 * playback; this file holds the shared types, the device identity, and the
 * event-stream and heartbeat plumbing both features use.
 */

/** One queue row as the server keeps it (the same shape the player uses). */
export interface ListenRow {
  track: { id: number | string; title: string; quality?: string; durationMs?: number };
  artistTitle?: string;
  albumTitle?: string;
  albumId?: string;
  cover?: string;
  genres?: string[];
}

/** True for a real session view, not an error body or an empty answer. */
export function isListenView(value: unknown): value is ListenView {
  const v = value as Partial<ListenView> | null;
  return !!v && typeof v === 'object' && typeof v.code === 'string' && Array.isArray(v.queue) && typeof v.seq === 'number';
}

export interface ListenMember { userId: string; name: string; host: boolean }

/** The shared session as one listener sees it. `position` is where playback was at `serverNow`. */
export interface ListenView {
  code: string;
  host: string;
  everyoneControl: boolean;
  members: ListenMember[];
  queue: ListenRow[];
  index: number;
  playing: boolean;
  position: number;
  updatedAt: number;
  seq: number;
  serverNow: number;
  you: string;
  youAreHost: boolean;
  canControl: boolean;
  canAdd: boolean;
}

/** What a device reports about its own playback. */
export interface DeviceState {
  deviceId?: string;
  playing: boolean;
  position: number;
  duration: number;
  index: number;
  queueLength: number;
  title?: string;
  artist?: string;
  cover?: string;
  volume: number;
  blocked: boolean;
}

export interface DeviceInfo { id: string; name: string; state: DeviceState | null }

/** A command a remote sends to a device. */
export type DeviceCommand =
  | { type: 'load'; queue: ListenRow[]; index: number; position: number; playing: boolean }
  | { type: 'play' | 'pause' | 'next' | 'prev' | 'stop' }
  | { type: 'seek'; position: number }
  | { type: 'volume'; value: number };

export const DEVICE_STALE_MS = 30_000;

const ID_KEY = 'vv-device-id';
const NAME_KEY = 'vv-device-name';
const ID_RE = /^[a-z0-9-]{6,40}$/;
const makeId = () => `dev-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
let memoryId = '';

/** One id per open tab, kept for the life of the tab. */
export function deviceId(): string {
  try {
    const saved = sessionStorage.getItem(ID_KEY);
    if (saved && ID_RE.test(saved)) return saved;
    const id = makeId();
    sessionStorage.setItem(ID_KEY, id);
    return id;
  } catch {
    if (!memoryId) memoryId = makeId();
    return memoryId;
  }
}

/** A name from the browser: "Chrome on Mac", "Safari on iPhone", "TV browser". */
export function defaultDeviceName(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  if (/SmartTV|Tizen|WebOS|BRAVO|AFT|CrKey|Viera|NetCast/i.test(ua)) return 'TV browser';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';
  const os = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'Chromebook'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return os ? `${browser} on ${os}` : browser;
}

/** The name the person gave this browser, or the one the browser suggests. */
export function loadDeviceName(): string {
  try { return localStorage.getItem(NAME_KEY)?.trim().slice(0, 40) || defaultDeviceName(); } catch { return defaultDeviceName(); }
}

export function saveDeviceName(name: string): void {
  try { localStorage.setItem(NAME_KEY, name.trim().slice(0, 40)); } catch { /* storage off: the name resets on reload */ }
}

/** Calls the server and returns its answer, or the message it sent back. */
export async function call<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (!res.ok) return { ok: false, status: res.status, message: data.message ?? 'That did not work. Try again.' };
    return { ok: true, data };
  } catch {
    return { ok: false, status: 0, message: 'Cannot reach the server. Check the connection.' };
  }
}

/**
 * Listens to a listen-together session. `onView` gets every change; `onEnded` fires when the
 * session is over (the host ended it, it went idle, or this person is no longer a member).
 */
export function useListenStream(code: string | null, onView: (view: ListenView) => void, onEnded: () => void): void {
  const viewRef = useRef(onView);
  const endedRef = useRef(onEnded);
  viewRef.current = onView;
  endedRef.current = onEnded;
  useEffect(() => {
    if (!code) return;
    const source = new EventSource(`/api/listen/${encodeURIComponent(code)}/events?client=${makeId()}`);
    source.addEventListener('state', event => viewRef.current(JSON.parse((event as MessageEvent).data) as ListenView));
    source.addEventListener('ended', () => { source.close(); endedRef.current(); });
    // The browser retries on a dropped connection by itself. Only a refusal (not a member, or no such session) stops it.
    source.onerror = () => { if (source.readyState === EventSource.CLOSED) endedRef.current(); };
    return () => source.close();
  }, [code]);
}

/** This tab's device stream: commands aimed at it, and the state of its account's devices. */
export function useDeviceStream(id: string, enabled: boolean, onCommand: (cmd: DeviceCommand) => void, onState: (state: DeviceState) => void): void {
  const commandRef = useRef(onCommand);
  const stateRef = useRef(onState);
  commandRef.current = onCommand;
  stateRef.current = onState;
  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource(`/api/devices/stream?device=${encodeURIComponent(id)}`);
    source.addEventListener('command', event => commandRef.current(JSON.parse((event as MessageEvent).data) as DeviceCommand));
    source.addEventListener('state', event => stateRef.current(JSON.parse((event as MessageEvent).data) as DeviceState));
    return () => source.close();
  }, [id, enabled]);
}

/**
 * Keeps this device listed for its account: a heartbeat every 10 seconds, and while
 * something is playing, its position every 2 seconds (a change of state is sent at once).
 */
export function useDeviceHeartbeat(id: string, enabled: boolean, getName: () => string, getState: () => DeviceState | null): void {
  useEffect(() => {
    if (!enabled) return;
    let last = 0;
    let lastSig = '';
    const beat = () => {
      const state = getState();
      const sig = JSON.stringify(state);
      const now = Date.now();
      if (sig === lastSig && now - last < 10_000) return;
      lastSig = sig;
      last = now;
      void call('POST', '/api/devices/heartbeat', { id, name: getName(), state });
    };
    beat();
    const timer = window.setInterval(beat, 2000);
    return () => window.clearInterval(timer);
    // getName and getState read refs through the caller, so they are not dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, enabled]);
}
