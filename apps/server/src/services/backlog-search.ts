import type { RadarrAdapter, SonarrAdapter, LidarrAdapter } from '@virtuallyview/integrations';
import { getAdapter } from './registry.js';
import { getServerSettings } from './server-settings.js';

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
// Spread the three services out instead of firing them in the same instant: the actual indexer traffic
// happens inside each service over the following minutes regardless, but starting them apart keeps this
// job from being the single moment all three briefly compete for one shared tunnel at once.
const STAGGER_MS = 2 * 60_000;

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function runBacklogSearch(): Promise<void> {
  const services: Array<['radarr' | 'sonarr' | 'lidarr', () => Promise<unknown>]> = [
    ['radarr', () => getAdapter<RadarrAdapter>('radarr').searchAllMissing()],
    ['sonarr', () => getAdapter<SonarrAdapter>('sonarr').searchAllMissing()],
    ['lidarr', () => getAdapter<LidarrAdapter>('lidarr').searchAllMissing()]
  ];
  for (let i = 0; i < services.length; i++) {
    if (i > 0) await wait(STAGGER_MS);
    const [, run] = services[i]!;
    await run().catch(() => undefined);
  }
}

export function startBacklogSearch(): void {
  // Reuses the same "automatic repair" toggle the download doctor respects, rather than adding a second
  // on/off switch for what is, from an administrator's point of view, the same kind of background
  // behavior: the app searching and fixing things on its own without being asked each time.
  const tick = () => { if (getServerSettings().autoFixDownloads) void runBacklogSearch(); };
  setTimeout(tick, 5 * 60_000).unref();
  setInterval(tick, INTERVAL_MS).unref();
}
