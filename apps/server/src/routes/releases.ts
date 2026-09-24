import type { FastifyInstance } from 'fastify';
import { grabRelease, searchReleases, type FileAs } from '../services/release-picker.js';

/** Pick a release by hand: search every source with your own words, then start the one you want. Administrators only. */
export default async function releaseRoutes(server: FastifyInstance) {
  server.get<{ Querystring: { q?: string } }>('/api/releases/search', async (request, reply) => {
    const q = (request.query.q ?? '').trim();
    if (q.length < 2) return reply.code(400).send({ error: 'bad_request', message: 'Type at least two letters to search.' });
    try { return { query: q, releases: await searchReleases(q) }; } catch (error) {
      return reply.code(502).send({ error: 'search_unavailable', message: error instanceof Error ? error.message : 'Search is not available.' });
    }
  });

  server.post<{ Body: { id?: string; fileAs?: string } }>('/api/releases/grab', async (request, reply) => {
    const id = request.body?.id;
    if (!id || typeof id !== 'string' || id.length > 2000) return reply.code(400).send({ error: 'bad_request', message: 'Choose a release.' });
    const fileAs: FileAs = request.body?.fileAs === 'concert' || request.body?.fileAs === 'video' || request.body?.fileAs === 'none' ? request.body.fileAs : 'auto';
    try {
      const result = await grabRelease(id, fileAs);
      return result.success ? { ok: true, message: result.message, filesUnder: result.filesUnder } : reply.code(502).send({ error: 'grab_failed', message: result.message });
    } catch (error) {
      return reply.code(502).send({ error: 'grab_failed', message: error instanceof Error ? error.message : 'Could not start it.' });
    }
  });
}
