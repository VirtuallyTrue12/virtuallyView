import { describe, test, expect } from 'vitest';
import { DATA_DIR, THEMES_DIR, REPO_ROOT } from '../../apps/server/src/lib/paths.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('server data paths', () => {
  test('resolve to real directories regardless of process.cwd()', () => {
    expect(existsSync(DATA_DIR)).toBe(true);
    expect(existsSync(THEMES_DIR)).toBe(true);
    expect(existsSync(resolve(REPO_ROOT, 'package.json'))).toBe(true);
  });

  test('DATA_DIR and THEMES_DIR are not cwd-relative', () => {
    // A regression of the original bug would produce a path with "apps/server" doubled.
    expect(DATA_DIR).not.toMatch(/apps[\\/]server[\\/].*apps[\\/]server/);
  });
});
