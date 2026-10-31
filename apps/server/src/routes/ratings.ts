import type { FastifyInstance } from 'fastify';
import { getThumb, setThumb, type Thumb } from '../services/user-flags.js';

/** Only movies and shows take a thumb. */
const RATABLE_TYPES = new Set(['movie', 'series']);

/** 1 for thumbs up, -1 for thumbs down, 0 to clear. Anything else is refused. */
export function parseThumb(value: unknown): Thumb | null {
  return value === 1 || value === -1 || value === 0 ? value : null;
}

export function isRatableType(mediaType: string): boolean {
  return RATABLE_TYPES.has(mediaType);
}

/** Per-user thumbs up and down on movies and shows. */
export default async function ratingRoutes(server: FastifyInstance) {
  server.get<{ Params: { mediaType: string; mediaId: string } }>('/api/ratings/:mediaType/:mediaId', async (request, reply) => {
    const { mediaType, mediaId } = request.params;
    if (!isRatableType(mediaType)) return reply.code(400).send({ message: 'Only movies and TV shows can be rated.' });
    return { mediaType, mediaId, thumb: getThumb(mediaType, mediaId) };
  });

  server.post<{ Params: { mediaType: string; mediaId: string }; Body: { thumb?: unknown } }>(
    '/api/ratings/:mediaType/:mediaId',
    async (request, reply) => {
      const { mediaType, mediaId } = request.params;
      if (!isRatableType(mediaType)) return reply.code(400).send({ message: 'Only movies and TV shows can be rated.' });
      if (!mediaId || mediaId.length > 200) return reply.code(400).send({ message: 'Unknown title.' });
      const thumb = parseThumb(request.body?.thumb);
      if (thumb === null) return reply.code(400).send({ message: 'Thumb must be 1 (up), -1 (down) or 0 (clear).' });
      return { mediaType, mediaId, thumb: setThumb(mediaType, mediaId, thumb) };
    }
  );
}
