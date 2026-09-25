/**
 * What a download-queue row's message says about it. Shared by the Downloads
 * page and the Requests page so both describe the same download the same way.
 */

/** In the queue, but nobody is sending it: not failed, and not moving either. */
export const STALLED_RE = /stalled|no connections|no seeders|not enough seeders/i;

export const STALLED_HELP = 'Stalled: nobody is sharing this release right now. Try another release from Downloads.';

export function isStalled(status: string | undefined, message: string | undefined, progress = 0): boolean {
  return ['warning', 'error', 'failed'].includes((status ?? '').toLowerCase()) && !!message && STALLED_RE.test(message) && progress < 100;
}

export interface Completeness { have: number; total: number; unit: 'episodes' | 'tracks' }

/** How much of a title's content is in the library. Null for films, and when the service does not say. */
export function completenessOf(item: { type?: string; seasons?: Array<{ number: number; episodes: number; availableEpisodes: number }>; trackFileCount?: number; totalTrackCount?: number }): Completeness | null {
  if (item.type === 'series' && Array.isArray(item.seasons)) {
    const real = item.seasons.filter(s => s.number > 0);
    const total = real.reduce((n, s) => n + (s.episodes || 0), 0);
    return total > 0 ? { have: real.reduce((n, s) => n + (s.availableEpisodes || 0), 0), total, unit: 'episodes' } : null;
  }
  if (item.type === 'artist' && (item.totalTrackCount ?? 0) > 0) return { have: item.trackFileCount ?? 0, total: item.totalTrackCount ?? 0, unit: 'tracks' };
  return null;
}

export const isPartial = (c: Completeness | null): c is Completeness => !!c && c.have < c.total;

export const PARTLY_PREFIX = 'Partly available';

/** Notes that only ever come from the queue, so they can be dropped when the queue stops saying them. */
export const isQueueNote = (message: string | undefined): boolean =>
  !!message && /^(Needs attention:|Stalled:|Partly available|The download queue reports|Waiting in the download queue|Paused in the download client)/.test(message);
export const partlyMessage = (c: Completeness) => `${PARTLY_PREFIX}: ${c.have} of ${c.total} ${c.unit}.`;

const RANK: Record<string, number> = { downloading: 5, importing: 4, queued: 3, paused: 2, warning: 1 };

/** One row to speak for several (a discography is many queue rows): the most active one. */
export function leadRow<T extends { status?: string }>(rows: T[]): T | undefined {
  return [...rows].sort((a, b) => (RANK[b.status ?? 'downloading'] ?? 0) - (RANK[a.status ?? 'downloading'] ?? 0))[0];
}
