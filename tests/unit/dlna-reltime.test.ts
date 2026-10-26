import { describe, it, expect } from 'vitest';

import { relTimeToSeconds, secondsToRelTime } from '../../apps/server/src/services/dlna.js';

describe('DLNA RelTime', () => {
  it('parses H:MM:SS correctly', () => {
    expect(relTimeToSeconds('1:23:45')).toBe(5025);
    expect(relTimeToSeconds('0:00:00')).toBe(0);
    expect(relTimeToSeconds('2:00:00')).toBe(7200);
    expect(relTimeToSeconds('0:01:30')).toBe(90);
  });

  it('formats seconds to H:MM:SS', () => {
    expect(secondsToRelTime(5025)).toBe('1:23:45');
    expect(secondsToRelTime(0)).toBe('0:00:00');
    expect(secondsToRelTime(7200)).toBe('2:00:00');
    expect(secondsToRelTime(90)).toBe('0:01:30');
  });

  it('round-trips correctly', () => {
    for (const s of [0, 1, 59, 60, 3599, 3600, 7261]) {
      expect(relTimeToSeconds(secondsToRelTime(s))).toBe(s);
    }
  });
});
