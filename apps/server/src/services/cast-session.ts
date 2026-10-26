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
}

const sessions = new Map<string, Session>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

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
  for (const [id, session] of sessions) {
    const device = lookupDevice(id);
    if (!device) { sessions.delete(id); continue; }
    try {
      const status = await deviceStatus(device);
      if (!status) { session.pollErrors++; }
      else {
        session.pollErrors = 0;
        const position = session.offset + status.currentTime;
        const duration = status.duration ?? session.duration;
        // Save progress under the session owner.
        runAsActor(session.actor, () => saveWatchProgress(session.mediaType, session.mediaId, position, duration, session.seriesId));
        // Finished or stopped: end the session, let progress clear naturally.
        if (status.state === 'IDLE' && status.idleReason && ['FINISHED', 'STOPPED', 'ERROR'].includes(status.idleReason)) {
          if (status.idleReason === 'FINISHED') {
            runAsActor(session.actor, () => saveWatchProgress(session.mediaType, session.mediaId, duration, duration, session.seriesId));
          }
          sessions.delete(id);
        }
      }
    } catch {
      session.pollErrors++;
    }
    if (session.pollErrors >= 3) sessions.delete(id);
  }
  if (sessions.size === 0) stopPolling();
}

export function startSession(device: CastDevice, opts: {
  mediaType: string; mediaId: string; seriesId?: string;
  offset: number; duration: number; title: string; actor: Actor;
}): void {
  sessions.set(device.id, {
    deviceId: device.id, deviceName: device.name,
    mediaType: opts.mediaType, mediaId: opts.mediaId, seriesId: opts.seriesId,
    offset: opts.offset, duration: opts.duration, title: opts.title,
    userId: opts.actor.userId, actor: opts.actor,
    startedAt: Date.now(), pollErrors: 0
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
  try {
    const status = await deviceStatus(device);
    const tvTime = status?.currentTime ?? 0;
    const position = session.offset + tvTime;
    if (saveProgress) {
      const duration = status?.duration ?? session.duration;
      runAsActor(session.actor, () => saveWatchProgress(session.mediaType, session.mediaId, position, duration, session.seriesId));
    }
    return position;
  } catch {
    return session.offset;
  }
}

/** Update the offset after a seek-by-reload on the TV. */
export function updateSessionOffset(deviceId: string, newOffset: number): void {
  const session = sessions.get(deviceId);
  if (session) session.offset = newOffset;
}

/** All active sessions for a user, for reconnection after a page reload. */
export function activeSessions(userId: string): Array<{ deviceId: string; deviceName: string; mediaType: string; mediaId: string; title: string }> {
  return [...sessions.values()]
    .filter(s => s.userId === userId)
    .map(({ deviceId, deviceName, mediaType, mediaId, title }) => ({ deviceId, deviceName, mediaType, mediaId, title }));
}
