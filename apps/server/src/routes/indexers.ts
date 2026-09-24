import type { FastifyInstance } from 'fastify';
import type { ProwlarrAdapter, ProwlarrIndexerDefinition } from '@virtuallyview/integrations';
import { getAdapter } from '../services/registry.js';
import { getRequests } from '../services/requests.js';

type Health = { healthCheck: () => Promise<{ healthy: boolean }> };

let catalogCache: { at: number; items: ProwlarrIndexerDefinition[] } | null = null;

interface BulkState { state: 'idle' | 'running' | 'done' | 'failed'; total: number; checked: number; added: number; message?: string }
let bulk: BulkState = { state: 'idle', total: 0, checked: 0, added: 0 };

export default async function indexerRoutes(server: FastifyInstance) {
  const prowlarr = () => getAdapter('prowlarr') as unknown as ProwlarrAdapter;

  // Opt-in, and only when an administrator asks: every public, non-adult source
  // that answers a connection test. Nothing broad is ever added on its own.
  server.post('/api/indexers/enable-public', async (_request, reply) => {
    if (bulk.state === 'running') return reply.code(409).send({ message: 'Already adding sources.', ...bulk });
    let todo: string[];
    try {
      const have = new Set((await prowlarr().listIndexers()).map(i => i.definitionName));
      catalogCache = { at: Date.now(), items: await prowlarr().indexerCatalog() };
      todo = catalogCache.items.filter(d => d.privacy === 'public' && !d.adult && !have.has(d.definitionName)).map(d => d.definitionName);
    } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : 'Prowlarr is not reachable.' });
    }
    bulk = { state: 'running', total: todo.length, checked: 0, added: 0 };
    void (async () => {
      let next = 0;
      const worker = async () => {
        while (next < todo.length) {
          const name = todo[next++]!;
          try { if ((await prowlarr().addIndexer(name)).success) bulk.added++; } catch { /* one slow source must not stop the rest */ }
          bulk.checked++;
        }
      };
      try { await Promise.all(Array.from({ length: 4 }, worker)); bulk.state = 'done'; }
      catch (error) { bulk = { ...bulk, state: 'failed', message: error instanceof Error ? error.message : 'Stopped unexpectedly.' }; }
    })();
    return reply.code(202).send(bulk);
  });
  server.get('/api/indexers/enable-public/status', async () => bulk);

  server.get('/api/indexers', async (_request, reply) => {
    try {
      return { indexers: await prowlarr().listIndexers() };
    } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : 'Prowlarr is not reachable.' });
    }
  });

  // Public indexers only: they need no account. Private ones are added in Prowlarr with your own login.
  server.get<{ Querystring: { q?: string; adult?: string } }>('/api/indexers/catalog', async (request, reply) => {
    try {
      if (!catalogCache || Date.now() - catalogCache.at > 10 * 60_000) {
        catalogCache = { at: Date.now(), items: await prowlarr().indexerCatalog() };
      }
      const q = (request.query.q ?? '').trim().toLowerCase();
      // Adult sources are only sent when that section is opened on purpose.
      const adult = request.query.adult === '1';
      const pub = catalogCache.items.filter(d => d.privacy === 'public');
      const items = pub
        .filter(d => d.adult === adult)
        .filter(d => !q || `${d.name} ${d.description} ${d.language}`.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 60);
      return { indexers: items, totalPublic: pub.filter(d => !d.adult).length, totalAdult: pub.filter(d => d.adult).length };
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
    let failingNames: string[] = [];
    if (prowlarrUp) {
      try {
        const list = (await prowlarr().listIndexers()).filter(i => i.enabled);
        failingNames = list.filter(i => i.failingUntil).map(i => i.name);
        indexers = list.length - failingNames.length;
      } catch { indexers = -1; }
    }
    const items = [
      { id: 'services', label: 'Movies, TV and music services running', ok: radarr && sonarr && lidarr, detail: [!radarr && 'Movies', !sonarr && 'TV', !lidarr && 'Music'].filter(Boolean).length ? `Not running yet: ${[!radarr && 'Movies', !sonarr && 'TV', !lidarr && 'Music'].filter(Boolean).join(', ')}. On the server computer run: docker compose up -d` : 'All running', href: '/settings' },
      { id: 'downloader', label: 'Downloader running', ok: qbit, detail: qbit ? 'Ready to download' : 'Not running yet. On the server computer run: docker compose up -d', href: '/settings' },
      { id: 'indexers', label: 'Places to search', ok: indexers > 0, detail: !prowlarrUp ? 'The search service is not running yet. On the server computer run: docker compose up -d'
          : indexers > 0 ? `${indexers} place${indexers === 1 ? '' : 's'} to search`
          : failingNames.length ? `${failingNames.join(', ')} ${failingNames.length === 1 ? 'is' : 'are'} not answering right now. Press Choose more to add another place to search.`
          : 'Where the app looks for what you request. Press Set up for me and one is added.', href: '/settings?cat=indexers' },
      { id: 'request', label: 'Make your first request', ok: getRequests().length > 0, detail: 'Search for a title and request it', href: '/search' }
    ];
    return { items, complete: items.every(i => i.ok) };
  });
}
