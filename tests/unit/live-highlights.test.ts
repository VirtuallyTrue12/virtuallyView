import { describe, expect, it } from 'vitest';
import { sameChannel, scoreEvent } from '../../apps/server/src/services/live-highlights.js';

describe('live highlights', () => {
  it('matches a broadcaster to a playlist channel despite quality and country tags', () => {
    expect(sameChannel('Sky Sports Main Event', 'Sky Sports Main Event UK HD')).toBe(true);
    expect(sameChannel('ESPN', 'ESPN HD')).toBe(true);
    expect(sameChannel('Star Sports 1', 'Star Sports 1 HD (India)')).toBe(true);
  });
  it('does not confuse numbered or partial names', () => {
    expect(sameChannel('ESPN', 'ESPN 2')).toBe(false);
    expect(sameChannel('Sky Sports Main Event', 'Sky News')).toBe(false);
    expect(sameChannel('Fox', 'Fox Sports')).toBe(false);
    expect(sameChannel('', 'ESPN')).toBe(false);
  });
  it('ranks big competitions and famous teams above minor fixtures', () => {
    const big = scoreEvent({ weight: 10, title: 'Real Madrid vs Liverpool', hasTv: true });
    const minor = scoreEvent({ weight: 6, title: 'Monterey Bay FC vs Lexington SC', hasTv: false });
    expect(big).toBeGreaterThan(minor);
    expect(minor).toBeLessThan(9);
    expect(scoreEvent({ weight: 12, title: 'Azerbaijan Grand Prix', hasTv: true })).toBeGreaterThanOrEqual(9);
  });
});
