import { describe, expect, it } from 'vitest';
import { classify, GRACE_MINUTES } from '../../apps/server/src/services/download-doctor.js';
import { normalizeStatus } from '../../apps/server/src/services/real-downloads.js';

const row = (status: string, message?: string, progress = 0) => ({ status, message, progress });

describe('download doctor: what counts as stuck', () => {
  it('a release nobody shares is stalled, whichever service words it', () => {
    expect(normalizeStatus('radarr', 'warning', 0, 'The download is stalled with no connections')).toBe('stalled');
    expect(classify(row('stalled', 'The download is stalled with no connections'))).toEqual({ kind: 'stalled', needsYou: null });
  });

  it('a download stuck fetching metadata is treated as a dead release, but only while it has no data', () => {
    expect(classify(row('queued', 'qBittorrent is downloading metadata'))?.kind).toBe('metadata');
    expect(classify(row('downloading', 'qBittorrent is downloading metadata', 40))).toBeNull();
  });

  it('a finished download that cannot be matched is replaced', () => {
    expect(classify(row('failed', "Couldn't find similar album for [/downloads/pckt-vinyl-pink-floyd-animals]", 100))).toEqual({ kind: 'import', needsYou: null });
    expect(classify(row('failed', 'No files found are eligible for import'))?.kind).toBe('import');
  });

  it('never replaces what another release cannot fix: disk, permissions, folders', () => {
    for (const message of ['Not enough free disk space', 'Permission denied writing to /media/tv', 'Destination path does not exist', 'Read-only file system']) {
      const c = classify(row('failed', message, 100));
      expect(c?.kind).toBe('other');
      expect(c?.needsYou).toMatch(/server/);
    }
  });

  it('leaves healthy downloads alone and waits longer for slow starts than for failed imports', () => {
    expect(classify(row('downloading', undefined, 50))).toBeNull();
    expect(classify(row('completed', undefined, 100))).toBeNull();
    expect(classify(row('paused'))).toBeNull();
    expect(GRACE_MINUTES.import).toBeLessThan(GRACE_MINUTES.stalled);
    expect(GRACE_MINUTES.stalled).toBeLessThan(GRACE_MINUTES.metadata);
  });
});
