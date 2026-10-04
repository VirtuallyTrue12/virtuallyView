import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const upstream = vi.hoisted(() => ({
  radarr: { rootFolders: vi.fn().mockResolvedValue(['/media/movies']) },
  sonarr: { rootFolders: vi.fn().mockResolvedValue(['/media/tv']) },
  lidarr: { rootFolders: vi.fn().mockResolvedValue(['/media/music']) }
}));
vi.mock('../../apps/server/src/services/registry.js', () => ({ getAdapter: (key: string) => upstream[key as keyof typeof upstream] }));

const { mediaFolderInfo } = await import('../../apps/server/src/services/media-folders.js');

describe('media folder info', () => {
  const ENV_KEYS = ['MOVIES_DIR', 'TV_DIR', 'MUSIC_DIR', 'PHOTOS_DIR', 'BOOKS_DIR'];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { vi.clearAllMocks(); for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('is null when no host folder is configured (Docker-managed storage)', async () => {
    expect((await mediaFolderInfo('movies')).hostPath).toBeNull();
  });

  it('reports the configured host path', async () => {
    process.env.MOVIES_DIR = '/home/you/Videos/Movies';
    expect((await mediaFolderInfo('movies')).hostPath).toBe('/home/you/Videos/Movies');
  });

  it('photos and books have no media manager, so never ask one for extra folders', async () => {
    const info = await mediaFolderInfo('photos');
    expect(info).toEqual({ kind: 'photos', hostPath: null, extraFolders: [] });
    expect(upstream.radarr.rootFolders).not.toHaveBeenCalled();
  });

  it('lists a second Radarr root folder beyond the one this app mounts, and ignores the one that matches', async () => {
    upstream.radarr.rootFolders.mockResolvedValueOnce(['/media/movies', '/media/movies2']);
    const info = await mediaFolderInfo('movies');
    expect(info.extraFolders).toEqual(['/media/movies2']);
  });

  it('a media manager that is offline still reports the host path, just no extra folders', async () => {
    process.env.TV_DIR = '/home/you/Videos/TV';
    upstream.sonarr.rootFolders.mockRejectedValueOnce(new Error('offline'));
    const info = await mediaFolderInfo('tv');
    expect(info).toEqual({ kind: 'tv', hostPath: '/home/you/Videos/TV', extraFolders: [] });
  });
});
