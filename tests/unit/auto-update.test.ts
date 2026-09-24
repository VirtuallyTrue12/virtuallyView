import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PRIORITY_IMAGES, internetReachable, runUpdates, startAutoUpdate, triggerUpdate, watchtowerPresent } from '../../apps/server/src/services/auto-update.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('auto-update', () => {
  it('asks Watchtower for the priority apps first, then everything', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(decodeURIComponent(String(url)));
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer secret');
      return json({ summary: { updated: 1, failed: 0 } });
    }) as unknown as typeof fetch;
    const summary = await runUpdates({ fetchImpl, url: 'http://watchtower:8080/', token: 'secret' });
    expect(summary).toEqual({ updated: 2, failed: 0 });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('/v1/update?image=');
    for (const name of ['radarr', 'sonarr', 'lidarr', 'prowlarr']) expect(calls[0]).toContain(name);
    expect(calls[1]).toBe('http://watchtower:8080/v1/update');
  });

  it('does nothing without a URL or token', async () => {
    expect(await triggerUpdate({ url: undefined, token: 'x', fetchImpl: vi.fn() as unknown as typeof fetch })).toBeNull();
    expect(await triggerUpdate({ url: 'http://w', token: '', fetchImpl: vi.fn() as unknown as typeof fetch })).toBeNull();
  });

  it('reports a Watchtower error', async () => {
    const fetchImpl = (async () => json({}, 401)) as unknown as typeof fetch;
    await expect(triggerUpdate({ url: 'http://w', token: 't', fetchImpl })).rejects.toThrow('401');
  });

  it('treats any HTTP answer as online and a network failure as offline', async () => {
    expect(await internetReachable((async () => new Response('', { status: 401 })) as unknown as typeof fetch)).toBe(true);
    expect(await internetReachable((async () => { throw new Error('ENETUNREACH'); }) as unknown as typeof fetch)).toBe(false);
  });

  it('sees whether Watchtower is running', async () => {
    expect(await watchtowerPresent({ url: 'http://w', fetchImpl: (async () => new Response('', { status: 405 })) as unknown as typeof fetch })).toBe(true);
    expect(await watchtowerPresent({ url: 'http://w', fetchImpl: (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch })).toBe(false);
    expect(await watchtowerPresent({ url: undefined })).toBe(false);
  });

  it('lists the download and search apps as priority', () => {
    expect(PRIORITY_IMAGES.join(' ')).toMatch(/prowlarr.*radarr.*sonarr.*lidarr/);
  });

  describe('scheduler', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('updates when the internet comes back, not before, and not repeatedly', async () => {
      let online = false;
      const updateCalls: string[] = [];
      const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (init?.method === 'POST') { updateCalls.push(u); return json({ summary: { updated: 0, failed: 0 } }); }
        if (init?.method === 'HEAD') { if (!online) throw new Error('offline'); return new Response('', { status: 401 }); }
        return new Response('', { status: 405 });
      }) as unknown as typeof fetch;
      startAutoUpdate({ fetchImpl, url: 'http://watchtower:8080', token: 't', now: () => Date.now() });

      await vi.advanceTimersByTimeAsync(20_000 + 120_000);
      expect(updateCalls).toHaveLength(0); // offline: nothing sent

      online = true;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(updateCalls).toHaveLength(2); // priority call, then the rest

      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(updateCalls).toHaveLength(2); // not again within the interval

      online = false;
      await vi.advanceTimersByTimeAsync(60_000);
      online = true;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(updateCalls).toHaveLength(4); // connection returned: run again straight away
    });

    it('sends nothing at all when Watchtower is not running', async () => {
      const fetchImpl = vi.fn(async (url: string) => { if (String(url).includes('watchtower:8080')) throw new Error('ENOTFOUND'); return new Response('', { status: 401 }); });
      startAutoUpdate({ fetchImpl: fetchImpl as unknown as typeof fetch, url: 'http://watchtower:8080', token: 't' });
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(fetchImpl.mock.calls.every(([u]) => String(u).includes('watchtower:8080'))).toBe(true);
    });
  });
});
