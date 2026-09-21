import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { all as dbAll, get as dbGet, run as dbRun } from '../db/app-db.js';

export interface PlaylistTrack {
  trackId: string;
  title: string;
  artistTitle?: string;
  albumTitle?: string;
  /** Library-safe album id (album-<n>) so the track can link back. */
  albumId?: string;
  cover?: string;
  quality?: string;
  durationMs?: number;
}

export interface Playlist {
  id: string;
  name: string;
  tracks: PlaylistTrack[];
  createdAt: string;
  updatedAt: string;
}

interface PlaylistRow {
  id: string;
  name: string;
  tracks: string;
  created_at: string;
  updated_at: string;
}

function rowToPlaylist(row: PlaylistRow): Playlist {
  let tracks: PlaylistTrack[] = [];
  try {
    const parsed = JSON.parse(row.tracks);
    if (Array.isArray(parsed)) tracks = parsed as PlaylistTrack[];
  } catch {
    // A corrupt row keeps its name but shows no tracks rather than crashing.
  }
  return {
    id: row.id,
    name: row.name,
    tracks,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function save(id: string, name: string, tracks: PlaylistTrack[]): Playlist {
  const updatedAt = new Date().toISOString();
  dbRun(
    'UPDATE playlists SET name = ?, tracks = ?, updated_at = ? WHERE id = ?',
    name,
    JSON.stringify(tracks),
    updatedAt,
    id
  );
  return { id, name, tracks, createdAt: updatedAt, updatedAt };
}

export default async function playlistRoutes(server: FastifyInstance) {
  server.get('/api/playlists', async () => {
    const rows = dbAll<PlaylistRow>('SELECT * FROM playlists ORDER BY updated_at DESC');
    return rows.map(rowToPlaylist);
  });

  server.get<{ Params: { id: string } }>('/api/playlists/:id', async (request, reply) => {
    const row = dbGet<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', request.params.id);
    if (!row) {
      return reply.code(404).send({ error: 'not_found', message: `No playlist found with id "${request.params.id}".` });
    }
    return rowToPlaylist(row);
  });

  server.post<{ Body: { name?: string } }>('/api/playlists', async (request, reply) => {
    const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
    if (!name) {
      return reply.code(400).send({ error: 'bad_request', message: 'A playlist name is required.' });
    }
    if (name.length > 80) {
      return reply.code(400).send({ error: 'bad_request', message: 'Playlist names must be 80 characters or fewer.' });
    }
    const id = `playlist-${randomUUID()}`;
    const now = new Date().toISOString();
    dbRun('INSERT INTO playlists (id, name, tracks, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', id, name, '[]', now, now);
    return { id, name, tracks: [], createdAt: now, updatedAt: now } satisfies Playlist;
  });

  server.patch<{ Params: { id: string }; Body: { name?: string } }>('/api/playlists/:id', async (request, reply) => {
    const row = dbGet<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', request.params.id);
    if (!row) {
      return reply.code(404).send({ error: 'not_found', message: `No playlist found with id "${request.params.id}".` });
    }
    const name = typeof request.body?.name === 'string' ? request.body.name.trim() : row.name;
    if (!name || name.length > 80) {
      return reply.code(400).send({ error: 'bad_request', message: 'Playlist names must be 1 to 80 characters.' });
    }
    return save(row.id, name, rowToPlaylist(row).tracks);
  });

  server.delete<{ Params: { id: string } }>('/api/playlists/:id', async (request, reply) => {
    const result = dbRun('DELETE FROM playlists WHERE id = ?', request.params.id);
    if (Number(result.changes) === 0) {
      return reply.code(404).send({ error: 'not_found', message: `No playlist found with id "${request.params.id}".` });
    }
    return { success: true, id: request.params.id };
  });

  // Add one track snapshot. Duplicates are dropped: a track belongs to a
  // playlist once, and adding it again moves it to the end.
  server.post<{ Params: { id: string }; Body: { track?: PlaylistTrack } }>(
    '/api/playlists/:id/tracks',
    async (request, reply) => {
      const row = dbGet<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', request.params.id);
      if (!row) {
        return reply.code(404).send({ error: 'not_found', message: `No playlist found with id "${request.params.id}".` });
      }
      const track = request.body?.track;
      if (!track || typeof track.trackId !== 'string' || !track.trackId || typeof track.title !== 'string' || !track.title.trim()) {
        return reply.code(400).send({ error: 'bad_request', message: 'A valid track is required to add to a playlist.' });
      }
      const playlist = rowToPlaylist(row);
      const without = playlist.tracks.filter(t => t.trackId !== track.trackId);
      return save(row.id, row.name, [...without, track]);
    }
  );

  server.delete<{ Params: { id: string; trackId: string } }>(
    '/api/playlists/:id/tracks/:trackId',
    async (request, reply) => {
      const row = dbGet<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', request.params.id);
      if (!row) {
        return reply.code(404).send({ error: 'not_found', message: `No playlist found with id "${request.params.id}".` });
      }
      const playlist = rowToPlaylist(row).tracks.filter(t => t.trackId !== request.params.trackId);
      return save(row.id, row.name, playlist);
    }
  );
}