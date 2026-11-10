import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

type Inv = typeof import('../../apps/server/src/services/invidious.js');
type Lists = typeof import('../../apps/server/src/services/video-lists.js');
type Ctx = typeof import('../../apps/server/src/services/user-context.js');
type Db = typeof import('../../apps/server/src/db/app-db.js');
let inv: Inv; let lists: Lists; let ctx: Ctx; let appDb: Db;
let dir = '';

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vv-videos-'));
  process.env.VV_DATA_DIR = dir;
  process.env.VIDEOS_LIBRARY = join(dir, 'videos');
  mkdirSync(process.env.VIDEOS_LIBRARY, { recursive: true });
  inv = await import('../../apps/server/src/services/invidious.js');
  lists = await import('../../apps/server/src/services/video-lists.js');
  ctx = await import('../../apps/server/src/services/user-context.js');
  appDb = await import('../../apps/server/src/db/app-db.js');
});
afterAll(() => { appDb.closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.VIDEOS_LIBRARY; });
afterEach(() => { delete process.env.INVIDIOUS_URL; vi.unstubAllGlobals(); });

const as = <T>(userId: string, fn: () => T): T => ctx.runAsActor({ userId, username: userId, role: 'user' }, fn);
const video = (id: string, published?: string) => ({ id, title: `Video ${id}`, channel: 'C', durationSeconds: 100, views: 1, ...(published ? { published } : {}) });
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Videos section: reading what the video service sends', () => {
  it('reads short view counts ("824M") that related videos carry instead of a number', () => {
    expect(inv.parseCount('824M')).toBe(824_000_000);
    expect(inv.parseCount('1.2K')).toBe(1200);
    expect(inv.parseCount('12,345')).toBe(12345);
    expect(inv.parseCount(undefined)).toBe(0);
  });

  it('turns channel pictures into addresses on this server, and the image proxy only ever reaches the instance', () => {
    process.env.INVIDIOUS_URL = 'http://invidious:3000';
    const path = inv.imageProxyPath('https://yt3.ggpht.com/abc-DEF=s88-c-k');
    expect(path).toBe(`/api/videos/image?p=${encodeURIComponent('/ggpht/abc-DEF=s88-c-k')}`);
    expect(inv.imageProxyPath('//yt3.googleusercontent.com/xyz=w1280')).toContain(encodeURIComponent('/ggpht/xyz=w1280'));
    expect(inv.imageProxyPath('https://evil.example/a.png')).toBeUndefined();
    expect(inv.imageUpstream('/ggpht/abc-DEF=s88-c-k')).toBe('http://invidious:3000/ggpht/abc-DEF=s88-c-k');
    for (const bad of ['/ggpht/../api/v1/stats', 'http://evil/x', '/api/v1/videos/x', '/ggpht/a?b=c']) expect(inv.imageUpstream(bad)).toBeNull();
  });

  it('finds chapters in a description only when they start at 0:00 and go forward', () => {
    expect(inv.parseChapters('Intro text\n0:00 Intro\n1:05 - The build\n1:02:03 Finale\nthanks')).toEqual([
      { start: 0, title: 'Intro' }, { start: 65, title: 'The build' }, { start: 3723, title: 'Finale' }
    ]);
    expect(inv.parseChapters('2:00 Starts late\n3:00 Next')).toEqual([]);
    expect(inv.parseChapters('0:00 Only one')).toEqual([]);
    expect(inv.parseChapters(undefined)).toEqual([]);
  });

  it('merges followed channels newest first, each video once', () => {
    const merged = inv.mergeFeed([[video('aaaaaaaaaaa', '2026-01-01T00:00:00Z'), video('bbbbbbbbbbb', '2026-03-01T00:00:00Z')], [video('ccccccccccc', '2026-02-01T00:00:00Z'), video('aaaaaaaaaaa', '2026-01-01T00:00:00Z')]]);
    expect(merged.map(v => v.id)).toEqual(['bbbbbbbbbbb', 'ccccccccccc', 'aaaaaaaaaaa']);
  });

  it('keeps the feed going when one followed channel fails, and asks each channel again only after a few minutes', async () => {
    process.env.INVIDIOUS_URL = 'http://invidious.local';
    inv.clearFeedCache();
    const good = 'UC' + 'a'.repeat(22), bad = 'UC' + 'b'.repeat(22);
    const fetchMock = vi.fn(async (url: string) => url.includes(bad) ? jsonRes({ error: 'gone' }, 500)
      : jsonRes({ videos: [{ videoId: 'dQw4w9WgXcQ', title: 'New upload', author: 'Good', authorId: good, published: 1_790_000_000, lengthSeconds: 60, viewCount: 3 }] }));
    vi.stubGlobal('fetch', fetchMock);
    const feed = await inv.subscriptionFeed([good, bad]);
    expect(feed.failed).toBe(1);
    expect(feed.videos.map(v => v.id)).toEqual(['dQw4w9WgXcQ']);
    expect(feed.videos[0]!.published).toBe(new Date(1_790_000_000 * 1000).toISOString());
    await inv.subscriptionFeed([good]);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes(good))).toHaveLength(1);
  });

  it('matches a video to the film it is about by title, and by year when the video names one', () => {
    const library = [{ id: 'm1', title: 'Inception', year: 2010 }, { id: 'm2', title: 'Up', year: 2009 }, { id: 'm3', title: 'Dune', year: 1984 }, { id: 'm4', title: 'Dune', year: 2021 }];
    expect(inv.matchLibraryTitle('Inception (2010) Official Trailer #1', library)?.id).toBe('m1');
    expect(inv.matchLibraryTitle('DUNE - Official Trailer (2021)', library)?.id).toBe('m4');
    expect(inv.matchLibraryTitle('Cheer up! A happy song', library)).toBeNull();
    expect(inv.matchLibraryTitle('Inceptionism explained', library)).toBeNull();
  });
});

describe('Videos section: per-person lists', () => {
  const channel = { id: 'UC' + 'c'.repeat(22), name: 'A Channel', subscribers: 10 };

  it('keeps followed channels, Watch later and resume points per person', () => {
    as('alice', () => { lists.subscribe(channel); lists.addToList('later', video('dQw4w9WgXcQ')); });
    expect(as('alice', () => lists.subscriptions().map(c => c.id))).toEqual([channel.id]);
    expect(as('bob', () => lists.subscriptions())).toEqual([]);
    expect(as('bob', () => lists.listVideos('later'))).toEqual([]);
    expect(as('alice', () => lists.isSubscribed(channel.id))).toBe(true);
    as('alice', () => lists.unsubscribe(channel.id));
    expect(as('alice', () => lists.subscriptions())).toEqual([]);
  });

  it('remembers where a video was left, even one never opened online, and lists it under Continue watching', () => {
    as('alice', () => {
      expect(lists.saveProgress('dQw4w9WgXcQ', 90, 600)).toBe(true); // known from Watch later
      expect(lists.saveProgress('zzzzzzzzzzz', 90, 600)).toBe(false); // nothing known about it
      expect(lists.progressOf('dQw4w9WgXcQ')).toBe(90);
      expect(lists.continueWatching().map(v => [v.id, v.position])).toEqual([['dQw4w9WgXcQ', 90]]);
      lists.saveProgress('dQw4w9WgXcQ', 590, 600); // practically finished
      expect(lists.continueWatching()).toEqual([]);
    });
    expect(as('bob', () => lists.progressOf('dQw4w9WgXcQ'))).toBe(0);
  });

  it('finds only a finished saved file, and deletes it only when nobody has it saved any more', () => {
    const lib = lists.videosLibrary();
    writeFileSync(join(lib, 'aaaaaaaaaaa.f137.mp4'), 'half');
    writeFileSync(join(lib, 'aaaaaaaaaaa.mp4.part'), 'half');
    expect(lists.savedFile('aaaaaaaaaaa')).toBeNull();
    writeFileSync(join(lib, 'aaaaaaaaaaa.mp4'), 'video');
    expect(lists.savedFile('aaaaaaaaaaa')).toBe(join(lib, 'aaaaaaaaaaa.mp4'));
    expect(lists.savedFile('../../etc/x')).toBeNull();
    as('alice', () => lists.addToList('saved', video('aaaaaaaaaaa')));
    as('bob', () => lists.addToList('saved', video('aaaaaaaaaaa')));
    as('alice', () => lists.removeFromList('saved', 'aaaaaaaaaaa'));
    expect(lists.removeSavedFileIfUnused('aaaaaaaaaaa')).toBe(false);
    expect(existsSync(join(lib, 'aaaaaaaaaaa.mp4'))).toBe(true);
    as('bob', () => lists.removeFromList('saved', 'aaaaaaaaaaa'));
    expect(lists.removeSavedFileIfUnused('aaaaaaaaaaa')).toBe(true);
    expect(existsSync(join(lib, 'aaaaaaaaaaa.mp4'))).toBe(false);
  });
});
