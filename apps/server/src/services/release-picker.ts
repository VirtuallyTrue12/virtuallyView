import type { ProwlarrAdapter, ProwlarrRelease, QBittorrentAdapter } from '@virtuallyview/integrations';
import { getAdapter } from './registry.js';
import { releaseQualityLabel, cleanReleaseName } from './names.js';
import { classifyMusicVideo } from './music-videos.js';

/** Downloads picked by hand stay out of Radarr/Sonarr/Lidarr, under this qBittorrent category. */
export const MANUAL_CATEGORY = 'vv-manual';
/** Downloads the person said are a concert or a music video: filed under the artist whatever the name says. */
export const CONCERT_CATEGORY = 'vv-concerts';
export const VIDEO_CATEGORY = 'vv-videos';
export type FileAs = 'auto' | 'concert' | 'video' | 'none';

export interface ReleaseChoice {
  id: string;
  title: string;
  cleanTitle: string;
  indexer: string;
  sizeBytes: number;
  seeders: number;
  ageDays: number;
  quality: string;
  /** "Concerts" or "Videos" when it will be filed under an artist on its own. */
  filesUnder: 'Concerts' | 'Videos' | null;
}

const cache = new Map<string, { release: ProwlarrRelease; at: number }>();
const TTL_MS = 15 * 60_000;

function remember(list: ProwlarrRelease[]): void {
  const now = Date.now();
  for (const [key, value] of cache) if (now - value.at > TTL_MS) cache.delete(key);
  for (const release of list) cache.set(release.guid, { release, at: now });
  while (cache.size > 600) cache.delete(cache.keys().next().value as string);
}

export function toChoice(r: ProwlarrRelease): ReleaseChoice {
  return {
    id: r.guid, title: r.title, cleanTitle: cleanReleaseName(r.title), indexer: r.indexer, sizeBytes: r.size, seeders: r.seeders,
    ageDays: r.ageDays, quality: releaseQualityLabel(r.title), filesUnder: classifyMusicVideo(r.title)
  };
}

/** The significant (3+ letter) words in a search, for a loose relevance check against what came back. */
function significantWords(text: string): string[] {
  return text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length >= 3);
}

/**
 * How well a release matches the words actually searched for, independent of seeders: an indexer's own
 * search is fuzzy and sometimes returns results that only share one word with the query. 1 when every
 * significant word of the query appears in the title, scaling down as fewer do; a release matching none
 * of them is dropped outright rather than ranked low, since no amount of seeders makes it the right title.
 */
function relevance(title: string, queryWords: string[]): number {
  if (queryWords.length === 0) return 1;
  const titleWords = new Set(significantWords(title));
  const matched = queryWords.filter(w => titleWords.has(w)).length;
  return matched / queryWords.length;
}

/**
 * A release's rank: seeders dominate (the main driver of real download speed), a healthier swarm
 * (leechers actively trying to join, capped at the seeder count so a long-dead torrent with one
 * leftover seeder and hundreds of stale leechers cannot outrank a genuinely active one) adds a little,
 * and a newer release breaks a close tie, since a fresher encode is more often the cleaner one.
 */
function releaseScore(r: ProwlarrRelease): number {
  return r.seeders * 10 + Math.min(r.leechers, r.seeders) - Math.min(r.ageDays, 3650) / 3650;
}

/** Everything the search sources have for these words, best-matched and best-seeded first. Dead torrents and
 * off-topic results are left out. `skipped` names any source left out of this search for being unusually slow
 * (still used by the automatic background search) so the caller can say why, instead of it looking like a gap. */
export async function searchReleases(query: string): Promise<{ choices: ReleaseChoice[]; skipped: string[] }> {
  const q = query.trim().slice(0, 200);
  if (q.length < 2) return { choices: [], skipped: [] };
  const queryWords = significantWords(q);
  const { releases, skipped } = await getAdapter<ProwlarrAdapter>('prowlarr').searchReleases(q);
  const found = releases
    .filter(r => r.protocol === 'torrent' && (r.seeders > 0 || r.guid.startsWith('magnet:')) && r.size > 0)
    .filter(r => relevance(r.title, queryWords) > 0)
    .sort((a, b) => releaseScore(b) - releaseScore(a))
    .slice(0, 60);
  remember(found);
  return { choices: found.map(toChoice), skipped };
}

/** Starts one release from the last search. Only a release the server itself listed can be started. */
export async function grabRelease(id: string, fileAs: FileAs = 'auto'): Promise<{ success: boolean; message: string; filesUnder: 'Concerts' | 'Videos' | null }> {
  const entry = cache.get(id);
  if (!entry || Date.now() - entry.at > TTL_MS) return { success: false, message: 'That search is too old. Search again.', filesUnder: null };
  const { release } = entry;
  const detected = classifyMusicVideo(release.title);
  const filesUnder = fileAs === 'concert' ? 'Concerts' : fileAs === 'video' ? 'Videos' : fileAs === 'none' ? null : detected;
  const category = filesUnder === 'Concerts' ? CONCERT_CATEGORY : filesUnder === 'Videos' ? VIDEO_CATEGORY : MANUAL_CATEGORY;
  const qbit = getAdapter<QBittorrentAdapter>('qbittorrent');
  let result: { success: boolean; message: string };
  if (release.guid.startsWith('magnet:')) {
    result = await qbit.addMagnet(release.guid, category);
  } else {
    // The source's own download link: fetched here (the download client may not reach it), then handed over.
    const res = await fetch(release.downloadUrl, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location?.startsWith('magnet:')) result = await qbit.addMagnet(location, category);
    else if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > 5_000_000) return { success: false, message: 'The source did not give a usable torrent file.', filesUnder };
      result = await qbit.addTorrentFile(bytes, category);
    } else return { success: false, message: `The source answered ${res.status}. Try another release.`, filesUnder };
  }
  return { ...result, message: result.success ? (filesUnder ? `Downloading. It will be filed under the artist's ${filesUnder} when it finishes.` : 'Downloading. It appears in Downloads; it is not added to a library automatically.') : result.message, filesUnder };
}
