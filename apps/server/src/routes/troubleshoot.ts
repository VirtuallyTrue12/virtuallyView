import type { FastifyInstance } from 'fastify';
import { helperAction } from '../services/host-helper.js';
import { RESTARTABLE, runTroubleshooting } from '../services/troubleshoot.js';

/** Administrators only (registered under the admin lists in index.ts): what is wrong, and a restart for what the helper can. */
export default async function troubleshootRoutes(server: FastifyInstance) {
  let inFlight: ReturnType<typeof runTroubleshooting> | undefined;
  server.get('/api/troubleshoot', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!inFlight) {
      inFlight = runTroubleshooting();
      void inFlight.then(() => { inFlight = undefined; }, () => { inFlight = undefined; });
    }
    try { return await inFlight; } catch { return reply.code(503).send({ message: 'The checks could not run. Try again in a moment.' }); }
  });

  server.post<{ Body: { service?: string } }>('/api/troubleshoot/restart', async (request, reply) => {
    const service = request.body?.service ?? '';
    if (!RESTARTABLE.has(service)) return reply.code(400).send({ error: 'bad_request', message: 'That cannot be restarted from here.' });
    const result = await helperAction(service, 'restart');
    return result.ok ? { ok: true, message: `Restarting ${service}. Give it a minute, then run the checks again.` } : reply.code(502).send({ error: 'helper_unavailable', message: result.message ?? 'The helper could not restart it.' });
  });
}
