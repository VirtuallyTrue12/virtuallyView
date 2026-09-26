import { describe, expect, it } from 'vitest';
import { restartOrder } from '../../apps/server/src/services/auto-repair.js';

describe('fix everything', () => {
  it('restarts the VPN before the download client that shares its network, and adds the client', () => {
    expect(restartOrder(['qbittorrent', 'radarr', 'gluetun'])).toEqual(['gluetun', 'radarr', 'qbittorrent']);
    expect(restartOrder(['gluetun'])).toEqual(['gluetun', 'qbittorrent']);
  });
  it('leaves unrelated services alone', () => {
    expect(restartOrder(['prowlarr'])).toEqual(['prowlarr']);
    expect(restartOrder([])).toEqual([]);
  });
});
