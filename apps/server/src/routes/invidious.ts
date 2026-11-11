import type { FastifyInstance } from 'fastify';
import type { Media } from '@virtuallyview/types';
import {
  captionsVtt, CHANNEL_ID, channelInfo, channelVideos, clearVideoHistory, embedUrl, imageUpstream, invidiousAvailable, matchLibraryTitle, NotConfigured,
  popularVideos, removeFromVideoHistory, searchChannels, searchVideos, streamUrl, subscriptionFeed, thumbnailUpstream, touchVideoHistory, trendingVideos,
  videoDetails, videoFetch, videoHistory, videoInfo, videosAboutTitle, type VideoResult
} from '../services/invidious.js';
import {
  addToList, continueWatching, inList, isSubscribed, knownVideo, listVideos, progressOf, removeFromList, removeSavedFileIfUnused, savedByAnyone, savedFile, savedSize,
  saveProgress, subscribe, subscriptions, unsubscribe, VIDEO_ID, videosLibrary
} from '../services/video-lists.js';
import { cancelYoutubeJob, saveToVideosLibrary, WorkerOff, youtubeJobs, type YoutubeJob } from '../services/youtube.js';
import { getAdapter } from '../services/registry.js';
import { filterByRating } from '../services/parental.js';
import { statfs } from 'node:fs/promises';
import { currentActor } from '../services/user-context.js';
import { serveMediaFile } from './stream.js';

// A full disk once stopped every service, so saving refuses to start below this much free space.
const MIN_FREE_BYTES = 5 * 1024 ** 3;
async function freeBytes(dir: string): Promise<number> {
  try { const s = await statfs(dir); return s.bavail * s.bsize; } catch { return Infinity; }
}

const fail = (error: unknown) => (error instanceof NotConfigured ? error.message : error instanceof Error ? error.message : 'The video service could not be reached.');

/** An image from the instance, passed through with the same checks the thumbnail route has always made. */
async function proxyImage(upstream: string | null, reply: import('fastify').FastifyReply, maxAge = 3600) {
  if (!upstream) return reply.code(404).send();
  try {
    const res = await videoFetch(upstream, 6000);
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/^image\//i.test(type)) return reply.code(404).send();
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > 2_000_000) return reply.code(404).send();
    return reply.header('Content-Type', type).header('Cache-Control', `public, max-age=${maxAge}`).header('X-Content-Type-Options', 'nosniff').send(bytes);
  } catch { return reply.code(404).send(); }
}

/** Where a saved video stands: ready to play, still coming (with progress), or lost. */
function savedState(id: string, jobs: YoutubeJob[]) {
  const file = savedFile(id);
  if (file) return { status: 'ready' as const, percent: 100, sizeBytes: savedSize(file) };
  const job = jobs.find(j => j.videoId === id && j.dir === videosLibrary());
  if (job && job.status !== 'done') return { status: job.status, percent: Math.round(job.percent ?? 0), ...(job.error ? { error: job.error } : {}), jobId: job.id };
  return { status: 'missing' as const, percent: 0 };
}
const workerJobs = () => youtubeJobs().catch(() => [] as YoutubeJob[]);

/** Search and watch YouTube through Invidious (a private front end), with per-person history, followed channels,
 * Watch later and Saved lists kept only on this server. Saved videos are downloaded by the YouTube worker into
 * the videos library and play from there, so they work while the video service is off. */
export default async function invidiousRoutes(server: FastifyInstance) {
  server.get('/api/videos/status', async () => ({ available: await invidiousAvailable() }));

  server.get<{ Querystring: { q?: string; page?: string; type?: string } }>('/api/videos/search', async (request, reply) => {
    const q = (request.query.q ?? '').trim();
    const channels = request.query.type === 'channel';
    if (!q) return channels ? { channels: [] } : { videos: [] };
    try { return channels ? { channels: await searchChannels(q) } : { videos: await searchVideos(q, Number(request.query.page) || 1) }; }
    catch (error) { return reply.code(502).send({ message: fail(error) }); }
  });

  server.get<{ Querystring: { region?: string } }>('/api/videos/trending', async (request, reply) => {
    try { return { videos: await trendingVideos(request.query.region?.toUpperCase()) }; } catch (error) { return reply.code(502).send({ message: fail(error) }); }
  });
  server.get('/api/videos/popular', async (_request, reply) => {
    try { return { videos: await popularVideos() }; } catch (error) { return reply.code(502).send({ message: fail(error) }); }
  });

  // Trailers, reviews and featurettes for a film or show on its own page.
  server.get<{ Querystring: { title?: string; year?: string; kind?: string } }>('/api/videos/about', async (request, reply) => {
    const title = (request.query.title ?? '').trim();
    if (!title || title.length > 200) return reply.code(400).send({ message: 'Say which title.' });
    try { return { videos: await videosAboutTitle(title, Number(request.query.year) || undefined, request.query.kind === 'series' ? 'series' : 'movie') }; }
    catch (error) { return reply.code(502).send({ message: fail(error) }); }
  });

  server.get<{ Params: { id: string }; Querystring: { continuation?: string } }>('/api/videos/channels/:id', async (request, reply) => {
    const { id } = request.params;
    if (!CHANNEL_ID.test(id)) return reply.code(400).send({ message: 'That is not a channel.' });
    try {
      const continuation = request.query.continuation;
      const [channel, page] = await Promise.all([continuation ? null : channelInfo(id), channelVideos(id, continuation)]);
      if (!continuation && !channel) return reply.code(404).send({ message: 'Channel not found.' });
      return { ...(channel ? { channel } : {}), subscribed: isSubscribed(id), ...page };
    } catch (error) { return reply.code(502).send({ message: fail(error) }); }
  });

  // Channel pictures and banners, through the instance (never fetched by the browser from Google).
  server.get<{ Querystring: { p?: string } }>('/api/videos/image', async (request, reply) => proxyImage(imageUpstream(request.query.p ?? ''), reply, 86400));

  // ---- Followed channels and their newest uploads ----
  server.get('/api/videos/subscriptions', async () => ({ channels: subscriptions() }));
  server.post<{ Body: { id?: string } }>('/api/videos/subscriptions', async (request, reply) => {
    const id = String(request.body?.id ?? '');
    if (!CHANNEL_ID.test(id)) return reply.code(400).send({ message: 'That is not a channel.' });
    try {
      const channel = await channelInfo(id);
      if (!channel) return reply.code(404).send({ message: 'Channel not found.' });
      subscribe(channel);
      return { ok: true, channel };
    } catch (error) { return reply.code(502).send({ message: fail(error) }); }
  });
  server.delete<{ Params: { id: string } }>('/api/videos/subscriptions/:id', async request => { unsubscribe(request.params.id); return { ok: true }; });
  server.get('/api/videos/feed', async (_request, reply) => {
    const channels = subscriptions();
    if (!channels.length) return { videos: [], failed: 0, channels: 0 };
    try { return { ...(await subscriptionFeed(channels.map(c => c.id))), channels: channels.length }; } catch (error) { return reply.code(502).send({ message: fail(error) }); }
  });

  // ---- Watch later ----
  server.get('/api/videos/later', async () => ({ videos: listVideos('later') }));
  server.post<{ Body: { id?: string } }>('/api/videos/later', async (request, reply) => {
    const id = String(request.body?.id ?? '');
    if (!VIDEO_ID.test(id)) return reply.code(400).send({ message: 'That is not a video.' });
    try {
      const video = knownVideo(id) ?? await videoInfo(id);
      if (!video) return reply.code(404).send({ message: 'Video not found.' });
      addToList('later', video);
      return { ok: true };
    } catch (error) { return reply.code(502).send({ message: fail(error) }); }
  });
  server.delete<{ Params: { id: string } }>('/api/videos/later/:id', async request => { removeFromList('later', request.params.id); return { ok: true }; });

  // ---- Where each video was left ----
  server.get('/api/videos/continue', async () => ({ videos: continueWatching() }));
  server.post<{ Body: { id?: string; position?: number; duration?: number } }>('/api/videos/progress', async (request, reply) => {
    const { id = '', position, duration } = request.body ?? {};
    if (!VIDEO_ID.test(id) || typeof position !== 'number' || typeof duration !== 'number' || !Number.isFinite(position) || !Number.isFinite(duration) ||
      position < 0 || duration < 0 || duration > 7 * 86400) return reply.code(400).send({ message: 'Bad position.' });
    return { ok: saveProgress(id, Math.min(position, duration || position), duration) };
  });

  // ---- Saved: downloaded into the videos library ----
  server.get('/api/videos/saved', async () => {
    const jobs = await workerJobs();
    return { videos: listVideos('saved').map(v => ({ ...v, saved: savedState(v.id, jobs) })) };
  });
  server.post<{ Body: { id?: string } }>('/api/videos/saved', async (request, reply) => {
    // Saving uses server disk, so only an administrator may start one.
    if (currentActor().role === 'user') return reply.code(403).send({ message: 'Only an administrator can save videos.' });
    const id = String(request.body?.id ?? '');
    if (!VIDEO_ID.test(id)) return reply.code(400).send({ message: 'That is not a video.' });
    try {
      const video = knownVideo(id) ?? await videoInfo(id);
      if (!video) return reply.code(404).send({ message: 'Video not found.' });
      if (!savedFile(id)) {
        if (await freeBytes(videosLibrary()) < MIN_FREE_BYTES) return reply.code(507).send({ error: 'disk_full', message: 'Not enough free disk space to save videos (under 5 GB left). Free some space and try again.' });
        addToList('saved', video);
        await saveToVideosLibrary(id, video.title, videosLibrary());
      } else addToList('saved', video);
      return { ok: true, saved: savedState(id, await workerJobs()) };
    } catch (error) {
      if (error instanceof WorkerOff) {
        removeFromList('saved', id);
        return reply.code(503).send({ error: 'not_enabled', message: 'Saving videos needs the YouTube downloader. Run: docker compose --profile youtube up -d' });
      }
      return reply.code(502).send({ message: fail(error) });
    }
  });
  server.delete<{ Params: { id: string } }>('/api/videos/saved/:id', async (request) => {
    const { id } = request.params;
    if (!inList('saved', id)) return { ok: true, removedFile: false };
    removeFromList('saved', id);
    const job = (await workerJobs()).find(j => j.videoId === id && j.dir === videosLibrary() && ['queued', 'downloading', 'merging'].includes(j.status));
    if (job && !savedByAnyone(id)) await cancelYoutubeJob(job.id).catch(() => undefined);
    return { ok: true, removedFile: removeSavedFileIfUnused(id) };
  });
  server.get<{ Params: { id: string } }>('/api/videos/saved/:id/file', async (request, reply) => {
    const { id } = request.params;
    const file = inList('saved', id) ? savedFile(id) : null;
    return file ? serveMediaFile(request, reply, file) : reply.code(404).send({ message: 'Not saved.' });
  });

  // ---- History ----
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

  // This person's own state for one video (works while the video service is off): resume point, lists, follow.
  server.get<{ Params: { id: string } }>('/api/videos/:id/state', async (request, reply) => {
    const { id } = request.params;
    if (!VIDEO_ID.test(id)) return reply.code(400).send({ message: 'That is not a video.' });
    const known = knownVideo(id);
    const saved = inList('saved', id) ? savedState(id, savedFile(id) ? [] : await workerJobs()) : null;
    return {
      position: progressOf(id), later: inList('later', id), saved, video: known,
      subscribed: known?.channelId ? isSubscribed(known.channelId) : false
    };
  });

  server.get<{ Params: { id: string }; Querystring: { label?: string } }>('/api/videos/:id/captions', async (request, reply) => {
    try {
      const vtt = await captionsVtt(request.params.id, request.query.label ?? '');
      return vtt ? reply.header('Content-Type', 'text/vtt; charset=utf-8').header('Cache-Control', 'private, max-age=3600').send(vtt) : reply.code(404).send();
    } catch { return reply.code(404).send(); }
  });

  server.get<{ Params: { id: string } }>('/api/videos/:id', async (request, reply) => {
    try {
      const video = await videoDetails(request.params.id);
      if (!video) return reply.code(404).send({ message: 'Video not found.' });
      const host = request.headers.host;
      return {
        video, embed: embedUrl(video.id, host), stream: video.hasStream ? streamUrl(video.id, host) : null,
        subscribed: video.channelId ? isSubscribed(video.channelId) : false, library: await libraryMatch(video)
      };
    } catch (error) { return reply.code(502).send({ message: fail(error) }); }
  });

  // Proxied so the browser never talks to the video service (or YouTube's thumbnail CDN) directly.
  server.get<{ Params: { id: string } }>('/api/videos/:id/thumbnail', async (request, reply) => proxyImage(thumbnailUpstream(request.params.id), reply));
}

/** The film or show in this library the video is about, if any (only titles this viewer is allowed to see). */
async function libraryMatch(video: VideoResult): Promise<{ id: string; title: string; year?: number; href: string } | null> {
  const lists = await Promise.all((['radarr', 'sonarr'] as const).map(key => getAdapter(key).getItems().then(filterByRating).catch(() => [] as Media[])));
  const items = lists.flat().map(m => ({ id: m.id, title: m.title, ...(m.year ? { year: m.year } : {}), type: m.type }));
  const hit = matchLibraryTitle(video.title, items);
  return hit ? { id: hit.id, title: hit.title, ...(hit.year ? { year: hit.year } : {}), href: `/${hit.type === 'series' ? 'series' : 'movies'}/${encodeURIComponent(hit.id)}` } : null;
}
