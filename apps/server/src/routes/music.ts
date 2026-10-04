import { queueByItem } from '../services/item-downloads.js';
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { LidarrAdapter } from '@virtuallyview/integrations';
import { getAdapter } from '../services/registry.js';
import { isAllowedMediaFile } from './stream.js';
import { parseByteRange } from '../lib/byte-range.js';
import { freshCast, setCastCache } from '../services/cast.js';
import { fetchBand, wikipediaPortrait } from '../services/cast-more.js';
import { applyEdits, clearEdit, listEdits, saveEdit } from '../services/member-edits.js';
import { startAudioTranscode } from '../services/transcode.js';
import { acquireConversion, CONVERSION_MAX_MS } from '../lib/limits.js';
import { currentActor } from '../services/user-context.js';

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
const removedNames = (artistId: string) => listEdits(artistId).filter(e => e.action === 'remove').map(e => e.name);

export default async function musicRoutes(server: FastifyInstance) {
  const lidarr = getAdapter<LidarrAdapter>('lidarr');

  server.get<{ Params: { id: string } }>('/api/artists/:id/albums', async (request, reply) => {
    const { id } = request.params;
    const numeric = id.replace(/^lidarr-/, '');
    if (!/^\d+$/.test(numeric)) {
      return reply.code(400).send({ error: 'bad_request', message: 'Invalid artist id.' });
    }
    try {
      const [albums, arriving] = await Promise.all([lidarr.getAlbums(numeric), queueByItem('lidarr', lidarr as never)]);
      return { artistId: id, albums: albums.map(a => { const d = arriving.get(Number(a.id)); return d ? { ...a, download: d } : a; }) };
    } catch (error) {
      return reply.code(502).send({ error: 'lidarr_offline', message: error instanceof Error ? error.message : 'Lidarr is not available.' });
    }
  });

  // The people in a band (or the artist themselves, when solo), with portraits.
  server.get<{ Params: { id: string } }>('/api/artists/:id/members', async (request, reply) => {
    const { id } = request.params;
    const key = `artist:${id}`;
    const fresh = freshCast(key);
    if (fresh) return { artistId: id, kind: fresh.cast.length === 1 && fresh.cast[0]!.role === 'Artist' ? 'solo' : 'band', members: applyEdits(fresh.cast, listEdits(id)), removed: removedNames(id) };
    try {
      const artist = (await lidarr.getItems()).find(a => a.id === id);
      if (!artist) return reply.code(404).send({ error: 'not_found', message: `No artist found with id "${id}".` });
      const mbid = (artist.provider?.metadata as { foreignArtistId?: string } | undefined)?.foreignArtistId;
      const band = await fetchBand(mbid, artist.title);
      // Only remember a real answer, so a MusicBrainz hiccup is retried on the next visit.
      // Only remember a fairly complete answer (most portraits found), so a Wikipedia hiccup is retried on the next visit.
      const pictured = band.members.filter(m => m.photo).length;
      if (mbid && band.kind !== 'unknown' && pictured * 2 >= band.members.length) setCastCache(key, band.members, 'musicbrainz');
      return { artistId: id, ...band, members: applyEdits(band.members, listEdits(id)), removed: removedNames(id) };
    } catch (error) {
      return reply.code(502).send({ error: 'lidarr_offline', message: error instanceof Error ? error.message : 'Lidarr is not available.' });
    }
  });

  // Administrator corrections to the member list. Everyone sees them; a refresh from MusicBrainz never loses them.
  server.post<{ Params: { id: string }; Body: { name?: string; action?: string; role?: string; years?: string; current?: boolean } }>('/api/member-edits/:id', async (request, reply) => {
    const { name, action, role, years, current } = request.body ?? {};
    if (!name?.trim() || name.length > 100 || !['set', 'remove', 'add'].includes(action ?? '')) return reply.code(400).send({ error: 'bad_request', message: 'Say who, and what to do.' });
    if ((role?.length ?? 0) > 80 || (years?.length ?? 0) > 40) return reply.code(400).send({ error: 'bad_request', message: 'That is too long.' });
    const edit = { name: name.trim(), action: action as 'set' | 'remove' | 'add', ...(role !== undefined ? { role: role.trim() } : {}), ...(years !== undefined ? { years: years.trim() } : {}), ...(typeof current === 'boolean' ? { current } : {}) };
    // A person added by hand gets a portrait too, when Wikipedia has one about a musician.
    const photo = edit.action === 'add' ? await wikipediaPortrait(edit.name) : '';
    saveEdit(request.params.id, { ...edit, ...(photo ? { photo } : {}) });
    return { ok: true };
  });

  server.delete<{ Params: { id: string; name: string } }>('/api/member-edits/:id/:name', async request => {
    clearEdit(request.params.id, decodeURIComponent(request.params.name));
    return { ok: true };
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
      const arriving = await queueByItem('lidarr', lidarr as never);
      const download = arriving.get(Number(numeric));
      return { album: download ? { ...album, download } : album, tracks: tracks.map(t => (!t.hasFile && download ? { ...t, download } : t)) };
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

  const trackFile = async (id: string): Promise<{ safePath: string } | { status: 400 | 404 | 502; error: 'bad_request' | 'not_found' | 'lidarr_offline'; message: string }> => {
    const numeric = id.replace(/^track-/, '');
    if (!/^\d+$/.test(numeric)) return { status: 400, error: 'bad_request', message: 'Invalid track id.' };
    let file: { path: string } | null;
    try {
      file = await lidarr.getTrackFile(numeric);
    } catch (error) {
      // getTrackFile only throws when Lidarr itself is unreachable or unconfigured (requireConfig(),
      // or the fetch failing/timing out) - a track that genuinely has no file yet resolves to null
      // instead, so conflating the two here previously reported a transient Lidarr outage as a
      // permanent 404, the same inconsistency every sibling route in this file already avoids.
      return { status: 502, error: 'lidarr_offline', message: error instanceof Error ? error.message : 'Lidarr is not available.' };
    }
    if (!file || !file.path) return { status: 404, error: 'not_found', message: 'This track has no audio file on the server yet.' };
    if (!existsSync(file.path) || !isAllowedMediaFile(file.path)) {
      return { status: 404, error: 'not_found', message: 'The audio file for this track is missing or outside the allowed media folders.' };
    }
    return { safePath: realpathSync(file.path) };
  };

  // A browser can't play WMA, ALAC or Monkey's Audio/APE at all; this converts on the fly the same
  // way video does, so a library ripped with those is not simply a dead player.
  server.get<{ Params: { id: string }; Querystring: { start?: string } }>('/api/music/stream/:id/transcode', async (request, reply) => {
    const resolved = await trackFile(request.params.id);
    if ('status' in resolved) return reply.code(resolved.status).send({ error: resolved.error, message: resolved.message });
    const start = Math.max(0, Number(request.query.start) || 0);
    const release = acquireConversion(currentActor().userId);
    if (!release) {
      return reply.code(429).header('Retry-After', '30').send({ error: 'too_many_conversions', message: 'Too many tracks are being converted right now. Try again in a moment.' });
    }
    const handle = startAudioTranscode(resolved.safePath, start);
    if (!handle?.process.stdout) {
      release();
      return reply.code(503).send({ error: 'transcode_unavailable', message: 'This track needs conversion, but ffmpeg is not installed on the server.' });
    }
    const child = handle.process;
    const limit = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already exited */ } }, CONVERSION_MAX_MS);
    child.on('close', () => { clearTimeout(limit); release(); });
    request.raw.on('close', () => { try { child.kill('SIGKILL'); } catch { /* already exited */ } });
    child.on('error', () => { try { reply.raw.destroy(); } catch { /* connection already gone */ } });
    child.stderr?.on('data', () => { /* ffmpeg diagnostics are intentionally discarded */ });
    return reply
      .code(200)
      .header('Content-Type', 'audio/aac')
      .header('Cache-Control', 'no-store')
      .header('Accept-Ranges', 'none')
      .send(child.stdout);
  });

  server.get<{ Params: { id: string } }>('/api/music/stream/:id', async (request, reply) => {
    const resolved = await trackFile(request.params.id);
    if ('status' in resolved) return reply.code(resolved.status).send({ error: resolved.error, message: resolved.message });
    const safePath = resolved.safePath;
    const stat = statSync(safePath);
    const mime = audioMime(safePath);
    const range = request.headers.range;

    if (range) {
      const parsed = parseByteRange(range, stat.size);
      if (!parsed) {
        return reply.code(416).header('Content-Range', `bytes */${stat.size}`).send();
      }
      const { start, end } = parsed;
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