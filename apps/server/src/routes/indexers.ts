import type { FastifyInstance } from 'fastify';
import type { ProwlarrAdapter, ProwlarrIndexerDefinition } from '@virtuallyview/integrations';
import { getAdapter } from '../services/registry.js';
import { getRequests } from '../services/requests.js';

type Health = { healthCheck: () => Promise<{ healthy: boolean }> };

let catalogCache: { at: number; items: ProwlarrIndexerDefinition[] } | null = null;

export default async function indexerRoutes(server: FastifyInstance) {
  const prowlarr = () => getAdapter('prowlarr') as unknown as ProwlarrAdapter;

  server.get('/api/indexers', async (_request, reply) => {
    try {
      return { indexers: await prowlarr().listIndexers() };
    } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : 'Prowlarr is not reachable.' });
    }
  });

  // Public indexers only: they need no account. Private ones are added in Prowlarr with your own login.
  server.get<{ Querystring: { q?: string } }>('/api/indexers/catalog', async (request, reply) => {
    try {
      if (!catalogCache || Date.now() - catalogCache.at > 10 * 60_000) {
        catalogCache = { at: Date.now(), items: await prowlarr().indexerCatalog() };
      }
      const q = (request.query.q ?? '').trim().toLowerCase();
      const items = catalogCache.items
        .filter(d => d.privacy === 'public')
        .filter(d => !q || `${d.name} ${d.description} ${d.language}`.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 60);
      return { indexers: items, totalPublic: catalogCache.items.filter(d => d.privacy === 'public').length };
    } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : 'Prowlarr is not reachable.' });
    }
  });

  server.post<{ Body: { definitionName?: string } }>('/api/indexers', async (request, reply) => {
    const name = request.body?.definitionName;
    if (!name) return reply.code(400).send({ message: 'Choose an indexer.' });
    try {
      const result = await prowlarr().addIndexer(name);
      return result.success ? result : reply.code(422).send(result);
    } catch (error) {
      return reply.code(502).send({ success: false, message: error instanceof Error ? error.message : 'Prowlarr is not reachable.' });
    }
  });

  server.post<{ Params: { id: string } }>('/api/indexers/:id/test', async (request, reply) => {
    try {
      const result = await prowlarr().testIndexer(Number(request.params.id));
      return result.success ? result : reply.code(422).send(result);
    } catch (error) {
      return reply.code(502).send({ success: false, message: error instanceof Error ? error.message : 'Prowlarr is not reachable.' });
    }
  });

  server.delete<{ Params: { id: string } }>('/api/indexers/:id', async (request, reply) => {
    try {
      const result = await prowlarr().removeIndexer(Number(request.params.id));
      return result.success ? result : reply.code(422).send(result);
    } catch (error) {
      return reply.code(502).send({ success: false, message: error instanceof Error ? error.message : 'Prowlarr is not reachable.' });
    }
  });

  // First-run checklist: the things that make "request a movie" actually deliver a movie.
  server.get('/api/setup/status', async () => {
    const up = async (key: string) => { try { return (await (getAdapter(key) as unknown as Health).healthCheck()).healthy; } catch { return false; } };
    const [radarr, sonarr, lidarr, prowlarrUp, qbit] = await Promise.all(['radarr', 'sonarr', 'lidarr', 'prowlarr', 'qbittorrent'].map(up));
    let indexers = -1;
    if (prowlarrUp) { try { indexers = (await prowlarr().listIndexers()).filter(i => i.enabled).length; } catch { indexers = -1; } }
    const items = [
      { id: 'services', label: 'Movies, TV and music services running', ok: radarr && sonarr && lidarr, detail: [!radarr && 'Movies', !sonarr && 'TV', !lidarr && 'Music'].filter(Boolean).length ? `Not running yet: ${[!radarr && 'Movies', !sonarr && 'TV', !lidarr && 'Music'].filter(Boolean).join(', ')}. On the server computer run: docker compose up -d` : 'All running', href: '/settings' },
      { id: 'downloader', label: 'Downloader running', ok: qbit, detail: qbit ? 'Ready to download' : 'Not running yet. On the server computer run: docker compose up -d', href: '/settings' },
      { id: 'indexers', label: 'Places to search', ok: indexers > 0, detail: !prowlarrUp ? 'The search service is not running yet. On the server computer run: docker compose up -d' : indexers > 0 ? `${indexers} place${indexers === 1 ? '' : 's'} to search` : 'Where the app looks for what you request. Press Set up for me and one is added.', href: '/settings?cat=indexers' },
      { id: 'request', label: 'Make your first request', ok: getRequests().length > 0, detail: 'Search for a title and request it', href: '/search' }
    ];
    return { items, complete: items.every(i => i.ok) };
  });
}
