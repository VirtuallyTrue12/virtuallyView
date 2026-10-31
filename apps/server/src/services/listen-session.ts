import { randomBytes } from 'node:crypto';

/**
 * Listen together. One shared queue and one playback position that everyone in
 * a session hears. The rules are plain functions with the clock passed in, so
 * they are tested without a server. Sessions live in memory: they end after six
 * hours with no activity, or on a restart.
 */

export const SESSION_IDLE_MS = 6 * 60 * 60 * 1000;
export const MAX_MEMBERS = 25;
export const MAX_QUEUE = 2000;
const MAX_SESSIONS = 200;

/** One queue row. Only what the player needs is kept from what the client sends. */
export interface ListenEntry {
  track: { id: number | string; title: string; quality?: string; durationMs?: number };
  artistTitle?: string;
  albumTitle?: string;
  albumId?: string;
  cover?: string;
  genres?: string[];
}

export interface Member { userId: string; name: string; joinedAt: number }

export interface ListenSession {
  code: string;
  host: string;
  members: Member[];
  everyoneControl: boolean;
  queue: ListenEntry[];
  index: number;
  playing: boolean;
  /** Seconds into the current track as of updatedAt (epoch ms). */
  position: number;
  updatedAt: number;
  seq: number;
  lastActive: number;
}

export type Command =
  | { type: 'add'; entries: ListenEntry[] }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; position: number }
  | { type: 'skip'; index: number }
  | { type: 'replace'; queue: ListenEntry[]; index: number; position?: number; playing?: boolean }
  | { type: 'remove'; index: number }
  | { type: 'move'; from: number; to: number }
  | { type: 'everyone'; on: boolean };

export type Outcome<T = ListenSession> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404 | 409; message: string };

const sessions = new Map<string, ListenSession>();

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.slice(0, max) : undefined);

/** Keeps a queue row the client sent if it has a usable track id; anything else is dropped. */
export function sanitizeEntry(raw: unknown): ListenEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const t = (r.track ?? {}) as Record<string, unknown>;
  const id = typeof t.id === 'number' && Number.isFinite(t.id) ? t.id : str(t.id, 100);
  if (id === undefined) return null;
  const duration = typeof t.durationMs === 'number' && Number.isFinite(t.durationMs) && t.durationMs > 0 ? t.durationMs : undefined;
  const genres = Array.isArray(r.genres) ? r.genres.filter((g): g is string => typeof g === 'string').slice(0, 10).map(g => g.slice(0, 60)) : [];
  const quality = str(t.quality, 40);
  return {
    track: { id, title: str(t.title, 200) ?? 'Untitled', ...(quality ? { quality } : {}), ...(duration ? { durationMs: duration } : {}) },
    ...(str(r.artistTitle, 200) ? { artistTitle: str(r.artistTitle, 200) } : {}),
    ...(str(r.albumTitle, 200) ? { albumTitle: str(r.albumTitle, 200) } : {}),
    ...(str(r.albumId, 100) ? { albumId: str(r.albumId, 100) } : {}),
    ...(str(r.cover, 500) ? { cover: str(r.cover, 500) } : {}),
    ...(genres.length ? { genres } : {})
  };
}

export function sanitizeQueue(raw: unknown): ListenEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_QUEUE).map(sanitizeEntry).filter((e): e is ListenEntry => e !== null);
}

/** Anyone in the session may add songs. Play, pause, seek, skip and reorder need the host, or everyone-control. */
export const isMember = (s: ListenSession, userId: string): boolean => s.members.some(m => m.userId === userId);
export const isHost = (s: ListenSession, userId: string): boolean => s.host === userId;
export const canAdd = (s: ListenSession, userId: string): boolean => isMember(s, userId);
export const canControl = (s: ListenSession, userId: string): boolean => isHost(s, userId) || (s.everyoneControl && isMember(s, userId));

/** Where playback is now. Playing moves on from the last recorded point; paused stays put. */
export function positionAt(s: ListenSession, now: number): number {
  return s.playing ? s.position + Math.max(0, now - s.updatedAt) / 1000 : s.position;
}

function touch(s: ListenSession, now: number): void {
  s.lastActive = now;
  s.seq += 1;
}

/** Ends every session that has sat idle too long. Returns the codes it removed. */
export function expireSessions(now: number): string[] {
  const gone: string[] = [];
  for (const [code, s] of sessions) {
    if (now - s.lastActive > SESSION_IDLE_MS) { sessions.delete(code); gone.push(code); }
  }
  return gone;
}

/** The session, if it exists and has not expired. */
export function getSession(code: string, now: number): ListenSession | null {
  const s = sessions.get(code);
  if (!s) return null;
  if (now - s.lastActive > SESSION_IDLE_MS) { sessions.delete(code); return null; }
  return s;
}

const newCode = (): string => randomBytes(4).toString('hex').slice(0, 6).toUpperCase();

export function createSession(host: Omit<Member, 'joinedAt'>, init: { queue: ListenEntry[]; index?: number; position?: number; playing?: boolean }, now: number): Outcome {
  expireSessions(now);
  if (sessions.size >= MAX_SESSIONS) return { ok: false, status: 409, message: 'Too many listening sessions are open. Try again later.' };
  if (!init.queue.length) return { ok: false, status: 400, message: 'Add something to play first.' };
  let code = newCode();
  while (sessions.has(code)) code = newCode();
  const index = Math.max(0, Math.min(init.index ?? 0, init.queue.length - 1));
  const s: ListenSession = {
    code, host: host.userId, members: [{ ...host, joinedAt: now }], everyoneControl: false,
    queue: init.queue, index, playing: init.playing ?? true,
    position: Math.max(0, init.position ?? 0), updatedAt: now, seq: 1, lastActive: now
  };
  sessions.set(code, s);
  return { ok: true, value: s };
}

export function joinSession(code: string, member: Omit<Member, 'joinedAt'>, now: number): Outcome {
  const s = getSession(code, now);
  if (!s) return { ok: false, status: 404, message: 'That listening session has ended or the code is wrong.' };
  if (!isMember(s, member.userId)) {
    if (s.members.length >= MAX_MEMBERS) return { ok: false, status: 409, message: 'This listening session is full.' };
    s.members.push({ ...member, joinedAt: now });
    touch(s, now);
  }
  return { ok: true, value: s };
}

/**
 * Someone leaves. If the host leaves, the member who joined first is host next.
 * A session with nobody left in it ends (value.session becomes null).
 */
export function leaveSession(code: string, userId: string, now: number): Outcome<{ session: ListenSession | null }> {
  const s = getSession(code, now);
  if (!s) return { ok: false, status: 404, message: 'That listening session has ended.' };
  const before = s.members.length;
  s.members = s.members.filter(m => m.userId !== userId);
  if (s.members.length === before) return { ok: true, value: { session: s } };
  if (!s.members.length) { sessions.delete(code); return { ok: true, value: { session: null } }; }
  if (s.host === userId) s.host = [...s.members].sort((a, b) => a.joinedAt - b.joinedAt)[0]!.userId;
  touch(s, now);
  return { ok: true, value: { session: s } };
}

/** Applies one change from a member, after the permission check. */
export function applyCommand(code: string, userId: string, cmd: Command, now: number): Outcome {
  const s = getSession(code, now);
  if (!s) return { ok: false, status: 404, message: 'That listening session has ended.' };
  if (!isMember(s, userId)) return { ok: false, status: 403, message: 'Join the listening session first.' };
  if (cmd.type === 'everyone') {
    if (!isHost(s, userId)) return { ok: false, status: 403, message: 'Only the host can change that.' };
  } else if (cmd.type === 'add') {
    if (!canAdd(s, userId)) return { ok: false, status: 403, message: 'Join the listening session first.' };
  } else if (!canControl(s, userId)) {
    return { ok: false, status: 403, message: 'Only the host can do that. Ask them to turn on "Everyone can control".' };
  }
  const current = positionAt(s, now);
  switch (cmd.type) {
    case 'add': {
      const entries = sanitizeQueue(cmd.entries);
      if (!entries.length) return { ok: false, status: 400, message: 'Nothing to add.' };
      if (s.queue.length + entries.length > MAX_QUEUE) return { ok: false, status: 400, message: 'The shared queue is full.' };
      s.queue = [...s.queue, ...entries];
      break;
    }
    case 'play':
      s.position = current; s.playing = true; s.updatedAt = now;
      break;
    case 'pause':
      s.position = current; s.playing = false; s.updatedAt = now;
      break;
    case 'seek': {
      const to = Number(cmd.position);
      if (!Number.isFinite(to) || to < 0) return { ok: false, status: 400, message: 'Send a position in seconds.' };
      s.position = to; s.updatedAt = now;
      break;
    }
    case 'skip': {
      if (!Number.isInteger(cmd.index) || cmd.index < 0 || cmd.index >= s.queue.length) return { ok: false, status: 400, message: 'That track is not in the queue.' };
      s.index = cmd.index; s.position = 0; s.updatedAt = now;
      break;
    }
    case 'replace': {
      const queue = sanitizeQueue(cmd.queue);
      if (!queue.length) return { ok: false, status: 400, message: 'Nothing to play.' };
      s.queue = queue;
      s.index = Math.max(0, Math.min(Number.isInteger(cmd.index) ? cmd.index : 0, queue.length - 1));
      s.playing = cmd.playing ?? true;
      s.position = Math.max(0, Number(cmd.position) || 0); s.updatedAt = now;
      break;
    }
    case 'remove': {
      if (!Number.isInteger(cmd.index) || cmd.index < 0 || cmd.index >= s.queue.length) return { ok: false, status: 400, message: 'That track is not in the queue.' };
      const i = cmd.index;
      s.queue = s.queue.filter((_, at) => at !== i);
      if (!s.queue.length) { s.index = 0; s.playing = false; s.position = 0; s.updatedAt = now; break; }
      if (i < s.index) s.index -= 1;
      else if (i === s.index) { s.index = Math.min(s.index, s.queue.length - 1); s.position = 0; s.updatedAt = now; }
      break;
    }
    case 'move': {
      const n = s.queue.length;
      if (![cmd.from, cmd.to].every(v => Number.isInteger(v) && v >= 0 && v < n)) return { ok: false, status: 400, message: 'That track is not in the queue.' };
      const [moved] = s.queue.splice(cmd.from, 1);
      s.queue.splice(cmd.to, 0, moved!);
      if (s.index === cmd.from) s.index = cmd.to;
      else if (cmd.from < s.index && s.index <= cmd.to) s.index -= 1;
      else if (cmd.to <= s.index && s.index < cmd.from) s.index += 1;
      break;
    }
    case 'everyone':
      s.everyoneControl = !!cmd.on;
      break;
    default:
      return { ok: false, status: 400, message: 'Unknown listening command.' };
  }
  touch(s, now);
  return { ok: true, value: s };
}

/** Clears every session (tests, and a restart). */
export function resetListenSessions(): void {
  sessions.clear();
}
