import { describe, test, expect, vi } from 'vitest';

vi.mock('../../apps/server/src/lib/paths.js', () => ({ DATA_DIR: '/tmp/vv-hardening-test' }));

import { redactUrl } from '../../apps/server/src/lib/redact.js';
import { acquireConversion } from '../../apps/server/src/lib/limits.js';
import { rewriteHls, verifyRelay } from '../../apps/server/src/services/live-tv.js';

describe('log redaction', () => {
  test('secrets in a query string never survive, ordinary parts do', () => {
    expect(redactUrl('/api/stream/movie-1?st=1700000000.user.abcdef&x=1')).toBe('/api/stream/movie-1?st=[redacted]&x=1');
    expect(redactUrl('/api/live/relay?u=http%3A%2F%2Fsecret.example%2Fa.m3u8&e=123&s=deadbeef')).toBe('/api/live/relay?u=[redacted]&e=[redacted]&s=[redacted]');
    expect(redactUrl('/api/movies?sort=title')).toBe('/api/movies?sort=title');
    expect(redactUrl(undefined)).toBe('');
  });
});

describe('conversion limits', () => {
  test('a person gets two at once, everyone together three, and a released slot is reusable', () => {
    const a1 = acquireConversion('a')!;
    const a2 = acquireConversion('a')!;
    expect(a1).toBeTruthy();
    expect(a2).toBeTruthy();
    expect(acquireConversion('a')).toBeNull();
    const b1 = acquireConversion('b')!;
    expect(b1).toBeTruthy();
    expect(acquireConversion('c')).toBeNull();
    a1(); a1(); // releasing twice frees only one slot
    expect(acquireConversion('c')).toBeTruthy();
    a2(); b1();
  });
});

describe('live relay links', () => {
  const link = (body: string) => new URL('http://x' + /(\/api\/live\/relay\?[^\s"]+)/.exec(rewriteHls(body, 'http://origin.example/live/'))![1]);
  test('a fresh link verifies, and changes to the address, signature or expiry are refused', () => {
    const q = link('#EXTM3U\nsegment1.ts').searchParams;
    const url = q.get('u')!, sig = q.get('s')!, exp = q.get('e')!;
    expect(url).toBe('http://origin.example/live/segment1.ts');
    expect(verifyRelay(url, sig, exp)).toBe(true);
    expect(verifyRelay('http://evil.example/x', sig, exp)).toBe(false);
    expect(verifyRelay(url, sig.replace(/.$/, c => (c === 'a' ? 'b' : 'a')), exp)).toBe(false);
    expect(verifyRelay(url, sig, String(Number(exp) + 1))).toBe(false);
    expect(verifyRelay(url, sig, undefined)).toBe(false);
  });
  test('an expired link is refused even with a valid signature for that expiry', () => {
    vi.useFakeTimers();
    try {
      const q = link('#EXTM3U\nsegment2.ts').searchParams;
      vi.setSystemTime(Date.now() + 13 * 3_600_000);
      expect(verifyRelay(q.get('u')!, q.get('s')!, q.get('e')!)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
