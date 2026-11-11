import { describe, expect, it } from 'vitest';
import { estimateBytes, keepNextPlan, qualityLabel } from '../../apps/web/src/lib/offline-plan';

describe('offline size estimate', () => {
  it('multiplies duration by the target bitrate', () => {
    expect(estimateBytes(3600, 'small')).toBe(405_000_000);
    expect(estimateBytes(3600, 'standard')).toBe(900_000_000);
    expect(estimateBytes(3600, 'high')).toBe(2_025_000_000);
  });
  it('has no guess without a duration, and the label then leaves the size out', () => {
    expect(estimateBytes(null, 'high')).toBeNull();
    expect(estimateBytes(0, 'high')).toBeNull();
    expect(qualityLabel('small', null, String)).toBe('Smaller (480p)');
    expect(qualityLabel('small', 5, b => `${b} MB`)).toBe('Smaller (480p, about 5 MB)');
  });
});

describe('keep the next N episodes', () => {
  const eps = (spec: string) => spec.split(' ').map((s, i) => ({ id: `e${i + 1}`, watched: s.includes('w'), hasFile: !s.includes('x') }));
  it('fetches the next unwatched episodes and removes watched ones that are saved', () => {
    const plan = keepNextPlan(eps('w w u u u u'), new Set(['e1', 'e3']), 3);
    expect(plan.remove).toEqual(['e1']);
    expect(plan.fetch).toEqual(['e4', 'e5']);
  });
  it('skips episodes with no file on the server and counts only the ones it can fetch', () => {
    expect(keepNextPlan(eps('u ux u u u'), new Set(), 3).fetch).toEqual(['e1', 'e3', 'e4']);
  });
  it('does nothing when everything is already in place or N is zero', () => {
    expect(keepNextPlan(eps('u u'), new Set(['e1', 'e2']), 3)).toEqual({ remove: [], fetch: [] });
    expect(keepNextPlan(eps('u u'), new Set(), 0).fetch).toEqual([]);
  });
});
