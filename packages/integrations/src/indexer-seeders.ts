import { joinApiUrl } from './request-identity.js';

export interface MinimumSeedersResult { success: boolean; message: string; updated: number; skipped: number }

/**
 * Radarr, Sonarr and Lidarr all expose the same Indexer REST shape (they share the Servarr codebase):
 * a list of indexers, each with a `fields` array of {name, value} pairs. "Minimum Seeders" is one such
 * field on every torrent indexer, and setting it stops a dead release (no peers sharing it) from being
 * picked by an automatic grab in the first place - the manual release picker already sorts by seeders,
 * but an automatic request has no such control short of this.
 */
/** `apiRoot` differs by service: Radarr and Sonarr use `/api/v3`, Lidarr uses `/api/v1`. */
export async function setMinimumSeeders(config: { url: string; apiKey: string }, minimum: number, apiRoot: '/api/v3' | '/api/v1'): Promise<MinimumSeedersResult> {
  const headers = { 'X-Api-Key': config.apiKey, 'Content-Type': 'application/json' };
  let indexers: Array<{ id: number; protocol?: string; fields?: Array<{ name: string; value?: unknown }> }>;
  try {
    const res = await fetch(joinApiUrl(config.url, apiRoot, 'indexer'), { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { success: false, message: `Could not list indexers (HTTP ${res.status}).`, updated: 0, skipped: 0 };
    indexers = await res.json();
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Not reachable.', updated: 0, skipped: 0 };
  }
  let updated = 0;
  let skipped = 0;
  for (const indexer of indexers) {
    if (indexer.protocol !== 'torrent') continue;
    const field = indexer.fields?.find(f => f.name === 'minimumSeeders');
    if (!field) { skipped++; continue; }
    if (field.value === minimum) continue;
    field.value = minimum;
    try {
      // forceSave: a normal save re-tests the indexer live (a real connection to the indexer/Prowlarr),
      // which is fine for a person changing one field by hand but turns updating every indexer in a row
      // into a burst of live connection tests - the download source itself (often proxied through
      // Prowlarr) can rate-limit that and fail every save after the first few with an unrelated error.
      const put = await fetch(`${joinApiUrl(config.url, apiRoot, 'indexer', String(indexer.id))}?forceSave=true`, {
        method: 'PUT', headers, body: JSON.stringify(indexer), signal: AbortSignal.timeout(10_000)
      });
      if (put.ok) updated++; else skipped++;
    } catch {
      skipped++;
    }
  }
  return { success: true, message: `${updated} indexer${updated === 1 ? '' : 's'} set to a minimum of ${minimum} seeders; ${skipped} left as is.`, updated, skipped };
}
