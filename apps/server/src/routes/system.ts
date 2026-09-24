import type { FastifyInstance } from 'fastify';
import { getStorageReport } from '../services/storage.js';
import { currentActor } from '../services/user-context.js';

/**
 * Server/device storage facts. The Statistics page reads real folder sizes and
 * filesystem capacity here instead of guessing from in-flight download rows,
 * which is why "data stored on device" used to show 0 GB.
 */
export default async function systemRoutes(server: FastifyInstance) {
  server.get('/api/system/storage', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const report = await getStorageReport();
    // Sizes are for everyone; folder locations are for administrators.
    return currentActor().role === 'user' ? { ...report, roots: report.roots.map(root => ({ ...root, path: '' })) } : report;
  });
}
