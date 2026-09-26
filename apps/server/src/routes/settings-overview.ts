import type { FastifyInstance } from 'fastify';
import { buildOverview } from '../services/settings-overview.js';
import { listChanges } from '../services/settings-history.js';

/** Administrators only (see ADMIN_ONLY_READ in index.ts). */
export default async function settingsOverviewRoutes(server: FastifyInstance) {
  server.get('/api/settings/overview', async () => buildOverview());
  server.get<{ Querystring: { limit?: string } }>('/api/settings/history', async request => ({ changes: listChanges(Number(request.query.limit) || 30) }));
}
