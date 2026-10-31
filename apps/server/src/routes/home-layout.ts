import type { FastifyInstance } from 'fastify';
import { savedHomeLayout, saveHomeLayout } from '../services/home-layout.js';
import type { LayoutRow } from '../services/home-rails.js';

const MAX_RAILS = 60;
const RAIL_ID = /^[a-z0-9-]{1,80}$/;

/**
 * Check a PUT body: { rails: [{ id, hidden, position }] }. Returns null when it is not valid.
 * An empty list is valid and means "back to the default layout".
 */
export function parseLayout(body: unknown): LayoutRow[] | null {
  const rails = (body as { rails?: unknown } | null | undefined)?.rails;
  if (!Array.isArray(rails) || rails.length > MAX_RAILS) return null;
  const rows: LayoutRow[] = [];
  for (const raw of rails) {
    const row = raw as { id?: unknown; hidden?: unknown; position?: unknown } | null;
    if (!row || typeof row.id !== 'string' || !RAIL_ID.test(row.id)) return null;
    if (row.hidden !== undefined && typeof row.hidden !== 'boolean') return null;
    if (!Number.isInteger(row.position) || (row.position as number) < 0 || (row.position as number) > 999) return null;
    rows.push({ railId: row.id, hidden: row.hidden === true, position: row.position as number });
  }
  return rows;
}

/** Each viewer's home page order and hidden rails. */
export default async function homeLayoutRoutes(server: FastifyInstance) {
  server.get('/api/home-layout', async () => ({
    rails: savedHomeLayout().map(row => ({ id: row.railId, hidden: row.hidden, position: row.position }))
  }));

  server.put<{ Body: unknown }>('/api/home-layout', async (request, reply) => {
    const rows = parseLayout(request.body);
    if (!rows) return reply.code(400).send({ message: 'The home layout is not in the right shape.' });
    saveHomeLayout(rows);
    return { rails: rows.map(row => ({ id: row.railId, hidden: row.hidden, position: row.position })) };
  });
}
