/**
 * Every playable track in the music library, with its artist, album, genre and year.
 * Built from Lidarr and kept for a few minutes, because it takes one request per artist.
 */
import type { LidarrAdapter } from '@virtuallyview/integrations';
import { getAdapter } from './registry.js';
import type { CatalogTrack } from './music-mixes.js';

const TTL_MS = 10 * 60 * 1000;
const CONCURRENCY = 4;

let cached: { at: number; tracks: CatalogTrack[] } | null = null;

export async function libraryCatalog(): Promise<CatalogTrack[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.tracks;
  const lidarr = getAdapter<LidarrAdapter>('lidarr');
  const artists = await lidarr.getItems();
  const tracks: CatalogTrack[] = [];

  let next = 0;
  const worker = async () => {
    while (next < artists.length) {
      const artist = artists[next++]!;
      const numeric = artist.id.replace(/^lidarr-/, '');
      if (!/^\d+$/.test(numeric)) continue;
      try {
        const [albums, songs] = await Promise.all([lidarr.getAlbums(numeric), lidarr.getTracks(numeric)]);
        const albumById = new Map(albums.map(a => [Number(a.id), a]));
        const genre = artist.genres?.[0];
        for (const song of songs) {
          if (!song.hasFile) continue;
          const album = albumById.get(Number(song.albumId));
          const year = album?.releaseDate ? Number(album.releaseDate.slice(0, 4)) : NaN;
          tracks.push({
            trackId: String(song.id),
            title: song.title,
            artistId: artist.id,
            artistTitle: artist.title,
            albumId: album ? `album-${album.id}` : undefined,
            albumTitle: album?.title,
            genre,
            ...(Number.isFinite(year) ? { year } : {}),
            cover: album?.artwork?.cover,
            durationMs: song.durationMs,
            quality: song.quality
          });
        }
      } catch {
        // One artist that fails to load is left out; the rest of the library still counts.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, artists.length) }, worker));
  cached = { at: Date.now(), tracks };
  return tracks;
}
