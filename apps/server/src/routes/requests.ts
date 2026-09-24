import type { FastifyInstance } from 'fastify';
import { getDownloads } from '../services/real-downloads.js';
import { getAdapter } from '../services/registry.js';
import { getServerSettings } from '../services/server-settings.js';
import { currentActor } from '../services/user-context.js';
import { createRequest, getRequests, getRequest, approveRequest, cancelRequest, stopRequest, deleteRequest, lookupCandidates, type MediaKind, type CreateRequestInput } from '../services/requests.js';

/** Administrators manage every request; everyone else only their own. */
function mayManage(id: string): boolean {
  const actor = currentActor();
  if (actor.role !== 'user') return true;
  const req = getRequest(id);
  return !!req && req.requesterId === actor.userId;
}

export default async function requestsRoutes(server: FastifyInstance) {
  server.get<{ Querystring: { page?: string; limit?: string } }>('/api/requests', async request => {
    const page = Math.max(1, Number(request.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 50)));
    const all = getRequests();
    const start = (page - 1) * limit;
    const pageItems = all.slice(start, start + limit);
    // Live queue state per request (progress, speed, ETA) from the same source
    // the Downloads page reads, so both pages always agree.
    let rows: Awaited<ReturnType<typeof getDownloads>> = [];
    if (pageItems.some(r => ['searching', 'downloading', 'importing'].includes(r.status))) {
      rows = await getDownloads().catch(() => []);
    }
    const items = pageItems.map(r => {
      const mine = rows.filter(d => d.mediaId && (d.mediaId === r.providerId || d.mediaId === r.selectedProviderId));
      if (!mine.length) return r;
      const progress = Math.round(mine.reduce((sum, d) => sum + (d.progress ?? 0), 0) / mine.length);
      const active = mine.find(d => d.status === 'downloading') ?? mine[0];
      return {
        ...r,
        download: { count: mine.length, progress, status: active.status, speed: active.speed, eta: active.eta, size: active.size, sourceClient: active.sourceClient }
      };
    });
    return { items, page, limit, total: all.length, hasMore: start + limit < all.length };
  });

  server.get<{ Querystring: { title?: string; mediaType?: MediaKind } }>('/api/requests/candidates', async (request, reply) => {
    const { title, mediaType = 'movie' } = request.query;
    if (typeof title !== 'string' || !title.trim() || !['movie', 'series', 'artist'].includes(mediaType)) {
      reply.code(400);
      return { ok: false, message: 'Provide a title and choose movie, series or artist.' };
    }
    try {
      return { candidates: await lookupCandidates(title, mediaType) };
    } catch (error) {
      reply.code(502);
      return { ok: false, message: error instanceof Error ? error.message : 'Metadata lookup failed. Nothing was added.' };
    }
  });

  server.get('/api/requests/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const item = getRequest(id);
    if (!item) {
      reply.code(404);
      return { error: 'not_found', message: `No request found with id "${id}".` };
    }
    return item;
  });

  server.post<{ Body: CreateRequestInput }>(
    '/api/requests',
    async (request, reply) => {
      const body = request.body ?? {};
      const result = await createRequest(body);
      if (!result.ok) {
        reply.code(result.code === 'ambiguous' || result.code === 'invalid_selection' || result.code === 'unreleased' ? 409 : result.code === 'limit' ? 429 : 400);
        return result;
      }
      return result;
    }
  );

  server.post('/api/requests/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (currentActor().role === 'user') return reply.code(403).send({ message: 'Only an administrator can approve requests.' });
    const updated = await approveRequest(id);
    if (!updated) {
      reply.code(404);
      return { error: 'not_found', message: `No request found with id "${id}".` };
    }
    if (updated.status === 'failed') {
      reply.code(400);
      return { ok: false, request: updated, message: updated.message };
    }
    return updated;
  });

  server.post('/api/requests/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!mayManage(id)) return reply.code(403).send({ message: 'You can only change your own requests.' });
    const updated = cancelRequest(id);
    if (!updated) {
      reply.code(404);
      return { error: 'not_found', message: `No request found with id "${id}".` };
    }
    return updated;
  });

  // Remove a finished (failed/completed/cancelled) request line from the
  // ledger. Active pipelines reject removal so a download that is genuinely
  // running cannot be silently untracked.
  server.delete('/api/requests/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!mayManage(id)) return reply.code(403).send({ message: 'You can only remove your own requests.' });
    const active = getRequests().find(r => r.id === id);
    if (!active) {
      reply.code(404);
      return { error: 'not_found', message: `No request found with id "${id}".` };
    }
    if (['pending', 'searching', 'downloading', 'importing'].includes(active.status)) {
      reply.code(409);
      return { error: 'still_active', message: 'This request is still running. Stop it first, then remove it.' };
    }
    const removed = deleteRequest(id);
    if (!removed) {
      reply.code(404);
      return { error: 'not_found', message: `No request found with id "${id}".` };
    }
    return { removed: true, id };
  });

  server.post('/api/requests/:id/stop', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!mayManage(id)) return reply.code(403).send({ message: 'You can only change your own requests.' });
    // "Stop" cancels the request and also removes its running downloads from the
    // download client, so nothing keeps transferring in the background.
    const result = await stopRequest(id);
    if (!result) {
      reply.code(404);
      return { error: 'not_found', message: `No request found with id "${id}".` };
    }
    return { ...result.request, stopped: true, stoppedDownloads: result.stoppedDownloads };
  });

  // --- Download quality (movie: Radarr, series: Sonarr, artist: Lidarr profiles) ---
  type QualityAdapter = {
    listQualityProfiles?: () => Promise<Array<{ id: number; name: string }>>;
    getQualityProfileId?: (id: string) => Promise<number | null>;
    setQualityProfile?: (id: string, profileId: number, search: boolean) => Promise<{ success: boolean; message: string }>;
  };
  const qualityAdapter = (mediaType: string): QualityAdapter | null =>
    mediaType === 'movie' ? getAdapter('radarr') as unknown as QualityAdapter
      : mediaType === 'series' ? getAdapter('sonarr') as unknown as QualityAdapter
        : mediaType === 'artist' ? getAdapter('lidarr') as unknown as QualityAdapter : null;

  server.get<{ Querystring: { mediaType?: string } }>('/api/quality-profiles', async (request, reply) => {
    const mediaType = request.query.mediaType ?? 'movie';
    const adapter = qualityAdapter(mediaType);
    if (!adapter?.listQualityProfiles) return reply.code(400).send({ message: 'Choose movie, series or artist.' });
    try {
      const configured = getServerSettings().defaultQuality?.[mediaType as 'movie' | 'series' | 'artist'] ?? '';
      return { profiles: await adapter.listQualityProfiles(), defaultName: configured || (mediaType === 'artist' ? 'Standard' : 'HD-1080p') };
    } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : 'Could not read quality profiles.' });
    }
  });

  server.get<{ Params: { mediaType: string; id: string } }>('/api/quality/:mediaType/:id', async (request, reply) => {
    const adapter = qualityAdapter(request.params.mediaType);
    if (!adapter?.getQualityProfileId || !adapter.listQualityProfiles) return reply.code(400).send({ message: 'Unknown media type.' });
    try {
      const [profiles, current] = await Promise.all([adapter.listQualityProfiles(), adapter.getQualityProfileId(request.params.id)]);
      return { profiles, current };
    } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : 'Could not read quality profiles.' });
    }
  });

  server.post<{ Params: { mediaType: string; id: string }; Body: { profileId?: number; search?: boolean } }>(
    '/api/quality/:mediaType/:id',
    async (request, reply) => {
      const adapter = qualityAdapter(request.params.mediaType);
      const profileId = Number(request.body?.profileId);
      if (!adapter?.setQualityProfile || !Number.isInteger(profileId)) return reply.code(400).send({ message: 'Choose a quality profile.' });
      try {
        const result = await adapter.setQualityProfile(request.params.id, profileId, request.body?.search !== false);
        return result.success ? result : reply.code(422).send(result);
      } catch (error) {
        return reply.code(502).send({ success: false, message: error instanceof Error ? error.message : 'Could not change quality.' });
      }
    }
  );
}
