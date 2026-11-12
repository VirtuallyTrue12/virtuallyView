import type { FastifyInstance } from 'fastify';
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { parseByteRange } from '../lib/byte-range.js';
import { checked, countListen, countryStations, favoriteStations, nowPlayingInfo, openSource, radioCountries, radioRegions, radioTags, recentStations, safeFetch, searchStations, setStationFavorite, stationById, stationInfo, touchStation, type Station } from '../services/radio.js';
import { buildHome, type RadioHome } from '../services/radio-home.js';
import { deleteRadioRecording, listRadioRecordings, radioRecordingFile, startRadioRecording, stopRadioRecording } from '../services/radio-recordings.js';
import { ensureBuffer, readPlaylist, segmentFile } from '../services/radio-timeshift.js';
import { rewriteHls } from '../services/live-tv.js';
import { currentActor } from '../services/user-context.js';

const ID = /^[0-9a-f-]{36}$/i;
const OPEN_PER_PERSON = 3;
const open = new Map<string, number>();
const fail = (error: unknown) => (error instanceof Error ? error.message : 'The radio directory could not be reached.');
const HOME_MS = 2 * 60_000;
const homeCache = new Map<string, { at: number; value: RadioHome & { hidden: number } }>();

/** Internet radio by region. The stream address never reaches the page; audio is relayed from here. */
export default async function radioRoutes(server: FastifyInstance) {
  server.get('/api/radio/countries', async (_request, reply) => { try { return { countries: await radioCountries() }; } catch (e) { return reply.code(502).send({ message: fail(e) }); } });
  server.get<{ Querystring: { country?: string } }>('/api/radio/regions', async request => ({ regions: await radioRegions(request.query.country ?? '').catch(() => []) }));
  server.get('/api/radio/tags', async () => ({ tags: await radioTags().catch(() => []) }));

  server.get<{ Querystring: { country?: string; region?: string; tag?: string; q?: string; language?: string; offset?: string; live?: string; all?: string } }>('/api/radio/stations', async (request, reply) => {
    try {
      const { country, region, tag, q, language } = request.query;
      return await searchStations({ country, region, tag, q, language, offset: Number(request.query.offset) || 0, liveOnly: request.query.live === '1', all: request.query.all === '1' });
    } catch (e) { return reply.code(502).send({ message: fail(e) }); }
  });

  // The radio home: featured stations, then rows by topic, region and (India) language. Live broadcasts that the
  // background check has not found dead, unless all=1.
  server.get<{ Querystring: { country?: string; region?: string; all?: string } }>('/api/radio/home', async (request, reply) => {
    const started = performance.now();
    const country = (request.query.country ?? '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) return reply.code(400).send({ message: 'Choose a country.' });
    const region = (request.query.region ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60);
    const all = request.query.all === '1';
    const key = `${country}|${region.toLowerCase()}|${all}`;
    let value = homeCache.get(key);
    if (!value || Date.now() - value.at > HOME_MS) {
      try {
        const [list, near] = await Promise.all([countryStations(country), region ? countryStations(country, region).catch(() => []) : []]);
        const live = (l: Station[]) => (all ? l : l.filter(s => s.kind === 'live'));
        const shown = checked(live(list), all);
        const home = buildHome(shown, { country, near: checked(live(near), all), ...(region ? { region } : {}) });
        value = { at: Date.now(), value: { ...home, hidden: live(list).length - shown.length } };
        homeCache.set(key, value);
        if (homeCache.size > 100) homeCache.delete(homeCache.keys().next().value!);
      } catch (e) { return reply.code(502).send({ message: fail(e) }); }
    }
    return reply.header('Server-Timing', `home;dur=${Math.round(performance.now() - started)}`).header('Cache-Control', 'no-store').send(value.value);
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

  // What the station says is playing now (artist, song and its cover), when it tells.
  server.get<{ Params: { id: string } }>('/api/radio/now/:id', async (request, reply) => {
    const station = ID.test(request.params.id) ? await stationById(request.params.id) : undefined;
    if (!station) return reply.code(404).send({ message: 'Station not found.' });
    return nowPlayingInfo(request.params.id, station);
  });

  // Pause and rewind: the station through a rolling 30-minute buffer on this server, as HLS (services/radio-timeshift).
  server.get<{ Params: { id: string } }>('/api/radio/live/:id/index.m3u8', async (request, reply) => {
    const station = ID.test(request.params.id) ? await stationById(request.params.id) : undefined;
    if (!station) return reply.code(404).send({ message: 'That station is not in the directory any more.' });
    const who = currentActor().userId;
    const started = await ensureBuffer(request.params.id, who, signal => openSource(station.url, signal));
    if (!started.ok) return reply.code(started.status).send({ message: started.message });
    const text = readPlaylist(request.params.id, who);
    if (!text) return reply.code(502).send({ message: 'The station stopped sending audio.' });
    return reply.header('Content-Type', 'application/vnd.apple.mpegurl').header('Cache-Control', 'no-store').send(text);
  });
  server.get<{ Params: { id: string; segment: string } }>('/api/radio/live/:id/:segment', async (request, reply) => {
    const file = ID.test(request.params.id) ? segmentFile(request.params.id, request.params.segment) : null;
    if (!file) return reply.code(404).send({ message: 'That part of the broadcast is no longer kept.' });
    return reply.header('Content-Type', 'video/mp2t').header('Cache-Control', 'private, max-age=3600').send(createReadStream(file));
  });

  // Recording a show. Each person sees and manages only their own (services/radio-recordings).
  server.post<{ Body: { id?: string; minutes?: number } }>('/api/radio/record', async (request, reply) => {
    const id = String(request.body?.id ?? '');
    const station = ID.test(id) ? await stationById(id) : undefined;
    if (!station) return reply.code(404).send({ message: 'That station is not in the directory any more.' });
    const result = await startRadioRecording(currentActor().userId, { id, name: station.name }, Number(request.body?.minutes), signal => openSource(station.url, signal));
    return result.ok ? result.recording : reply.code(result.status).send({ message: result.message });
  });
  server.get('/api/radio/recordings', async () => ({ recordings: listRadioRecordings(currentActor().userId) }));
  server.post<{ Params: { id: string } }>('/api/radio/record/:id/stop', async (request, reply) =>
    stopRadioRecording(currentActor().userId, request.params.id) ? { ok: true } : reply.code(404).send({ message: 'That recording is not running.' }));
  server.delete<{ Params: { id: string } }>('/api/radio/recordings/:id', async (request, reply) =>
    deleteRadioRecording(currentActor().userId, request.params.id) ? { ok: true } : reply.code(404).send({ message: 'Recording not found.' }));
  server.get<{ Params: { id: string } }>('/api/radio/recordings/:id/file', async (request, reply) => {
    const file = radioRecordingFile(currentActor().userId, request.params.id);
    if (!file) return reply.code(404).send({ message: 'Recording not found.' });
    const size = statSync(file).size;
    reply.header('Accept-Ranges', 'bytes').header('Cache-Control', 'private, no-store').type('audio/mp4');
    if (!request.headers.range) return reply.header('Content-Length', size).send(createReadStream(file));
    const range = parseByteRange(request.headers.range, size);
    if (!range) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
    return reply.code(206).header('Content-Range', `bytes ${range.start}-${range.end}/${size}`).header('Content-Length', range.end - range.start + 1).send(createReadStream(file, range));
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
        const body = rewriteHls(await upstream.text(), upstream.url || station.url, true);
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
