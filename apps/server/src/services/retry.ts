import type { RadarrAdapter, SonarrAdapter, LidarrAdapter } from '@virtuallyview/integrations';
import { getAdapter } from './registry.js';
import { getDownloads } from './real-downloads.js';

export interface RetryResult { success: boolean; message: string }

const fail = (message: string): RetryResult => ({ success: false, message });

/** Search again for one movie. */
export async function retryMovie(id: string): Promise<RetryResult> {
  if (!/^radarr-\d+$/.test(id)) return fail('Unknown movie id.');
  return getAdapter<RadarrAdapter>('radarr').refreshMetadata(id);
}

/** Search again for one episode, or every missing aired episode of a show. */
export async function retrySeries(id: string, episodeId?: string): Promise<RetryResult> {
  const sonarr = getAdapter<SonarrAdapter>('sonarr');
  if (episodeId) {
    if (!/^episode-\d+$/.test(episodeId)) return fail('Unknown episode id.');
    return sonarr.searchEpisodes([episodeId]);
  }
  if (!/^sonarr-\d+$/.test(id)) return fail('Unknown show id.');
  const result = await sonarr.searchMissing(id);
  return { success: result.success, message: result.count === 0 && result.success ? 'No episode is missing.' : result.message };
}

/** Search again for the missing albums of an artist, or one album. */
export async function retryArtist(id: string, albumId?: string): Promise<RetryResult> {
  const lidarr = getAdapter<LidarrAdapter>('lidarr');
  if (albumId) {
    const numeric = albumId.replace(/^album-/, '');
    return /^\d+$/.test(numeric) ? lidarr.searchAlbum(Number(numeric)) : fail('Unknown album id.');
  }
  if (!/^lidarr-\d+$/.test(id)) return fail('Unknown artist id.');
  const result = await lidarr.searchMissing(id);
  return { success: result.success, message: result.count === 0 && result.success ? 'No album is missing tracks.' : result.message };
}

/** Retry whatever kind of title `mediaId` is (radarr-, sonarr-, lidarr- ids). */
export async function retryTitle(mediaId: string): Promise<RetryResult> {
  try {
    if (mediaId.startsWith('radarr-')) return await retryMovie(mediaId);
    if (mediaId.startsWith('sonarr-')) return await retrySeries(mediaId);
    if (mediaId.startsWith('lidarr-')) return await retryArtist(mediaId);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'The service is not available.');
  }
  return fail('Unknown title id.');
}

/**
 * Reject a download that failed or would not import and look for another copy:
 * the release is blocklisted in the media manager that grabbed it, which then searches again.
 */
export async function retryDownload(queueItemId: string): Promise<RetryResult> {
  let rows: Awaited<ReturnType<typeof getDownloads>>;
  try { rows = await getDownloads(); } catch { return fail('The download services are not reachable right now.'); }
  const row = rows.find(item => item.id === queueItemId);
  if (!row) return fail('That download is no longer in the queue.');
  const hash = (row.id.startsWith('queue-qbittorrent-') ? row.id.slice('queue-qbittorrent-'.length) : row.downloadId ?? '').toLowerCase();
  if (hash) {
    for (const key of ['radarr', 'sonarr', 'lidarr'] as const) {
      try {
        const adapter = getAdapter<RadarrAdapter | SonarrAdapter | LidarrAdapter>(key);
        const record = (await adapter.getQueue()).find(q => q.downloadId?.toLowerCase() === hash);
        if (record) {
          const removed = await adapter.removeQueueItem(record.id.replace(/^queue-/, ''), true);
          return removed.success ? { success: true, message: 'That release was rejected and a new search has started.' } : removed;
        }
      } catch {
        // that service is offline: try the next one
      }
    }
  }
  return row.mediaId ? retryTitle(row.mediaId) : fail('Nothing links this download to a title, so it cannot be retried.');
}
