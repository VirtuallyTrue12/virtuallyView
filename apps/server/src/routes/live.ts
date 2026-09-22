import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { addPlaylist, channelById, channelsFor, listPlaylists, removePlaylist, rewriteHls, verifyRelay } from '../services/live-tv.js';
import { outboundFetch } from '../services/outbound.js';
import { startTranscode } from '../services/transcode.js';

const isPlaylistType = (type: string | null, url: string) => /mpegurl/i.test(type ?? '') || /\.m3u8?(\?|$)/i.test(url);

export default async function liveRoutes(server: FastifyInstance) {
  server.get('/api/live/playlists', async () => ({ playlists: listPlaylists() }));

  server.post<{ Body: { name?: string; url?: string } }>('/api/live/playlists', async (request, reply) => {
    const result = addPlaylist(request.body?.name ?? '', (request.body?.url ?? '').trim());
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
        for (const { url: _hidden, ...channel } of await channelsFor(playlist)) channels.push(channel);
      } catch (error) {
        problems.push(`${playlist.name}: ${error instanceof Error ? error.message : 'could not be loaded'}`);
      }
    }
    if (!channels.length && problems.length) return reply.code(502).send({ message: problems.join(' ') });
    return { channels, problems };
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
    const handle = startTranscode(channel.url, 0, {});
    if (!handle?.process.stdout) return reply.code(503).send({ message: 'This channel needs ffmpeg, which is not installed.' });
    const child = handle.process;
    request.raw.on('close', () => { try { child.kill('SIGKILL'); } catch { /* gone */ } });
    child.stderr?.on('data', () => undefined);
    return reply.header('Content-Type', 'video/mp4').header('Cache-Control', 'no-store').send(child.stdout);
  });

  server.get<{ Querystring: { u?: string; s?: string } }>('/api/live/relay', async (request, reply) => {
    const url = request.query.u ?? '';
    if (!verifyRelay(url, request.query.s ?? '')) return reply.code(403).send({ message: 'That link is not valid.' });
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
}
