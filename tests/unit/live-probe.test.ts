import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let server: Server;
let base = '';
let dir = '';
const MEDIA = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nseg1.ts\n#EXTINF:4,\nseg2.ts\n';
const routes: Record<string, [number, string, string]> = {
  '/good.m3u8': [200, 'application/vnd.apple.mpegurl', MEDIA],
  '/master.m3u8': [200, 'application/vnd.apple.mpegurl', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvariant/low.m3u8\n'],
  '/variant/low.m3u8': [200, 'application/vnd.apple.mpegurl', MEDIA],
  '/variant/seg2.ts': [200, 'video/mp2t', 'x'],
  '/seg2.ts': [200, 'video/mp2t', 'x'],
  '/nosegment.m3u8': [200, 'application/vnd.apple.mpegurl', '#EXTM3U\n#EXT-X-TARGETDURATION:4\n'],
  '/html.m3u8': [200, 'text/html', '<html>sign in</html>'],
  '/gone.m3u8': [404, 'text/plain', 'no'],
  '/deadseg.m3u8': [200, 'application/vnd.apple.mpegurl', '#EXTM3U\n#EXTINF:4,\nmissing.ts\n']
};
const M3U = '#EXTM3U\n#EXTINF:-1 tvg-id="A.in@SD" group-title="News",A\nhttp://h/a\n#EXTINF:-1 tvg-id="A.in@HD" group-title="Kids",A HD\nhttp://h/a2\n#EXTINF:-1,NoId\nhttp://h/x\n#EXTINF:-1,NoId again\nhttp://h/x\n#EXTINF:-1,Other\nhttp://h/y\n';

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vv-probe-'));
  process.env.VV_DATA_DIR = dir;
  server = createServer((req, res) => {
    const hit = routes[req.url ?? ''] ?? [404, 'text/plain', 'no'];
    res.writeHead(hit[0], { 'Content-Type': hit[1] });
    res.end(hit[2]);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', () => done()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

describe('probe decision and TTL', () => {
  it('hides a channel only after two failures in a row, and one success resets it', async () => {
    const { decide, isDead } = await import('../../apps/server/src/services/live-probe');
    const one = decide(undefined, false, 1000);
    expect(isDead(one)).toBe(false);
    const two = decide(one, false, 2000);
    expect(isDead(two)).toBe(true);
    expect(isDead(decide(two, true, 3000))).toBe(false);
    expect(decide(two, true, 3000).fails).toBe(0);
  });
  it('trusts an answer for 24 hours', async () => {
    const { isFresh, TTL_MS } = await import('../../apps/server/src/services/live-probe');
    const h = { ok: true, fails: 0, at: 1000 };
    expect(isFresh(h, 1000 + TTL_MS - 1)).toBe(true);
    expect(isFresh(h, 1000 + TTL_MS + 1)).toBe(false);
    expect(isFresh(undefined, 5)).toBe(false);
  });
});

describe('probeStream', () => {
  it('follows a variant playlist and checks a segment', async () => {
    const { probeStream } = await import('../../apps/server/src/services/live-probe');
    expect(await probeStream(`${base}/good.m3u8`)).toBe(true);
    expect(await probeStream(`${base}/master.m3u8`)).toBe(true);
  });
  it('fails for errors, non-playlists, empty playlists and missing segments', async () => {
    const { probeStream } = await import('../../apps/server/src/services/live-probe');
    for (const p of ['gone', 'html', 'nosegment', 'deadseg']) expect(await probeStream(`${base}/${p}.m3u8`)).toBe(false);
    expect(await probeStream('http://127.0.0.1:9/x.m3u8')).toBe(false);
  });
});

describe('uniqueChannels', () => {
  it('shows a channel once across playlists, by guide id or by address, and merges categories', async () => {
    const live = await import('../../apps/server/src/services/live-tv');
    const out = live.uniqueChannels([...live.parseM3u(M3U, 'index'), ...live.parseM3u(M3U, 'india')]);
    // A.in@SD and A.in@HD share a guide id; the two NoId entries share an address.
    expect(out.map(c => c.name)).toEqual(['A', 'NoId', 'Other']);
    expect(out[0]!.group).toBe('News;Kids');
    expect(out[0]!.lists).toEqual(['index', 'india']);
    expect(out[0]!.country).toBe('in');
  });
});
