import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { addPlaylist, channelById, channelsFor, guideSources, knownChannel, listPlaylists, removePlaylist, rewriteHls, verifyRelay } from '../services/live-tv.js';
import { ensureGuide, programmesFor, type Programme } from '../services/epg.js';
import { checkChannels, deadChannels, favoriteChannels, recentChannels, setChannelFavorite, touchRecent } from '../services/live-user.js';
import { outboundFetch } from '../services/outbound.js';
import { startTranscode } from '../services/transcode.js';
import { acquireConversion, CONVERSION_MAX_MS } from '../lib/limits.js';
import { currentActor } from '../services/user-context.js';
import { deleteRecording, listRecordings, recordingFile, startRecording, stopRecording } from '../services/recordings.js';
import { createReadStream, statSync } from 'node:fs';

const isPlaylistType = (type: string | null, url: string) => /mpegurl/i.test(type ?? '') || /\.m3u8?(\?|$)/i.test(url);

export default async function liveRoutes(server: FastifyInstance) {
  server.get('/api/live/playlists', async () => ({ playlists: listPlaylists() }));

  server.post<{ Body: { name?: string; url?: string; epgUrl?: string } }>('/api/live/playlists', async (request, reply) => {
    const result = addPlaylist(request.body?.name ?? '', (request.body?.url ?? '').trim(), request.body?.epgUrl ?? '');
    return result.ok ? result.playlist : reply.code(400).send({ message: result.message });
  });

  server.delete<{ Params: { id: string } }>('/api/live/playlists/:id', async (request, reply) =>
    removePlaylist(request.params.id) ? { ok: true } : reply.code(404).send({ message: 'Playlist not found.' }));

  server.get<{ Querystring: { playlist?: string } }>('/api/live/channels', async (request, reply) => {
    const lists = listPlaylists().filter(p => !request.query.playlist || p.id === request.query.playlist);
    const channels = [];
    const problems: string[] = [];
    for (const playlist of lists) {
      try {
        // The address of a stream stays on the server; the page gets an id.
        const hasGuide = guideSources(playlist.id).length > 0 || !!playlist.epgUrl;
        for (const { url: _hidden, tvgId, ...channel } of await channelsFor(playlist)) channels.push({ ...channel, ...(hasGuide && tvgId ? { guide: true } : {}) });
      } catch (error) {
        problems.push(`${playlist.name}: ${error instanceof Error ? error.message : 'could not be loaded'}`);
      }
    }
    if (!channels.length && problems.length) return reply.code(502).send({ message: problems.join(' ') });
    return { channels, problems };
  });

  // What is on: now and next (and more) for the channels asked about, from the playlist's program guide.
  server.get<{ Querystring: { channels?: string; hours?: string } }>('/api/live/guide', async request => {
    const ids = [...new Set((request.query.channels ?? '').split(',').filter(Boolean))].slice(0, 150);
    const hours = Math.min(Math.max(Number(request.query.hours) || 3, 1), 24);
    const now = Date.now();
    const wanted: Array<{ id: string; tvgId: string; urls: string[] }> = [];
    for (const id of ids) {
      const c = knownChannel(id) ?? await channelById(id);
      const urls = c ? (listPlaylists().find(p => p.id === c.playlist)?.epgUrl ? [listPlaylists().find(p => p.id === c.playlist)!.epgUrl!] : guideSources(c.playlist)) : [];
      if (c?.tvgId && urls.length) wanted.push({ id, tvgId: c.tvgId, urls });
    }
    const byUrl = new Map<string, Set<string>>();
    for (const w of wanted) for (const u of w.urls) { const set = byUrl.get(u) ?? new Set<string>(); set.add(w.tvgId); byUrl.set(u, set); }
    // The guide covers every channel of its playlist, so ask for all of that playlist's ids the first time.
    const all = new Map<string, Set<string>>();
    for (const [u, set] of byUrl) {
      const full = new Set(set);
      for (const p of listPlaylists()) if (p.epgUrl === u || guideSources(p.id).includes(u)) { try { for (const c of await channelsFor(p)) if (c.tvgId) full.add(c.tvgId); } catch { /* the playlist is unreachable */ } }
      all.set(u, full);
    }
    const ready = (await Promise.all([...all].map(([u, set]) => ensureGuide(u, set)))).every(Boolean);
    const programmes: Record<string, Programme[]> = {};
    for (const w of wanted) {
      const list = w.urls.flatMap(u => programmesFor(u, w.tvgId, now - 30 * 60_000, now + hours * 3_600_000));
      if (list.length) programmes[w.id] = list.sort((a, b) => a.start - b.start).slice(0, 40);
    }
    return { ready, now, programmes };
  });

  // Each person's favorites and recently watched channels, and which channels were found dead.
  server.get('/api/live/me', async () => ({ favorites: favoriteChannels(), recent: recentChannels(), dead: deadChannels() }));
  server.post<{ Body: { channelId?: string; favorite?: boolean } }>('/api/live/favorite', async (request, reply) => {
    const id = String(request.body?.channelId ?? '');
    if (!/^[0-9a-f]{12}$/.test(id)) return reply.code(400).send({ message: 'Unknown channel.' });
    setChannelFavorite(id, request.body?.favorite !== false);
    return { ok: true };
  });
  server.post<{ Body: { channelId?: string } }>('/api/live/watched', async (request, reply) => {
    const channel = await channelById(String(request.body?.channelId ?? ''));
    if (!channel) return reply.code(404).send({ message: 'Channel not found.' });
    touchRecent(channel.id, channel.name);
    return { ok: true };
  });
  // Administrators: test a batch of channels and remember which ones do not answer.
  server.post<{ Body: { channelIds?: string[] } }>('/api/live/health', async (request, reply) => {
    const ids = (request.body?.channelIds ?? []).filter(id => /^[0-9a-f]{12}$/.test(id)).slice(0, 60);
    if (!ids.length) return reply.code(400).send({ message: 'Choose some channels to check.' });
    return checkChannels(ids);
  });

  // The stream itself: playlists are relayed (HLS), anything else is converted to MP4 by ffmpeg.
  server.get<{ Params: { id: string } }>('/api/live/stream/:id', async (request, reply) => {
    const channel = await channelById(request.params.id);
    if (!channel) return reply.code(404).send({ message: 'That channel is no longer in your playlists. Reload the page to refresh the channel list.' });
    try {
      const head = await outboundFetch(channel.url, { timeoutMs: 15_000 });
      if (!head.ok) return reply.code(502).send({ message: `The channel answered ${head.status}.` });
      if (isPlaylistType(head.headers.get('content-type'), channel.url)) {
        const text = await head.text();
        return reply.header('Content-Type', 'application/vnd.apple.mpegurl').header('Cache-Control', 'no-store').send(rewriteHls(text, head.url || channel.url));
      }
      void head.body?.cancel();
    } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : 'The channel could not be reached.' });
    }
    const release = acquireConversion(currentActor().userId);
    if (!release) return reply.code(429).header('Retry-After', '30').send({ message: 'Too many videos are being converted right now. Try again in a moment.' });
    const handle = startTranscode(channel.url, 0, {});
    if (!handle?.process.stdout) { release(); return reply.code(503).send({ message: 'This channel needs ffmpeg, which is not installed.' }); }
    const child = handle.process;
    const limit = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, CONVERSION_MAX_MS);
    child.on('close', () => { clearTimeout(limit); release(); });
    request.raw.on('close', () => { try { child.kill('SIGKILL'); } catch { /* gone */ } });
    child.stderr?.on('data', () => undefined);
    return reply.header('Content-Type', 'video/mp4').header('Cache-Control', 'no-store').send(child.stdout);
  });

  server.get<{ Querystring: { u?: string; s?: string; e?: string } }>('/api/live/relay', async (request, reply) => {
    const url = request.query.u ?? '';
    if (!verifyRelay(url, request.query.s ?? '', request.query.e)) return reply.code(403).send({ message: 'That link is not valid.' });
    try {
      const upstream = await outboundFetch(url, { timeoutMs: 20_000 });
      if (!upstream.ok) return reply.code(502).send({ message: `The stream answered ${upstream.status}.` });
      if (isPlaylistType(upstream.headers.get('content-type'), url)) {
        return reply.header('Content-Type', 'application/vnd.apple.mpegurl').header('Cache-Control', 'no-store').send(rewriteHls(await upstream.text(), upstream.url || url));
      }
      return reply
        .header('Content-Type', upstream.headers.get('content-type') ?? 'video/mp2t')
        .header('Cache-Control', 'no-store')
        .send(upstream.body ? Readable.fromWeb(upstream.body as never) : '');
    } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : 'The stream could not be reached.' });
    }
  });

  server.post<{ Body: { channelId?: string; minutes?: number } }>('/api/live/record', async (request, reply) => {
    const channel = await channelById(request.body?.channelId ?? '');
    if (!channel) return reply.code(404).send({ message: 'That channel is no longer in your playlists. Reload the page to refresh the channel list.' });
    const result = startRecording(channel.url, channel.name, Number(request.body?.minutes));
    return result.ok ? result.recording : reply.code(400).send({ message: result.message });
  });
  server.get('/api/live/recordings', async () => ({ recordings: listRecordings() }));
  server.post<{ Params: { id: string } }>('/api/live/record/:id/stop', async (request, reply) =>
    stopRecording(request.params.id) ? { ok: true } : reply.code(404).send({ message: 'That recording is not running.' }));
  server.delete<{ Params: { id: string } }>('/api/live/recordings/:id', async (request, reply) =>
    deleteRecording(request.params.id) ? { ok: true } : reply.code(404).send({ message: 'Recording not found.' }));
  server.get<{ Params: { id: string } }>('/api/live/recordings/:id/file', async (request, reply) => {
    const file = recordingFile(request.params.id);
    if (!file) return reply.code(404).send({ message: 'Recording not found.' });
    const size = statSync(file).size;
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.range ?? ''));
    reply.header('Accept-Ranges', 'bytes').header('Cache-Control', 'no-store').type('video/mp4');
    if (!range) return reply.header('Content-Length', size).send(createReadStream(file));
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
    return reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1).send(createReadStream(file, { start, end }));
  });
}
