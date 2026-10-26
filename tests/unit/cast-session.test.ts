import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test the cast-session logic by importing and calling functions directly.
// We mock the dlna deviceStatus and progress saveWatchProgress to avoid real network calls.

vi.mock('../../apps/server/src/services/dlna.js', () => ({
  deviceStatus: vi.fn(),
}));

vi.mock('../../apps/server/src/services/progress.js', () => ({
  saveWatchProgress: vi.fn(),
}));

vi.mock('../../apps/server/src/services/user-context.js', () => ({
  runAsActor: vi.fn((actor: unknown, fn: () => unknown) => fn()),
  currentActor: vi.fn(() => ({ userId: 'u1', username: 'test', role: 'user' })),
}));

import { startSession, getSession, endSession, updateSessionOffset, activeSessions, setCastDeviceLookup, positionOf, pollOnce } from '../../apps/server/src/services/cast-session.js';
import { deviceStatus } from '../../apps/server/src/services/dlna.js';
import { saveWatchProgress } from '../../apps/server/src/services/progress.js';

const actor = { userId: 'u1', username: 'test', role: 'user' as const };
const device = { id: 'tv1', name: 'My TV', host: '192.168.0.1' };

beforeEach(() => {
  vi.clearAllMocks();
  // Register the device lookup so endSession can find it.
  setCastDeviceLookup(id => id === 'tv1' ? device : undefined);
});

describe('cast-session', () => {
  it('accumulates offset + TV time for the saved position', async () => {
    vi.mocked(deviceStatus).mockResolvedValue({ state: 'PLAYING', currentTime: 120, duration: 3600 });

    startSession(device, { mediaType: 'movie', mediaId: 'm1', offset: 300, duration: 3600, title: 'Test', actor });
    const session = getSession('tv1');
    expect(session).toBeTruthy();
    expect(session?.offset).toBe(300);

    const pos = await endSession(device, true);
    // position = offset 300 + TV time 120 = 420
    expect(pos).toBe(420);
    expect(saveWatchProgress).toHaveBeenCalledWith('movie', 'm1', 420, 3600, undefined);
  });

  it('updates offset correctly after a seek-reload', () => {
    startSession(device, { mediaType: 'movie', mediaId: 'm2', offset: 0, duration: 1800, title: 'Film', actor });
    updateSessionOffset('tv1', 600);
    expect(getSession('tv1')?.offset).toBe(600);
  });

  it('activeSessions returns only this user sessions', () => {
    const otherActor = { userId: 'u2', username: 'other', role: 'user' as const };
    const device2 = { id: 'tv2', name: 'Other TV', host: '192.168.0.2' };
    setCastDeviceLookup(id => id === 'tv1' ? device : id === 'tv2' ? device2 : undefined);
    startSession(device, { mediaType: 'movie', mediaId: 'm3', offset: 0, duration: 100, title: 'A', actor });
    startSession(device2, { mediaType: 'movie', mediaId: 'm4', offset: 0, duration: 100, title: 'B', actor: otherActor });
    const mine = activeSessions('u1');
    expect(mine.length).toBe(1);
    expect(mine[0]?.mediaId).toBe('m3');
    // Clean up.
    void endSession(device, false);
    void endSession(device2, false);
  });

  it('endSession returns offset when status call fails', async () => {
    vi.mocked(deviceStatus).mockRejectedValue(new Error('timeout'));
    startSession(device, { mediaType: 'episode', mediaId: 'ep1', offset: 200, duration: 2400, title: 'Ep', actor });
    const pos = await endSession(device, false);
    expect(pos).toBe(200); // falls back to offset
  });

  it('uses the full length, not the TV\'s length of a conversion that began part-way', () => {
    // 40 min film cast from 30 min in: the TV reports a 10 min stream, 2 min played.
    expect(positionOf({ offset: 1800, duration: 2400 }, 120, 600)).toEqual({ position: 1920, duration: 2400 });
    // Unknown full length: the TV's remaining length plus the offset.
    expect(positionOf({ offset: 1800, duration: 0 }, 120, 600)).toEqual({ position: 1920, duration: 2400 });
  });

  it('a TV stopped from its own remote keeps the last real position instead of saving the offset', async () => {
    vi.mocked(deviceStatus).mockResolvedValueOnce({ state: 'PLAYING', currentTime: 500, duration: 3000 });
    startSession(device, { mediaType: 'movie', mediaId: 'm5', offset: 100, duration: 3600, title: 'F', actor });
    await pollOnce();
    expect(saveWatchProgress).toHaveBeenLastCalledWith('movie', 'm5', 600, 3600, undefined);
    vi.mocked(deviceStatus).mockResolvedValueOnce({ state: 'IDLE', currentTime: 0, idleReason: 'STOPPED' });
    await pollOnce();
    expect(saveWatchProgress).toHaveBeenCalledTimes(1);
    expect(getSession('tv1')).toBeUndefined();
  });

  it('Stop returns the last position the poll saw when the TV is already idle', async () => {
    vi.mocked(deviceStatus).mockResolvedValueOnce({ state: 'PLAYING', currentTime: 50, duration: 1000 });
    startSession(device, { mediaType: 'movie', mediaId: 'm6', offset: 0, duration: 1000, title: 'G', actor });
    await pollOnce();
    vi.mocked(deviceStatus).mockResolvedValueOnce({ state: 'IDLE', currentTime: 0 });
    expect(await endSession(device, true)).toBe(50);
  });

  it('playing to the end marks it watched', async () => {
    vi.mocked(deviceStatus).mockResolvedValueOnce({ state: 'IDLE', currentTime: 0, idleReason: 'FINISHED' });
    startSession(device, { mediaType: 'episode', mediaId: 'e9', seriesId: 's1', offset: 0, duration: 1500, title: 'E', actor });
    await pollOnce();
    expect(saveWatchProgress).toHaveBeenCalledWith('episode', 'e9', 1500, 1500, 's1');
    expect(getSession('tv1')).toBeUndefined();
  });

  it('survives a TV that is silent while it loads, and gives up after about a minute', async () => {
    vi.mocked(deviceStatus).mockResolvedValue(null);
    startSession(device, { mediaType: 'movie', mediaId: 'm7', offset: 0, duration: 1000, title: 'H', actor });
    for (let i = 0; i < 5; i++) await pollOnce();
    expect(getSession('tv1')).toBeTruthy();
    await pollOnce();
    expect(getSession('tv1')).toBeUndefined();
  });
});
