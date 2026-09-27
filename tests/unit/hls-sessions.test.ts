import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscodeOptions } from '../../apps/server/src/services/transcode.js';

const acquireConversion = vi.fn((userId: string) => (userId === 'blocked' ? null : vi.fn()));

vi.mock('../../apps/server/src/lib/limits.js', () => ({
  acquireConversion: (userId: string) => acquireConversion(userId),
  CONVERSION_MAX_MS: 999_999_999
}));

vi.mock('../../apps/server/src/services/transcode.js', () => ({
  ffmpegHlsArgs: () => [],
  resolveBinary: () => '/fake/ffmpeg',
  HLS_PLAYLIST: 'index.m3u8',
  HLS_SEGMENT_PATTERN: /^seg\d{5}\.ts$/
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void };
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    return proc;
  })
}));

const { ensureHlsSession } = await import('../../apps/server/src/services/hls-sessions.js');

const opts: TranscodeOptions = {};

describe('HLS sessions are shared by content+options rather than by viewer, but joining one still costs a slot', () => {
  beforeEach(() => acquireConversion.mockClear());

  it('a second, different user joining an already-running session spends their own conversion slot, and is refused once they have none left', () => {
    const key = `test-${Math.random()}`;

    const started = ensureHlsSession(key, 'alice', '/media/movie.mkv', 0, opts);
    expect(started.ok).toBe(true);
    expect(acquireConversion).toHaveBeenCalledTimes(1);
    expect(acquireConversion).toHaveBeenCalledWith('alice');

    // Alice re-requesting the same session (a reload, a second tab) must not charge her twice.
    const again = ensureHlsSession(key, 'alice', '/media/movie.mkv', 0, opts);
    expect(again.ok).toBe(true);
    expect(acquireConversion).toHaveBeenCalledTimes(1);

    // Bob joining the same already-running session must spend his own slot, not ride Alice's for free.
    const bob = ensureHlsSession(key, 'bob', '/media/movie.mkv', 0, opts);
    expect(bob.ok).toBe(true);
    expect(acquireConversion).toHaveBeenCalledTimes(2);
    expect(acquireConversion).toHaveBeenCalledWith('bob');

    // Someone already at their own limit is refused, even though the session already exists for others.
    const blocked = ensureHlsSession(key, 'blocked', '/media/movie.mkv', 0, opts);
    expect(blocked).toEqual({ ok: false, status: 429, message: expect.stringContaining('Too many videos') });
  });
});
