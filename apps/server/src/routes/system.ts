import type { FastifyInstance } from 'fastify';
import { getStorageReport } from '../services/storage.js';
import { currentActor } from '../services/user-context.js';
import { hostAddresses } from '../services/stream-token.js';
import { disks, forgetTitle, getPlan, SUGGEST_DAYS } from '../services/storage-planner.js';
import { removeTitle } from '../services/remove-title.js';
import { getAdapter } from '../services/registry.js';
import { videoHardwareReport } from '../services/transcode.js';

/**
 * Server/device storage facts. The Statistics page reads real folder sizes and
 * filesystem capacity here instead of guessing from in-flight download rows,
 * which is why "data stored on device" used to show 0 GB.
 */
export default async function systemRoutes(server: FastifyInstance) {
  // The addresses this computer has on the home network (and Tailscale), for opening the dashboard on a phone or TV.
  server.get('/api/system/addresses', async () => hostAddresses());

  // Which chip converts video and whether HDR is tone mapped, for the admin's Settings page.
  server.get('/api/system/video', async (_request, reply) => {
    if (currentActor().role === 'user') return reply.code(403).send({ error: 'forbidden', message: 'Only an administrator can see this.' });
    return videoHardwareReport();
  });

  server.get('/api/system/storage', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const report = await getStorageReport();
    // Sizes are for everyone; folder locations are for administrators.
    return currentActor().role === 'user' ? { ...report, roots: report.roots.map(root => ({ ...root, path: '' })) } : report;
  });

  // The storage planner shows the whole household's data and can delete files, so it is for administrators only.
  server.get<{ Querystring: { days?: string } }>('/api/system/storage/plan', async (request, reply) => {
    if (currentActor().role === 'user') return reply.code(403).send({ error: 'forbidden', message: 'Only an administrator can see this.' });
    reply.header('Cache-Control', 'no-store');
    const days = Math.min(3650, Math.max(1, Math.floor(Number(request.query.days)) || SUGGEST_DAYS));
    return { disks: await disks(), ...getPlan(days) };
  });

  // Deleting goes through Radarr or Sonarr with its files, so they do not download it again.
  server.post<{ Body: { id?: string } }>('/api/system/storage/delete', async (request, reply) => {
    if (currentActor().role === 'user') return reply.code(403).send({ error: 'forbidden', message: 'Only an administrator can delete files.' });
    const id = request.body?.id;
    const service = typeof id === 'string' ? /^(radarr|sonarr)-\d+$/.exec(id)?.[1] : undefined;
    if (!id || !service) return reply.code(400).send({ error: 'bad_request', message: 'Choose a movie or show.' });
    try {
      const result = await removeTitle(getAdapter(service) as unknown as Parameters<typeof removeTitle>[0], id, true);
      if (!result.success) return reply.code(422).send(result);
      forgetTitle(id);
      return { success: true, message: result.message };
    } catch (error) {
      return reply.code(502).send({ success: false, message: error instanceof Error ? error.message : 'Could not delete it.' });
    }
  });
}
