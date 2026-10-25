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
export async function artistMix(artist: Pick<MediaItem, 'id' | 'title' | 'artwork' | 'genres'>, limit = 40): Promise<QueueEntry[]> {
  const { tracks } = await api.artistTracks(artist.id);
  return shuffled(tracks.filter(t => t.hasFile)).slice(0, limit).map(track => ({
    track: { id: track.id, title: track.title, quality: track.quality, durationMs: track.durationMs },
    artistTitle: artist.title,
    cover: artist.artwork?.poster,
    ...(artist.genres?.length ? { genres: artist.genres } : {})
  }));
}

/** A few tracks from each of several random artists, mixed together. */
/**
 * A shuffle across the whole music library, like a streaming app's: up to 40 artists, 25 tracks each, fetched a few
 * at a time so a big library does not flood the server. The caller spreads it so one artist never plays twice in a
 * row (MusicProvider.shufflePlay).
 */
export async function libraryMix(artists: MediaItem[], artistCount = 40, perArtist = 25): Promise<QueueEntry[]> {
  const pool = shuffled(artists.filter(a => a.status === 'available' && /^lidarr-/.test(a.id))).slice(0, artistCount);
  const parts: QueueEntry[][] = [];
  for (let i = 0; i < pool.length; i += 4) {
    // (Not push(...await ...): the legacy-browser build cannot compile a spread of an await.)
    const batch = await Promise.all(pool.slice(i, i + 4).map(a => artistMix(a, perArtist).catch(() => [] as QueueEntry[])));
    for (const b of batch) parts.push(b);
  }
  return parts.flat();
}
