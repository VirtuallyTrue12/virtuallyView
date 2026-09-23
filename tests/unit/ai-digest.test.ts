import { describe, test, expect, vi, beforeEach } from 'vitest';

let requestRows: any[] = [];
let downloadRows: any[] = [];

vi.mock('../../apps/server/src/services/requests.js', () => ({ getRequests: () => requestRows }));
vi.mock('../../apps/server/src/services/real-downloads.js', () => ({ getDownloads: async () => downloadRows }));

import { buildDigest } from '../../apps/server/src/services/ai-digest.js';

const SINCE = Date.parse('2026-01-01T00:00:00.000Z');
const AFTER = '2026-01-01T01:00:00.000Z';
const BEFORE = '2025-12-31T00:00:00.000Z';

beforeEach(() => {
  requestRows = [];
  downloadRows = [];
});

describe('buildDigest', () => {
  test('returns null when nothing notable happened', async () => {
    requestRows = [{ id: 'r1', title: 'Old Movie', status: 'available', updatedAt: BEFORE }];
    downloadRows = [{ id: 'd1', title: 'Something', status: 'downloading' }];
    expect(await buildDigest(SINCE)).toBeNull();
  });

  test('mentions newly available titles by name', async () => {
    requestRows = [
      { id: 'r1', title: 'Inception', status: 'available', updatedAt: AFTER },
      { id: 'r2', title: 'The Matrix', status: 'available', updatedAt: AFTER },
      { id: 'r3', title: 'Old One', status: 'available', updatedAt: BEFORE }
    ];
    const digest = await buildDigest(SINCE);
    expect(digest).not.toBeNull();
    expect(digest!.body).toContain('Inception');
    expect(digest!.body).toContain('The Matrix');
    expect(digest!.body).not.toContain('Old One');
    expect(digest!.body).toContain('2 titles are now ready to watch');
  });

  test('mentions failed requests and failed downloads separately', async () => {
    requestRows = [{ id: 'r1', title: 'Broken Show', status: 'failed', updatedAt: AFTER }];
    downloadRows = [{ id: 'd1', title: 'Stuck', status: 'failed' }];
    const digest = await buildDigest(SINCE);
    expect(digest!.body).toContain('Broken Show');
    expect(digest!.body).toContain('1 download failed');
  });

  test('singular vs plural phrasing', async () => {
    requestRows = [{ id: 'r1', title: 'Solo', status: 'available', updatedAt: AFTER }];
    const digest = await buildDigest(SINCE);
    expect(digest!.body).toContain('One title is now ready to watch: Solo.');
  });
});
