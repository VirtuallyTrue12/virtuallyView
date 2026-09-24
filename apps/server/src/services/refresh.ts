import { clearBackdropCache } from './backdrop.js';
import { clearTrailerCache } from './trailers.js';
import { clearDlnaCache } from './dlna.js';
import { clearStorageCache } from './storage.js';
import { clearSearchCache } from './search-detect.js';
import { clearPlaylistCache } from './live-tv.js';
import { clearBioCache } from '../routes/people.js';
import { clearIndexerCatalogCache } from '../routes/indexers.js';
import { syncRequestsWithServices } from './requests.js';
import { loadServiceConfig } from './registry.js';

// "Refresh": forget what the server remembered for a few minutes so the next
// look at each page is fresh, and re-check the things that change on their own
// (requests, and for administrators the download queues) right now instead of
// at the next scheduled poll. Library data itself is never cached here: pages
// read it from Radarr, Sonarr and Lidarr each time.

const COOLDOWN_MS = 4000;
const lastByUser = new Map<string, number>();

/** Seconds to wait, or 0 when this person may refresh now. */
export function refreshWait(userId: string, now = Date.now()): number {
  const last = lastByUser.get(userId) ?? 0;
  if (now - last < COOLDOWN_MS) return Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
  lastByUser.set(userId, now);
  if (lastByUser.size > 500) for (const [id, at] of lastByUser) if (now - at > 60_000) lastByUser.delete(id);
  return 0;
}

const CLEARERS: Array<[string, () => void]> = [
  ['storage report', clearStorageCache],
  ['search suggestions', clearSearchCache],
  ['sign-in backdrop', clearBackdropCache],
  ['trailers', clearTrailerCache],
  ['cast devices', clearDlnaCache],
  ['live TV playlists', clearPlaylistCache],
  ['people', clearBioCache]
];

/** Asks Radarr, Sonarr and Lidarr to re-read their download queues now (they otherwise wait for their own timer). */
async function nudgeDownloadQueues(): Promise<string[]> {
  const nudged: string[] = [];
  const config = loadServiceConfig();
  await Promise.all([['radarr', 'v3'], ['sonarr', 'v3'], ['lidarr', 'v1']].map(async ([key, version]) => {
    const entry = config[key!];
    if (!entry?.url || !entry.apiKey || entry.enabled === false) return;
    try {
      const res = await fetch(`${entry.url.replace(/\/$/, '')}/api/${version}/command`, {
        method: 'POST', headers: { 'X-Api-Key': entry.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'RefreshMonitoredDownloads' }), signal: AbortSignal.timeout(3000)
      });
      if (res.ok) nudged.push(key!);
    } catch { /* an offline service is not a refresh failure */ }
  }));
  return nudged;
}

export interface RefreshResult { refreshedAt: string; cleared: string[]; requestsChecked: boolean; queuesNudged: string[] }

export async function refreshEverything(asAdmin: boolean): Promise<RefreshResult> {
  const cleared: string[] = [];
  for (const [label, clear] of CLEARERS) { try { clear(); cleared.push(label); } catch { /* keep going */ } }
  if (asAdmin) { clearIndexerCatalogCache(); cleared.push('indexer catalog'); }
  const [queuesNudged, requestsChecked] = await Promise.all([
    asAdmin ? nudgeDownloadQueues() : Promise.resolve([]),
    syncRequestsWithServices().then(() => true, () => false)
  ]);
  return { refreshedAt: new Date().toISOString(), cleared, requestsChecked, queuesNudged };
}
