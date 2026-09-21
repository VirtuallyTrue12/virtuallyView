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
