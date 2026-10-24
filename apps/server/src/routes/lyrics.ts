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

type LrcLib = { trackName?: string; artistName?: string; duration?: number; plainLyrics?: string | null; syncedLyrics?: string | null };

const lrclib = async (path: string, params: Record<string, string>): Promise<unknown> => {
  const res = await outboundFetch(`https://lrclib.net/api/${path}?${new URLSearchParams(params)}`, {
    headers: { 'User-Agent': 'virtuallyView/1.0 (self-hosted media dashboard)' },
    timeoutMs: 8000
  });
  return res.ok ? res.json() : null;
};

/** "Wasted (feat. Lil Uzi Vert) - Remastered 2020" to "Wasted": how the lyrics database names most songs. */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([](feat|ft|with|prod|remaster|explicit|clean|bonus|album version|radio edit)[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+(remaster|live|mono|stereo|explicit|single version|radio edit).*$/i, '')
    .replace(/\s+(feat|ft)\.?\s.*$/i, '')
    .trim() || title;
}

const toLyrics = (body: LrcLib | null): Lyrics | null => {
  if (!body) return null;
  const synced = body.syncedLyrics ? parseSynced(body.syncedLyrics) : [];
  return synced.length || body.plainLyrics ? { plain: body.plainLyrics ?? null, synced: synced.length ? synced : null } : null;
};

/**
 * Exact match first (artist, title, album, length), then without the album, then a search that takes the closest
 * length and prefers timed lyrics. Library tags rarely match the database word for word, so the exact call alone
 * missed most songs.
 */
async function findLyrics(artist: string, title: string, album: string, duration: number): Promise<Lyrics | null> {
  const name = cleanTitle(title);
  const base = { artist_name: artist, track_name: name, ...(duration > 0 ? { duration: String(duration) } : {}) };
  let best: Lyrics | null = null;
  for (const params of album ? [{ ...base, album_name: album }, base] : [base]) {
    const found = toLyrics(await lrclib('get', params) as LrcLib | null);
    if (found?.synced) return found;
    best ??= found;
  }
  const hits = (await lrclib('search', { artist_name: artist, track_name: name }) as LrcLib[] | null) ?? [];
  const near = hits
    .filter(h => !duration || !h.duration || Math.abs(h.duration - duration) <= 4)
    .sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics) || Math.abs((a.duration ?? 0) - duration) - Math.abs((b.duration ?? 0) - duration));
  const found = toLyrics(near[0] ?? null);
  return found?.synced ? found : best ?? found;
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
    let value: Lyrics | null;
    try {
      value = await findLyrics(artist, title, album, duration);
    } catch {
      return reply.code(502).send({ message: 'The lyrics service could not be reached.' });
    }
    cache.set(key, { at: Date.now(), value });
    return value ?? reply.code(404).send({ message: 'No lyrics found for this track.' });
  });
}
