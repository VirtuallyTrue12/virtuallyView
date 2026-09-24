import type { FastifyInstance } from 'fastify';
import { currentActor } from '../services/user-context.js';
import { refreshEverything, refreshWait } from '../services/refresh.js';

export default async function refreshRoutes(server: FastifyInstance) {
  // Any signed-in person may refresh: it only clears short-lived caches and
  // re-checks state. It is rate limited per person so it cannot be used to hammer the services.
  server.post('/api/refresh', async (_request, reply) => {
    const actor = currentActor();
    const wait = refreshWait(actor.userId);
    if (wait > 0) return reply.code(429).header('Retry-After', String(wait)).send({ error: 'too_soon', message: 'Just refreshed. Give it a moment.', retryAfter: wait });
    return refreshEverything(actor.role !== 'user');
  });
}
