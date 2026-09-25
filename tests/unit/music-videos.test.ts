import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'vv-mv-'));
process.env.VV_DATA_DIR = join(root, 'data');
process.env.MEDIA_ROOTS = join(root, 'music');

type Mod = typeof import('../../apps/server/src/services/music-videos.js');
type Lib = typeof import('../../apps/server/src/services/music-video-library.js');
let mv: Mod;
let lib: Lib;
beforeAll(async () => {
  mv = await import('../../apps/server/src/services/music-videos.js');
  lib = await import('../../apps/server/src/services/music-video-library.js');
});

const torrent = (name: string, over: Record<string, unknown> = {}) => ({
  hash: 'a'.repeat(40), name, category: '', state: 'uploading', progress: 100,
  savePath: '/downloads', contentPath: `/downloads/${name}`, size: 1000, ...over
});

function fakes(library: Array<{ id: number; name: string; path: string }>, known: string[], torrents: ReturnType<typeof torrent>[] = []) {
  const moves: Array<[string, string]> = [];
  const added: string[] = [];
  const deps = {
    qbit: {
      listTorrents: async () => torrents,
      torrentFiles: async () => ['Show/concert.mkv'],
      setLocation: async (h: string, l: string) => { moves.push([h, l]); return { success: true, message: 'Moved.' }; }
    },
    lidarr: {
      listArtistFolders: async () => library,
      lookupCandidates: async (n: string) => known.filter(k => k.toLowerCase().includes(n.toLowerCase().slice(0, 4))).map(title => ({ title })),
      addArtistQuietly: async (n: string) => { added.push(n); const a = { id: 100 + added.length, name: n, path: `/media/music/${n}` }; library.push(a); return a; }
    }
  };
  return { deps, moves, added };
}

describe('recognising concerts and videos', () => {
  it('tells concerts from videos from everything else', () => {
    expect(() => mv.classifyMusicVideo('x')).not.toThrow();
    expect(mv.classifyMusicVideo('Foo.Fighters.Live.at.Wembley.2008.1080p.BluRay.x264')).toBe('Concerts');
    expect(mv.classifyMusicVideo('Metallica - S&M Symphony in Concert 1999 DVDRip')).toBe('Concerts');
    expect(mv.classifyMusicVideo('Queen - Greatest Video Hits Music Videos')).toBe('Videos');
    expect(mv.classifyMusicVideo('Spider-Man Brand New Day 2026 1080p')).toBeNull();
    expect(mv.classifyMusicVideo('Live Free or Die Hard 2007 1080p')).toBeNull();
    expect(mv.classifyMusicVideo('Live at the Apollo S03E01 720p')).toBeNull();
  });

  it('guesses the artist from the name', () => {
    expect(mv.artistGuesses('Foo.Fighters.Live.at.Wembley.2008.1080p.BluRay.x264')).toContain('Foo Fighters');
    expect(mv.artistGuesses('Metallica - S&M Symphony in Concert 1999 DVDRip')).toContain('Metallica');
    expect(mv.artistGuesses('Rock Concert 2019 1080p')).toEqual([]);
    // Titles written the other way round.
    expect(mv.artistGuesses('Live In Texas (Full) [HD UPGRADE] - Linkin Park')[0]).toBe('Linkin Park');
    expect(mv.artistGuesses('Foo Fighters - Live at Wembley 2008')[0]).toBe('Foo Fighters');
  });
});

describe('filing under the artist', () => {
  it('files under an artist already in the library', async () => {
    const { deps, moves, added } = fakes([{ id: 7, name: 'Foo Fighters', path: '/media/music/Foo Fighters' }], []);
    const out = await mv.fileTorrent(torrent('Foo.Fighters.Live.at.Wembley.2008.1080p.BluRay.x264'), deps);
    expect(out).toMatchObject({ status: 'filed', created: false, kind: 'Concerts' });
    expect(moves).toEqual([['a'.repeat(40), '/media/music/Foo Fighters/Concerts']]);
    expect(added).toEqual([]);
  });

  it('creates an artist the library has never had, then files under them', async () => {
    const { deps, moves, added } = fakes([{ id: 1, name: 'Juice WRLD', path: '/media/music/Juice WRLD' }], ['Scorpions']);
    const out = await mv.fileTorrent(torrent('Scorpions - Live in Berlin 1080p', { hash: 'b'.repeat(40) }), deps);
    expect(out).toMatchObject({ status: 'filed', created: true, kind: 'Concerts' });
    expect(added).toEqual(['Scorpions']);
    expect(moves[0]![1]).toBe('/media/music/Scorpions/Concerts');
  });

  it('waits for a person when the artist cannot be found, and accepts their answer', async () => {
    const { deps, moves } = fakes([], []);
    const t = torrent('Rock Concert 2019 1080p', { hash: 'c'.repeat(40) });
    const first = await mv.fileTorrent(t, deps);
    expect(first.status).toBe('needs_artist');
    expect(moves).toHaveLength(0);
    expect(mv.listJobs('needs_artist').map(j => j.hash)).toContain('c'.repeat(40));

    const known = fakes([], ['Kiss']);
    const second = await mv.fileTorrent(t, known.deps, { artistName: 'Kiss', kind: 'Videos' });
    expect(second).toMatchObject({ status: 'filed', kind: 'Videos' });
    expect(known.moves[0]![1]).toBe('/media/music/Kiss/Videos');
    expect(mv.listJobs('needs_artist').map(j => j.hash)).not.toContain('c'.repeat(40));
  });

  it('does not treat part of a title as an artist', async () => {
    const { deps, added } = fakes([], ['Wembley Stadium Band']);
    const out = await mv.fileTorrent(torrent('Wembley Live 1986 1080p', { hash: 'd'.repeat(40) }), deps);
    expect(out.status).toBe('needs_artist');
    expect(added).toEqual([]);
  });

  it('files a download the person marked as a concert even though its name says nothing', async () => {
    const list = [torrent('Linkin Park - Rock Am Ring 2004', { hash: '3'.repeat(40), category: 'vv-concerts' }), torrent('Some Movie 2010', { hash: '4'.repeat(40), category: 'vv-manual' })];
    const { deps, moves } = fakes([{ id: 8, name: 'Linkin Park', path: '/media/music/Linkin Park' }], [], list);
    const out = await mv.sweepMusicVideos(deps);
    expect(out).toHaveLength(1);
    expect(moves).toEqual([['3'.repeat(40), '/media/music/Linkin Park/Concerts']]);
  });

  it('only sweeps finished, unmanaged concert downloads, and only once', async () => {
    const list = [
      torrent('Foo.Fighters.Live.at.Wembley.2008.1080p', { hash: 'e'.repeat(40) }),
      torrent('Foo.Fighters.Live.Unfinished.2008', { hash: 'f'.repeat(40), progress: 40 }),
      torrent('Foo.Fighters.Live.Tour.2008', { hash: '1'.repeat(40), category: 'radarr' }),
      torrent('Ubuntu 24.04 desktop iso', { hash: '2'.repeat(40) })
    ];
    const { deps, moves } = fakes([{ id: 7, name: 'Foo Fighters', path: '/media/music/Foo Fighters' }], [], list);
    expect(await mv.sweepMusicVideos(deps)).toHaveLength(1);
    expect(moves.map(m => m[0])).toEqual(['e'.repeat(40)]);
    expect(await mv.sweepMusicVideos(deps)).toHaveLength(0);
  });
});

describe('the artist page listing', () => {
  it('lists concerts and videos found under an artist folder', () => {
    const artistPath = join(root, 'music', 'Queen');
    mkdirSync(join(artistPath, 'Concerts', 'Queen.Live.at.Wembley.1986.1080p'), { recursive: true });
    mkdirSync(join(artistPath, 'Videos'), { recursive: true });
    writeFileSync(join(artistPath, 'Concerts', 'Queen.Live.at.Wembley.1986.1080p', 'wembley.mkv'), 'x');
    writeFileSync(join(artistPath, 'Concerts', 'Queen.Live.at.Wembley.1986.1080p', 'readme.txt'), 'x');
    writeFileSync(join(artistPath, 'Videos', 'Bohemian Rhapsody.mp4'), 'x');
    const items = lib.scanArtistVideos({ id: 5, name: 'Queen', path: artistPath });
    expect(items.map(i => i.kind).sort()).toEqual(['Concerts', 'Videos']);
    expect(items.every(i => i.id.startsWith('musicvideo-5~'))).toBe(true);
    expect(items.find(i => i.kind === 'Videos')?.title).toBe('Bohemian Rhapsody');
    // One file in a release folder takes the release's name, minus the artist's own name.
    expect(items.find(i => i.kind === 'Concerts')?.title).toBe('Live at Wembley 1986');
  });
});
