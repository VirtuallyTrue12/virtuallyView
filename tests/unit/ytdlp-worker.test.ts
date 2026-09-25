import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'vv-yt-'));
const library = join(root, 'music');
process.env.YTDLP_LIBRARY = library;
mkdirSync(library, { recursive: true });

// A stand-in for yt-dlp that behaves like the real one closely enough to test everything around it.
const fake = join(root, 'fake-yt-dlp');
writeFileSync(fake, `#!/usr/bin/env node
const args = process.argv.slice(2);
const fs = require('fs'), path = require('path');
if (args.includes('-J')) {
  const q = args.at(-1);
  if (q.includes('boom')) { process.stderr.write('ERROR: blocked\\n'); process.exit(1); }
  console.log(JSON.stringify({ entries: [
    { id: '9PSo4PjbDbs', title: 'Linkin Park - Rock am Ring 2004 (Full Show)', channel: 'Someone', duration: 4262, view_count: 1921185, thumbnails: [{ url: 'https://i.ytimg.com/vi/9PSo4PjbDbs/hq720.jpg' }] },
    { id: 'LIVEliveLIV', title: 'Live stream now', duration: 0, live_status: 'is_live' },
    { id: 'short', title: 'not an id' }
  ] }));
  process.exit(0);
}
const dir = args[args.indexOf('-P') + 1];
const id = args.at(-1).split('v=')[1];
if (id === 'FAILfailFAI') { process.stderr.write('ERROR: Video unavailable\\n'); process.exit(1); }
console.log('PROGRESS| 40.0%|00:03|1.2MiB/s');
setTimeout(() => {
  console.log('PROGRESS|100.0%|00:00|1.2MiB/s');
  const file = path.join(dir, 'Concert [' + id + '].mp4');
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, 'video');
  console.log('FILE|' + file);
}, 300);
`);
chmodSync(fake, 0o755);
writeFileSync(join(root, 'token'), 'secret-token');

type Worker = typeof import('../../scripts/ytdlp-worker.mjs');
let worker: Worker;
let child: ChildProcess;
let base = '';

const freePort = () => new Promise<number>(res => { const s = createServer(); s.listen(0, () => { const { port } = s.address() as { port: number }; s.close(() => res(port)); }); });
const call = async (method: string, path: string, body?: unknown, token: string | null = 'secret-token') => {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, json: await res.json() as Record<string, any> };
};

beforeAll(async () => {
  worker = await import('../../scripts/ytdlp-worker.mjs');
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['scripts/ytdlp-worker.mjs'], {
    env: { ...process.env, YTDLP_PORT: String(port), YTDLP_LIBRARY: library, YTDLP_TOKEN_FILE: join(root, 'token'), YTDLP_BIN: fake }, stdio: 'ignore'
  });
  for (let i = 0; i < 60; i++) { try { if ((await call('GET', '/health')).status === 200) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
}, 30_000);
afterAll(() => { child?.kill('SIGKILL'); });

describe('YouTube worker: what it will and will not do', () => {
  it('only writes inside an artist\'s Concerts or Videos folder of the library', () => {
    expect(worker.safeDestination(join(library, 'Queen', 'Concerts'))).toBe(join(library, 'Queen', 'Concerts'));
    expect(worker.safeDestination(join(library, 'Queen', 'Videos', 'Wembley'))).toBeTruthy();
    for (const bad of [library, join(library, 'Queen'), join(library, 'Queen', 'Albums'), join(library, '..', 'etc', 'Concerts'), join(library, 'Queen', 'Concerts', '..', '..', '..', 'x'), '/etc', '', 'Queen/Concerts']) {
      expect(worker.safeDestination(bad)).toBeNull();
    }
  });

  it('builds a download for a video id only, capped at 1080p and preferring files any browser plays', () => {
    const args = worker.downloadArgs('9PSo4PjbDbs', join(library, 'Queen', 'Concerts'));
    expect(args.at(-1)).toBe('https://www.youtube.com/watch?v=9PSo4PjbDbs');
    expect(args).toContain('--no-playlist');
    expect(args[args.indexOf('-S') + 1]).toMatch(/res:1080,vcodec:h264,acodec:aac/);
    expect(worker.VIDEO_ID.test('9PSo4PjbDbs')).toBe(true);
    for (const bad of ['', 'short', 'https://evil.example/x', '9PSo4PjbDbs; rm -rf /', '../../etc/passwd']) expect(worker.VIDEO_ID.test(bad)).toBe(false);
  });

  it('reads progress, the final file name and the merge step from yt-dlp output', () => {
    expect(worker.parseLine('PROGRESS| 42.5%|00:31|2.0MiB/s')).toEqual({ percent: 42.5, eta: '00:31', speed: '2.0MiB/s' });
    expect(worker.parseLine('FILE|/media/music/Q/Concerts/x.mp4')).toEqual({ file: '/media/music/Q/Concerts/x.mp4' });
    expect(worker.parseLine('[Merger] Merging formats into "x.mp4"')).toEqual({ merging: true });
    expect(worker.parseLine('random')).toBeNull();
  });

  it('refuses callers without the token', async () => {
    expect((await call('GET', '/jobs', undefined, null)).status).toBe(401);
    expect((await call('GET', '/jobs', undefined, 'wrong-token')).status).toBe(401);
    expect((await call('POST', '/search', { q: 'queen' }, 'wrong')).status).toBe(401);
  });

  it('searches, dropping live streams and anything that is not a real video id', async () => {
    const r = await call('POST', '/search', { q: 'linkin park rock am ring 2004' });
    expect(r.status).toBe(200);
    expect(r.json.results).toHaveLength(1);
    expect(r.json.results[0]).toMatchObject({ id: '9PSo4PjbDbs', title: 'Linkin Park - Rock am Ring 2004 (Full Show)', durationSeconds: 4262, views: 1921185 });
    expect((await call('POST', '/search', { q: 'x' })).status).toBe(400);
    const failed = await call('POST', '/search', { q: 'boom' });
    expect(failed.status).toBe(502);
  });

  it('rejects bad downloads before anything runs', async () => {
    expect((await call('POST', '/download', { id: 'nope', dir: join(library, 'Q', 'Concerts') })).status).toBe(400);
    expect((await call('POST', '/download', { id: '9PSo4PjbDbs', dir: '/etc' })).status).toBe(400);
    expect((await call('POST', '/download', { id: '9PSo4PjbDbs', dir: join(library, 'Q', 'Secrets') })).status).toBe(400);
    expect(existsSync(join(library, 'Q'))).toBe(false);
  });

  it('downloads into the folder, reports progress, and does not start the same one twice', async () => {
    const dir = join(library, 'Linkin Park', 'Concerts');
    const first = await call('POST', '/download', { id: '9PSo4PjbDbs', dir, title: 'Rock am Ring 2004' });
    expect(first.status).toBe(202);
    const again = await call('POST', '/download', { id: '9PSo4PjbDbs', dir, title: 'Rock am Ring 2004' });
    expect(again.json.id).toBe(first.json.id);
    let job: Record<string, any> = {};
    for (let i = 0; i < 60; i++) {
      job = (await call('GET', '/jobs')).json.jobs.find((j: { id: string }) => j.id === first.json.id);
      if (job.status === 'done') break;
      await new Promise(r => setTimeout(r, 100));
    }
    expect(job.status).toBe('done');
    expect(job.percent).toBe(100);
    expect(job.file).toBe(join(dir, 'Concert [9PSo4PjbDbs].mp4'));
    expect(existsSync(job.file)).toBe(true);
  });

  it('reports a failed download in plain words', async () => {
    const start = await call('POST', '/download', { id: 'FAILfailFAI', dir: join(library, 'Queen', 'Videos'), title: 'gone' });
    let job: Record<string, any> = {};
    for (let i = 0; i < 60; i++) { job = (await call('GET', '/jobs')).json.jobs.find((j: { id: string }) => j.id === start.json.id); if (job.status === 'error') break; await new Promise(r => setTimeout(r, 100)); }
    expect(job.status).toBe('error');
    expect(job.error).toBe('Video unavailable');
  });
});
