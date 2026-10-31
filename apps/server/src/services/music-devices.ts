import { sanitizeQueue, type ListenEntry } from './listen-session.js';

/**
 * Play on another device. Each open virtuallyView tab registers as a device for
 * its account and sends a heartbeat. A device with no heartbeat for 30 seconds
 * drops off the list. Only the account that owns a device can control it.
 */

export const DEVICE_TTL_MS = 30_000;

/** What a device reports about its own playback. Small on purpose: the queue is sent once, on handover. */
export interface DeviceState {
  playing: boolean;
  position: number;
  duration: number;
  index: number;
  queueLength: number;
  title?: string;
  artist?: string;
  cover?: string;
  volume: number;
  /** The browser refused to start audio without a tap. */
  blocked: boolean;
}

interface DeviceRecord { id: string; userId: string; name: string; lastSeen: number; state: DeviceState | null }

export type DeviceCommand =
  | { type: 'load'; queue: ListenEntry[]; index: number; position: number; playing: boolean }
  | { type: 'play' | 'pause' | 'next' | 'prev' | 'stop' }
  | { type: 'seek'; position: number }
  | { type: 'volume'; value: number };

export type DeviceOutcome<T> = { ok: true; value: T } | { ok: false; status: 404 | 400; message: string };

const records = new Map<string, DeviceRecord>();
const key = (userId: string, id: string) => `${userId}\u0000${id}`;

export const DEVICE_ID = /^[a-z0-9-]{6,40}$/;
const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function sanitizeState(raw: unknown): DeviceState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    playing: r.playing === true,
    position: Math.max(0, num(r.position, 0)),
    duration: Math.max(0, num(r.duration, 0)),
    index: Math.max(0, Math.floor(num(r.index, 0))),
    queueLength: Math.max(0, Math.floor(num(r.queueLength, 0))),
    ...(text(r.title, 200) ? { title: text(r.title, 200) } : {}),
    ...(text(r.artist, 200) ? { artist: text(r.artist, 200) } : {}),
    ...(text(r.cover, 500) ? { cover: text(r.cover, 500) } : {}),
    volume: Math.max(0, Math.min(1, num(r.volume, 1))),
    blocked: r.blocked === true
  };
}

/** A command from a remote. Anything unrecognised is refused rather than guessed at. */
export function sanitizeCommand(raw: unknown): DeviceCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  switch (r.type) {
    case 'load': {
      const queue = sanitizeQueue(r.queue);
      if (!queue.length) return null;
      return { type: 'load', queue, index: Math.max(0, Math.min(Math.floor(num(r.index, 0)), queue.length - 1)), position: Math.max(0, num(r.position, 0)), playing: r.playing !== false };
    }
    case 'play': case 'pause': case 'next': case 'prev': case 'stop':
      return { type: r.type };
    case 'seek':
      return Number.isFinite(r.position) && (r.position as number) >= 0 ? { type: 'seek', position: r.position as number } : null;
    case 'volume':
      return Number.isFinite(r.value) ? { type: 'volume', value: Math.max(0, Math.min(1, r.value as number)) } : null;
    default:
      return null;
  }
}

/** Records a heartbeat from one of this account's tabs. Optional state rides along. */
export function heartbeat(userId: string, input: { id: string; name?: string; state?: DeviceState | null }, now: number): DeviceRecord {
  const k = key(userId, input.id);
  const prev = records.get(k);
  const rec: DeviceRecord = {
    id: input.id, userId,
    name: text(input.name, 40) ?? prev?.name ?? 'Browser',
    lastSeen: now,
    state: input.state ?? prev?.state ?? null
  };
  records.set(k, rec);
  return rec;
}

export const isLive = (rec: DeviceRecord, now: number): boolean => now - rec.lastSeen < DEVICE_TTL_MS;

/** This account's devices that have sent a heartbeat recently. */
export function listLive(userId: string, now: number): Array<Pick<DeviceRecord, 'id' | 'name' | 'state'>> {
  return [...records.values()]
    .filter(r => r.userId === userId && isLive(r, now))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(r => ({ id: r.id, name: r.name, state: r.state }));
}

/** Drops records that have gone quiet, so the map does not grow for ever. */
export function purgeDevices(now: number): void {
  for (const [k, rec] of records) if (!isLive(rec, now)) records.delete(k);
}

/**
 * The device a remote wants to control. A device belonging to another account
 * is reported as not found, so one account cannot even see another's devices.
 */
export function controlTarget(actorUserId: string, deviceId: string, now: number): DeviceOutcome<DeviceRecord> {
  const rec = records.get(key(actorUserId, deviceId));
  if (!rec || rec.userId !== actorUserId) return { ok: false, status: 404, message: 'That device is not on your account.' };
  if (!isLive(rec, now)) return { ok: false, status: 404, message: 'That device is offline. Open virtuallyView on it and try again.' };
  return { ok: true, value: rec };
}

/** Clears every record (tests, and a restart). */
export function resetDevices(): void {
  records.clear();
}
