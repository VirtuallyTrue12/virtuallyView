/**
 * Books end to end: the real server (tsx -> src/index.ts) against fake Project Gutenberg, Internet Archive, arXiv and
 * LibriVox servers. Covers search per source, pulling an EPUB, a PDF, a paper and an audiobook zip into a scratch
 * books folder, the checks on what arrives (a web page instead of a book), the library, covers, Range requests,
 * saved positions per person, shelves, limits and cancel.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { epubBytes, makeZip } from './fixtures/books-zip.js';

const REPO_ROOT = process.cwd();
// A git worktree keeps its packages in the main checkout further up the tree.
const TSX_BIN = ['.', '..', '../..', '../../..', '../../../..'].map(d => resolve(REPO_ROOT, d, 'node_modules/.bin/tsx')).find(existsSync)!;
const hasUnzip = spawnSync('unzip', ['-v']).status === 0;
let child: ChildProcess | null = null, fake: Server;
let base = '', fakeBase = '', dataDir = '', booksDir = '', childLog = '';
let admin = '', viewer = '';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(900, 7)]);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(300, 1)]);

async function req(method: string, path: string, cookie: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await res.arrayBuffer());
  let json: any = null;
  try { json = JSON.parse(buf.toString()); } catch { /* not JSON */ }
  return { status: res.status, json, buf, headers: res.headers };
}
const cookieOf = (res: { headers: Headers }) => /vv_session=[^;]+/.exec(res.headers.get('set-cookie') ?? '')![0];
const until = async (check: () => Promise<boolean>, ms: number) => { for (const end = Date.now() + ms; Date.now() < end;) { if (await check()) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
const finished = async (id: string, cookie = admin) => { let job: any; await until(async () => { job = (await req('GET', '/api/books/jobs', cookie)).json.jobs.find((j: any) => j.id === id); return job && !['queued', 'downloading', 'processing'].includes(job.status); }, 20_000); return job; };

beforeAll(async () => {
  dataDir = mkdtempSync(resolve(tmpdir(), 'vv-e2e-books-'));
  booksDir = resolve(dataDir, 'books');
  mkdirSync(booksDir, { recursive: true });
  const epub = epubBytes();
  const gutendex = (id: number, title: string, author: string) => ({ id, title, authors: [{ name: author }], subjects: ['Stoics', 'Philosophy'], bookshelves: [], languages: ['en'],
    formats: { 'application/epub+zip': `${fakeBase}/ebooks/${id}.epub`, 'image/jpeg': `${fakeBase}/cover.jpg` } });
  fake = createServer((request, res) => {
    const url = new URL(request.url ?? '/', 'http://x');
    const json = (value: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    const send = (type: string, data: Buffer | string) => { res.writeHead(200, { 'Content-Type': type }); res.end(data); };
    if (url.pathname === '/books/') return json({ results: [gutendex(2680, 'Meditations', 'Marcus Aurelius'), gutendex(999, 'Broken page', 'Nobody'), gutendex(555, 'Meditations On Slow Things', 'Slow, Sam')] });
    const g = /^\/books\/(\d+)$/.exec(url.pathname);
    if (g) return json(g[1] === '2680' ? gutendex(2680, 'Meditations', 'Marcus Aurelius') : g[1] === '999' ? gutendex(999, 'Broken page', 'Nobody') : g[1] === '555' ? gutendex(555, 'Meditations On Slow Things', 'Slow, Sam') : {});
    if (url.pathname === '/ebooks/2680.epub') return send('application/epub+zip', epub);
    if (url.pathname === '/ebooks/999.epub') return send('text/html', '<html>Please log in</html>');
    if (url.pathname === '/ebooks/555.epub') { res.writeHead(200, { 'Content-Type': 'application/epub+zip' }); res.write(epub.subarray(0, 100)); return; } // never finishes
    if (url.pathname === '/cover.jpg') return send('image/jpeg', JPEG);
    if (url.pathname === '/advancedsearch.php') return json({ response: { docs: [{ identifier: 'artofwar', title: 'The Art of War', creator: 'Sun Tzu', year: '1910', subject: ['War'], format: ['Text PDF'] }] } });
    if (url.pathname === '/metadata/artofwar') return json({ metadata: { title: 'The Art of War', creator: 'Sun Tzu', date: '1910', subject: ['War'] }, files: [{ name: 'artofwar.pdf', format: 'Text PDF', size: '40' }] });
    if (url.pathname === '/download/artofwar/artofwar.pdf') return send('application/pdf', '%PDF-1.4 fake art of war');
    if (url.pathname === '/services/img/artofwar') return send('image/jpeg', JPEG);
    if (url.pathname === '/search.json') return json({ docs: [] });
    if (url.pathname === '/api/query') return send('application/atom+xml', `<feed><entry><id>http://arxiv.org/abs/1706.03762v7</id><published>2017-06-12T00:00:00Z</published><title>Attention Is All You Need</title><summary>Models</summary><author><name>Ashish Vaswani</name></author><category term="cs.CL"/></entry></feed>`);
    if (url.pathname === '/pdf/1706.03762') return send('application/pdf', '%PDF-1.5 attention');
    if (url.pathname === '/api/feed/audiobooks') return url.searchParams.get('id') === '77' || url.searchParams.get('title')
      ? json({ books: [{ id: '77', title: 'The Short Odyssey', description: 'Epic', language: 'English', copyright_year: '1900', url_zip_file: `${fakeBase}/lv/77.zip`, totaltimesecs: 600, authors: [{ first_name: 'Homer', last_name: '' }], genres: [{ name: 'Epic' }] }] })
      : (res.writeHead(404, { 'Content-Type': 'application/json' }), res.end('{"error":"Audiobooks could not be found"}'));
    if (url.pathname === '/lv/77.zip') return send('application/zip', makeZip({ '01_book_1.mp3': MP3, '02_book_2.mp3': MP3, 'notes/readme.txt': 'hi', '../evil.mp3': MP3 }));
    res.writeHead(404); res.end();
  });
  await new Promise<void>(done => fake.listen(0, '127.0.0.1', () => done()));
  fakeBase = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  const port = 40000 + Math.floor(Math.random() * 9000);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [TSX_BIN, 'src/index.ts'], {
    cwd: resolve(REPO_ROOT, 'apps/server'),
    env: { ...process.env, VV_DATA_DIR: dataDir, VV_BOOKS_DIR: booksDir, PORT: String(port), TRUST_PROXY: 'loopback', API_RATE_LIMIT: '1000000', VV_RADIO_ALLOW_LOCAL: '1', VV_BOOKS_TEST: '1',
      VV_BOOKS_GUTENDEX: fakeBase, VV_BOOKS_GUTENBERG_SITE: fakeBase, VV_BOOKS_ARCHIVE: fakeBase, VV_BOOKS_OPENLIBRARY: fakeBase, VV_BOOKS_OPENLIBRARY_COVERS: fakeBase, VV_BOOKS_ARXIV: fakeBase, VV_BOOKS_ARXIV_SITE: fakeBase, VV_BOOKS_LIBRIVOX: fakeBase },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true
  });
  child.stdout?.on('data', d => { childLog += d.toString(); });
  child.stderr?.on('data', d => { childLog += d.toString(); });
  if (!await until(async () => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } }, 45_000)) throw new Error(`Server did not start.\n${childLog}`);
  admin = cookieOf(await req('POST', '/api/auth/signup', null, { username: 'booksadmin', password: 'booksadmin-password-1', stayLoggedIn: false }));
  await req('POST', '/api/auth/users', admin, { username: 'booksviewer', password: 'booksviewer-password-1', role: 'user' });
  viewer = cookieOf(await req('POST', '/api/auth/login', null, { username: 'booksviewer', password: 'booksviewer-password-1' }));
}, 90_000);

afterAll(async () => {
  fake?.closeAllConnections?.();
  if (child?.pid) try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
  fake?.close();
  await new Promise(r => setTimeout(r, 300));
  rmSync(dataDir, { recursive: true, force: true });
}, 30_000);

describe('e2e: books', () => {
  it('needs a signed-in user, validates the query and the source', async () => {
    expect((await req('GET', '/api/books/library', null)).status).toBe(401);
    expect((await req('GET', '/api/books/search?source=nope&q=abc', admin)).json.code).toBe('bad_source');
    expect((await req('GET', '/api/books/search?source=gutenberg&q=a', admin)).json.code).toBe('bad_query');
    const cfg = (await req('GET', '/api/books/config', admin)).json;
    expect(cfg.writable).toBe(true);
    expect(cfg.sources.map((s: any) => s.id)).toEqual(['gutenberg', 'archive', 'openlibrary', 'arxiv', 'librivox', 'indexers']);
    expect(cfg.sources.find((s: any) => s.id === 'indexers').available).toBe(false);
    expect((await req('GET', '/api/books/search?source=indexers&q=meditations', admin)).status).toBe(409);
  });

  it('searches each source separately with covers served by this server', async () => {
    const g = (await req('GET', '/api/books/search?source=gutenberg&q=meditations', admin)).json;
    expect(g.results[0]).toMatchObject({ source: 'gutenberg', id: '2680', title: 'Meditations', authors: ['Marcus Aurelius'], formats: [{ kind: 'epub' }] });
    expect(g.results[0].cover).toMatch(/^\/api\/books\/cover\?u=/);
    const cover = await req('GET', g.results[0].cover, admin);
    expect(cover.status).toBe(200);
    expect(cover.headers.get('content-type')).toBe('image/jpeg');
    expect((await req('GET', '/api/books/cover?u=http%3A%2F%2Fexample.com%2Fa.jpg', admin)).status).toBe(400);
    expect((await req('GET', '/api/books/search?source=archive&q=art+of+war', admin)).json.results[0]).toMatchObject({ id: 'artofwar', formats: [{ kind: 'pdf' }] });
    expect((await req('GET', '/api/books/search?source=arxiv&q=attention', admin)).json.results[0]).toMatchObject({ id: '1706.03762', media: 'paper' });
    expect((await req('GET', '/api/books/search?source=librivox&q=odyssey', admin)).json.results[0]).toMatchObject({ id: '77', media: 'audiobook', durationSec: 600 });
    expect((await req('GET', '/api/books/search?source=openlibrary&q=anything', admin)).json.results).toEqual([]);
  });

  it('pulls a Gutenberg EPUB into the library with title, author, cover and a file that serves with Range', async () => {
    const start = await req('POST', '/api/books/pull', admin, { source: 'gutenberg', id: '2680', format: 'epub' });
    expect(start.status).toBe(202);
    const job = await finished(start.json.job.id);
    expect(job).toMatchObject({ status: 'done', percent: 100 });
    const lib = (await req('GET', '/api/books/library', admin)).json;
    const book = lib.items.find((b: any) => b.id === job.bookId);
    expect(book).toMatchObject({ title: 'Meditations', authors: ['Marcus Aurelius'], kind: 'ebook', hasCover: true, source: 'gutenberg', sourceId: '2680' });
    expect(book.path).toBe('Marcus Aurelius/Meditations/Meditations.epub');
    expect(existsSync(resolve(booksDir, 'Marcus Aurelius/Meditations/metadata.json'))).toBe(true);
    expect((await req('GET', `/api/books/library/${book.id}/cover`, admin)).buf.length).toBeGreaterThan(0);
    const file = await req('GET', `/api/books/library/${book.id}/file/0`, admin);
    expect(file.headers.get('content-type')).toBe('application/epub+zip');
    expect(file.buf.subarray(0, 2).toString()).toBe('PK');
    const part = await req('GET', `/api/books/library/${book.id}/file/0`, admin, undefined, { Range: 'bytes=0-9' });
    expect(part.status).toBe(206);
    expect(part.buf.length).toBe(10);
    expect((await req('GET', `/api/books/library/${book.id}/file/5`, admin)).status).toBe(404);
    // A second pull of the same book is refused, and search now says it is owned.
    const again = await req('POST', '/api/books/pull', admin, { source: 'gutenberg', id: '2680' });
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ code: 'already_in_library', bookId: book.id });
    expect((await req('GET', '/api/books/search?source=gutenberg&q=meditations', admin)).json.results[0].inLibrary).toBe(book.id);
  });

  it('refuses a "book" that is really a web page and leaves nothing behind', async () => {
    const start = await req('POST', '/api/books/pull', admin, { source: 'gutenberg', id: '999' });
    const job = await finished(start.json.job.id);
    expect(job.status).toBe('failed');
    expect(job.message).toMatch(/web page/);
    expect(existsSync(resolve(booksDir, 'Nobody'))).toBe(false);
    expect(readdirSync(resolve(booksDir, '.vv-pull'))).toEqual([]);
  });

  it('pulls a PDF from the Internet Archive and a paper from arXiv', async () => {
    const a = await finished((await req('POST', '/api/books/pull', admin, { source: 'archive', id: 'artofwar', format: 'pdf' })).json.job.id);
    const p = await finished((await req('POST', '/api/books/pull', admin, { source: 'arxiv', id: '1706.03762', format: 'pdf' })).json.job.id);
    expect([a.status, p.status]).toEqual(['done', 'done']);
    const items = (await req('GET', '/api/books/library', admin)).json.items;
    expect(items.find((b: any) => b.id === a.bookId)).toMatchObject({ title: 'The Art of War', authors: ['Sun Tzu'], year: 1910, hasCover: true });
    expect(items.find((b: any) => b.id === p.bookId)).toMatchObject({ title: 'Attention Is All You Need', authors: ['Ashish Vaswani'], year: 2017 });
    expect(existsSync(resolve(booksDir, 'Sun Tzu/The Art of War (1910)/The Art of War.pdf'))).toBe(true);
  });

  it.skipIf(!hasUnzip)('pulls a LibriVox audiobook: only audio, flat, inside the folder', async () => {
    const j = await finished((await req('POST', '/api/books/pull', admin, { source: 'librivox', id: '77' })).json.job.id);
    expect(j.message).toBe('In the library.');
    const book = (await req('GET', `/api/books/library/${j.bookId}`, admin)).json.book;
    expect(book).toMatchObject({ kind: 'audiobook', title: 'The Short Odyssey', authors: ['Homer'] });
    expect(book.files.map((f: any) => f.name)).toEqual(['01_book_1.mp3', '02_book_2.mp3', 'evil.mp3']); // the ../ in the zip is dropped, so it lands inside the folder
    expect(existsSync(resolve(booksDir, 'evil.mp3'))).toBe(false);
    const track = await req('GET', `/api/books/library/${book.id}/file/1`, admin, undefined, { Range: 'bytes=-4' });
    expect(track.status).toBe(206);
    expect(track.headers.get('content-type')).toBe('audio/mpeg');
  });

  it('keeps each person\'s place separately and builds shelves', async () => {
    const lib = (await req('GET', '/api/books/library', admin)).json.items;
    const med = lib.find((b: any) => b.source === 'gutenberg');
    expect((await req('PUT', `/api/books/library/${med.id}/state`, admin, { position: 'epubcfi(/6/4!/4/2)', percent: 42.5, opened: true })).json.state).toMatchObject({ position: 'epubcfi(/6/4!/4/2)', percent: 42.5, finished: false });
    expect((await req('GET', `/api/books/library/${med.id}/state`, admin)).json.state.percent).toBe(42.5);
    expect((await req('GET', `/api/books/library/${med.id}/state`, viewer)).json.state).toBeNull();
    expect((await req('PUT', `/api/books/library/${med.id}/state`, admin, { percent: 'x' })).status).toBe(400);
    expect((await req('PUT', `/api/books/library/${med.id}/state`, admin, { position: 'x'.repeat(2001) })).status).toBe(400);
    expect((await req('PUT', '/api/books/library/nope/state', admin, { percent: 1 })).status).toBe(404);
    const shelves = (await req('GET', '/api/books/shelves', admin)).json.shelves;
    expect(shelves[0]).toMatchObject({ kind: 'continue' });
    expect(shelves[0].items[0].id).toBe(med.id);
    expect((await req('GET', '/api/books/shelves', viewer)).json.shelves.some((s: any) => s.kind === 'continue')).toBe(false);
    await req('POST', `/api/books/library/${med.id}/favorite`, admin, { favorite: true });
    expect((await req('GET', `/api/books/library/${med.id}`, admin)).json.book.favorite).toBe(true);
    expect((await req('PUT', `/api/books/library/${med.id}/state`, admin, { percent: 99 })).json.state.finished).toBe(true);
  });

  it('stops a download on cancel and caps downloads per person', async () => {
    const slow = await req('POST', '/api/books/pull', viewer, { source: 'gutenberg', id: '555' });
    expect(slow.status).toBe(202);
    await until(async () => (await req('GET', '/api/books/jobs', viewer)).json.jobs[0].status === 'downloading', 5000);
    expect((await req('DELETE', `/api/books/jobs/${slow.json.job.id}`, admin)).status).toBe(200);
    expect((await req('GET', '/api/books/jobs', viewer)).json.jobs[0].status).toBe('canceled');
    expect((await req('DELETE', `/api/books/jobs/${slow.json.job.id}`, viewer)).status).toBe(200);
    expect((await req('DELETE', '/api/books/jobs/none', viewer)).status).toBe(404);
    expect((await req('POST', '/api/books/pull', viewer, { source: 'nope', id: 'x' })).status).toBe(400);
    expect((await req('POST', '/api/books/pull', viewer, { source: 'gutenberg', id: '12345' })).status).toBe(404);
  });
});
