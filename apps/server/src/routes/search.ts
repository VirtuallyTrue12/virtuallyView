import type { FastifyInstance } from 'fastify';
import { detectMediaKind, searchAll } from '../services/search-detect.js';
import { fetchWebCover } from '../services/web-covers.js';

/**
 * Search-side helpers for the redesigned search: kind auto-detection (movie /
 * TV show / artist / single song) and web cover lookup for results that have
 * no local artwork.
 */
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
      return await searchAll(query);
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