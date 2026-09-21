import type { FastifyInstance } from 'fastify';
import { getFlags, setFlags } from '../services/user-flags.js';
import { getAdapter } from '../services/registry.js';

const TYPES = new Set(['movie', 'series', 'artist', 'episode']);

/** Per-user favorites ("My List") and watched marks. */
export default async function userDataRoutes(server: FastifyInstance) {
  server.get<{ Params: { mediaType: string; mediaId: string } }>('/api/me/flags/:mediaType/:mediaId', async (request, reply) => {
    const { mediaType, mediaId } = request.params;
    if (!TYPES.has(mediaType)) return reply.code(400).send({ message: 'Unknown media type.' });
    return getFlags(mediaType, mediaId);
  });

  server.post<{ Params: { mediaType: string; mediaId: string }; Body: { favorite?: boolean; watched?: boolean } }>(
    '/api/me/flags/:mediaType/:mediaId',
    async (request, reply) => {
      const { mediaType, mediaId } = request.params;
      if (!TYPES.has(mediaType)) return reply.code(400).send({ message: 'Unknown media type.' });
      const patch: { favorite?: boolean; watched?: boolean } = {};
      if (typeof request.body?.favorite === 'boolean') patch.favorite = request.body.favorite;
      if (typeof request.body?.watched === 'boolean') patch.watched = request.body.watched;
      return setFlags(mediaType, mediaId, patch);
    }
  );

  // "Scan library": ask each media manager to rescan disk and refresh metadata.
  server.post<{ Body: { types?: string[] } }>('/api/library/scan', async request => {
    const wanted = new Set(request.body?.types ?? ['movie', 'series', 'artist']);
    const targets = [['movie', 'radarr', 'Movies'], ['series', 'sonarr', 'TV'], ['artist', 'lidarr', 'Music']] as const;
    const results: Array<{ library: string; success: boolean; message: string }> = [];
    for (const [type, key, label] of targets) {
      if (!wanted.has(type)) continue;
      try {
        const adapter = getAdapter(key) as unknown as { scanLibrary?: () => Promise<{ success: boolean; message: string }> };
        results.push({ library: label, ...(await (adapter.scanLibrary?.() ?? Promise.resolve({ success: false, message: 'Not supported.' }))) });
      } catch (error) {
        results.push({ library: label, success: false, message: error instanceof Error ? error.message : 'Service unavailable.' });
      }
    }
    return { results };
  });
}
