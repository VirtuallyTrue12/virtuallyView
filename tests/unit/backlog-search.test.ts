import { describe, expect, it, vi } from 'vitest';

const upstream = vi.hoisted(() => ({
  radarr: { searchAllMissing: vi.fn().mockResolvedValue({ success: true, message: 'ok' }) },
  sonarr: { searchAllMissing: vi.fn().mockResolvedValue({ success: true, message: 'ok' }) },
  lidarr: { searchAllMissing: vi.fn().mockRejectedValue(new Error('Lidarr is not connected.')) }
}));
vi.mock('../../apps/server/src/services/registry.js', () => ({ getAdapter: (key: string) => upstream[key as keyof typeof upstream] }));

const { runBacklogSearch } = await import('../../apps/server/src/services/backlog-search.js');

describe('backlog search: asks every service to search its own missing backlog', () => {
  it('asks all three services, staggered, and one being offline never stops the others', async () => {
    vi.useFakeTimers();
    const done = runBacklogSearch();
    // Radarr starts immediately; Sonarr and Lidarr are staggered a couple of minutes apart.
    expect(upstream.radarr.searchAllMissing).toHaveBeenCalledTimes(1);
    expect(upstream.sonarr.searchAllMissing).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(upstream.sonarr.searchAllMissing).toHaveBeenCalledTimes(1);
    expect(upstream.lidarr.searchAllMissing).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(upstream.lidarr.searchAllMissing).toHaveBeenCalledTimes(1);
    await done;
    vi.useRealTimers();
  });
});
