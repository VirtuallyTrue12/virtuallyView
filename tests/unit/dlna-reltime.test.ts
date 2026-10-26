import { describe, it, expect } from 'vitest';

// Test the RelTime ↔ seconds conversion without importing the whole service.
// The functions are not exported, so we duplicate them here.
function relTimeToSeconds(t: string): number {
  const parts = t.split(':').map(Number);
  if (parts.length === 3) return (parts[0]! * 3600) + (parts[1]! * 60) + (parts[2]! || 0);
  if (parts.length === 2) return (parts[0]! * 60) + (parts[1]! || 0);
  return Number(parts[0]) || 0;
}

function secondsToRelTime(s: number): string {
  const sec = Math.floor(s);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const rest = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

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
