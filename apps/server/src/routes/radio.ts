import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { countListen, favoriteStations, nowPlaying, radioCountries, radioRegions, radioTags, recentStations, safeFetch, searchStations, setStationFavorite, stationById, stationInfo, touchStation } from '../services/radio.js';
import { rewriteHls } from '../services/live-tv.js';
import { currentActor } from '../services/user-context.js';

const ID = /^[0-9a-f-]{36}$/i;
const OPEN_PER_PERSON = 3;
const open = new Map<string, number>();
const fail = (error: unknown) => (error instanceof Error ? error.message : 'The radio directory could not be reached.');

/** Internet radio by region. The stream address never reaches the page; audio is relayed from here. */
export default async function radioRoutes(server: FastifyInstance) {
  server.get('/api/radio/countries', async (_request, reply) => { try { return { countries: await radioCountries() }; } catch (e) { return reply.code(502).send({ message: fail(e) }); } });
  server.get<{ Querystring: { country?: string } }>('/api/radio/regions', async request => ({ regions: await radioRegions(request.query.country ?? '').catch(() => []) }));
  server.get('/api/radio/tags', async () => ({ tags: await radioTags().catch(() => []) }));

  server.get<{ Querystring: { country?: string; region?: string; tag?: string; q?: string; language?: string; offset?: string } }>('/api/radio/stations', async (request, reply) => {
    try {
      const { country, region, tag, q, language } = request.query;
      return await searchStations({ country, region, tag, q, language, offset: Number(request.query.offset) || 0 });
    } catch (e) { return reply.code(502).send({ message: fail(e) }); }
  });

  server.get('/api/radio/me', async () => ({ favorites: favoriteStations(), recent: recentStations() }));
  server.post<{ Body: { id?: string; favorite?: boolean } }>('/api/radio/favorite', async (request, reply) => {
    const id = String(request.body?.id ?? '');
    const station = await stationInfo(id);
    if (!station) return reply.code(404).send({ message: 'That station could not be found. Try again in a moment.' });
    setStationFavorite(station, request.body?.favorite !== false);
    return { ok: true };
  });
  server.post<{ Body: { id?: string } }>('/api/radio/played', async (request, reply) => {
    const id = String(request.body?.id ?? '');
    const station = await stationInfo(id);
    if (!station) return reply.code(404).send({ message: 'Station not found.' });
    touchStation(station);
    countListen(id);
    return { ok: true };
  });

  // What the station says is playing now (artist and title), when it tells.
  server.get<{ Params: { id: string } }>('/api/radio/now/:id', async (request, reply) => {
    const station = ID.test(request.params.id) ? await stationById(request.params.id) : undefined;
    if (!station) return reply.code(404).send({ message: 'Station not found.' });
    return { title: await nowPlaying(station.url) };
  });

  server.get<{ Params: { id: string } }>('/api/radio/logo/:id', async (request, reply) => {
    const station = ID.test(request.params.id) ? await stationById(request.params.id) : undefined;
    if (!station?.favicon) return reply.code(404).send();
    try {
      const res = await safeFetch(station.favicon, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'virtuallyView' } });
      const type = res.headers.get('content-type') ?? '';
      const size = Number(res.headers.get('content-length') ?? 0);
      if (!res.ok || !/^image\/(png|jpe?g|webp|gif|x-icon|vnd\.microsoft\.icon)/i.test(type) || size > 400_000) return reply.code(404).send();
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > 400_000) return reply.code(404).send();
      return reply.header('Content-Type', type).header('Cache-Control', 'public, max-age=86400').header('X-Content-Type-Options', 'nosniff').send(bytes);
    } catch { return reply.code(404).send(); }
  });

  // The audio: relayed, so an http:// station plays on an https:// page and never sees the viewer.
  server.get<{ Params: { id: string } }>('/api/radio/stream/:id', async (request, reply) => {
    const station = ID.test(request.params.id) ? await stationById(request.params.id) : undefined;
    if (!station) return reply.code(404).send({ message: 'That station is not in the directory any more.' });
    const who = currentActor().userId;
    if ((open.get(who) ?? 0) >= OPEN_PER_PERSON) return reply.code(429).header('Retry-After', '10').send({ message: 'Too many stations are playing at once. Close one first.' });
    const controller = new AbortController();
    try {
      const upstream = await safeFetch(station.url, { signal: controller.signal, headers: { 'User-Agent': 'virtuallyView', Accept: 'audio/*,*/*' } });
      if (!upstream.ok || !upstream.body) return reply.code(502).send({ message: `The station answered ${upstream.status}. It may be off the air.` });
      const type = upstream.headers.get('content-type') ?? '';
      if (/mpegurl/i.test(type) || /\.m3u8?(\?|$)/i.test(station.url)) {
        const body = rewriteHls(await upstream.text(), upstream.url || station.url);
        return reply.header('Content-Type', 'application/vnd.apple.mpegurl').header('Cache-Control', 'no-store').send(body);
      }
      open.set(who, (open.get(who) ?? 0) + 1);
      const done = () => { controller.abort(); open.set(who, Math.max(0, (open.get(who) ?? 1) - 1)); };
      let ended = false;
      request.raw.on('close', () => { if (!ended) { ended = true; done(); } });
      const stream = Readable.fromWeb(upstream.body as never);
      stream.on('error', () => undefined);
      return reply.header('Content-Type', /^audio\//i.test(type) || /ogg|aac|mpeg/i.test(type) ? type : 'audio/mpeg').header('Cache-Control', 'no-store').header('X-Accel-Buffering', 'no').send(stream);
    } catch (e) {
      if (e instanceof Error && e.message === 'That address is not allowed.') return reply.code(400).send({ message: 'That station points somewhere it should not.' });
      return reply.code(502).send({ message: e instanceof Error && e.name === 'TimeoutError' ? 'The station did not answer.' : 'The station could not be reached. It may be off the air.' });
    }
  });
}
