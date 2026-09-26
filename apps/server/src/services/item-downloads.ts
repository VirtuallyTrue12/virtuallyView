import { normalizeStatus } from './real-downloads.js';

/** What is arriving for one episode or album right now, in words a page can show next to it. */
export interface ItemDownload { progress: number; status: string; message?: string; timeleft?: string }

interface QueueRow { status: string; progress?: number; statusMessage?: string; timeleft?: string; episodeId?: number; albumId?: number }
interface HasQueue { getQueue: () => Promise<QueueRow[]> }

const RANK: Record<string, number> = { downloading: 5, importing: 4, queued: 3, paused: 2, stalled: 1, failed: 1 };

function describe(source: 'sonarr' | 'lidarr', row: QueueRow): ItemDownload {
  const progress = Math.round(row.progress ?? 0);
  const status = normalizeStatus(source, row.status, progress, row.statusMessage);
  return { progress, status, ...(row.statusMessage ? { message: row.statusMessage } : {}), ...(row.timeleft && row.timeleft !== '00:00:00' ? { timeleft: row.timeleft } : {}) };
}

const best = (a: ItemDownload | undefined, b: ItemDownload) => (!a || (RANK[b.status] ?? 0) > (RANK[a.status] ?? 0) ? b : a);

/** Queue rows by episode id (Sonarr) or album id (Lidarr). A failure to read the queue just means nothing is shown. */
export async function queueByItem(source: 'sonarr' | 'lidarr', adapter: HasQueue): Promise<Map<number, ItemDownload>> {
  const map = new Map<number, ItemDownload>();
  try {
    for (const row of await adapter.getQueue()) {
      const id = source === 'sonarr' ? row.episodeId : row.albumId;
      if (id === undefined) continue;
      map.set(id, best(map.get(id), describe(source, row)));
    }
  } catch { /* the media app is unreachable: show no download state */ }
  return map;
}
