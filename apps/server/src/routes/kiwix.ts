import type { FastifyInstance } from 'fastify';
import { clearKiwixConfig, kiwixStatus, saveKiwixConfig } from '../services/kiwix.js';

export default async function kiwixRoutes(server: FastifyInstance) {
  server.get('/api/kiwix/status', async () => kiwixStatus());

  server.post<{ Body: { url?: string } }>('/api/kiwix/config', async (request, reply) => {
    const url = (request.body?.url ?? '').trim();
    if (!url) { clearKiwixConfig(); return kiwixStatus(); }
    const result = saveKiwixConfig(url);
    if (!result.ok) return reply.code(400).send({ message: result.message });
    return kiwixStatus();
  });
}
