import { api, type MediaItem } from './api';
import type { QueueEntry } from '../components/media/MusicProvider';

function shuffled<T>(list: T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

/** Every playable track of one artist, in random order, ready for the player queue. */
export async function artistMix(artist: Pick<MediaItem, 'id' | 'title' | 'artwork'>, limit = 40): Promise<QueueEntry[]> {
  const { tracks } = await api.artistTracks(artist.id);
  return shuffled(tracks.filter(t => t.hasFile)).slice(0, limit).map(track => ({
    track: { id: track.id, title: track.title, quality: track.quality, durationMs: track.durationMs },
    artistTitle: artist.title,
    cover: artist.artwork?.poster
  }));
}

/** A few tracks from each of several random artists, mixed together. */
export async function libraryMix(artists: MediaItem[], artistCount = 6, perArtist = 6): Promise<QueueEntry[]> {
  const pool = shuffled(artists.filter(a => a.status === 'available' && /^lidarr-/.test(a.id))).slice(0, artistCount);
  const parts = await Promise.all(pool.map(a => artistMix(a, perArtist).catch(() => [] as QueueEntry[])));
  return shuffled(parts.flat());
}
