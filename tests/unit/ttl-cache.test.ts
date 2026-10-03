import { describe, expect, it, vi } from 'vitest';
import { TtlCache } from '../../packages/integrations/src/ttl-cache';

describe('TtlCache', () => {
  it('serves a fresh value without calling fill again', async () => {
    const cache = new TtlCache<number>(10_000);
    const fill = vi.fn().mockResolvedValue(1);
    expect(await cache.get('k', fill)).toBe(1);
    expect(await cache.get('k', fill)).toBe(1);
    expect(fill).toHaveBeenCalledTimes(1);
  });

  it('single-flight: concurrent callers for the same cold key share one fetch, not one each', async () => {
    const cache = new TtlCache<number>(10_000);
    let resolveFill: (v: number) => void = () => {};
    const fill = vi.fn(() => new Promise<number>(resolve => { resolveFill = resolve; }));
    const calls = [cache.get('k', fill), cache.get('k', fill), cache.get('k', fill)];
    // All three must be waiting on the one in-flight fetch, not three separate ones, before it resolves.
    expect(fill).toHaveBeenCalledTimes(1);
    resolveFill(42);
    expect(await Promise.all(calls)).toEqual([42, 42, 42]);
    expect(fill).toHaveBeenCalledTimes(1);
  });

  it('a failed fetch is not left in flight: the next call retries', async () => {
    const cache = new TtlCache<number>(10_000);
    const fill = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(7);
    await expect(cache.get('k', fill)).rejects.toThrow('boom');
    expect(await cache.get('k', fill)).toBe(7);
    expect(fill).toHaveBeenCalledTimes(2);
  });

  it('stale-on-error still applies once the in-flight refresh settles', async () => {
    const cache = new TtlCache<number>(10_000, 500, 5 * 60_000);
    const okFill = vi.fn().mockResolvedValue(1);
    expect(await cache.get('k', okFill)).toBe(1);
    vi.useFakeTimers();
    vi.advanceTimersByTime(11_000); // past ttlMs, still within staleMs
    const failFill = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await cache.get('k', failFill)).toBe(1);
    vi.useRealTimers();
  });
});
