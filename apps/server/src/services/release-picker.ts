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

/** Everything the search sources have for these words, best-seeded first. Dead torrents are left out. */
export async function searchReleases(query: string): Promise<ReleaseChoice[]> {
  const q = query.trim().slice(0, 200);
  if (q.length < 2) return [];
  const found = (await getAdapter<ProwlarrAdapter>('prowlarr').searchReleases(q))
    .filter(r => r.protocol === 'torrent' && (r.seeders > 0 || r.guid.startsWith('magnet:')) && r.size > 0)
    .sort((a, b) => b.seeders - a.seeders)
    .slice(0, 60);
  remember(found);
  return found.map(toChoice);
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
