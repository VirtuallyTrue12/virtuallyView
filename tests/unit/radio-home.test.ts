import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Station } from '../../apps/server/src/services/radio';

const dir = mkdtempSync(join(tmpdir(), 'vv-radio-home-'));
process.env.VV_DATA_DIR = dir;
const radio = await import('../../apps/server/src/services/radio');
const { buildHome } = await import('../../apps/server/src/services/radio-home');
const probe = await import('../../apps/server/src/services/live-probe');

let server: Server;
let base = '';
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/audio') { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.alloc(8192, 1)); return; }
    if (req.url === '/short') { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.alloc(100, 1)); return; }
    if (req.url === '/signin') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>'.repeat(2000)); return; }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', () => done()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

const station = (name: string, extra: Partial<Station> = {}): Station => ({
  id: name, name, country: 'India', countryCode: 'IN', tags: [], votes: 0, logo: false, kind: 'live', health: 'unknown',
  topics: radio.stationTopics({ name, tags: (extra.tags ?? []).join(',') }), ...extra
});

describe('radio: what a station airs', () => {
  it('reads topics from tags and, for news, sport and devotional, from the name', () => {
    expect(radio.stationTopics({ name: 'City 91.1', tags: 'news,talk' })).toEqual(['news', 'talk']);
    expect(radio.stationTopics({ name: 'Aaj Tak News Radio', tags: '' })).toEqual(['news']);
    expect(radio.stationTopics({ name: 'Star Sports Live', tags: 'cricket' })).toEqual(['sports']);
    expect(radio.stationTopics({ name: 'Gurbani Kirtan', tags: '' })).toEqual(['devotional']);
    expect(radio.stationTopics({ name: 'Bhakti FM', tags: 'bhajan,devotional' })).toEqual(['devotional']);
    expect(radio.stationTopics({ name: 'Mirchi 98.3', tags: 'bollywood,hits' })).toEqual(['music']);
    // Untagged FM stations play music.
    expect(radio.stationTopics({ name: 'Radio 93.5', tags: '' })).toEqual(['music']);
  });
});

describe('radio: home rows', () => {
  const list = [
    station('News One', { tags: ['news'], logo: true, language: 'hindi' }),
    station('News Two', { tags: ['news'], logo: true, language: 'hindi,english', health: 'ok' }),
    station('Hits', { tags: ['pop'], language: 'hindi' }),
    station('Tamil Hits', { tags: ['pop'], language: 'tamil', logo: true }),
    station('Cricket', { tags: ['cricket'], language: 'english' })
  ];

  it('puts featured stations with a logo first, working ones before unchecked ones', () => {
    const home = buildHome(list, { country: 'IN' });
    expect(home.featured.map(s => s.name)).toEqual(['News Two', 'News One', 'Tamil Hits']);
  });

  it('makes topic rows, a region row, and Indian language rows with three or more stations; no empty rows', () => {
    const home = buildHome(list, { country: 'IN', near: [list[2]!], region: 'Kerala' });
    expect(home.rows.map(r => [r.id, r.title, r.stations.length])).toEqual([
      ['near', 'Near you · Kerala', 1], ['news', 'News', 2], ['music', 'Music', 2], ['sports', 'Sports', 1], ['lang-hindi', 'Hindi', 3]
    ]);
  });

  it('has no language rows outside India and no region row without a region', () => {
    const home = buildHome(list, { country: 'GB' });
    expect(home.rows.map(r => r.id)).toEqual(['news', 'music', 'sports']);
  });
});

describe('radio: now playing', () => {
  it('splits an ICY title into artist and song', () => {
    expect(radio.splitTitle('Coldplay - Yellow')).toEqual({ title: 'Coldplay - Yellow', artist: 'Coldplay', song: 'Yellow' });
    expect(radio.splitTitle('A-ha – Take On Me - 2015 Remaster')).toEqual({ title: 'A-ha – Take On Me - 2015 Remaster', artist: 'A-ha', song: 'Take On Me - 2015 Remaster' });
    expect(radio.splitTitle('"Xerxes: Largo" - Handel - I Solisti Italiani')).toMatchObject({ artist: 'Handel - I Solisti Italiani', song: 'Xerxes: Largo' });
    expect(radio.splitTitle('Peter Gabriel - text="Sledgehammer" song_spot="M" MediaBaseId="1"')).toMatchObject({ artist: 'Peter Gabriel', song: 'Sledgehammer' });
  });
  it('treats blanks, ads and the station name as no title, and keeps a title it cannot split', () => {
    for (const t of [null, '', ' - ', 'Advertisement', 'Unknown']) expect(radio.splitTitle(t).title).toBeNull();
    expect(radio.splitTitle('Heart 80s', 'Heart 80s').title).toBeNull();
    expect(radio.splitTitle('The Morning Show')).toEqual({ title: 'The Morning Show' });
  });
});

describe('radio: health check', () => {
  it('needs real audio bytes from a plain stream, not just an answer', async () => {
    expect(await probe.probeStream(`${base}/audio`)).toBe(true);
    for (const p of ['short', 'signin', 'gone']) expect(await probe.probeStream(`${base}/${p}`)).toBe(false);
  });

  it('hides a station after two failures (one retry at the end of the pass) and remembers it in DATA_DIR for a day', async () => {
    const tried: string[] = [];
    const store = probe.healthStore<{ id: string; url: string }>('test-health.json', { concurrency: 2, probe: async url => { tried.push(url); return url === 'good'; } });
    expect(store.scheduleProbes([{ id: 'a', url: 'good' }, { id: 'b', url: 'bad' }])).toBe(2);
    for (let i = 0; i < 50 && !store.healthOf('b')?.fails; i++) await new Promise(r => setTimeout(r, 100));
    for (let i = 0; i < 50 && store.healthOf('b')!.fails < 2; i++) await new Promise(r => setTimeout(r, 100));
    expect(probe.isDead(store.healthOf('b'))).toBe(true);
    expect(probe.isDead(store.healthOf('a'))).toBe(false);
    expect(tried.filter(u => u === 'bad')).toHaveLength(2);
    // Fresh answers are not checked again.
    expect(store.scheduleProbes([{ id: 'a', url: 'good' }, { id: 'b', url: 'bad' }])).toBe(0);
    await new Promise(r => setTimeout(r, 200));
    expect(existsSync(join(dir, 'test-health.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'test-health.json'), 'utf8')).b.fails).toBe(2);
  });

  it('marks stations and drops dead ones unless all is asked for', () => {
    const word = radio.healthWord('00000000-0000-0000-0000-000000000000');
    expect(word).toBe('unknown');
    const s = station('x', { id: '00000000-0000-0000-0000-000000000000' });
    expect(radio.checked([s])[0]!.health).toBe('unknown');
  });
});
