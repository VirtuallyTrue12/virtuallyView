import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hostAddresses as fromInterfaces, kindOf } from '../../scripts/host-addresses.mjs';
import { hostAddresses as fromFile } from '../../apps/server/src/services/stream-token';

const iface = (address: string, internal = false) => ({ address, family: 'IPv4', internal, netmask: '', mac: '', cidr: null });

describe('this computer\'s addresses for other devices', () => {
  it('keeps the home network and Tailscale, home network first, and drops loopback and container bridges', () => {
    const list = fromInterfaces({
      lo: [iface('127.0.0.1', true)],
      tailscale0: [iface('100.124.169.68')],
      wlan0: [iface('192.168.1.11'), { ...iface('fe80::1'), family: 'IPv6' }],
      podman1: [iface('10.89.1.1')],
      docker0: [iface('172.17.0.1')],
      veth12: [iface('10.88.0.5')]
    } as never);
    expect(list).toEqual([
      { interface: 'wlan0', address: '192.168.1.11', kind: 'lan' },
      { interface: 'tailscale0', address: '100.124.169.68', kind: 'tailscale' }
    ]);
  });

  it('tells Tailscale\'s range apart from a public address', () => {
    expect(kindOf('eth0', '100.64.0.1')).toBe('tailscale');
    expect(kindOf('eth0', '100.128.0.1')).toBeNull();
    expect(kindOf('eth0', '8.8.8.8')).toBeNull();
    expect(kindOf('eth0', '172.20.1.4')).toBe('lan');
  });

  it('reads what the host service wrote, and is empty (not an error) when there is nothing yet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vv-host-'));
    const file = join(dir, 'addresses.json');
    expect(fromFile(file)).toEqual({ addresses: [], updatedAt: null });
    writeFileSync(file, JSON.stringify({ updatedAt: '2026-10-21T10:00:00Z', addresses: [{ interface: 'wlan0', address: '192.168.1.11', kind: 'lan' }, { interface: 'x', address: 'bad', kind: 'other' }] }));
    expect(fromFile(file)).toEqual({ updatedAt: '2026-10-21T10:00:00Z', addresses: [{ interface: 'wlan0', address: '192.168.1.11', kind: 'lan' }] });
  });
});
