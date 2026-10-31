import type { QueueEntry } from '../media/MusicProvider';
import type { LibraryTrack } from '../../lib/api';

/** A library track from the discovery routes, as an entry the player can queue. */
export function queueEntryOf(track: LibraryTrack): QueueEntry {
  return {
    track: { id: Number(track.trackId), title: track.title, quality: track.quality, durationMs: track.durationMs },
    albumTitle: track.albumTitle,
    artistTitle: track.artistTitle,
    albumId: track.albumId,
    artistId: track.artistId,
    cover: track.cover,
    ...(track.genre ? { genres: [track.genre] } : {})
  };
}
