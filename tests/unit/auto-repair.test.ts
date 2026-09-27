import { describe, expect, it } from 'vitest';
import { restartOrder } from '../../apps/server/src/services/auto-repair.js';

describe('fix everything', () => {
  it('restarts the VPN before the download client that shares its network, and adds the client', () => {
    expect(restartOrder(['qbittorrent', 'radarr', 'gluetun'], [])).toEqual(['gluetun', 'radarr', 'qbittorrent']);
    expect(restartOrder(['gluetun'], ['gluetun', 'qbittorrent'])).toEqual(['gluetun', 'qbittorrent']);
    expect(restartOrder(['gluetun'], ['gluetun', 'vpngate-config', 'qbittorrent'])).toEqual(['vpngate-config', 'gluetun', 'qbittorrent']);
  });
  it('leaves unrelated services alone', () => {
    expect(restartOrder(['prowlarr'])).toEqual(['prowlarr']);
    expect(restartOrder([])).toEqual([]);
  });
});
