import { describe, expect, it } from 'vitest';
import { clockOffset, driftAction, expectedPosition, unescapeChat, type SharedState } from '../../apps/web/src/lib/partySync';
import { allowSend, cleanChat, CHAT_MAX } from '../../apps/server/src/services/party-chat';

const state = (over: Partial<SharedState> = {}): SharedState => ({ playing: true, position: 100, rate: 1, seq: 1, from: 'a', at: 10_000, waiting: [], ...over });

describe('drift correction', () => {
  it('leaves tiny drift alone', () => expect(driftAction(0.03)).toEqual({ kind: 'none' }));
  it('speeds up when behind and slows down when ahead', () => {
    expect(driftAction(-0.4)).toMatchObject({ kind: 'nudge', rate: 1.05 });
    expect(driftAction(0.4)).toMatchObject({ kind: 'nudge', rate: 0.95 });
  });
  it('keeps the nudge to a few seconds and scales it by the party speed', () => {
    const act = driftAction(-0.4, 2);
    expect(act).toMatchObject({ kind: 'nudge', rate: 2.1 });
    expect((act as { ms: number }).ms).toBeLessThanOrEqual(10_000);
  });
  it('seeks for a drift over two seconds', () => {
    expect(driftAction(2.5)).toEqual({ kind: 'seek' });
    expect(driftAction(-30)).toEqual({ kind: 'seek' });
  });
});

describe('shared clock', () => {
  it('trusts the sample with the shortest round trip', () => {
    // Server is 5 s ahead. The slow sample is lopsided; the quick one is exact.
    const offset = clockOffset([
      { sent: 1000, received: 1900, server: 6600 },
      { sent: 2000, received: 2020, server: 7010 }
    ]);
    expect(offset).toBe(5000);
  });
  it('is zero with no samples', () => expect(clockOffset([])).toBe(0));
  it('works out where the video should be', () => {
    expect(expectedPosition(state(), 12_000)).toBe(102);
    expect(expectedPosition(state({ rate: 2 }), 12_000)).toBe(104);
    expect(expectedPosition(state({ playing: false }), 12_000)).toBe(100);
    expect(expectedPosition(state({ waiting: ['Sam'] }), 12_000)).toBe(100);
  });
});

describe('chat rules', () => {
  it('escapes markup and drops control characters', () => {
    expect(cleanChat('<img src=x onerror="a()">\u0007hi')).toBe('&lt;img src=x onerror=&quot;a()&quot;&gt; hi');
    expect(unescapeChat(cleanChat(`Tom & Jerry's <b>`)!)).toBe(`Tom & Jerry's <b>`);
  });
  it('trims, caps the length and refuses empty or non-text input', () => {
    expect(cleanChat('   ')).toBeNull();
    expect(cleanChat(42)).toBeNull();
    expect(cleanChat('x'.repeat(CHAT_MAX + 50))).toHaveLength(CHAT_MAX);
  });
  it('allows a few messages per window, then refuses until the window passes', () => {
    const stamps: number[] = [];
    expect([0, 1, 2, 3, 4].every(i => allowSend(stamps, i * 100, 5, 10_000))).toBe(true);
    expect(allowSend(stamps, 600, 5, 10_000)).toBe(false);
    expect(allowSend(stamps, 10_050, 5, 10_000)).toBe(true);
  });
});
