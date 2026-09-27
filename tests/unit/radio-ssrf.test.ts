import { afterEach, describe, expect, it, vi } from 'vitest';

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

const { isPublicUrl, safeFetch } = await import('../../apps/server/src/services/radio.js');

afterEach(() => { vi.unstubAllGlobals(); lookupMock.mockReset(); });

describe('radio: never let a station or its redirects point inside the private network', () => {
  it('blocks the private and link-local IPv4 ranges (where cloud metadata endpoints live)', async () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '169.254.169.254', '172.16.0.5', '100.64.0.1', '0.0.0.0']) {
      lookupMock.mockResolvedValue([{ address, family: 4 }]);
      expect(await isPublicUrl('http://station.example/stream')).toBe(false);
    }
  });

  it('blocks the IPv4-mapped IPv6 form of the same ranges, not only the bare IPv4 or IPv6 forms', async () => {
    // This is exactly the gap a hostile DNS answer can use: the address is "private" only once you unwrap
    // the ::ffff: mapping, so a check that does not unwrap it lets the request straight through.
    for (const address of ['::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:172.20.0.1', '::ffff:10.0.0.1']) {
      lookupMock.mockResolvedValue([{ address, family: 6 }]);
      expect(await isPublicUrl('http://station.example/stream')).toBe(false);
    }
  });

  it('blocks a literal bracketed IPv6 loopback or link-local address, on purpose (not just by the lookup throwing)', async () => {
    expect(await isPublicUrl('http://[::1]/stream')).toBe(false);
    expect(await isPublicUrl('http://[fe80::1]/stream')).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('allows a real public address', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    expect(await isPublicUrl('http://station.example/stream')).toBe(true);
  });

  it('only http/https, and only when every resolved address is public', async () => {
    expect(await isPublicUrl('file:///etc/passwd')).toBe(false);
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]);
    expect(await isPublicUrl('http://station.example/stream')).toBe(false);
  });

  it('re-validates every redirect hop before following it, so a 3xx cannot point the request inside the network afterwards', async () => {
    lookupMock.mockImplementation(async (host: string) => (host === 'evil.example' ? [{ address: '169.254.169.254', family: 4 }] : [{ address: '93.184.216.34', family: 4 }]));
    const fetchMock = vi.fn(async (url: string) => new Response(null, { status: 302, headers: { location: 'http://evil.example/metadata' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(safeFetch('http://station.example/stream')).rejects.toThrow('That address is not allowed.');
    // The redirect target must have been requested at most for the manual-redirect check, never followed further.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows a redirect chain that stays public the whole way', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://station.example/final' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await safeFetch('http://station.example/stream');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
