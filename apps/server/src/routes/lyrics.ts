import type { FastifyInstance } from 'fastify';
import { outboundFetch } from '../services/outbound.js';

interface Lyrics { plain: string | null; synced: Array<{ time: number; text: string }> | null }

const cache = new Map<string, { at: number; value: Lyrics | null }>();
const TTL_HIT = 7 * 24 * 60 * 60 * 1000;
const TTL_MISS = 60 * 60 * 1000;

/** "[01:23.45] text" lines to seconds. Lines without a stamp are dropped. */
function parseSynced(raw: string): Array<{ time: number; text: string }> {
  const lines: Array<{ time: number; text: string }> = [];
  for (const line of raw.split('\n')) {
    const match = /^\[(\d+):(\d+(?:\.\d+)?)\]\s?(.*)$/.exec(line.trim());
    if (match) lines.push({ time: Number(match[1]) * 60 + Number(match[2]), text: match[3] ?? '' });
  }
  return lines;
}

/**
 * Lyrics for the track that is playing, looked up on LRCLIB (a free public
 * lyrics database, no key). The request carries the artist, title and album,
 * so it goes through the same outbound proxy setting as other public lookups.
 */
export default async function lyricsRoutes(server: FastifyInstance) {
  server.get<{ Querystring: { artist?: string; title?: string; album?: string; duration?: string } }>('/api/lyrics', async (request, reply) => {
    const artist = request.query.artist?.trim().slice(0, 200) ?? '';
    const title = request.query.title?.trim().slice(0, 200) ?? '';
    if (!artist || !title) return reply.code(400).send({ message: 'An artist and a title are required.' });
    const album = request.query.album?.trim().slice(0, 200) ?? '';
    const duration = Math.round(Number(request.query.duration) || 0);
    const key = `${artist}|${title}|${album}|${duration}`.toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < (hit.value ? TTL_HIT : TTL_MISS)) {
      return hit.value ?? reply.code(404).send({ message: 'No lyrics found for this track.' });
    }
    let value: Lyrics | null = null;
    try {
      const params = new URLSearchParams({ artist_name: artist, track_name: title });
      if (album) params.set('album_name', album);
      if (duration > 0) params.set('duration', String(duration));
      const res = await outboundFetch(`https://lrclib.net/api/get?${params}`, {
        headers: { 'User-Agent': 'virtuallyView/1.0 (self-hosted media dashboard)' },
        timeoutMs: 8000
      });
      if (res.ok) {
        const body = (await res.json()) as { plainLyrics?: string | null; syncedLyrics?: string | null; instrumental?: boolean };
        const synced = body.syncedLyrics ? parseSynced(body.syncedLyrics) : [];
        if (synced.length || body.plainLyrics) {
          value = { plain: body.plainLyrics ?? null, synced: synced.length ? synced : null };
        }
      }
    } catch {
      return reply.code(502).send({ message: 'The lyrics service could not be reached.' });
    }
    cache.set(key, { at: Date.now(), value });
    return value ?? reply.code(404).send({ message: 'No lyrics found for this track.' });
  });
}
