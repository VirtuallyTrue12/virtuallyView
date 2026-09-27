import type { FastifyInstance } from 'fastify';
import {
  clearVideoHistory, embedUrl, invidiousAvailable, NotConfigured, removeFromVideoHistory,
  searchVideos, thumbnailUpstream, touchVideoHistory, videoFetch, videoHistory, videoInfo
} from '../services/invidious.js';

const fail = (error: unknown) => (error instanceof NotConfigured ? error.message : error instanceof Error ? error.message : 'The video service could not be reached.');

/** Search and watch YouTube through Invidious (a private front end), with a local, per-person watch history. */
export default async function invidiousRoutes(server: FastifyInstance) {
  server.get('/api/videos/status', async () => ({ available: await invidiousAvailable() }));

  server.get<{ Querystring: { q?: string; page?: string } }>('/api/videos/search', async (request, reply) => {
    const q = (request.query.q ?? '').trim();
    if (!q) return { videos: [] };
    try { return { videos: await searchVideos(q, Number(request.query.page) || 1) }; }
    catch (error) { return reply.code(502).send({ message: fail(error) }); }
  });

  server.get<{ Params: { id: string } }>('/api/videos/:id', async (request, reply) => {
    try {
      const video = await videoInfo(request.params.id);
      if (!video) return reply.code(404).send({ message: 'Video not found.' });
      const embed = embedUrl(video.id, request.headers.host);
      return { video, embed };
    } catch (error) { return reply.code(502).send({ message: fail(error) }); }
  });

  // Proxied so the browser never talks to the video service (or YouTube's thumbnail CDN) directly.
  server.get<{ Params: { id: string } }>('/api/videos/:id/thumbnail', async (request, reply) => {
    const upstream = thumbnailUpstream(request.params.id);
    if (!upstream) return reply.code(404).send();
    try {
      const res = await videoFetch(upstream, 6000);
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !/^image\//i.test(type)) return reply.code(404).send();
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > 2_000_000) return reply.code(404).send();
      return reply.header('Content-Type', type).header('Cache-Control', 'public, max-age=3600').header('X-Content-Type-Options', 'nosniff').send(bytes);
    } catch { return reply.code(404).send(); }
  });

  server.get('/api/videos/history/me', async () => ({ history: videoHistory() }));
  server.post<{ Body: { id?: string } }>('/api/videos/history/watched', async (request, reply) => {
    const id = String(request.body?.id ?? '');
    try {
      const video = await videoInfo(id);
      if (!video) return reply.code(404).send({ message: 'Video not found.' });
      touchVideoHistory(video);
      return { ok: true };
    } catch (error) { return reply.code(502).send({ message: fail(error) }); }
  });
  server.delete<{ Params: { id: string } }>('/api/videos/history/:id', async (request) => { removeFromVideoHistory(request.params.id); return { ok: true }; });
  server.delete('/api/videos/history', async () => { clearVideoHistory(); return { ok: true }; });
}
