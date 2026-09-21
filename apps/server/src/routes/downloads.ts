import type { FastifyInstance } from 'fastify';
import { actOnDownload, getDownloads, type DownloadAction } from '../services/real-downloads.js';
import { getRequests } from '../services/requests.js';
import { retryDownload } from '../services/retry.js';

export default async function downloadsRoutes(server: FastifyInstance) {
  server.get('/api/downloads', async (_request, reply) => {
    try {
      const rows = await getDownloads();
      // Link each queue row back to the request that caused it, so the Requests
      // and Downloads pages describe one and the same job.
      const requests = getRequests();
      return rows.map(row => {
        const req = row.mediaId
          ? requests.find(r => r.providerId === row.mediaId || r.selectedProviderId === row.mediaId)
          : undefined;
        return req ? { ...row, requestId: req.id } : row;
      });
    } catch (error) {
      return reply.code(503).send({ message: (error as Error).message });
    }
  });

  server.post<{ Params: { id: string } }>('/api/downloads/:id/retry', async (request, reply) => {
    const result = await retryDownload(request.params.id);
    return result.success ? { id: request.params.id, ...result } : reply.code(422).send(result);
  });

  for (const action of ['pause', 'resume', 'remove', 'delete-files'] as DownloadAction[]) {
    server.post<{ Params: { id: string } }>(`/api/downloads/:id/${action}`, async (request, reply) => {
      const { id } = request.params;
      const result = await actOnDownload(id, action);
      return result.success ? { id, ...result } : reply.code(422).send(result);
    });
  }
}
