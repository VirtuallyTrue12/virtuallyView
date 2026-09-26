import type { FastifyInstance } from 'fastify';
import { artistFolders, concertFilmsOf, liveFilerDeps, resolveMusicVideoPath, scanArtistVideos } from '../services/music-video-library.js';
import { fileTorrent, listJobs, sweepMusicVideos, type VideoKind } from '../services/music-videos.js';

export { resolveMusicVideoPath };

/** Concerts and music videos under each artist, plus the small admin tools that file the odd one by hand. */
export default async function musicVideoRoutes(server: FastifyInstance) {
  server.get<{ Params: { id: string } }>('/api/artists/:id/videos', async (request, reply) => {
    const numeric = request.params.id.replace(/^lidarr-/, '');
    if (!/^\d+$/.test(numeric)) return reply.code(400).send({ error: 'bad_request', message: 'Invalid artist id.' });
    try {
      const artist = (await artistFolders()).find(a => String(a.id) === numeric);
      if (!artist) return { artistId: request.params.id, concerts: [], videos: [] };
      const items = [...scanArtistVideos(artist), ...(await concertFilmsOf(artist))];
      return { artistId: request.params.id, concerts: items.filter(i => i.kind === 'Concerts'), videos: items.filter(i => i.kind === 'Videos') };
    } catch (error) {
      return reply.code(502).send({ error: 'lidarr_offline', message: error instanceof Error ? error.message : 'Lidarr is not available.' });
    }
  });

  // Downloads that look like concerts or videos but need a person to say which artist.
  server.get('/api/music-videos/pending', async () => ({ jobs: listJobs('needs_artist') }));
  server.get('/api/music-videos/recent', async () => ({ jobs: listJobs() }));

  server.post('/api/music-videos/sweep', async (request, reply) => {
    try { return { outcomes: (await sweepMusicVideos(liveFilerDeps())).map(o => ({ status: o.status, message: o.message })) }; } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : 'Could not check downloads.' });
    }
  });

  server.post<{ Body: { hash?: string; artist?: string; kind?: string } }>('/api/music-videos/file', async (request, reply) => {
    const { hash, artist, kind } = request.body ?? {};
    if (!hash || !/^[a-f0-9]{40,64}$/i.test(hash) || !artist?.trim() || artist.length > 120) {
      return reply.code(400).send({ error: 'bad_request', message: 'Say which download and which artist.' });
    }
    try {
      const deps = liveFilerDeps();
      const torrent = (await deps.qbit.listTorrents()).find(t => t.hash.toLowerCase() === hash.toLowerCase());
      if (!torrent) return reply.code(404).send({ error: 'not_found', message: 'That download is not in qBittorrent any more.' });
      if (torrent.progress < 100) return reply.code(409).send({ error: 'not_finished', message: 'Wait until it has finished downloading.' });
      const outcome = await fileTorrent(torrent, deps, { artistName: artist.trim(), ...(kind === 'Concerts' || kind === 'Videos' ? { kind: kind as VideoKind } : {}) });
      return outcome.status === 'filed' ? { ok: true, message: outcome.message, artistId: outcome.artist?.id } : reply.code(422).send({ error: outcome.status, message: outcome.message });
    } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : 'Could not file it.' });
    }
  });
}
