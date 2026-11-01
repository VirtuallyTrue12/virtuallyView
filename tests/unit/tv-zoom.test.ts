import { describe, expect, it } from 'vitest';
import { tvZoom, TV_LAYOUT_WIDTH } from '../../apps/web/src/lib/perf.js';

describe('TV page scale', () => {
  it('lays every TV out 1280 wide', () => {
    expect(TV_LAYOUT_WIDTH).toBe(1280);
    // A 1080p Android TV web view reports 960 wide: shrink, so the desktop layout fits instead of a doubled tablet one.
    expect(tvZoom(960)).toBe(0.75);
    // A TV browser at one pixel each reports 1920: grow, so it reads from the sofa.
    expect(tvZoom(1920)).toBe(1.5);
    expect(tvZoom(0)).toBe(1);
  });
});
