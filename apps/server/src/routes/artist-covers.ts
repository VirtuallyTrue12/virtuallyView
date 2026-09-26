import type { FastifyInstance } from 'fastify';
import type { Media } from '@virtuallyview/types';
import type { LidarrAdapter } from '@virtuallyview/integrations';
import { getAdapter } from '../services/registry.js';
import { run } from '../db/app-db.js';
import { gatherCoverCandidates, getArtistCover, chooseArtistCover, saveArtistCovers, servedCover, type ArtistCoverCandidate } from '../services/artist-covers.js';
import { findMoreArtwork } from '../services/artist-artwork.js';

/**
 * Artist artwork picker. Returns a handful of real cover candidates (Lidarr
 * artwork, MusicBrainz release covers, Wikipedia) and lets the user fix the
 * chosen one server-side so every device agrees on the cover.
 */
export default async function artistCoversRoutes(server: FastifyInstance) {
  const lidarr = getAdapter<LidarrAdapter>('lidarr');

  async function resolveArtist(id: string): Promise<Media & { musicBrainzId?: string; images?: string[] } | null> {
    try {
      const items = await lidarr.getItems();
      const found = items.find(a => a.id === id || a.provider?.id === Number(id.replace(/^lidarr-/, '')));
      return found as Media & { musicBrainzId?: string; images?: string[] } | null;
    } catch {
      return null;
    }
  }

  async function lidarrImagesOf(id: string) {
    try { return await lidarr.getArtistImages(id); } catch { return []; }
  }

  // Pictures are shown through this server, so the browser never contacts the image sites.
  const withPreview = (c: ArtistCoverCandidate) => ({ ...c, preview: servedCover(c.url) });

  server.post<{ Params: { id: string } }>('/api/artists/:id/covers/more', async (request, reply) => {
    const { id } = request.params;
    const artist = await resolveArtist(id);
    if (!artist) return reply.code(404).send({ error: 'not_found', message: `No artist found with id "${id}".` });
    const mbid = (artist.provider?.metadata as { foreignArtistId?: string } | undefined)?.foreignArtistId;
    const found = await findMoreArtwork(artist.title, { mbid });
    const saved = getArtistCover(id);
    const existing = saved?.covers ?? [];
    const fresh = found.filter(c => !existing.some(e => e.url === c.url));
    saveArtistCovers(id, [...existing, ...fresh], saved?.chosen);
    return { artistId: id, added: fresh.length, candidates: [...existing, ...fresh].map(withPreview), chosen: saved?.chosen ?? null };
  });

  server.get<{ Params: { id: string } }>('/api/artists/:id/covers', async (request, reply) => {
    const { id } = request.params;
    const artist = await resolveArtist(id);
    if (!artist) {
      return reply.code(404).send({ error: 'not_found', message: `No artist found with id "${id}".` });
    }
    const result = await gatherCoverCandidates(id, artist.title, await lidarrImagesOf(id));
    const saved = getArtistCover(id);
    return {
      artistId: id,
      title: artist.title,
      candidates: result.candidates.map(withPreview),
      chosen: result.chosen ?? saved?.chosen ?? null
    };
  });

  server.post<{ Params: { id: string }; Body: { url?: string } }>('/api/artists/:id/covers', async (request, reply) => {
    const { id } = request.params;
    const { url } = request.body ?? {};
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return reply.code(400).send({ error: 'bad_request', message: 'A cover URL is required.' });
    }
    const existing = getArtistCover(id);
    if (!existing || !existing.covers.some(c => c.url === url)) {
      return reply.code(422).send({ error: 'unknown_cover', message: 'That cover is not in the candidate list for this artist.' });
    }
    const candidates = chooseArtistCover(id, url);
    return { artistId: id, chosen: url, candidates };
  });

  server.delete<{ Params: { id: string } }>('/api/artists/:id/covers', async (request, reply) => {
    const { id } = request.params;
    const existing = getArtistCover(id);
    if (!existing) {
      return reply.code(404).send({ error: 'not_found', message: 'No cover choice saved for this artist.' });
    }
    run('UPDATE artist_covers SET chosen = NULL WHERE artist_id = ?', id);
    return { artistId: id, chosen: null };
  });
}