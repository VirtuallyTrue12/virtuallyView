import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { LidarrAdapter } from '@virtuallyview/integrations';
import { getAdapter } from '../services/registry.js';
import { isAllowedMediaFile } from './stream.js';

const AUDIO_MIME: Record<string, string> = {
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.wma': 'audio/x-ms-wma'
};

function audioMime(filePath: string): string {
  return AUDIO_MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Music endpoints: albums and tracks for one artist (Lidarr), plus a range-aware
 * audio stream that only serves files inside the configured media roots.
 */
export default async function musicRoutes(server: FastifyInstance) {
  const lidarr = getAdapter<LidarrAdapter>('lidarr');

  server.get<{ Params: { id: string } }>('/api/artists/:id/albums', async (request, reply) => {
    const { id } = request.params;
    const numeric = id.replace(/^lidarr-/, '');
    if (!/^\d+$/.test(numeric)) {
      return reply.code(400).send({ error: 'bad_request', message: 'Invalid artist id.' });
    }
    try {
      const albums = await lidarr.getAlbums(numeric);
      return { artistId: id, albums };
    } catch (error) {
      return reply.code(502).send({ error: 'lidarr_offline', message: error instanceof Error ? error.message : 'Lidarr is not available.' });
    }
  });

  server.get<{ Params: { id: string } }>('/api/artists/:id/tracks', async (request, reply) => {
    const { id } = request.params;
    const numeric = id.replace(/^lidarr-/, '');
    if (!/^\d+$/.test(numeric)) {
      return reply.code(400).send({ error: 'bad_request', message: 'Invalid artist id.' });
    }
    try {
      const tracks = await lidarr.getTracks(numeric);
      return { artistId: id, tracks };
    } catch (error) {
      return reply.code(502).send({ error: 'lidarr_offline', message: error instanceof Error ? error.message : 'Lidarr is not available.' });
    }
  });

  // One album plus its tracks, so /albums/:id can render a playable album page
  // without needing the artist id in the URL.
  server.get<{ Params: { id: string } }>('/api/albums/:id', async (request, reply) => {
    const { id } = request.params;
    const numeric = id.replace(/^album-/, '');
    if (!/^\d+$/.test(numeric)) {
      return reply.code(400).send({ error: 'bad_request', message: 'Invalid album id.' });
    }
    try {
      const [album, tracks] = await Promise.all([
        lidarr.getAlbum(numeric),
        lidarr.getAlbumTracks(numeric)
      ]);
      if (!album) {
        return reply.code(404).send({ error: 'not_found', message: `No album found with id "${id}".` });
      }
      return { album, tracks };
    } catch (error) {
      return reply.code(502).send({ error: 'lidarr_offline', message: error instanceof Error ? error.message : 'Lidarr is not available.' });
    }
  });

  // Stream a single track by Lidarr track id. Range requests keep seeking
  // instant and let browsers play without buffering the whole file.
  server.post<{ Params: { id: string } }>('/api/albums/:id/search', async (request, reply) => {
    const numeric = request.params.id.replace(/^album-/, '');
    if (!/^\d+$/.test(numeric)) return reply.code(400).send({ error: 'bad_request', message: 'Invalid album id.' });
    try {
      const result = await lidarr.searchAlbum(Number(numeric));
      return result.success ? result : reply.code(502).send(result);
    } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : 'Lidarr is not available.' });
    }
  });

  server.get<{ Params: { id: string } }>('/api/music/stream/:id', async (request, reply) => {
    const { id } = request.params;
    const numeric = id.replace(/^track-/, '');
    if (!/^\d+$/.test(numeric)) {
      return reply.code(400).send({ error: 'bad_request', message: 'Invalid track id.' });
    }
    let file: { path: string } | null;
    try {
      file = await lidarr.getTrackFile(numeric);
    } catch {
      file = null;
    }
    if (!file || !file.path) {
      return reply.code(404).send({ error: 'not_found', message: 'This track has no audio file on the server yet.' });
    }
    if (!existsSync(file.path) || !isAllowedMediaFile(file.path)) {
      return reply.code(404).send({ error: 'not_found', message: 'The audio file for this track is missing or outside the allowed media folders.' });
    }
    const safePath = realpathSync(file.path);
    const stat = statSync(safePath);
    const mime = audioMime(safePath);
    const range = request.headers.range;

    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match?.[1] ? parseInt(match[1], 10) : 0;
      const requestedEnd = match?.[2] ? parseInt(match[2], 10) : NaN;
      const end = Number.isNaN(requestedEnd) ? stat.size - 1 : Math.min(requestedEnd, stat.size - 1);
      if (Number.isNaN(start) || start < 0 || start >= stat.size) {
        return reply.code(416).header('Content-Range', `bytes */${stat.size}`).send();
      }
      return reply
        .code(206)
        .header('Content-Type', mime)
        .header('Accept-Ranges', 'bytes')
        .header('Content-Range', `bytes ${start}-${end}/${stat.size}`)
        .header('Content-Length', end - start + 1)
        .header('Cache-Control', 'no-store')
        .send(createReadStream(safePath, { start, end }));
    }

    return reply
      .code(200)
      .header('Content-Type', mime)
      .header('Accept-Ranges', 'bytes')
      .header('Content-Length', stat.size)
      .header('Cache-Control', 'no-store')
      .send(createReadStream(safePath));
  });
}