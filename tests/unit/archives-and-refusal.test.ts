import { describe, expect, it } from 'vitest';
import { safeFolder } from '../../apps/server/src/services/archives.js';
import { refusal } from '../../packages/integrations/src/adapters/QBittorrentAdapter.js';

describe('unpacking a download that arrived as an archive', () => {
  it('only ever works inside the downloads folder', () => {
    expect(safeFolder('/downloads/juice-wrld-the-party-never-ends', '/downloads')).toBe('/downloads/juice-wrld-the-party-never-ends');
    expect(safeFolder('/downloads/../etc', '/downloads')).toBeNull();
    expect(safeFolder('/media/music/Juice WRLD', '/downloads')).toBeNull();
    expect(safeFolder('/downloads-other/x', '/downloads')).toBeNull();
    expect(safeFolder(undefined, '/downloads')).toBeNull();
  });
});

describe('a release qBittorrent will not add', () => {
  it('says why in plain words instead of a status code', () => {
    expect(refusal(409)).toMatch(/already has this release/);
    expect(refusal(409)).not.toMatch(/returned 409/);
    expect(refusal(500)).toMatch(/Try another release/);
  });
});
