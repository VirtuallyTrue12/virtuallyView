import { describe, expect, it } from 'vitest';
import { nearestInDirection, type Box, type Candidate } from '../../apps/web/src/lib/dpad';

const box = (left: number, top: number, width = 100, height = 60): Box => ({ left, top, right: left + width, bottom: top + height });
const from = box(300, 300);

describe('nearestInDirection', () => {
  it('moves right to the closest control in the same row', () => {
    const items: Candidate<string>[] = [
      { item: 'near', box: box(420, 300) },
      { item: 'far', box: box(700, 300) },
    ];
    expect(nearestInDirection(from, items, 'right')).toBe('near');
  });

  it('never picks a control behind the direction of travel', () => {
    const items: Candidate<string>[] = [{ item: 'left', box: box(100, 300) }];
    expect(nearestInDirection(from, items, 'right')).toBeNull();
    expect(nearestInDirection(from, items, 'left')).toBe('left');
  });

  it('moves down to the card below, not the one off to the side', () => {
    const items: Candidate<string>[] = [
      { item: 'side', box: box(420, 300) },
      { item: 'below', box: box(300, 420) },
    ];
    expect(nearestInDirection(from, items, 'down')).toBe('below');
  });

  it('prefers a control in line over a nearer one far off to the side', () => {
    // Straight below (200px down, no sideways offset) versus diagonal (120px down, 130px across).
    // Score: straight 200, diagonal 120 + 2 * 130 = 380, so straight wins.
    const items: Candidate<string>[] = [
      { item: 'diagonal', box: box(430, 420) },
      { item: 'straight', box: box(300, 500) },
    ];
    expect(nearestInDirection(from, items, 'down')).toBe('straight');
  });

  it('moves up and left the same way', () => {
    expect(nearestInDirection(from, [{ item: 'above', box: box(300, 120) }], 'up')).toBe('above');
    expect(nearestInDirection(from, [{ item: 'before', box: box(120, 300) }], 'left')).toBe('before');
  });

  it('returns null when nothing lies that way', () => {
    expect(nearestInDirection(from, [], 'down')).toBeNull();
  });
});
