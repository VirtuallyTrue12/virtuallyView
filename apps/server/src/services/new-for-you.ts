import type { Media } from '@virtuallyview/types';
import { all } from '../db/app-db.js';
import { currentActor } from './user-context.js';
import { followsByUser, loadFollowInputs } from './new-arrivals.js';

const WINDOW_MS = 14 * 86_400_000;
const MAX_ITEMS = 12;

/**
 * The "New for You" home rail: followed shows and artists that got something new in the last 14 days,
 * newest first, one tile per show or artist. Empty when nothing qualifies, so the rail is hidden.
 */
export function newForYouRails(byId: Map<string, Media>, libraryArtistIds: string[]): Array<{ id: string; title: string; items: Array<Media & { href: string }> }> {
  const actor = currentActor();
  const follows = followsByUser(loadFollowInputs([{ userId: actor.userId, role: actor.role }], libraryArtistIds))
    .get(actor.userId);
  if (!follows) return [];

  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const rows = all<{ kind: string; mediaId: string }>(
    'SELECT kind, media_id AS mediaId FROM new_arrivals WHERE arrived_at >= ? ORDER BY arrived_at DESC, rowid DESC',
    since
  );

  const seen = new Set<string>();
  const items: Array<Media & { href: string }> = [];
  for (const row of rows) {
    if (seen.has(row.mediaId)) continue;
    const isShow = row.kind === 'episode';
    const followed = isShow ? follows.series.has(row.mediaId) : follows.artists.has(row.mediaId);
    if (!followed) continue;
    const item = byId.get(row.mediaId);
    if (!item) continue;
    seen.add(row.mediaId);
    items.push({ ...item, href: isShow ? `/series/${row.mediaId}` : `/music/${row.mediaId}` });
    if (items.length >= MAX_ITEMS) break;
  }
  return items.length ? [{ id: 'new-for-you', title: 'New for You', items }] : [];
}
