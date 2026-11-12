/**
 * Radio end to end: the real server (tsx -> src/index.ts) against a fake station directory, a fake ICY station
 * (MP3 with a song title every 16 KB), a fake live HLS station, and two broken ones (an HLS stream whose segments
 * are gone, and a "stream" that is a web page). Covers the home rows, hiding dead stations, now playing, the
 * pause/rewind buffer, per-user recordings, and that no ffmpeg is left behind.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const TSX_BIN = resolve(REPO_ROOT, 'node_modules/.bin/tsx');
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

let child: ChildProcess | null = null;
let fake: Server;
let base = '', fakeBase = '', dataDir = '', childLog = '';
let admin = '', viewer = '';
const ids = {
  icy: '11111111-0000-4000-8000-000000000001', hls: '11111111-0000-4000-8000-000000000002', dead: '11111111-0000-4000-8000-000000000003',
  page: '11111111-0000-4000-8000-000000000004', auto: '11111111-0000-4000-8000-000000000005', bhakti: '11111111-0000-4000-8000-000000000006'
};
const directory = () => [
  { stationuuid: ids.icy, name: 'Fake FM 93.5', url: `${fakeBase}/icy`, favicon: `${fakeBase}/logo.png`, tags: 'bollywood,hits', countrycode: 'IN', country: 'India', state: 'Kerala', language: 'hindi', codec: 'MP3', votes: 50 },
  { stationuuid: ids.hls, name: 'Fake News 101.1 FM', url: `${fakeBase}/hls/index.m3u8`, favicon: `${fakeBase}/logo.png`, tags: 'news', countrycode: 'IN', country: 'India', language: 'hindi', codec: 'AAC', hls: 1, votes: 40 },
  { stationuuid: ids.dead, name: 'Gone AIR 102.6 FM', url: `${fakeBase}/dead/index.m3u8`, tags: 'news', countrycode: 'IN', country: 'India', language: 'hindi', hls: 1, votes: 30 },
  { stationuuid: ids.page, name: 'Broken 99.9 FM', url: `${fakeBase}/page`, tags: 'talk', countrycode: 'IN', country: 'India', language: 'tamil', votes: 20 },
  { stationuuid: ids.auto, name: 'Non-Stop Hits', url: `${fakeBase}/icy?auto`, tags: 'pop', countrycode: 'IN', country: 'India', language: 'hindi', votes: 10 },
  { stationuuid: ids.bhakti, name: 'Bhakti 90.4 FM', url: `${fakeBase}/icy?bhakti`, tags: 'devotional,bhajan', countrycode: 'IN', country: 'India', language: 'hindi', votes: 5 }
];

async function req(method: string, path: string, cookie: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await res.arrayBuffer());
  let json: any = null;
  try { json = JSON.parse(buf.toString()); } catch { /* not JSON */ }
  return { status: res.status, json, buf, text: buf.toString(), headers: res.headers };
}
const cookieOf = (res: { headers: Headers }) => /vv_session=[^;]+/.exec(res.headers.get('set-cookie') ?? '')![0];
const until = async (check: () => Promise<boolean>, ms: number) => { for (const end = Date.now() + ms; Date.now() < end;) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); } return false; };
const ffmpegLeft = () => spawnSync('ps', ['-eo', 'args']).stdout.toString().split('\n').filter(l => /ffmpeg/.test(l) && l.includes(dataDir));

beforeAll(async () => {
  dataDir = mkdtempSync(resolve(tmpdir(), 'vv-e2e-radio-'));
  const media = resolve(dataDir, 'fake-media');
  mkdirSync(resolve(media, 'hls'), { recursive: true });
  if (hasFfmpeg) {
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', resolve(media, 'tone.mp3')]);
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=120', '-ac', '2', '-c:a', 'aac', '-b:a', '64k', '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0', '-hls_segment_filename', resolve(media, 'hls', 's%03d.ts'), resolve(media, 'hls', 'all.m3u8')]);
  }
  const mp3 = hasFfmpeg ? readFileSync(resolve(media, 'tone.mp3')) : Buffer.alloc(0);
  const started = Date.now();
  fake = createServer((request, res) => {
    const url = new URL(request.url ?? '/', 'http://x');
    const json = (value: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/json/stations/search') return json(directory());
    if (url.pathname.startsWith('/json/stations/byuuid/')) return json(directory().filter(s => s.stationuuid === url.pathname.split('/').pop()));
    if (url.pathname.startsWith('/json/')) return json([]);
    if (url.pathname === '/icy') {
      // An ICY station: MP3 in a loop, a little faster than real time, with "StreamTitle" every 16000 bytes when asked.
      const every = request.headers['icy-metadata'] === '1' ? 16000 : 0;
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', ...(every ? { 'icy-metaint': String(every) } : {}) });
      const meta = Buffer.from("StreamTitle='Coldplay - Yellow';");
      const block = Buffer.concat([Buffer.from([Math.ceil(meta.length / 16)]), meta, Buffer.alloc(Math.ceil(meta.length / 16) * 16 - meta.length)]);
      let at = 0, sinceMeta = 0, open = true;
      request.on('close', () => { open = false; });
      const tick = () => {
        if (!open) return;
        let out = Buffer.alloc(0);
        for (let n = 0; n < 6000; n++) {
          out = Buffer.concat([out, mp3.subarray(at % mp3.length, at % mp3.length + 1)]); at++; sinceMeta++;
          if (every && sinceMeta === every) { out = Buffer.concat([out, block]); sinceMeta = 0; }
        }
        res.write(out);
        setTimeout(tick, 250);
      };
      tick();
      return;
    }
    if (url.pathname === '/hls/index.m3u8' || url.pathname === '/dead/index.m3u8') {
      // A live window of three 4-second segments that moves on with the clock.
      const k = Math.floor((Date.now() - started) / 4000);
      const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:4', `#EXT-X-MEDIA-SEQUENCE:${k}`];
      for (let i = k; i < k + 3; i++) lines.push('#EXTINF:4.0,', `seg-${i}.ts`);
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      return res.end(lines.join('\n'));
    }
    const seg = /^\/hls\/seg-(\d+)\.ts$/.exec(url.pathname);
    if (seg) {
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      return res.end(readFileSync(resolve(media, 'hls', `s${String(Number(seg[1]) % 30).padStart(3, '0')}.ts`)));
    }
    if (url.pathname === '/page') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>please sign in</html>'.repeat(300)); }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(done => fake.listen(0, '127.0.0.1', () => done()));
  fakeBase = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;

  const port = 40000 + Math.floor(Math.random() * 9000);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [TSX_BIN, 'src/index.ts'], {
    cwd: resolve(REPO_ROOT, 'apps/server'),
    env: { ...process.env, VV_DATA_DIR: dataDir, PORT: String(port), TRUST_PROXY: 'loopback', API_RATE_LIMIT: '1000000', RADIO_BROWSER_URL: fakeBase, VV_RADIO_ALLOW_LOCAL: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });
  child.stdout?.on('data', d => { childLog += d.toString(); });
  child.stderr?.on('data', d => { childLog += d.toString(); });
  if (!await until(async () => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } }, 45_000)) throw new Error(`Server did not start.\n${childLog}`);
  const signup = await req('POST', '/api/auth/signup', null, { username: 'radioadmin', password: 'radioadmin-password-1', stayLoggedIn: false });
  admin = cookieOf(signup);
  await req('POST', '/api/auth/users', admin, { username: 'radioviewer', password: 'radioviewer-password-1', role: 'user' });
  viewer = cookieOf(await req('POST', '/api/auth/login', null, { username: 'radioviewer', password: 'radioviewer-password-1' }));
}, 90_000);

afterAll(async () => {
  if (child?.pid) try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
  fake?.close();
  await new Promise(r => setTimeout(r, 300));
  rmSync(dataDir, { recursive: true, force: true });
}, 30_000);

describe.skipIf(!hasFfmpeg)('e2e: radio', () => {
  it('needs a signed-in user', async () => {
    expect((await req('GET', '/api/radio/home?country=IN', null)).status).toBe(401);
    expect((await req('GET', `/api/radio/live/${ids.icy}/index.m3u8`, null)).status).toBe(401);
    expect((await req('GET', '/api/radio/home', admin)).status).toBe(400);
  });

  it('builds the home rows from live broadcasts only, and times itself', async () => {
    const home = await req('GET', '/api/radio/home?country=IN', admin);
    expect(home.status).toBe(200);
    expect(home.headers.get('server-timing')).toMatch(/^home;dur=\d+$/);
    expect(Object.keys(home.json).sort()).toEqual(['featured', 'hidden', 'rows']);
    expect(home.json.featured.map((s: any) => s.id)).toEqual([ids.icy, ids.hls]);
    const rows = Object.fromEntries(home.json.rows.map((r: any) => [r.id, r.stations.map((s: any) => s.id)]));
    expect(rows.news).toEqual([ids.hls, ids.dead]);
    expect(rows.devotional).toEqual([ids.bhakti]);
    expect(rows['lang-hindi']).toEqual([ids.icy, ids.hls, ids.dead, ids.bhakti]);
    // The fan playlist is not a live broadcast.
    expect(home.json.rows.flatMap((r: any) => r.stations).some((s: any) => s.id === ids.auto)).toBe(false);
    for (const r of home.json.rows) expect(r).toEqual({ id: expect.any(String), title: expect.any(String), stations: expect.any(Array) });
    expect(home.json.featured[0]).toMatchObject({ name: 'Fake FM 93.5', logo: true, topics: ['music'], health: expect.stringMatching(/ok|unknown/) });
    expect(JSON.stringify(home.json)).not.toContain(fakeBase); // stream addresses stay on the server
  });

  it('hides stations that fail the background check twice, unless all=1', async () => {
    const live = async (all = '') => (await req('GET', `/api/radio/stations?country=IN&live=1${all}`, admin)).json.stations as any[];
    expect(await until(async () => !(await live()).some(s => s.id === ids.dead || s.id === ids.page), 60_000)).toBe(true);
    const everything = await live('&all=1');
    expect(everything.find(s => s.id === ids.dead)?.health).toBe('dead');
    expect(everything.find(s => s.id === ids.page)?.health).toBe('dead');
    expect(everything.find(s => s.id === ids.icy)?.health).toBe('ok');
    expect(everything.find(s => s.id === ids.hls)?.health).toBe('ok');
    // A new home (another region) counts what it hid.
    const home = await req('GET', '/api/radio/home?country=IN&region=Kerala', admin);
    expect(home.json.hidden).toBe(2);
    expect(home.json.rows[0]).toMatchObject({ id: 'near', title: 'Near you · Kerala' });
  }, 70_000);

  it('says what is playing, split into artist and song', async () => {
    const now = await req('GET', `/api/radio/now/${ids.icy}`, viewer);
    expect(now.json).toMatchObject({ title: 'Coldplay - Yellow', artist: 'Coldplay', song: 'Yellow' });
    expect((await req('GET', `/api/radio/now/${ids.hls}`, viewer)).json).toEqual({ title: null });
  }, 20_000);

  it('serves an ICY station and an HLS station through the pause/rewind buffer', async () => {
    for (const id of [ids.icy, ids.hls]) {
      const playlist = await req('GET', `/api/radio/live/${id}/index.m3u8`, viewer);
      expect(playlist.status).toBe(200);
      expect(playlist.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');
      const first = /^(seg\d{5}\.ts)$/m.exec(playlist.text)![1];
      const seg = await req('GET', `/api/radio/live/${id}/${first}`, viewer);
      expect(seg.status).toBe(200);
      expect(seg.headers.get('content-type')).toBe('video/mp2t');
      expect(seg.buf[0]).toBe(0x47); // MPEG-TS sync byte
    }
    expect((await req('GET', `/api/radio/live/${ids.icy}/../../index.m3u8`, viewer)).status).toBe(404);
    const page = await req('GET', `/api/radio/live/${ids.page}/index.m3u8`, viewer);
    expect(page.status).toBe(502);
    expect(page.json.message).toMatch(/web page/);
    expect((await req('GET', '/api/radio/live/not-a-station/index.m3u8', viewer)).status).toBe(404);
  }, 30_000);

  it('records a show that only its owner sees, plays, stops and deletes', async () => {
    expect((await req('POST', '/api/radio/record', admin, { id: ids.icy, minutes: 0 })).status).toBe(400);
    expect((await req('POST', '/api/radio/record', admin, { id: 'nope', minutes: 5 })).status).toBe(404);
    const started = await req('POST', '/api/radio/record', admin, { id: ids.icy, minutes: 5 });
    expect(started.status).toBe(200);
    const id = started.json.id;
    expect(started.json).toMatchObject({ stationId: ids.icy, station: 'Fake FM 93.5', state: 'recording' });
    expect((await req('GET', '/api/radio/recordings', viewer)).json.recordings).toEqual([]);
    expect((await req('POST', `/api/radio/record/${id}/stop`, viewer)).status).toBe(404);
    expect((await req('DELETE', `/api/radio/recordings/${id}`, viewer)).status).toBe(404);
    expect((await req('GET', `/api/radio/recordings/${id}/file`, viewer)).status).toBe(404);
    await new Promise(r => setTimeout(r, 4000));
    expect((await req('POST', `/api/radio/record/${id}/stop`, admin)).json).toEqual({ ok: true });
    expect(await until(async () => (await req('GET', '/api/radio/recordings', admin)).json.recordings[0]?.state === 'stopped', 15_000)).toBe(true);
    const list = (await req('GET', '/api/radio/recordings', admin)).json.recordings;
    expect(list[0]).toMatchObject({ id, owner: expect.any(String), sizeBytes: expect.any(Number) });
    expect(list[0].sizeBytes).toBeGreaterThan(1024);
    const file = await req('GET', `/api/radio/recordings/${id}/file`, admin);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('audio/mp4');
    const part = await req('GET', `/api/radio/recordings/${id}/file`, admin, undefined, { Range: 'bytes=0-99' });
    expect(part.status).toBe(206);
    expect(part.buf.length).toBe(100);
    expect((await req('DELETE', `/api/radio/recordings/${id}`, admin)).json).toEqual({ ok: true });
    expect((await req('GET', '/api/radio/recordings', admin)).json.recordings).toEqual([]);
  }, 40_000);

  it('leaves no ffmpeg running once the server stops', async () => {
    expect(ffmpegLeft().length).toBeGreaterThan(0); // the two buffers are still on
    process.kill(-child!.pid!, 'SIGTERM');
    child = null;
    expect(await until(async () => ffmpegLeft().length === 0, 10_000)).toBe(true);
  }, 15_000);
});
