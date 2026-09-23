import type { FastifyInstance } from 'fastify';
import { listApps, saveApp } from '../services/homelab-apps.js';

export default async function appsRoutes(server: FastifyInstance) {
  server.get('/api/apps', async () => ({ apps: await listApps() }));

  server.post<{ Params: { id: string }; Body: { url?: string; apiKey?: string } }>('/api/apps/:id/config', async (request, reply) => {
    const result = saveApp(request.params.id, request.body?.url ?? '', request.body?.apiKey);
    if (!result.ok) return reply.code(400).send({ message: result.message });
    return { apps: await listApps() };
  });
}
