import { deviceStatus, type CastDevice } from './dlna.js';
import { runAsActor, type Actor } from './user-context.js';
import { saveWatchProgress } from './progress.js';

// Tracks what each TV is playing so the server can save progress while the user
// is watching and so the web client can reconnect to a session after a reload.

interface Session {
  deviceId: string;
  deviceName: string;
  mediaType: string;
  mediaId: string;
  seriesId?: string;
  /** Seconds already watched before the current transcode started (the ?start= offset). */
  offset: number;
  duration: number;
  title: string;
  userId: string;
  actor: Actor;
  startedAt: number;
  pollErrors: number;
  /** Last position read while the TV was actually playing; an idle TV reports 0, which must not overwrite it. */
  lastPosition: number;
  /** How it was sent: the original file (the TV seeks by itself) or a conversion from `offset` (seeking reloads). */
  mode: 'direct' | 'transcode';
  /** What is needed to send it again from another position. */
  resend?: { transcodePath: string; subtitlePath?: string; subtitleLabel?: string; subtitleLang?: string };
}

const sessions = new Map<string, Session>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let polling = false;

/**
 * Where the viewer is in the whole item. The TV plays a conversion that began at `offset`, so its own clock and
 * its idea of the length cover only the rest of the file: the full length comes from the session.
 */
export function positionOf(session: { offset: number; duration: number }, tvTime: number, tvDuration?: number): { position: number; duration: number } {
  const duration = session.duration > 0 ? session.duration : (tvDuration ?? 0) + session.offset;
  return { position: Math.min(session.offset + tvTime, duration || Infinity), duration };
}

/** Look up a device by id to get a CastDevice stub. Kept outside sessions to avoid circular deps. */
type DeviceLookup = (id: string) => CastDevice | undefined;
let lookupDevice: DeviceLookup = () => undefined;

export function setCastDeviceLookup(fn: DeviceLookup): void {
  lookupDevice = fn;
}

function startPolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => void poll(), 10_000);
}

function stopPolling(): void {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

async function poll(): Promise<void> {
  if (sessions.size === 0) { stopPolling(); return; }
  // A TV that is slow to answer must not stack a second round of polls on top of the first.
  if (polling) return;
  polling = true;
  try { await pollOnce(); } finally { polling = false; }
}

export async function pollOnce(): Promise<void> {
  for (const [id, session] of sessions) {
    const device = lookupDevice(id);
    if (!device) { sessions.delete(id); continue; }
    try {
      const status = await deviceStatus(device);
      if (!status) { session.pollErrors++; }
      else {
        session.pollErrors = 0;
        const { position, duration } = positionOf(session, status.currentTime, status.duration);
        if (status.state !== 'IDLE') {
          session.lastPosition = position;
          runAsActor(session.actor, () => saveWatchProgress(session.mediaType, session.mediaId, position, duration, session.seriesId));
        } else if (status.idleReason && ['FINISHED', 'STOPPED', 'ERROR'].includes(status.idleReason)) {
          // Played to the end: watched. Stopped from the TV's own remote: keep the last real position.
          if (status.idleReason === 'FINISHED') runAsActor(session.actor, () => saveWatchProgress(session.mediaType, session.mediaId, duration, duration, session.seriesId));
          sessions.delete(id);
        }
      }
    } catch {
      session.pollErrors++;
    }
    // About a minute without an answer: the TV is off or gone. (Loading a video alone silences it for ~35 s.)
    if (session.pollErrors >= 6) sessions.delete(id);
  }
  if (sessions.size === 0) stopPolling();
}

export function startSession(device: CastDevice, opts: {
  mediaType: string; mediaId: string; seriesId?: string;
  offset: number; duration: number; title: string; actor: Actor;
  mode?: Session['mode']; resend?: Session['resend'];
}): void {
  sessions.set(device.id, {
    deviceId: device.id, deviceName: device.name,
    mediaType: opts.mediaType, mediaId: opts.mediaId, seriesId: opts.seriesId,
    offset: opts.offset, duration: opts.duration, title: opts.title,
    userId: opts.actor.userId, actor: opts.actor,
    startedAt: Date.now(), pollErrors: 0, lastPosition: opts.offset,
    mode: opts.mode ?? 'transcode', resend: opts.resend
  });
  startPolling();
}

export function getSession(deviceId: string): Session | undefined {
  return sessions.get(deviceId);
}

/** End the session and return the last known position (offset + TV time). Caller is responsible for stopping the device. */
export async function endSession(device: CastDevice, saveProgress = true): Promise<number> {
  const session = sessions.get(device.id);
  sessions.delete(device.id);
  if (sessions.size === 0) stopPolling();
  if (!session) return 0;
  let position = session.lastPosition;
  let duration = session.duration;
  try {
    const status = await deviceStatus(device);
    if (status && status.state !== 'IDLE') ({ position, duration } = positionOf(session, status.currentTime, status.duration));
  } catch { /* keep the last position the poll saw */ }
  if (saveProgress) runAsActor(session.actor, () => saveWatchProgress(session.mediaType, session.mediaId, position, duration, session.seriesId));
  return position;
}

/** Update the offset after a seek-by-reload on the TV. */
export function updateSessionOffset(deviceId: string, newOffset: number): void {
  const session = sessions.get(deviceId);
  if (session) { session.offset = newOffset; session.lastPosition = newOffset; }
}

/** All active sessions for a user, for reconnection after a page reload. */
export function activeSessions(userId: string): Array<{ deviceId: string; deviceName: string; mediaType: string; mediaId: string; title: string }> {
  return [...sessions.values()]
    .filter(s => s.userId === userId)
    .map(({ deviceId, deviceName, mediaType, mediaId, title }) => ({ deviceId, deviceName, mediaType, mediaId, title }));
}
