import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.VV_DATA_DIR = mkdtempSync(join(tmpdir(), 'vv-rp-'));

type Picker = typeof import('../../apps/server/src/services/release-picker.js');
type Registry = typeof import('../../apps/server/src/services/registry.js');
let picker: Picker;
let registry: Registry;
beforeAll(async () => {
  registry = await import('../../apps/server/src/services/registry.js');
  picker = await import('../../apps/server/src/services/release-picker.js');
});

const release = (over: Record<string, unknown>) => ({
  guid: 'magnet:?xt=urn:btih:AAAA', title: 'Linkin Park - Rock Am Ring 2004', indexer: 'The Pirate Bay', indexerId: 7,
  size: 900_000_000, seeders: 5, leechers: 1, ageDays: 400, protocol: 'torrent', downloadUrl: 'http://prowlarr:9696/7/download?x=1', ...over
});

describe('release picker', () => {
  it('lists releases best-seeded first, drops dead and non-torrent ones, and says what will be filed', async () => {
    vi.spyOn(registry.getAdapter('prowlarr') as never, 'searchReleases').mockResolvedValue([
      release({ guid: 'magnet:?xt=urn:btih:1', seeders: 2 }),
      release({ guid: 'magnet:?xt=urn:btih:2', seeders: 9, title: 'Linkin Park - Live at Rock am Ring 2004 1080p' }),
      release({ guid: 'https://x/dead.torrent', seeders: 0 }),
      release({ guid: 'nzb-1', protocol: 'usenet', seeders: 50 }),
      release({ guid: 'magnet:?xt=urn:btih:3', seeders: 4, title: 'Linkin Park Meteora album FLAC' })
    ] as never);
    const list = await picker.searchReleases('linkin park rock am ring');
    expect(list.map(r => r.id)).toEqual(['magnet:?xt=urn:btih:2', 'magnet:?xt=urn:btih:3', 'magnet:?xt=urn:btih:1']);
    expect(list[0]).toMatchObject({ filesUnder: 'Concerts', quality: '1080p' });
    expect(list[1]!.filesUnder).toBeNull();
    expect(await picker.searchReleases('a')).toEqual([]);
  });

  it('starts only a release the server listed, as an unmanaged download', async () => {
    const qbit = registry.getAdapter('qbittorrent') as never;
    const magnet = vi.spyOn(qbit, 'addMagnet').mockResolvedValue({ success: true, message: 'Started.' } as never);
    expect((await picker.grabRelease('magnet:?xt=urn:btih:made-up')).success).toBe(false);
    expect(magnet).not.toHaveBeenCalled();

    const ok = await picker.grabRelease('magnet:?xt=urn:btih:2');
    expect(ok).toMatchObject({ success: true, filesUnder: 'Concerts' });
    expect(ok.message).toMatch(/filed under the artist/);
    expect(magnet).toHaveBeenCalledWith('magnet:?xt=urn:btih:2', picker.CONCERT_CATEGORY);
  });

  it('honours "it is a concert" even when the name has no concert word, and "just download it"', async () => {
    vi.spyOn(registry.getAdapter('prowlarr') as never, 'searchReleases').mockResolvedValue([release({ guid: 'magnet:?xt=urn:btih:plain', title: 'Linkin Park - Rock Am Ring 2004' })] as never);
    await picker.searchReleases('linkin park');
    const magnet = vi.spyOn(registry.getAdapter('qbittorrent') as never, 'addMagnet').mockResolvedValue({ success: true, message: 'Started.' } as never);
    expect((await picker.grabRelease('magnet:?xt=urn:btih:plain', 'auto')).filesUnder).toBeNull();
    expect(magnet).toHaveBeenLastCalledWith('magnet:?xt=urn:btih:plain', picker.MANUAL_CATEGORY);
    expect((await picker.grabRelease('magnet:?xt=urn:btih:plain', 'concert')).filesUnder).toBe('Concerts');
    expect(magnet).toHaveBeenLastCalledWith('magnet:?xt=urn:btih:plain', picker.CONCERT_CATEGORY);
    expect((await picker.grabRelease('magnet:?xt=urn:btih:plain', 'video')).filesUnder).toBe('Videos');
    expect(magnet).toHaveBeenLastCalledWith('magnet:?xt=urn:btih:plain', picker.VIDEO_CATEGORY);
    expect((await picker.grabRelease('magnet:?xt=urn:btih:plain', 'none')).filesUnder).toBeNull();
  });

  it('fetches a .torrent file itself and hands over the bytes', async () => {
    vi.spyOn(registry.getAdapter('prowlarr') as never, 'searchReleases').mockResolvedValue([release({ guid: 'idx-77', seeders: 3 })] as never);
    await picker.searchReleases('linkin park');
    const add = vi.spyOn(registry.getAdapter('qbittorrent') as never, 'addTorrentFile').mockResolvedValue({ success: true, message: 'Started.' } as never);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })));
    const out = await picker.grabRelease('idx-77');
    vi.unstubAllGlobals();
    expect(out.success).toBe(true);
    expect(add).toHaveBeenCalledTimes(1);
    expect(Array.from(add.mock.calls[0]![0] as Uint8Array)).toEqual([1, 2, 3]);
  });
});
