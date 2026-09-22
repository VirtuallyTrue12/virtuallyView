import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A playlist added before a restart, then a channel picked afterwards: the
// server starts with nothing in memory and must find the channel anyway.
let server: Server;
let base = '';
let dir = '';
const M3U = '#EXTM3U\n#EXTINF:-1 group-title="News",Channel One\nhttp://127.0.0.1:9/one.m3u8\n#EXTINF:-1,Two\nhttp://127.0.0.1:9/two.ts\n';

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vv-live-'));
  process.env.VV_DATA_DIR = dir;
  server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' }); res.end(M3U); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', () => done()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('live tv after a restart', () => {
  it('finds a channel by id without the channel list being opened first', async () => {
    const live = await import('../../apps/server/src/services/live-tv');
    const added = live.addPlaylist('Test', `${base}/list.m3u`);
    expect(added.ok).toBe(true);
    const playlistId = added.ok ? added.playlist.id : '';
    const wanted = live.parseM3u(M3U, playlistId).find(c => c.name === 'Two')!;
    const found = await live.channelById(wanted.id);
    expect(found?.url).toBe('http://127.0.0.1:9/two.ts');
    expect(await live.channelById('does-not-exist')).toBeUndefined();
  });
});
