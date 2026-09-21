import { describe, test, expect } from 'vitest';
import { getAdapter, getManagedAdapters } from '../../apps/server/src/services/registry.js';

describe('adapter registry', () => {
  test('returns the real adapter for a known key', () => {
    expect(getAdapter('radarr')).toBe(getManagedAdapters().radarr);
    expect(getAdapter('sonarr')).toBe(getManagedAdapters().sonarr);
  });

  test('throws on an unknown key instead of silently returning Radarr', () => {
    expect(() => getAdapter('not-a-real-integration')).toThrow(/unknown integration/i);
  });
});
