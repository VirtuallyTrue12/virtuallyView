import type { FastifyInstance } from 'fastify';
import { liveFilerDeps, forgetArtistFolders } from '../services/music-video-library.js';
import { cancelYoutubeJob, downloadFromYoutube, searchYoutube, WorkerOff, youtubeAvailable, youtubeJobs, youtubeVideo } from '../services/youtube.js';
import { artProxyUrl } from '@virtuallyview/integrations';

/** Find concerts and music videos on YouTube and save them under the artist. Administrators only. */
export default async function youtubeRoutes(server: FastifyInstance) {
  server.get('/api/youtube/status', async () => ({ available: await youtubeAvailable() }));

  server.get<{ Querystring: { q?: string } }>('/api/youtube/search', async (request, reply) => {
    const q = (request.query.q ?? '').trim();
    if (q.length < 2) return reply.code(400).send({ error: 'bad_request', message: 'Type at least two letters to search.' });
    try {
      const results = await searchYoutube(q);
      return { query: q, results: results.map(r => ({ ...r, thumbnail: artProxyUrl(r.thumbnail) })) };
    } catch (error) {
      return reply.code(error instanceof WorkerOff ? 503 : 502).send({ error: error instanceof WorkerOff ? 'not_enabled' : 'search_failed', message: error instanceof Error ? error.message : 'Search failed.' });
    }
  });

  // A pasted link: the details of that one video.
  server.get<{ Querystring: { id?: string } }>('/api/youtube/video', async (request, reply) => {
    const id = request.query.id ?? '';
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return reply.code(400).send({ error: 'bad_request', message: 'That is not a YouTube video link.' });
    try {
      const video = await youtubeVideo(id);
      return { video: { ...video, thumbnail: artProxyUrl(video.thumbnail) } };
    } catch (error) {
      return reply.code(error instanceof WorkerOff ? 503 : 502).send({ error: error instanceof WorkerOff ? 'not_enabled' : 'video_failed', message: error instanceof Error ? error.message : 'Could not read that video.' });
    }
  });

  server.post<{ Body: { id?: string; title?: string; artist?: string; kind?: string } }>('/api/youtube/download', async (request, reply) => {
    const { id, title, artist, kind } = request.body ?? {};
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id) || !title || title.length > 300 || (artist && artist.length > 120)) {
      return reply.code(400).send({ error: 'bad_request', message: 'Choose a video.' });
    }
    try {
      const out = await downloadFromYoutube({ id, title, ...(artist ? { artist } : {}), ...(kind === 'Concerts' || kind === 'Videos' ? { kind } : {}) }, liveFilerDeps());
      forgetArtistFolders();
      if ('failure' in out) return reply.code(422).send({ error: 'needs_artist', message: out.failure });
      return { ok: true, job: out.job, artistId: out.artist.id, artistName: out.artist.name, created: out.created, kind: out.kind,
        message: `Downloading. It will appear under ${out.artist.name} / ${out.kind}${out.created ? ' (new artist added to the library)' : ''}.` };
    } catch (error) {
      return reply.code(error instanceof WorkerOff ? 503 : 502).send({ error: error instanceof WorkerOff ? 'not_enabled' : 'download_failed', message: error instanceof Error ? error.message : 'Could not start it.' });
    }
  });

  server.get('/api/youtube/jobs', async (_request, reply) => {
    try { return { jobs: await youtubeJobs() }; } catch { return reply.code(503).send({ error: 'not_enabled', jobs: [] }); }
  });

  server.post<{ Params: { id: string } }>('/api/youtube/jobs/:id/cancel', async (request, reply) => {
    try { await cancelYoutubeJob(request.params.id); return { ok: true }; } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : 'Could not cancel.' });
    }
  });
}
