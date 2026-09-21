import { all, get, run } from '../db/app-db.js';
import { currentUserId } from './user-context.js';

export interface WatchProgress {
  context?: string | null;
  mediaType: string;
  mediaId: string;
  positionSeconds: number;
  durationSeconds: number;
  percent: number;
  updatedAt: string;
}

const MIN_PERCENT_TO_KEEP = 1;
/** At/beyond this fraction the item counts as watched and progress clears. */
const COMPLETE_PERCENT = 96;

function percentOf(position: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!Number.isFinite(position) || position <= 0) return 0;
  return Math.max(0, Math.min(100, (position / duration) * 100));
}

/**
 * Record watch progress for an item. Position and duration are in seconds.
 * Progress below ~1% is ignored (a 5-second accidental click amounts to
 * nothing), and a finished item clears its entry so it does not linger as
 * "in progress" forever.
 */
export function saveWatchProgress(
  mediaType: string,
  mediaId: string,
  positionSeconds: number,
  durationSeconds: number,
  context?: string
): WatchProgress | null {
  const type = String(mediaType ?? '').trim();
  const id = String(mediaId ?? '').trim();
  if (!type || !id) return null;
  const position = Number(positionSeconds) || 0;
  const duration = Number(durationSeconds) || 0;
  const percent = percentOf(position, duration);

  if (!Number.isFinite(duration) || duration <= 0 || percent < MIN_PERCENT_TO_KEEP) {
    // Nothing meaningful was watched. Do not fabricate a "resume from 0".
    return null;
  }
  const now = new Date().toISOString();
  if (type === 'episode' && context) {
    // Remember the last episode touched so "Next Up" knows where to continue.
    run(
      `INSERT INTO series_last (user_id, series_id, episode_id, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, series_id) DO UPDATE SET episode_id = excluded.episode_id, updated_at = excluded.updated_at`,
      currentUserId(), context, id, now
    );
  }
  if (percent >= COMPLETE_PERCENT) {
    clearWatchProgress(type, id);
    // Finishing something marks it watched, as viewers expect.
    run(
      `INSERT INTO user_flags (user_id, media_type, media_id, favorite, watched, updated_at) VALUES (?, ?, ?, 0, 1, ?)
       ON CONFLICT(user_id, media_type, media_id) DO UPDATE SET watched = 1, updated_at = excluded.updated_at`,
      currentUserId(), type, id, now
    );
    return null;
  }

  run(
    `INSERT INTO watch_progress (user_id, media_type, media_id, position_seconds, duration_seconds, percent, updated_at, context)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, media_type, media_id) DO UPDATE SET
       position_seconds = excluded.position_seconds,
       duration_seconds = excluded.duration_seconds,
       percent = excluded.percent,
       updated_at = excluded.updated_at,
       context = COALESCE(excluded.context, watch_progress.context)`,
    currentUserId(), type, id, position, duration, percent, now, context ?? null
  );
  return { mediaType: type, mediaId: id, positionSeconds: position, durationSeconds: duration, percent, updatedAt: now };
}

export function getWatchProgress(mediaType: string, mediaId: string): WatchProgress | null {
  const type = String(mediaType ?? '').trim();
  const id = String(mediaId ?? '').trim();
  if (!type || !id) return null;
  // Own row first; a pre-multi-user 'shared' row is the fallback.
  const row = get<WatchProgress>(
    `SELECT media_type AS mediaType, media_id AS mediaId, position_seconds AS positionSeconds, duration_seconds AS durationSeconds, percent, updated_at AS updatedAt
     FROM watch_progress WHERE media_type = ? AND media_id = ? AND user_id IN (?, 'shared')
     ORDER BY (user_id = ?) DESC LIMIT 1`,
    type, id, currentUserId(), currentUserId()
  );
  return row ?? null;
}

export function clearWatchProgress(mediaType: string, mediaId: string): void {
  run("DELETE FROM watch_progress WHERE media_type = ? AND media_id = ? AND user_id IN (?, 'shared')", String(mediaType), String(mediaId), currentUserId());
}

/** Progress map for a whole library listing, keyed by item id. */
export function progressForLibrary(mediaType: string, ids: string[]): Map<string, WatchProgress> {
  const map = new Map<string, WatchProgress>();
  if (!ids.length) return map;
  const placeholders = ids.map(() => '?').join(',');
  const uid = currentUserId();
  const rows = all<WatchProgress & { userId: string }>(
    `SELECT user_id AS userId, media_type AS mediaType, media_id AS mediaId, position_seconds AS positionSeconds, duration_seconds AS durationSeconds, percent, updated_at AS updatedAt
     FROM watch_progress WHERE media_type = ? AND user_id IN (?, 'shared') AND media_id IN (${placeholders})`,
    mediaType, uid, ...ids
  );
  // A user's own row overrides the legacy shared one.
  for (const row of rows) if (row.userId === 'shared' && !map.has(row.mediaId)) map.set(row.mediaId, row);
  for (const row of rows) if (row.userId === uid) map.set(row.mediaId, row);
  return map;
}

export function allWatchProgress(): WatchProgress[] {
  return all<WatchProgress>(
    `SELECT media_type AS mediaType, media_id AS mediaId, position_seconds AS positionSeconds, duration_seconds AS durationSeconds, percent, updated_at AS updatedAt, context
     FROM watch_progress WHERE user_id IN (?, 'shared') ORDER BY updated_at DESC`,
    currentUserId()
  );
}
/** Series this viewer has started, most recent first, with the last episode they touched. */
export function lastWatchedSeries(limit = 8): Array<{ seriesId: string; episodeId: string }> {
  return all<{ seriesId: string; episodeId: string }>(
    'SELECT series_id AS seriesId, episode_id AS episodeId FROM series_last WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?',
    currentUserId(), limit
  );
}
