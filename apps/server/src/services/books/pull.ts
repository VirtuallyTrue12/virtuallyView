import { createHash, randomUUID } from 'node:crypto';
import { accessSync, closeSync, constants, copyFileSync, createWriteStream, existsSync, mkdirSync, openSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import type { QBittorrentAdapter } from '@virtuallyview/integrations';
import { all, db, run } from '../../db/app-db.js';
import { booksRoot } from '../library-folders.js';
import { getAdapter } from '../registry.js';
import { safeFetch } from '../radio.js';
import { currentActor } from '../user-context.js';
import { freeBytesAt, spaceCheck } from '../storage-planner.js';
import { listApps, savedApp } from '../homelab-apps.js';
import { AUDIO_EXT, EBOOK_EXT, invalidateLibrary, libraryRecords, matchLibrary, sanitizeSegment } from './index.js';
import { looksLikeEpub, readEpub } from './epub.js';
import { isSource, resolveItem, SourceError, type BookFormat, type Resolved, type SourceId } from './sources.js';

// Pull: bring a book from a source into /media/books. Direct downloads stream to a hidden staging folder inside the
// books folder (so the final move is a rename), are checked by their first bytes, then filed as Author/Title/file with
// a metadata.json. Torrents go to qBittorrent (category vv-books) and are copied in when they finish.

export type JobStatus = 'queued' | 'downloading' | 'processing' | 'done' | 'failed' | 'canceled';
export interface PullJob {
  id: string; userId: string; source: SourceId; sourceId: string; format: BookFormat['kind']; title: string; authors: string[];
  status: JobStatus; /** 0 to 100. */ percent: number; message: string; bytes: number; total: number; bookId?: string; createdAt: number; updatedAt: number; hash?: string;
}

export const LIMITS = { perUser: 3, server: 6, ebookBytes: 500 * 1024 * 1024, audioBytes: 2 * 1024 ** 3, textBytes: 50 * 1024 * 1024 };
export const TORRENT_CATEGORY = 'vv-books';
const STAGING = '.vv-pull';
const ACTIVE: JobStatus[] = ['queued', 'downloading', 'processing'];

// ---------- persistence ----------
let ready = false;
function table(): void {
  if (ready) return;
  db().exec('CREATE TABLE IF NOT EXISTS book_jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  ready = true;
}
const jobs = new Map<string, PullJob>();
const controllers = new Map<string, AbortController>();
let resumed = false;

function persist(job: PullJob): void {
  job.updatedAt = Date.now();
  try { table(); run('INSERT INTO book_jobs (id, user_id, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at', job.id, job.userId, JSON.stringify(job), job.updatedAt); } catch { /* memory still has it */ }
}
const set = (job: PullJob, patch: Partial<PullJob>) => { Object.assign(job, patch); persist(job); };

/** Load saved jobs once per start: direct downloads that were running are failed, torrents are followed again. */
function load(): void {
  if (resumed) return;
  resumed = true;
  try {
    table();
    run('DELETE FROM book_jobs WHERE updated_at < ?', Date.now() - 14 * 86_400_000);
    for (const row of all<{ payload: string }>('SELECT payload FROM book_jobs ORDER BY updated_at DESC LIMIT 500')) {
      const job = JSON.parse(row.payload) as PullJob;
      if (ACTIVE.includes(job.status) && !(job.format === 'torrent' && job.hash)) { job.status = 'failed'; job.message = 'The server restarted while this was downloading. Pull it again.'; persist(job); }
      jobs.set(job.id, job);
    }
  } catch { /* start empty */ }
  if ([...jobs.values()].some(j => j.format === 'torrent' && ACTIVE.includes(j.status))) startTicker();
}

export function listJobs(userId: string, everyone = false): PullJob[] {
  load();
  return [...jobs.values()].filter(j => everyone || j.userId === userId).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
}
export const activeCount = (userId?: string): number => [...jobs.values()].filter(j => ACTIVE.includes(j.status) && (!userId || j.userId === userId)).length;

// ---------- checks ----------
function head(file: string, n: number): Buffer {
  const fd = openSync(file, 'r');
  try { const b = Buffer.alloc(n); return b.subarray(0, readSync(fd, b, 0, n, 0)); } finally { closeSync(fd); }
}

/** Why this file is not what it claims to be, or null. Looks at the first bytes, not the name. */
export function checkFile(file: string, ext: string): string | null {
  const h = head(file, 4096);
  if (!h.length) return 'The download was empty.';
  const html = /^\s*(<!doctype html|<html|<\?xml)/i.test(h.subarray(0, 200).toString('latin1')) && ext !== 'txt';
  if (html) return 'The source sent a web page instead of the file.';
  if (ext === 'epub') return h.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4])) && looksLikeEpub(file) ? null : 'That is not a valid EPUB.';
  if (ext === 'pdf') return h.includes('%PDF-') ? null : 'That is not a valid PDF.';
  if (ext === 'zip') return h.subarray(0, 2).toString('latin1') === 'PK' ? null : 'That is not a valid zip file.';
  if (ext === 'txt') return h.includes(0) ? 'That is not a text file.' : null;
  if (ext === 'mp3') return h.subarray(0, 3).toString('latin1') === 'ID3' || (h[0] === 0xff && ((h[1] ?? 0) & 0xe0) === 0xe0) ? null : 'That is not a valid MP3.';
  if (['m4b', 'm4a'].includes(ext)) return h.subarray(4, 8).toString('latin1') === 'ftyp' ? null : 'That is not a valid audio book file.';
  if (ext === 'ogg' || ext === 'opus') return h.subarray(0, 4).toString('latin1') === 'OggS' ? null : 'That is not a valid audio file.';
  if (ext === 'flac') return h.subarray(0, 4).toString('latin1') === 'fLaC' ? null : 'That is not a valid audio file.';
  return null; // mobi, azw3, cbz, cbr, aac, wav: accepted by name
}

const isImage = (b: Buffer) => (b[0] === 0xff && b[1] === 0xd8) || b.subarray(1, 4).toString('latin1') === 'PNG';

/** Free space and write access for the books folder; null when fine. */
async function roomProblem(sizeBytes: number): Promise<{ status: number; code: string; message: string } | null> {
  const root = booksRoot();
  try { mkdirSync(root, { recursive: true }); accessSync(root, constants.W_OK); } catch {
    return { status: 503, code: 'books_read_only', message: 'The books folder is read-only. Mount it read-write in docker-compose.yml (the app line for /media/books must not end in :ro) and restart.' };
  }
  // Test-only: scratch disks in the tests are smaller than the 10 GB safety margin. Never set this on a real server.
  if (process.env.VV_BOOKS_TEST === '1') return null;
  const room = spaceCheck(await freeBytesAt(root), sizeBytes);
  return room.ok ? null : { status: 507, code: 'no_space', message: room.message };
}

// ---------- starting a pull ----------
export type StartResult = { ok: true; job: PullJob; existing?: boolean } | { ok: false; status: number; code: string; message: string; bookId?: string };

export async function startPull(body: { source?: unknown; id?: unknown; format?: unknown; title?: unknown; authors?: unknown }): Promise<StartResult> {
  load();
  const actor = currentActor();
  const kinds = ['epub', 'pdf', 'txt', 'audio', 'torrent'];
  if (!isSource(body.source) || typeof body.id !== 'string' || !body.id.trim() || body.id.length > 300) return { ok: false, status: 400, code: 'bad_request', message: 'Say which source and which item to pull.' };
  const format = (typeof body.format === 'string' && kinds.includes(body.format) ? body.format : body.source === 'indexers' ? 'torrent' : body.source === 'librivox' ? 'audio' : 'epub') as BookFormat['kind'];
  const source = body.source, sourceId = body.id.trim();
  const again = [...jobs.values()].find(j => j.source === source && j.sourceId === sourceId && ACTIVE.includes(j.status));
  if (again) return { ok: true, job: again, existing: true };
  const owned = matchLibrary('', [], source === 'openlibrary' ? 'archive' : source, sourceId);
  if (owned) return { ok: false, status: 409, code: 'already_in_library', message: 'That book is already in the library.', bookId: owned };
  if (activeCount(actor.userId) >= LIMITS.perUser) return { ok: false, status: 429, code: 'limit', message: `You already have ${LIMITS.perUser} books downloading. Wait for one to finish.` };
  if (activeCount() >= LIMITS.server) return { ok: false, status: 429, code: 'limit', message: 'The server is busy with other downloads. Try again in a few minutes.' };

  let resolved: Resolved | null;
  try { resolved = await resolveItem(source, sourceId, format); } catch (e) {
    return { ok: false, status: 502, code: e instanceof SourceError ? e.code : 'source_error', message: e instanceof SourceError ? e.message : 'That source did not answer. Try again in a moment.' };
  }
  if (!resolved) return { ok: false, status: 404, code: 'not_found', message: 'The source no longer has that item.' };
  if (resolved.problem) return { ok: false, status: 422, code: 'not_available', message: resolved.problem };
  // Torrent search results have no author; a hint from the page is accepted for naming only.
  if (source === 'indexers') {
    if (typeof body.title === 'string' && body.title.trim()) resolved.title = body.title.trim().slice(0, 200);
    if (Array.isArray(body.authors)) resolved.authors = body.authors.filter((a): a is string => typeof a === 'string').map(a => a.trim().slice(0, 100)).filter(Boolean).slice(0, 4);
  }
  const own = resolved.authors.length || source !== 'indexers' ? matchLibrary(resolved.title, resolved.authors) : undefined;
  if (own) return { ok: false, status: 409, code: 'already_in_library', message: 'That book is already in the library.', bookId: own };
  const size = resolved.download?.size ?? resolved.release?.size ?? 0;
  const cap = format === 'audio' || format === 'torrent' ? LIMITS.audioBytes : format === 'txt' ? LIMITS.textBytes : LIMITS.ebookBytes;
  if (size > cap) return { ok: false, status: 413, code: 'too_large', message: `That file is larger than the ${Math.round(cap / 1048576)} MB limit.` };
  const problem = await roomProblem(size);
  if (problem) return { ok: false, ...problem };

  const now = Date.now();
  const job: PullJob = { id: randomUUID(), userId: actor.userId, source, sourceId, format: resolved.download?.kind ?? format, title: resolved.title, authors: resolved.authors, status: 'queued', percent: 0, message: 'Starting.', bytes: 0, total: size, createdAt: now, updatedAt: now };
  jobs.set(job.id, job);
  persist(job);
  const abort = new AbortController();
  controllers.set(job.id, abort);
  void (resolved.release ? startTorrent(job, resolved) : runDirect(job, resolved, abort.signal)).catch(e => {
    if (job.status === 'canceled') return;
    set(job, { status: 'failed', message: e instanceof Error && e.message ? e.message : 'The download failed.' });
  }).finally(() => { controllers.delete(job.id); rmSync(path.join(booksRoot(), STAGING, job.id), { recursive: true, force: true }); });
  return { ok: true, job };
}

export async function cancelJob(id: string, userId: string, isAdmin: boolean): Promise<'ok' | 'missing' | 'forbidden'> {
  load();
  const job = jobs.get(id);
  if (!job) return 'missing';
  if (job.userId !== userId && !isAdmin) return 'forbidden';
  if (ACTIVE.includes(job.status)) {
    set(job, { status: 'canceled', message: 'Canceled.' });
    controllers.get(id)?.abort();
    if (job.hash) { try { await getAdapter<QBittorrentAdapter>('qbittorrent').removeWithFiles(job.hash); } catch { /* it may be gone already */ } }
  } else { jobs.delete(id); try { run('DELETE FROM book_jobs WHERE id = ?', id); } catch { /* ignore */ } }
  return 'ok';
}

// ---------- direct downloads ----------
async function download(url: string, dest: string, cap: number, job: PullJob, signal: AbortSignal): Promise<void> {
  const res = await safeFetch(url, { headers: { 'User-Agent': 'virtuallyView/0.4 (self-hosted book download)' }, signal });
  if (!res.ok || !res.body) throw new Error(`The source answered ${res.status}.`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > cap) throw new Error(`That file is larger than the ${Math.round(cap / 1048576)} MB limit.`);
  if (len) set(job, { total: len });
  let bytes = 0, last = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > cap) return cb(new Error(`That file is larger than the ${Math.round(cap / 1048576)} MB limit.`));
      if (Date.now() - last > 1000) { last = Date.now(); job.bytes = bytes; job.percent = job.total ? Math.min(99, Math.round(bytes / job.total * 100)) : 0; persist(job); }
      cb(null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(dest), { signal });
  job.bytes = bytes;
}

// unzip exits 11 when one of the wanted patterns matched nothing (a zip with only mp3s), which is fine.
const execFileP = (cmd: string, args: string[], timeout: number) => new Promise<void>((ok, no) => execFile(cmd, args, { timeout, maxBuffer: 1 << 20 }, err => (err && (err as { code?: number }).code !== 11 ? no(err) : ok())));

/** Author/Title (Year) folder under the books root for a pulled book. */
export function targetFolder(authors: string[], title: string, year?: number): string {
  return path.join(booksRoot(), sanitizeSegment(authors[0] ?? '', 'Unknown Author'), sanitizeSegment(year ? `${title} (${year})` : title, 'Untitled'));
}

async function runDirect(job: PullJob, r: Resolved, signal: AbortSignal): Promise<void> {
  const d = r.download!;
  const stage = path.join(booksRoot(), STAGING, job.id);
  mkdirSync(stage, { recursive: true });
  set(job, { status: 'downloading', message: 'Downloading.' });
  const raw = path.join(stage, 'download');
  await download(d.url, raw, d.kind === 'audio' ? LIMITS.audioBytes : d.kind === 'txt' ? LIMITS.textBytes : LIMITS.ebookBytes, job, signal);
  set(job, { status: 'processing', percent: 99, message: 'Checking the file.' });
  const bad = checkFile(raw, d.kind === 'audio' ? 'zip' : d.kind);
  if (bad) throw new Error(bad);
  const folder = targetFolder(r.authors, r.title, r.year);
  const names: string[] = [];
  if (d.kind === 'audio') {
    const out = path.join(stage, 'tracks');
    mkdirSync(out);
    // -j drops folder names (no path can climb out); only audio is extracted.
    // shortcut: no cap on the unpacked size beyond the 2 GB download limit, upgrade if zip bombs become a worry.
    await execFileP('unzip', ['-j', '-n', '-qq', raw, ...AUDIO_EXT.map(e => `*.${e}`), '-d', out], 20 * 60_000);
    for (const f of readdirSync(out).filter(f => new RegExp(`\\.(${AUDIO_EXT.join('|')})$`, 'i').test(f))) {
      const err = checkFile(path.join(out, f), path.extname(f).slice(1).toLowerCase());
      if (err) throw new Error(`${f}: ${err}`);
      names.push(f);
    }
    if (!names.length) throw new Error('The download had no audio files in it.');
    mkdirSync(folder, { recursive: true });
    for (const f of names) renameSync(path.join(out, f), path.join(folder, sanitizeSegment(f, 'track', 150)));
  } else {
    const name = `${sanitizeSegment(r.title, 'Untitled', 120)}.${d.kind}`;
    const final = path.join(folder, name);
    if (existsSync(final)) throw new Error('That book is already in the library.');
    mkdirSync(folder, { recursive: true });
    renameSync(raw, final);
    names.push(name);
  }
  await finish(job, folder, r, names.length === 1 || d.kind === 'audio');
}

/** Cover and metadata.json next to the files, then the library and Kavita are told. */
async function finish(job: PullJob, folder: string, r: Resolved, single: boolean): Promise<void> {
  if (r.coverUrl && !existsSync(path.join(folder, 'cover.jpg')) && !existsSync(path.join(folder, 'cover.png'))) {
    try {
      const res = await safeFetch(r.coverUrl, { signal: AbortSignal.timeout(10_000) });
      const bytes = Buffer.from(await res.arrayBuffer());
      if (res.ok && bytes.length > 500 && bytes.length < 3_000_000 && isImage(bytes)) writeFileSync(path.join(folder, bytes[0] === 0xff ? 'cover.jpg' : 'cover.png'), bytes);
    } catch { /* a book without a cover is fine */ }
  }
  writeFileSync(path.join(folder, 'metadata.json'), JSON.stringify({
    source: job.source === 'openlibrary' ? 'archive' : job.source, sourceId: job.sourceId, ...(single && r.title ? { title: r.title } : {}), ...(single && r.authors.length ? { authors: r.authors } : {}),
    ...(r.year ? { year: r.year } : {}), ...(r.language ? { language: r.language } : {}), subjects: r.subjects.slice(0, 30), ...(r.description ? { description: r.description } : {}), pulledAt: new Date().toISOString()
  }, null, 2));
  invalidateLibrary();
  const rel = path.relative(booksRoot(), folder).split(path.sep).join('/');
  const found = libraryRecords(true).find(b => b.path === rel || b.path.startsWith(`${rel}/`));
  set(job, { status: 'done', percent: 100, message: 'In the library.', ...(found ? { bookId: found.id } : {}) });
  void kavitaScan();
}

// ---------- torrents ----------
const btih = (magnet: string): string | undefined => {
  const m = /xt=urn:btih:([a-z0-9]+)/i.exec(magnet)?.[1];
  if (!m) return undefined;
  if (m.length === 40) return m.toLowerCase();
  if (m.length !== 32) return undefined;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of m.toUpperCase()) { const i = alphabet.indexOf(c); if (i < 0) return undefined; bits += i.toString(2).padStart(5, '0'); }
  return bits.match(/.{8}/g)!.map(b => parseInt(b, 2).toString(16).padStart(2, '0')).join('');
};

/** The info-hash of a .torrent file (sha1 of its bencoded "info" dictionary), so the torrent can be followed without guessing. */
export function torrentInfoHash(bytes: Uint8Array): string | undefined {
  const b = Buffer.from(bytes);
  const end = (i: number): number => {
    const c = b[i];
    if (c === 0x69) return b.indexOf(0x65, i) + 1; // i...e
    if (c === 0x6c || c === 0x64) { let p = i + 1; while (p < b.length && b[p] !== 0x65) p = end(p); return p + 1; } // l...e, d...e
    const colon = b.indexOf(0x3a, i);
    const len = Number(b.toString('latin1', i, colon));
    return colon < 0 || !Number.isFinite(len) ? b.length + 1 : colon + 1 + len;
  };
  if (b[0] !== 0x64) return undefined;
  for (let p = 1; p < b.length && b[p] !== 0x65;) {
    const keyEnd = end(p);
    const key = b.toString('latin1', b.indexOf(0x3a, p) + 1, keyEnd);
    const valueEnd = end(keyEnd);
    if (valueEnd > b.length) return undefined;
    if (key === 'info') return createHash('sha1').update(b.subarray(keyEnd, valueEnd)).digest('hex');
    p = valueEnd;
  }
  return undefined;
}

async function startTorrent(job: PullJob, r: Resolved): Promise<void> {
  const qbit = getAdapter<QBittorrentAdapter>('qbittorrent');
  const release = r.release!;
  const before = new Set((await qbit.listTorrents().catch(() => [])).map(t => t.hash.toLowerCase()));
  let result: { success: boolean; message: string };
  let hash: string | undefined;
  if (release.downloadUrl.startsWith('magnet:')) { hash = btih(release.downloadUrl); result = await qbit.addMagnet(release.downloadUrl, TORRENT_CATEGORY); }
  else {
    const res = await fetch(release.downloadUrl, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location?.startsWith('magnet:')) { hash = btih(location); result = await qbit.addMagnet(location, TORRENT_CATEGORY); }
    else if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!bytes.length || bytes.length > 5_000_000) throw new Error('The indexer did not give a usable torrent file.');
      hash = torrentInfoHash(bytes);
      result = await qbit.addTorrentFile(bytes, TORRENT_CATEGORY);
    } else throw new Error(`The indexer answered ${res.status}. Try another result.`);
  }
  if (!result.success) throw new Error(result.message);
  for (let i = 0; i < 20 && !hash; i++) {
    await new Promise(go => setTimeout(go, 1000));
    hash = (await qbit.listTorrents().catch(() => [])).find(t => t.category === TORRENT_CATEGORY && !before.has(t.hash.toLowerCase()))?.hash.toLowerCase();
  }
  if (!hash) throw new Error('qBittorrent did not list the torrent. Check the Downloads page.');
  // Keep it with the other downloads of this kind; failing to move it is harmless.
  void qbit.setLocation(hash, '/downloads/books').catch(() => undefined);
  set(job, { status: 'downloading', hash, message: 'Downloading with qBittorrent.' });
  startTicker();
}

let ticker: NodeJS.Timeout | null = null;
function startTicker(): void {
  if (ticker) return;
  ticker = setInterval(() => { void tick().catch(() => undefined); }, 5000);
  ticker.unref();
}
const DONE_STATES = /^(uploading|stalledUP|pausedUP|stoppedUP|queuedUP|forcedUP|checkingUP)$/;

async function tick(): Promise<void> {
  const mine = [...jobs.values()].filter(j => j.format === 'torrent' && j.hash && ACTIVE.includes(j.status) && j.status !== 'processing');
  if (!mine.length) { if (ticker) { clearInterval(ticker); ticker = null; } return; }
  const torrents = await getAdapter<QBittorrentAdapter>('qbittorrent').listTorrents();
  for (const job of mine) {
    const t = torrents.find(x => x.hash.toLowerCase() === job.hash);
    if (!t) { set(job, { status: 'failed', message: 'The torrent was removed from qBittorrent.' }); continue; }
    if (t.state === 'error' || t.state === 'missingFiles') { set(job, { status: 'failed', message: 'qBittorrent reports a problem with this download.' }); continue; }
    if (t.progress < 100 && !DONE_STATES.test(t.state)) { if (t.progress !== job.percent) set(job, { percent: Math.min(99, t.progress), total: t.size }); continue; }
    set(job, { status: 'processing', percent: 99, message: 'Copying into the library.' });
    void copyTorrent(job, t.contentPath || path.join(t.savePath, t.name)).catch(e => set(job, { status: 'failed', message: e instanceof Error ? e.message : 'Could not copy the files.' }));
  }
}

function collect(from: string, out: string[] = [], depth = 0): string[] {
  const st = statSync(from);
  if (st.isFile()) return [from];
  if (depth > 6 || out.length > 400) return out;
  for (const name of readdirSync(from)) {
    const child = path.join(from, name);
    let s; try { s = statSync(child); } catch { continue; }
    if (s.isDirectory()) collect(child, out, depth + 1);
    else if (new RegExp(`\\.(${[...EBOOK_EXT, ...AUDIO_EXT].join('|')})$`, 'i').test(name)) out.push(child);
  }
  return out;
}

/** "Author - Title [pdf] (2005)" style release names, as best as can be told. */
export function titleFromRelease(name: string): { title: string; authors: string[] } {
  const clean = name.replace(/\.(epub|pdf|mobi|azw3|zip|rar|m4b|mp3)$/i, '').replace(/[[(][^\])]*[\])]/g, ' ').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  const dash = clean.split(/\s+-\s+/);
  return dash.length === 2 ? { authors: [dash[0]!.trim()], title: dash[1]!.trim() } : { authors: [], title: clean || name };
}

async function copyTorrent(job: PullJob, content: string): Promise<void> {
  if (!existsSync(content)) throw new Error('The server cannot see qBittorrent\'s download folder. Both must share the /downloads volume.');
  const files = collect(content);
  const audio = files.filter(f => new RegExp(`\\.(${AUDIO_EXT.join('|')})$`, 'i').test(f));
  let books = files.filter(f => !audio.includes(f));
  // A .txt next to a real book is a readme ("free audiobook version.txt"), not a book.
  if (books.some(f => !/\.txt$/i.test(f))) books = books.filter(f => !/\.txt$/i.test(f));
  if (!files.length) throw new Error('That torrent has no book or audio files in it.');
  const cap = LIMITS.audioBytes;
  if (files.reduce((n, f) => n + statSync(f).size, 0) > cap) throw new Error('That torrent is larger than the 2 GB limit.');
  const stage = path.join(booksRoot(), STAGING, job.id);
  mkdirSync(stage, { recursive: true });
  try {
    const guess = titleFromRelease(job.title);
    const chosen = audio.length && audio.length >= books.length ? audio : books;
    const staged: string[] = [];
    for (const f of chosen) {
      const rel = path.relative(content, f);
      const name = sanitizeSegment(rel.includes(path.sep) ? rel.split(path.sep).join(' - ') : path.basename(f), 'file', 150);
      const dest = path.join(stage, name);
      if (existsSync(dest)) continue;
      copyFileSync(f, dest);
      const err = checkFile(dest, path.extname(name).slice(1).toLowerCase());
      if (err) throw new Error(`${name}: ${err}`);
      staged.push(dest);
    }
    // One EPUB tells the real title and author; otherwise the release name is the best guess.
    const stems = new Set(staged.map(f => path.basename(f).replace(/\.[^.]+$/, '').toLowerCase()));
    const single = audio.length >= books.length || stems.size === 1;
    const epub = single ? staged.find(f => /\.epub$/i.test(f)) : undefined;
    const meta = epub ? readEpub(epub)?.meta : undefined;
    const title = meta?.title || guess.title, authors = meta?.authors.length ? meta.authors : guess.authors;
    const folder = targetFolder(authors, title, meta?.year);
    mkdirSync(folder, { recursive: true });
    for (const f of staged) { const dest = path.join(folder, path.basename(f)); if (!existsSync(dest)) renameSync(f, dest); }
    await finish(job, folder, { title, authors, subjects: meta?.subjects ?? [], ...(meta?.year ? { year: meta.year } : {}), ...(meta?.language ? { language: meta.language } : {}), ...(meta?.description ? { description: meta.description } : {}) }, single);
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

// ---------- Kavita ----------
export async function kavitaInfo(): Promise<{ connected: boolean; healthy: boolean; url: string | null; port: number; canScan: boolean }> {
  const app = (await listApps().catch(() => [])).find(a => a.id === 'kavita');
  return { connected: !!app?.connected, healthy: !!app?.healthy, url: app?.url ?? null, port: app?.port ?? 5000, canScan: !!app?.hasKey };
}

/** Ask Kavita to look at the books folder again. Needs the API key saved on the Apps page; skipped quietly without it. */
export async function kavitaScan(): Promise<boolean> {
  try {
    const saved = savedApp('kavita');
    if (!saved?.url || !saved.apiKey) return false;
    const auth = await fetch(`${saved.url}/api/Plugin/authenticate?apiKey=${encodeURIComponent(saved.apiKey)}&pluginName=virtuallyView`, { method: 'POST', signal: AbortSignal.timeout(5000) });
    const token = ((await auth.json()) as { token?: string }).token;
    if (!auth.ok || !token) return false;
    return (await fetch(`${saved.url}/api/Library/scan-all`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) })).ok;
  } catch { return false; }
}
