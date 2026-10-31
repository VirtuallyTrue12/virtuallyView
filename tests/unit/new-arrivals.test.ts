import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// The services open the app database when they load, so point it at a throwaway folder first.
await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  process.env.VV_DATA_DIR = mkdtempSync(join(tmpdir(), 'vv-arrivals-'));
});
const { LidarrAdapter, SonarrAdapter } = await import('@virtuallyview/integrations');
const { findNewArrivals, followsByUser, isRequestDriven, episodeNotices, albumNotices } = await import('../../apps/server/src/services/new-arrivals.js');
const { newForYouRails } = await import('../../apps/server/src/services/new-for-you.js');

const NOW = '2026-10-31T12:00:00.000Z';
const CURSOR = '2026-10-31T11:00:00.000Z';

/** A Sonarr history record for one imported episode file. */
const sonarrImport = (at: string, seriesId: number, season: number, episode: number, extra: Record<string, unknown> = {}) => ({
  date: at, eventType: 'downloadFolderImported', seriesId, series: { id: seriesId, title: seriesId === 7 ? 'Severance' : 'The Bear' },
  episode: { seasonNumber: season, episodeNumber: episode }, data: { isUpgrade: 'False' }, ...extra
});

/** A Lidarr history record for one imported track file. */
const lidarrImport = (at: string, artistId: number, albumId: number, extra: Record<string, unknown> = {}) => ({
  date: at, eventType: 'trackFileImported', artistId, albumId,
  artist: { artistName: 'Portishead' }, album: { title: 'Dummy' }, data: { isUpgrade: 'False' }, ...extra
});

/** Fake fetch for both media managers: each history call returns the given records. */
function fakeArrs(sonarrRecords: unknown[], lidarrRecords: unknown[] = []) {
  return vi.fn(async (url: string) => {
    const records = url.includes('/api/v3/history') ? sonarrRecords : url.includes('/api/v1/history') ? lidarrRecords : [];
    return { ok: true, json: async () => ({ records }) };
  });
}

async function connected() {
  const sonarr = new SonarrAdapter();
  const lidarr = new LidarrAdapter();
  await sonarr.connect({ url: 'http://sonarr:8989', apiKey: 'k' });
  await lidarr.connect({ url: 'http://lidarr:8686', apiKey: 'k' });
  return { sonarr, lidarr };
}

describe('who follows what', () => {
  it('a show is followed from My List or from recent episode activity, and an artist from My List or, for administrators, the library', () => {
    const follows = followsByUser({
      users: [{ userId: 'ann', role: 'user' }, { userId: 'root', role: 'admin' }, { userId: 'kid', role: 'user' }],
      favorites: [{ userId: 'ann', mediaId: 'sonarr-7' }, { userId: 'kid', mediaId: 'lidarr-3' }],
      recentShows: [{ userId: 'kid', seriesId: 'sonarr-8' }],
      libraryArtistIds: ['lidarr-3', 'lidarr-4']
    });
    expect([...follows.get('ann')!.series]).toEqual(['sonarr-7']);
    expect([...follows.get('ann')!.artists]).toEqual([]);
    expect([...follows.get('kid')!.series]).toEqual(['sonarr-8']);
    expect([...follows.get('kid')!.artists]).toEqual(['lidarr-3']);
    // Administrators follow every artist in the library, but not every show.
    expect([...follows.get('root')!.artists].sort()).toEqual(['lidarr-3', 'lidarr-4']);
    expect(follows.get('root')!.series.size).toBe(0);
  });
});

describe('grouping arrivals into notices', () => {
  it('one episode is one notice with its code', () => {
    const [n] = episodeNotices([{ at: '2026-10-31T11:30:00.000Z', seriesId: 'sonarr-7', seriesTitle: 'Severance', season: 2, episode: 5 }]);
    expect(n).toMatchObject({ type: 'library.new-episode', mediaId: 'sonarr-7', title: 'New episode: Severance S02E05', link: '/series/sonarr-7' });
  });

  it('several episodes of one show become one notice, and two copies of the same episode count once', () => {
    const list = [
      { at: '2026-10-31T11:30:00.000Z', seriesId: 'sonarr-7', seriesTitle: 'Severance', season: 2, episode: 5 },
      { at: '2026-10-31T11:40:00.000Z', seriesId: 'sonarr-7', seriesTitle: 'Severance', season: 2, episode: 6 },
      { at: '2026-10-31T11:50:00.000Z', seriesId: 'sonarr-7', seriesTitle: 'Severance', season: 2, episode: 7 },
      { at: '2026-10-31T11:51:00.000Z', seriesId: 'sonarr-7', seriesTitle: 'Severance', season: 2, episode: 7 }
    ];
    const notices = episodeNotices(list);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ title: '3 new episodes of Severance', body: 'S02E05, S02E06, S02E07', detail: '3 new episodes' });
  });

  it('one album is one notice, however many of its tracks came in', () => {
    const notices = albumNotices([
      { at: '2026-10-31T11:30:00.000Z', artistId: 'lidarr-3', artistName: 'Portishead', albumId: 12, albumTitle: 'Dummy' },
      { at: '2026-10-31T11:31:00.000Z', artistId: 'lidarr-3', artistName: 'Portishead', albumId: 12, albumTitle: 'Dummy' }
    ]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ type: 'library.new-release', mediaId: 'lidarr-3', title: 'New album: Portishead – Dummy', link: '/albums/12' });
  });
});

describe('checking Sonarr and Lidarr history', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('the first run only records the time, and does not announce old history', async () => {
    const { sonarr, lidarr } = await connected();
    vi.stubGlobal('fetch', fakeArrs([sonarrImport('2026-10-30T09:00:00Z', 7, 2, 5)], [lidarrImport('2026-10-30T09:00:00Z', 3, 12)]));
    const result = await findNewArrivals({ now: NOW, cursors: {}, sonarr, lidarr, requests: [] });
    expect(result.notices).toEqual([]);
    expect(result.cursors).toEqual({ sonarr: NOW, lidarr: NOW });
  });

  it('after the first run, only imports since the last check are announced', async () => {
    const { sonarr, lidarr } = await connected();
    vi.stubGlobal('fetch', fakeArrs(
      [sonarrImport('2026-10-31T11:30:00Z', 7, 2, 5), sonarrImport('2026-10-31T10:00:00Z', 7, 2, 4)],
      [lidarrImport('2026-10-31T11:45:00Z', 3, 12)]
    ));
    const result = await findNewArrivals({ now: NOW, cursors: { sonarr: CURSOR, lidarr: CURSOR }, sonarr, lidarr, requests: [] });
    expect(result.notices.map(n => n.title)).toEqual(['New episode: Severance S02E05', 'New album: Portishead – Dummy']);
    expect(result.cursors).toEqual({ sonarr: NOW, lidarr: NOW });
  });

  it('imports caused by a request are skipped, because the request already says it is ready', async () => {
    const { sonarr, lidarr } = await connected();
    vi.stubGlobal('fetch', fakeArrs(
      [sonarrImport('2026-10-31T11:30:00Z', 7, 2, 5), sonarrImport('2026-10-31T11:35:00Z', 8, 1, 1)],
      [lidarrImport('2026-10-31T11:40:00Z', 3, 12)]
    ));
    const requests = [
      { providerId: 'sonarr-7', status: 'downloading', updatedAt: '2026-10-31T11:20:00Z' },
      { providerId: 'lidarr-3', status: 'available', updatedAt: '2026-10-31T11:41:00Z' }
    ];
    const result = await findNewArrivals({ now: NOW, cursors: { sonarr: CURSOR, lidarr: CURSOR }, sonarr, lidarr, requests });
    expect(result.notices.map(n => n.mediaId)).toEqual(['sonarr-8']);
  });

  it('an import that is not near a request, from a request that finished long ago, is announced', () => {
    const requests = [{ providerId: 'sonarr-7', status: 'available', updatedAt: '2026-10-01T00:00:00Z' }];
    expect(isRequestDriven('sonarr-7', '2026-10-31T11:30:00Z', requests)).toBe(false);
    expect(isRequestDriven('sonarr-7', '2026-10-31T11:30:00Z', [{ ...requests[0], updatedAt: '2026-10-31T11:00:00Z' }])).toBe(true);
    expect(isRequestDriven('sonarr-7', '2026-10-31T11:30:00Z', [{ providerId: 'sonarr-7', status: 'cancelled', updatedAt: '2026-10-31T11:30:00Z' }])).toBe(false);
  });

  it('a better copy replacing an old one, and a failed read, announce nothing and keep the old place', async () => {
    const { sonarr, lidarr } = await connected();
    vi.stubGlobal('fetch', fakeArrs([sonarrImport('2026-10-31T11:30:00Z', 7, 2, 5, { data: { isUpgrade: 'True' } })]));
    const upgraded = await findNewArrivals({ now: NOW, cursors: { sonarr: CURSOR }, sonarr, lidarr, requests: [] });
    expect(upgraded.notices).toEqual([]);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch failed'); }));
    const failed = await findNewArrivals({ now: NOW, cursors: { sonarr: CURSOR }, sonarr, lidarr, requests: [] });
    expect(failed.cursors.sonarr).toBe(CURSOR);
  });

  it('an album already announced is not announced again when more of its tracks arrive later', async () => {
    const { lidarr } = await connected();
    vi.stubGlobal('fetch', fakeArrs([], [lidarrImport('2026-10-31T11:45:00Z', 3, 12)]));
    const result = await findNewArrivals({
      now: NOW, cursors: { lidarr: CURSOR }, lidarr, requests: [], alreadySeen: key => key === 'album:12'
    });
    expect(result.notices).toEqual([]);
  });

  it('the adapter reads only what is newer than the check, and stops at the first older record', async () => {
    const { sonarr } = await connected();
    const fetchMock = fakeArrs([sonarrImport('2026-10-31T11:30:00Z', 7, 2, 5), sonarrImport('2026-10-31T10:00:00Z', 7, 2, 4), sonarrImport('2026-10-31T09:00:00Z', 7, 2, 3)]);
    vi.stubGlobal('fetch', fetchMock);
    const imports = await sonarr.getRecentImports(new Date(CURSOR));
    expect(imports).toEqual([expect.objectContaining({ seriesId: 'sonarr-7', seriesTitle: 'Severance', season: 2, episode: 5, upgrade: false })]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('the New for You rail', () => {
  it('is empty when the viewer follows nothing that arrived', () => {
    vi.stubGlobal('fetch', vi.fn());
    expect(newForYouRails(new Map(), [])).toEqual([]);
    vi.unstubAllGlobals();
  });
});
