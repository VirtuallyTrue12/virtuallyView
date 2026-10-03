import type { RadarrAdapter, SonarrAdapter, LidarrAdapter } from '@virtuallyview/integrations';
import { getAdapter } from './registry.js';

/**
 * Radarr, Sonarr and Lidarr only search for a title automatically in two cases: right when it is added,
 * and when RSS happens to see a brand-new release go up. Neither one ever retries a title that has been
 * sitting missing for a while (a search that found nothing, an indexer that was briefly down, a title
 * added before an indexer existed) - nothing asks again unless a person opens the app and presses search
 * by hand. This periodically asks each service to search everything it still has missing, the same
 * library-wide command "Search all missing" runs by hand, just on a schedule.
 *
 * A large backlog means a real burst of indexer traffic each time this runs; with the free VPN
 * profile, that traffic shares the same tunnel as the downloads themselves (see docs/privacy.md -
 * `SEARCH_VIA_VPN=false` routes search outside the tunnel instead). 12 hours keeps that burst
 * infrequent without leaving a title missing for long.
 */
const INTERVAL_MS = 12 * 3_600_000;

export async function runBacklogSearch(): Promise<void> {
  await Promise.allSettled([
    getAdapter<RadarrAdapter>('radarr').searchAllMissing(),
    getAdapter<SonarrAdapter>('sonarr').searchAllMissing(),
    getAdapter<LidarrAdapter>('lidarr').searchAllMissing()
  ]);
}

export function startBacklogSearch(): void {
  const tick = () => { void runBacklogSearch(); };
  setTimeout(tick, 5 * 60_000).unref();
  setInterval(tick, INTERVAL_MS).unref();
}
