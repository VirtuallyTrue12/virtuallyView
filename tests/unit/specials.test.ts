import { describe, expect, it } from 'vitest';
import { scoreCandidate } from '../../apps/server/src/services/specials';

const show = 'How I Met Your Mother';
describe('finding a TV special on video sites', () => {
  it('accepts a video carrying the special’s own title', () => {
    expect(scoreCandidate(show, "Lily and Marshall's Honeymoon Videos", "How I Met Your Mother - Lily and Marshall's Honeymoon", 631)).toBeGreaterThanOrEqual(0.6);
    expect(scoreCandidate(show, "Robin Sparkles Music Video - Let's Go to the Mall", "Robin Sparkles - Let's Go To The Mall [Full HD Music Video] | How I Met Your Mother", 215)).toBeGreaterThanOrEqual(0.6);
  });
  it('rejects look-alikes: a compilation or a different special from the same show', () => {
    expect(scoreCandidate(show, "Barney Stinson's Video Resume", 'How I Met Your Mother - Best Of Barney Stinson', 597)).toBeLessThan(0.6);
    expect(scoreCandidate(show, "Inside the Actors Studio: The Cast of 'How I Met Your Mother'", "How I Met Your Mother - The Cast's Favorite Moments", 261)).toBeLessThan(0.6);
  });
  it('rejects trailers and lengths far from the special’s', () => {
    expect(scoreCandidate(show, 'Series Finale: Alternate Ending', 'How I Met Your Mother Series Finale Alternate Ending trailer', 120, 41)).toBeLessThan(0.6);
    expect(scoreCandidate(show, 'Series Finale: Alternate Ending', 'How I Met Your Mother Series Finale Alternate Ending', 600, 41)).toBeLessThan(0.6);
  });
});
