import type { FastifyInstance } from 'fastify';
import { detectMediaKind, searchAll } from '../services/search-detect.js';
import { fetchWebCover } from '../services/web-covers.js';
import { getRequests, normalizeTitle } from '../services/requests.js';

/**
 * Search-side helpers for the redesigned search: kind auto-detection (movie /
 * TV show / artist / single song) and web cover lookup for results that have
 * no local artwork.
 */
interface Requestable { provider: string; providerId: string; title: string; year?: number; type: string }
interface RequestLike { id: string; status: string; title: string; year?: number; mediaType: string; metadataProvider?: string; selectedProviderId?: string }

/**
 * Marks each requestable result that already has a request, with that request's
 * state, so Search says "Requested, downloading" instead of offering the same
 * request again (and after a reload, not just in the session that made it).
 */
export function annotateWithRequests<T extends { movies: Requestable[]; series: Requestable[]; artists: Requestable[] }>(result: T, requests: RequestLike[]): T {
  const live = requests.filter(r => r.status !== 'cancelled');
  const mark = (c: Requestable) => {
    const found = live.find(r => r.mediaType === c.type && ((r.metadataProvider === c.provider && r.selectedProviderId === c.providerId) ||
      (normalizeTitle(r.title) === normalizeTitle(c.title) && (r.year ?? 0) === (c.year ?? 0))));
    return found ? { ...c, requestId: found.id, requestStatus: found.status } : c;
  };
  return { ...result, movies: result.movies.map(mark), series: result.series.map(mark), artists: result.artists.map(mark) };
}

export default async function searchRoutes(server: FastifyInstance) {
  server.get<{ Querystring: { q?: string } }>('/api/search/detect', async (request, reply) => {
    const query = (request.query.q ?? '').trim();
    if (!query) return reply.code(400).send({ error: 'bad_request', message: 'A search query is required.' });
    try {
      return await detectMediaKind(query);
    } catch (error) {
      return reply.code(502).send({
        error: 'detect_failed',
        message: error instanceof Error ? error.message : 'Could not classify that search query.'
      });
    }
  });

  // One call for the whole Search page: library hits, every request source, songs.
  server.get<{ Querystring: { q?: string } }>('/api/search/all', async (request, reply) => {
    const query = (request.query.q ?? '').trim();
    if (!query) return reply.code(400).send({ error: 'bad_request', message: 'A search query is required.' });
    try {
      return annotateWithRequests(await searchAll(query), getRequests());
    } catch (error) {
      return reply.code(502).send({ error: 'search_failed', message: error instanceof Error ? error.message : 'Search failed.' });
    }
  });

  server.get<{ Querystring: { q?: string } }>('/api/search/cover', async (request, reply) => {
    const query = (request.query.q ?? '').trim();
    if (!query) return reply.code(400).send({ error: 'bad_request', message: 'A search query is required.' });
    const cover = await fetchWebCover(query);
    if (!cover) return reply.code(404).send({ error: 'no_cover', message: 'No web cover found for that query.' });
    return { query, cover };
  });
}