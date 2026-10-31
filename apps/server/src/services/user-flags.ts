import { all, get, run } from '../db/app-db.js';
import { currentUserId } from './user-context.js';
import { clearWatchProgress } from './progress.js';

export interface UserFlags { favorite: boolean; watched: boolean }

interface Row { media_type: string; media_id: string; favorite: number; watched: number }

export function getFlags(mediaType: string, mediaId: string): UserFlags {
  const row = get<Row>('SELECT * FROM user_flags WHERE user_id = ? AND media_type = ? AND media_id = ?', currentUserId(), mediaType, mediaId);
  return { favorite: row?.favorite === 1, watched: row?.watched === 1 };
}

export function flagsForLibrary(mediaType: string, ids: string[]): Map<string, UserFlags> {
  const map = new Map<string, UserFlags>();
  if (!ids.length) return map;
  const rows = all<Row>(
    `SELECT * FROM user_flags WHERE user_id = ? AND media_type = ? AND media_id IN (${ids.map(() => '?').join(',')})`,
    currentUserId(), mediaType, ...ids
  );
  for (const r of rows) map.set(r.media_id, { favorite: r.favorite === 1, watched: r.watched === 1 });
  return map;
}

export function setFlags(mediaType: string, mediaId: string, patch: Partial<UserFlags>): UserFlags {
  const next = { ...getFlags(mediaType, mediaId), ...patch };
  run(
    `INSERT INTO user_flags (user_id, media_type, media_id, favorite, watched, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, media_type, media_id) DO UPDATE SET favorite = excluded.favorite, watched = excluded.watched, updated_at = excluded.updated_at`,
    currentUserId(), mediaType, mediaId, next.favorite ? 1 : 0, next.watched ? 1 : 0, new Date().toISOString()
  );
  // Marking something watched also drops its half-way resume point.
  if (patch.watched === true) clearWatchProgress(mediaType, mediaId);
  return next;
}

export function listFlagged(kind: 'favorite' | 'watched'): Array<{ mediaType: string; mediaId: string }> {
  return all<Row>(
    `SELECT * FROM user_flags WHERE user_id = ? AND ${kind} = 1 ORDER BY updated_at DESC`,
    currentUserId()
  ).map(r => ({ mediaType: r.media_type, mediaId: r.media_id }));
}

/** A viewer's thumb on a title: 1 up, -1 down, 0 none. */
export type Thumb = 1 | -1 | 0;

const asThumb = (n: number | undefined): Thumb => (n === 1 ? 1 : n === -1 ? -1 : 0);

export function getThumb(mediaType: string, mediaId: string): Thumb {
  const row = get<{ thumb: number }>('SELECT thumb FROM user_flags WHERE user_id = ? AND media_type = ? AND media_id = ?', currentUserId(), mediaType, mediaId);
  return asThumb(row?.thumb);
}

/**
 * Set or clear the viewer's thumb. The row's updated_at is left alone when the row already exists,
 * because that time also means "last watched" for the home page.
 */
export function setThumb(mediaType: string, mediaId: string, thumb: Thumb): Thumb {
  run(
    `INSERT INTO user_flags (user_id, media_type, media_id, favorite, watched, thumb, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?)
     ON CONFLICT(user_id, media_type, media_id) DO UPDATE SET thumb = excluded.thumb`,
    currentUserId(), mediaType, mediaId, thumb, new Date().toISOString()
  );
  return thumb;
}

/** Every title this viewer has thumbed up or down, or marked watched, with when that last changed. */
export function flagSignalRows(): Array<{ mediaType: string; mediaId: string; watched: boolean; thumb: Thumb; updatedAt: string }> {
  return all<{ media_type: string; media_id: string; watched: number; thumb: number; updated_at: string }>(
    'SELECT media_type, media_id, watched, thumb, updated_at FROM user_flags WHERE user_id = ? AND (watched = 1 OR thumb != 0)',
    currentUserId()
  ).map(r => ({
    mediaType: r.media_type,
    mediaId: r.media_id,
    watched: r.watched === 1,
    thumb: asThumb(r.thumb),
    updatedAt: r.updated_at
  }));
}
