import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'vv-yts-'));
process.env.VV_DATA_DIR = join(dir, 'data');
writeFileSync(join(dir, 'token'), 'tok');
process.env.YTDLP_URL = 'http://ytdlp:8098';
process.env.YTDLP_TOKEN_FILE = join(dir, 'token');

type Yt = typeof import('../../apps/server/src/services/youtube.js');
let yt: Yt;
beforeAll(async () => { yt = await import('../../apps/server/src/services/youtube.js'); });
afterEach(() => vi.unstubAllGlobals());

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const lidarr = (library: Array<{ id: number; name: string; path: string }>, known: string[] = []) => {
  const added: string[] = [];
  return { added, deps: { lidarr: {
    listArtistFolders: async () => library,
    lookupCandidates: async (n: string) => known.filter(k => k.toLowerCase().startsWith(n.toLowerCase().slice(0, 4))).map(title => ({ title })),
    addArtistQuietly: async (n: string) => { added.push(n); return { id: 50, name: n, path: `/media/music/${n}` }; }
  } } };
};

describe('YouTube concerts', () => {
  it('adds who the artist probably is and whether it is a concert or a video to each result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ results: [
      { id: '9PSo4PjbDbs', title: 'Linkin Park - Rock am Ring 2004 (Full Show)', channel: 'x', durationSeconds: 4262, views: 1, thumbnail: 't' },
      { id: 'abcdefghijk', title: 'Numb (Official Music Video)', channel: 'y', durationSeconds: 190, views: 1, thumbnail: 't' },
      { id: 'lmnopqrstuv', title: 'Some random upload', channel: 'z', durationSeconds: 3000, views: 1, thumbnail: 't' }
    ] })));
    const r = await yt.searchYoutube('linkin park');
    expect(r[0]).toMatchObject({ artistGuess: 'Linkin Park', kind: 'Concerts' });
    expect(r[1]!.kind).toBe('Videos');
    expect(r[2]!.kind).toBe('Concerts'); // nothing in the title, but it is long
  });

  it('files a download under an artist already in the library, sending the worker their Concerts folder', async () => {
    const calls: Array<{ url: string; body: unknown; auth: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization! });
      return reply({ id: 'job1', status: 'queued', percent: 0 }, 202);
    }));
    const { deps } = lidarr([{ id: 8, name: 'Linkin Park', path: '/media/music/Linkin Park' }]);
    const out = await yt.downloadFromYoutube({ id: '9PSo4PjbDbs', title: 'Linkin Park - Rock am Ring 2004 (Full Show)' }, deps);
    expect(out).toMatchObject({ created: false, kind: 'Concerts' });
    expect(calls[0]).toMatchObject({ url: 'http://ytdlp:8098/download', auth: 'Bearer tok', body: { id: '9PSo4PjbDbs', dir: '/media/music/Linkin Park/Concerts' } });
  });

  it('creates an artist the library has never had', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ id: 'job2', status: 'queued', percent: 0 }, 202)));
    const { deps, added } = lidarr([], ['Scorpions']);
    const out = await yt.downloadFromYoutube({ id: 'abcdefghijk', title: 'Scorpions - Live in Berlin (Full Concert)' }, deps);
    expect(out).toMatchObject({ created: true, artist: { name: 'Scorpions' } });
    expect(added).toEqual(['Scorpions']);
  });

  it('takes the artist a person typed over the guess, and asks when there is nothing to go on', async () => {
    const fetchMock = vi.fn(async () => reply({ id: 'job3', status: 'queued', percent: 0 }, 202));
    vi.stubGlobal('fetch', fetchMock);
    const { deps } = lidarr([{ id: 9, name: 'Kiss', path: '/media/music/Kiss' }]);
    expect(await yt.downloadFromYoutube({ id: 'abcdefghijk', title: 'Rock Concert 2019', artist: 'Kiss', kind: 'Videos' }, deps)).toMatchObject({ kind: 'Videos', artist: { name: 'Kiss' } });
    fetchMock.mockClear();
    const none = await yt.downloadFromYoutube({ id: 'abcdefghijk', title: 'Rock Concert 2019' }, deps);
    expect('failure' in none).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled(); // nothing is downloaded until the artist is known
  });

  it('says how to turn the service on when it is not there', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ENOTFOUND'); }));
    await expect(yt.searchYoutube('queen')).rejects.toThrow(/--profile youtube/);
    expect(await yt.youtubeAvailable()).toBe(false);
  });
});
