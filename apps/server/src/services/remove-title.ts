import type { RadarrAdapter, SonarrAdapter, LidarrAdapter } from '@virtuallyview/integrations';
import { deleteRequest, getRequest, getRequests, stopRequest } from './requests.js';
import { actOnDownload, getDownloads } from './real-downloads.js';

type Arr = RadarrAdapter | SonarrAdapter | LidarrAdapter;
const LOCAL_ID = /^(radarr|sonarr|lidarr)-\d+$/;
const REQUEST_ID = /^request-\d+$/;

/**
 * The library id behind an id from the dashboard. A title that is still being requested can appear in lists under its
 * request id ("request-110"); the media manager only knows "sonarr-3". Returns null when it never reached the media manager.
 */
export function libraryIdFor(id: string): { libraryId: string | null; requestIds: string[] } {
  const linked = (libraryId: string) => getRequests().filter(r => r.providerId === libraryId || r.selectedProviderId === libraryId).map(r => r.id);
  if (!REQUEST_ID.test(id)) return { libraryId: id, requestIds: linked(id) };
  const req = getRequest(id);
  const libraryId = [req?.providerId, req?.selectedProviderId].find((v): v is string => !!v && LOCAL_ID.test(v)) ?? null;
  return { libraryId, requestIds: [...new Set([id, ...(libraryId ? linked(libraryId) : [])])] };
}

/**
 * Take a title out of the library while it may still be downloading. Its transfers are stopped and removed from the
 * download client first (otherwise they keep running with nothing to import into), then the title is removed, then
 * the requests that pointed at it are dropped so it does not reappear as a "requested" placeholder.
 */
export interface RemoveDeps {
  downloads: () => Promise<Array<{ id: string; mediaId?: string; sourceClient: string }>>;
  act: (id: string, action: 'remove' | 'delete-files') => Promise<{ success: boolean; message: string }>;
}
const liveDeps: RemoveDeps = { downloads: getDownloads, act: actOnDownload };

export async function removeTitle(adapter: Arr, id: string, deleteFiles: boolean, deps: RemoveDeps = liveDeps): Promise<{ success: boolean; message: string }> {
  const { libraryId, requestIds } = libraryIdFor(id);
  let stopped = 0;
  // The media manager's own queue view is partial (it lists a page of rows), so also find the torrents
  // by the title they were matched to, before the title disappears and the match is lost.
  let torrents: string[] = [];
  if (libraryId) {
    try { torrents = (await deps.downloads()).filter(d => d.mediaId === libraryId && d.sourceClient === 'qbittorrent').map(d => d.id); } catch { /* the download client is unreachable */ }
  }
  if (libraryId) {
    try {
      const rows = (await adapter.getQueue()).filter(q => q.mediaId === libraryId);
      // Several rows can share one torrent; removing the same one twice is harmless.
      for (let i = 0; i < rows.length; i += 6) {
        const batch = await Promise.allSettled(rows.slice(i, i + 6).map(q => adapter.removeQueueItem(String(q.id).replace(/^queue-/, ''), false)));
        stopped += batch.filter(b => b.status === 'fulfilled' && b.value.success).length;
      }
    } catch { /* the queue could not be read: removing the title still goes ahead */ }
    const removed = await adapter.remove(libraryId, deleteFiles);
    if (!removed.success) return removed;
    // Whatever is still in the download client now belongs to nothing: stop it (and delete its partial files when asked).
    for (let i = 0; i < torrents.length; i += 6) {
      const batch = await Promise.allSettled(torrents.slice(i, i + 6).map(t => deps.act(t, deleteFiles ? 'delete-files' : 'remove')));
      stopped += batch.filter(b => b.status === 'fulfilled' && b.value.success).length;
    }
  } else {
    // Never reached the media manager: only the request exists.
    for (const rid of requestIds) await stopRequest(rid).catch(() => null);
  }
  for (const rid of requestIds) deleteRequest(rid);
  return { success: true, message: stopped ? `Removed, and ${stopped} download${stopped === 1 ? '' : 's'} stopped.` : 'Removed.' };
}
