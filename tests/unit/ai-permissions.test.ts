import { describe, test, expect, afterEach } from 'vitest';
import { getPermissionLevel, setPermissionLevel, isAllowed } from '../../apps/server/src/services/ai-permissions.js';

describe('AI permission levels', () => {
  afterEach(() => {
    setPermissionLevel('manage');
  });

  test('defaults to manage', () => {
    expect(getPermissionLevel()).toBe('manage');
  });

  test('read-level tools are always allowed at the default', () => {
    expect(isAllowed('read')).toBe(true);
    expect(isAllowed('request')).toBe(true);
    expect(isAllowed('manage')).toBe(true);
  });

  test('destructive tools are blocked at the default conservative level', () => {
    expect(isAllowed('destructive')).toBe(false);
  });

  test('lowering the level blocks tools above it', () => {
    setPermissionLevel('read');
    expect(isAllowed('read')).toBe(true);
    expect(isAllowed('request')).toBe(false);
  });

  test('rejects an unknown level', () => {
    // @ts-expect-error intentionally invalid input
    expect(() => setPermissionLevel('nonsense')).toThrow(/unknown permission level/i);
  });
});
