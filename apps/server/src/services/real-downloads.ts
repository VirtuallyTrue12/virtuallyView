import type { Download, Media } from '@virtuallyview/types';
import type { RadarrAdapter, SonarrAdapter, QBittorrentAdapter, NZBGetAdapter } from '@virtuallyview/integrations';
import { getAdapter } from './registry.js';
import { scrapeMovie, tmdbArt } from './tmdb.js';
import { cleanReleaseName, releaseQualityLabel } from './names.js';
import { fetchWebCover } from './web-covers.js';

export type DownloadAction = 'pause' | 'resume' | 'remove' | 'delete-files';
export interface QueueItem {
  id: string;
  title: string;
  progress: number;
  status: string;
  sourceClient: string;
  reportedBy: string[];
  downloadId?: string;
  actions: DownloadAction[];
  speed?: string;
  eta?: string;
  size?: string;
  /** Where this download lives on disk, when the client or library reports it. */
  savePath?: string;
  mediaId?: string;
  mediaType?: string;
  year?: number;
  /** The name as the release was published, kept for a tooltip. `title` is the cleaned name. */
  rawTitle?: string;
  /** Short technical label such as "1080p WEB-DL" or "FLAC 24-bit". */
  qualityLabel?: string;
  /** Why this item needs attention (for example an import that failed). */
  message?: string;
  artwork?: { poster?: string; backdrop?: string };
}
const sources = ['radarr', 'sonarr', 'lidarr', 'qbittorrent', 'nzbget'] as const;
type Source = typeof sources[number];

function normalizeStatus(source: Source, status: string, progress: number): string {
  const value = status.toLowerCase();
  if (['error', 'missingfiles', 'failed', 'warning'].includes(value)) return 'failed';
  if (value.includes('paused') || value.startsWith('stopped')) return 'paused';
  if (['importing', 'imported', 'postprocessing', 'unpacking', 'verifying', 'moving'].includes(value)) return 'importing';
  if (value === 'completed' || (source === 'qbittorrent' && progress >= 100)) return 'completed';
  if (['queued', 'queueddl', 'queuedup'].includes(value)) return 'queued';
  if (['downloading', 'stalleddl', 'metadl', 'forceddl', 'allocating'].includes(value)) return 'downloading';
  return 'unknown';
}

function normalize(source: Source, row: Download): QueueItem {
  const rawId = ['radarr', 'sonarr', 'lidarr'].includes(source) ? row.id.replace(/^queue-/, '') : row.id;
  const progress = Number.isFinite(row.progress) ? Math.max(0, Math.min(100, row.progress!)) : 0;
  return {
    id: `queue-${source}-${rawId}`,
    title: row.title || row.associatedMedia?.title || 'Untitled download',
    sourceClient: source,
    reportedBy: [source],
    downloadId: row.downloadId,
    actions:
      source === 'qbittorrent' ? ['pause', 'resume', 'remove', 'delete-files'] :
      source === 'nzbget' ? ['remove', 'delete-files'] :
      source === 'lidarr' ? [] : ['remove'],
    progress,
    status: normalizeStatus(source, row.status, progress),
    mediaId: row.mediaId ?? row.associatedMedia?.id,
    mediaType: row.associatedMedia?.type ?? ({ radarr: 'movie', sonarr: 'series', lidarr: 'artist' } as Partial<Record<Source, string>>)[source],
    savePath: row.savePath,
    size: row.size === undefined ? undefined : `${(row.size / 1024 ** 3).toFixed(1)} GB`,
    ...(row.statusMessage ? { message: row.statusMessage } : {}),
    speed: row.speed === undefined ? undefined : `${(row.speed / 1024 ** 2).toFixed(1)} MB/s`,
    eta: row.timeleft ?? (row.eta ? new Date(row.eta).toISOString() : undefined)
  };
}

function titleKey(value: string): string {
  return value.normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Provider artwork for queue rows the library lookup cannot match (a torrent
// still "searching" has no library entry yet). Results are cached by
// type:title so a 15s feed poll never re-hits TMDB/web-cover services.
const FALLBACK_ART_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const fallbackArtCache = new Map<string, { art?: { poster?: string; backdrop?: string }; at: number }>();

async function artworkFallback(
  mediaType: string | undefined,
  title: string,
  year?: number
): Promise<{ poster?: string; backdrop?: string } | undefined> {
  if (!title || title === 'Untitled download') return undefined;
  const key = `${mediaType ?? 'movie'}:${titleKey(title)}:${year ?? ''}`;
  const cached = fallbackArtCache.get(key);
  if (cached && Date.now() - cached.at < FALLBACK_ART_CACHE_TTL_MS) return cached.art;

  let art: { poster?: string; backdrop?: string } | undefined;
  try {
    if (mediaType === 'artist' || mediaType === 'series') {
      const cover = await fetchWebCover(title);
      if (cover) art = { poster: cover };
    } else {
      // Movies (and raw client torrents with no reported type) resolve against
      // TMDB first for a real poster+backdrop pair, then web image search.
      const scraped = await scrapeMovie(undefined, title, year);
      if (scraped.poster) {
        art = tmdbArt(scraped.poster, scraped.backdrop);
      } else {
        const cover = await fetchWebCover(title);
        if (cover) art = { poster: cover };
      }
    }
  } catch {
    art = undefined;
  }
  // Cache failures too so an unreachable provider is not re-hit every poll.
  fallbackArtCache.set(key, { art, at: Date.now() });
  return art;
}

/**
 * Attach cover art and a stable media identity to every queue row. Download
 * clients (qBittorrent/NZBGet) report raw torrent titles, not library entries,
 * so a row is matched by normalized title against the connected libraries.
 * The result feeds both the Downloads page and the Home rail, so a completed
 * download shows a cover thumbnail instead of an empty placeholder.
 */
async function enrichWithLibrary(rows: QueueItem[]): Promise<QueueItem[]> {
  if (rows.length === 0) return rows;
  const byId = new Map<string, Media>();
  const byTitle = new Map<string, Media>();
  const all: Media[] = [];
  for (const key of ['radarr', 'sonarr', 'lidarr'] as const) {
    try {
      all.push(...(await getAdapter(key).getItems()));
    } catch {
      // integration offline: skip it
    }
  }
  for (const item of all) {
    if (item.id) byId.set(item.id, item);
    if (item.title) {
      const key = titleKey(item.title);
      if (!byTitle.has(key)) byTitle.set(key, item);
    }
  }
  return Promise.all(rows.map(async row => {
    const byIdMatch = row.mediaId ? byId.get(row.mediaId) : undefined;
    const likely = byIdMatch ?? byTitle.get(titleKey(row.title));
    if (!likely) {
      // No library match yet (still "searching" or a raw client torrent):
      // fall back to provider artwork so the tile is not a blank placeholder.
      if (row.artwork) return row;
      const art = await artworkFallback(row.mediaType, row.title, row.year);
      return art ? { ...row, artwork: art } : row;
    }
    const filePath = (likely as Media & { fileInfo?: { path?: string } }).fileInfo?.path;
    const dir = filePath && filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : undefined;
    return {
      ...row,
      mediaId: row.mediaId ?? likely.id,
      mediaType: row.mediaType ?? likely.type ?? row.mediaType,
      year: row.year ?? likely.year,
      artwork: row.artwork ?? likely.artwork,
      savePath: row.savePath ?? dir
    };
  }));
}

// Only client-backed rows are exposed. Request reconciliation is tracking, not
// a second download client; its local records must not offer synthetic controls.
export async function getDownloads(): Promise<QueueItem[]> {
  const results = await Promise.all(sources.map(async source => {
    try {
      return { ok: true, rows: (await getAdapter(source).getQueue()).map(row => normalize(source, row)) };
    } catch {
      return { ok: false, rows: [] as QueueItem[] };
    }
  }));
  if (results.every(result => !result.ok)) throw new Error('Download services are unavailable. Check integrations and try again.');
  const rows = results.flatMap(result => result.rows);
  const clients = rows.filter(row => ['qbittorrent', 'nzbget'].includes(row.sourceClient));
  const merged = [...clients];
  for (const manager of rows.filter(row => !clients.includes(row))) {
    // A title is NOT an identity: different releases often share a title.
    // Merge by download ID first (torrent hashes), then by the media identity
    // both sources report, so a completed movie never reads as two downloads.
    const transfer = manager.downloadId?.toLowerCase();
    const client = transfer ? clients.find(row => {
      const rawId = row.id.slice(`queue-${row.sourceClient}-`.length).toLowerCase();
      // Numeric IDs can collide between NZBGet instances. Until upstream
      // client identity is carried explicitly, merge only torrent hashes.
      return row.sourceClient === 'qbittorrent' && /^[a-f0-9]{40}$/.test(transfer) && transfer === rawId;
    }) : undefined;
    const byMediaId = client ?? (manager.mediaId ? clients.find(row => row.mediaId === manager.mediaId)
      ?? merged.find(row => row.mediaId === manager.mediaId) : undefined);
    if (!byMediaId) {
      merged.push(manager);
      continue;
    }
    byMediaId.reportedBy = [...new Set([...byMediaId.reportedBy, manager.sourceClient])];
    byMediaId.mediaId ??= manager.mediaId;
    byMediaId.mediaType ??= manager.mediaType;
    // Imported/failed state belongs to the manager; transfer progress and
    // controls belong to the client. Keep the client ID so actions stay real.
    if (manager.status === 'importing' || manager.status === 'failed') byMediaId.status = manager.status;
    if (manager.message) byMediaId.message = manager.message;
  }
  // Names are cleaned last, after library matching used the raw ones.
  return (await enrichWithLibrary(merged)).map(row => ({
    ...row,
    rawTitle: row.title,
    title: cleanReleaseName(row.title),
    qualityLabel: releaseQualityLabel(row.title)
  }));
}

export async function actOnDownload(id: string, action: DownloadAction): Promise<{ success: boolean; message: string }> {
  const match = /^queue-(radarr|sonarr|lidarr|qbittorrent|nzbget)-([a-zA-Z0-9-]+)$/.exec(id);
  if (!match) return { success: false, message: 'Use an exact download ID from the current queue.' };
  const source = match[1] as Source;
  const rawId = match[2];
  if (source !== 'qbittorrent' && !/^\d+$/.test(rawId)) return { success: false, message: 'Invalid upstream queue ID.' };
  try {
    if (source === 'qbittorrent') {
      const adapter = getAdapter<QBittorrentAdapter>(source);
      if (action === 'delete-files') return await adapter.removeWithFiles(rawId);
      return await adapter[action](rawId);
    }
    if (action === 'delete-files') {
      if (source === 'nzbget') {
        return { success: false, message: 'Deleting files is done in NZBGet itself; "Remove" clears the entry from its queue.' };
      }
      return { success: false, message: 'Deleting files is only available for qBittorrent downloads.' };
    }
    if (action !== 'remove' || source === 'lidarr') {
      return { success: false, message: `This action is not supported here for ${source}; use its download client.` };
    }
    if (source === 'nzbget') return await getAdapter<NZBGetAdapter>(source).remove(rawId);
    return await getAdapter<RadarrAdapter | SonarrAdapter>(source).removeQueueItem(rawId);
  } catch {
    return { success: false, message: `${source} could not complete the action. Check its connection and retry.` };
  }
}

export const pauseDownload = (id: string) => actOnDownload(id, 'pause');
export const resumeDownload = (id: string) => actOnDownload(id, 'resume');
export const removeDownload = (id: string) => actOnDownload(id, 'remove');
