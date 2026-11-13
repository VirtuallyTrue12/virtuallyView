import { accessSync, constants, createReadStream, statSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { parseByteRange } from '../lib/byte-range.js';
import { booksRoot } from '../services/library-folders.js';
import { favoriteBooks, setBookFavorite } from '../services/photos.js';
import { safeFetch } from '../services/radio.js';
import { currentActor } from '../services/user-context.js';
import { coverOf, fileOf, findRecord, libraryRecords, publicItem } from '../services/books/index.js';
import { allBookStates, getBookState, saveBookState, type StatePatch } from '../services/books/state.js';
import { SOURCES, SourceError, indexersAvailable, isSource, searchSource } from '../services/books/sources.js';
import { buildShelves, discover, similarity, features, type BookCard } from '../services/books/recs.js';
import { LIMITS, cancelJob, kavitaInfo, listJobs, startPull } from '../services/books/pull.js';

const cards = (fresh = false): BookCard[] => {
  const states = allBookStates();
  const favorites = new Set(favoriteBooks());
  return libraryRecords(fresh).map(r => {
    const s = states.get(r.id);
    return { ...publicItem(r), favorite: favorites.has(r.path), percent: s?.percent ?? 0, finished: s?.finished ?? false, lastOpenedAt: s?.openedAt ?? 0 };
  });
};

const COVER_HOST = /(^|\.)(gutenberg\.org|archive\.org|openlibrary\.org|librivox\.org)$/i;
const coverCache = new Map<string, { type: string; data: Buffer }>();

/** Books, audiobooks and papers: your library, search across free sources and your indexers, and pulling a book in. */
export default async function bookRoutes(server: FastifyInstance) {
  server.get('/api/books/config', async () => {
    let writable = true;
    try { accessSync(booksRoot(), constants.W_OK); } catch { writable = false; }
    return {
      writable, limits: { perUser: LIMITS.perUser, server: LIMITS.server, ebookMB: LIMITS.ebookBytes / 1048576, audioMB: LIMITS.audioBytes / 1048576 },
      sources: SOURCES.map(s => ({ ...s, available: s.id !== 'indexers' || indexersAvailable() })), kavita: await kavitaInfo()
    };
  });

  server.get<{ Querystring: { fresh?: string } }>('/api/books/library', async request => {
    const items = cards(request.query.fresh === '1');
    return { items, total: items.length };
  });

  server.get('/api/books/shelves', async () => ({ shelves: buildShelves(cards()) }));
  server.get('/api/books/discover', async () => ({ rows: await discover(cards()) }));

  server.get<{ Params: { id: string } }>('/api/books/library/:id', async (request, reply) => {
    const rec = findRecord(request.params.id);
    if (!rec) return reply.code(404).send({ message: 'Book not found.' });
    const all = cards();
    const book = all.find(b => b.id === rec.id)!;
    const mine = features(book);
    const sameAuthor = all.filter(b => b.id !== book.id && b.authors.some(a => book.authors.includes(a))).slice(0, 20);
    const similar = all.filter(b => b.id !== book.id).map(b => ({ b, s: similarity(mine, features(b)) })).filter(x => x.s > 0.1).sort((a, b) => b.s - a.s).slice(0, 12).map(x => x.b);
    return { book, state: getBookState(rec.id), moreByAuthor: sameAuthor, similar };
  });

  server.get<{ Params: { id: string } }>('/api/books/library/:id/cover', async (request, reply) => {
    const rec = findRecord(request.params.id);
    const cover = rec && coverOf(rec);
    if (!cover) return reply.code(404).send({ message: 'No cover.' });
    return reply.header('Content-Type', cover.mime).header('Cache-Control', 'private, max-age=86400').send(createReadStream(cover.abs));
  });

  // One file of a book: an ebook format or an audiobook track. Supports Range so the reader and the audio player can seek.
  server.get<{ Params: { id: string; index: string }; Querystring: { download?: string } }>('/api/books/library/:id/file/:index', async (request, reply) => {
    const rec = findRecord(request.params.id);
    const found = rec && fileOf(rec, Number(request.params.index));
    if (!found) return reply.code(404).send({ message: 'File not found.' });
    let size: number;
    try { size = statSync(found.abs).size; } catch { return reply.code(404).send({ message: 'File not found.' }); }
    reply.header('Content-Type', found.file.mime).header('Accept-Ranges', 'bytes').header('Cache-Control', 'private, max-age=3600')
      .header('Content-Disposition', `${request.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(found.file.name)}`);
    const header = request.headers.range;
    if (!header) return reply.header('Content-Length', size).send(createReadStream(found.abs));
    const range = parseByteRange(header, size);
    if (!range) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
    return reply.code(206).header('Content-Range', `bytes ${range.start}-${range.end}/${size}`).header('Content-Length', range.end - range.start + 1).send(createReadStream(found.abs, { start: range.start, end: range.end }));
  });

  server.get<{ Params: { id: string } }>('/api/books/library/:id/state', async (request, reply) => {
    if (!findRecord(request.params.id)) return reply.code(404).send({ message: 'Book not found.' });
    return { state: getBookState(request.params.id) };
  });
  server.put<{ Params: { id: string }; Body: { position?: unknown; percent?: unknown; finished?: unknown; opened?: unknown } }>('/api/books/library/:id/state', async (request, reply) => {
    if (!findRecord(request.params.id)) return reply.code(404).send({ message: 'Book not found.' });
    const b = request.body ?? {};
    const patch: StatePatch = {};
    if (b.position !== undefined) { if (typeof b.position !== 'string' || b.position.length > 2000) return reply.code(400).send({ message: 'The position must be text of at most 2000 characters.' }); patch.position = b.position; }
    if (b.percent !== undefined) { if (typeof b.percent !== 'number' || !Number.isFinite(b.percent)) return reply.code(400).send({ message: 'The percent must be a number from 0 to 100.' }); patch.percent = b.percent; }
    if (b.finished !== undefined) { if (typeof b.finished !== 'boolean') return reply.code(400).send({ message: 'Finished must be true or false.' }); patch.finished = b.finished; }
    if (b.opened === true) patch.opened = true;
    return { state: saveBookState(request.params.id, patch) };
  });

  server.post<{ Params: { id: string }; Body: { favorite?: boolean } }>('/api/books/library/:id/favorite', async (request, reply) => {
    const rec = findRecord(request.params.id);
    if (!rec) return reply.code(404).send({ message: 'Book not found.' });
    const favorite = request.body?.favorite !== false;
    setBookFavorite(rec.path, favorite);
    return { ok: true, favorite };
  });

  // ---- search: one source per call, so the page can show each answer as it arrives ----
  server.get<{ Querystring: { source?: string; q?: string } }>('/api/books/search', async (request, reply) => {
    const q = (request.query.q ?? '').trim().slice(0, 200);
    if (!isSource(request.query.source)) return reply.code(400).send({ code: 'bad_source', message: `Choose a source: ${SOURCES.map(s => s.id).join(', ')}.` });
    if (q.length < 2) return reply.code(400).send({ code: 'bad_query', message: 'Type at least two letters to search.' });
    const started = Date.now();
    try {
      return { source: request.query.source, q, results: await searchSource(request.query.source, q), ms: Date.now() - started };
    } catch (e) {
      const code = e instanceof SourceError ? e.code : 'source_error';
      return reply.code(code === 'not_configured' ? 409 : 502).send({ source: request.query.source, code, message: e instanceof SourceError ? e.message : 'That source did not answer. Try again in a moment.', ms: Date.now() - started });
    }
  });

  // Covers from the sources are loaded here, so the browser only ever talks to this server.
  server.get<{ Querystring: { u?: string } }>('/api/books/cover', async (request, reply) => {
    const raw = request.query.u ?? '';
    let url: URL;
    try { url = new URL(raw); } catch { return reply.code(400).send({ message: 'That image cannot be loaded here.' }); }
    const local = process.env.VV_RADIO_ALLOW_LOCAL === '1' && url.hostname === '127.0.0.1';
    if (!local && !(url.protocol === 'https:' && COVER_HOST.test(url.hostname))) return reply.code(400).send({ message: 'That image cannot be loaded here.' });
    const hit = coverCache.get(raw);
    if (hit) return reply.header('Content-Type', hit.type).header('Cache-Control', 'private, max-age=604800').send(hit.data);
    try {
      const res = await safeFetch(raw, { signal: AbortSignal.timeout(10_000) });
      const type = res.headers.get('content-type') ?? '';
      const data = Buffer.from(await res.arrayBuffer());
      if (!res.ok || !/^image\/(jpeg|png|webp|gif)/i.test(type) || data.length > 1_000_000) return reply.code(404).send({ message: 'No image.' });
      coverCache.set(raw, { type, data });
      if (coverCache.size > 80) coverCache.delete(coverCache.keys().next().value!);
      return reply.header('Content-Type', type).header('Cache-Control', 'private, max-age=604800').send(data);
    } catch { return reply.code(404).send({ message: 'No image.' }); }
  });

  // ---- pull ----
  server.post<{ Body: { source?: unknown; id?: unknown; format?: unknown; title?: unknown; authors?: unknown } }>('/api/books/pull', async (request, reply) => {
    const result = await startPull(request.body ?? {});
    if (!result.ok) return reply.code(result.status).send({ code: result.code, message: result.message, ...(result.bookId ? { bookId: result.bookId } : {}) });
    return reply.code(result.existing ? 200 : 202).send({ job: result.job, ...(result.existing ? { existing: true } : {}) });
  });

  server.get<{ Querystring: { all?: string } }>('/api/books/jobs', async request => {
    const actor = currentActor();
    return { jobs: listJobs(actor.userId, request.query.all === '1' && actor.role !== 'user') };
  });
  server.delete<{ Params: { id: string } }>('/api/books/jobs/:id', async (request, reply) => {
    const actor = currentActor();
    const result = await cancelJob(request.params.id, actor.userId, actor.role !== 'user');
    if (result === 'missing') return reply.code(404).send({ message: 'No such download.' });
    if (result === 'forbidden') return reply.code(403).send({ message: 'You can only cancel your own downloads.' });
    return { ok: true };
  });
}
