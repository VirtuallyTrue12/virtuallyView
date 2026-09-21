import type { FastifyInstance } from 'fastify';
import {
  getWatchProgress, saveWatchProgress, clearWatchProgress, progressForLibrary
} from '../services/progress.js';
import { getAdapter } from '../services/registry.js';

const VALID_TYPES = new Set(['movie', 'series', 'artist', 'episode']);

export default async function progressRoutes(server: FastifyInstance) {
  server.get<{ Params: { mediaType: string; mediaId: string } }>(
    '/api/progress/:mediaType/:mediaId',
    async (request, reply) => {
      const { mediaType, mediaId } = request.params;
      if (!VALID_TYPES.has(mediaType)) {
        return reply.code(400).send({ message: 'Unknown media type. Use movie, series, artist or episode.' });
      }
      const progress = getWatchProgress(mediaType, mediaId);
      return progress ?? { mediaType, mediaId, positionSeconds: 0, durationSeconds: 0, percent: 0 };
    }
  );

  server.post<{ Params: { mediaType: string; mediaId: string }; Body: { positionSeconds?: number; durationSeconds?: number; seriesId?: string } }>(
    '/api/progress/:mediaType/:mediaId',
    async (request, reply) => {
      const { mediaType, mediaId } = request.params;
      if (!VALID_TYPES.has(mediaType)) {
        return reply.code(400).send({ message: 'Unknown media type. Use movie, series, artist or episode.' });
      }
      const position = Number(request.body?.positionSeconds) || 0;
      const duration = Number(request.body?.durationSeconds) || 0;
      const saved = saveWatchProgress(mediaType, mediaId, position, duration, typeof request.body?.seriesId === 'string' ? request.body.seriesId : undefined);
      return saved ?? { mediaType, mediaId, positionSeconds: 0, durationSeconds: 0, percent: 0 };
    }
  );

  server.delete<{ Params: { mediaType: string; mediaId: string } }>(
    '/api/progress/:mediaType/:mediaId',
    async (request, reply) => {
      const { mediaType, mediaId } = request.params;
      if (!VALID_TYPES.has(mediaType)) {
        return reply.code(400).send({ message: 'Unknown media type. Use movie, series, artist or episode.' });
      }
      clearWatchProgress(mediaType, mediaId);
      return { cleared: true };
    }
  );

  // Bulk resume positions for a library listing, so every card can paint its
  // watch progress without N round trips.
  server.get<{ Params: { mediaType: string } }>('/api/progress/library/:mediaType', async (request, reply) => {
    const { mediaType } = request.params;
    if (!VALID_TYPES.has(mediaType)) {
      return reply.code(400).send({ message: 'Unknown media type. Use movie, series, artist or episode.' });
    }
    const adapter = getAdapter(
      mediaType === 'movie' ? 'radarr' : mediaType === 'series' ? 'sonarr' : 'lidarr'
    );
    let items: Array<{ id: string }> = [];
    try {
      items = (await adapter.getItems()) as Array<{ id: string }>;
    } catch {
      // Unconfigured service: nothing has progress either.
    }
    const map = progressForLibrary(mediaType, items.map(i => i.id));
    return { mediaType, progress: Object.fromEntries(map) };
  });
}