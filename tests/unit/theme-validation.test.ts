import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateManifest, validateTokens } from '../../packages/themes/src/theme-engine.js';

const dirs = readdirSync('themes').filter(d => existsSync(join('themes', d, 'tokens.json')));

describe('bundled themes still validate under the strict rules', () => {
  test.each(dirs)('%s', dir => {
    const manifest = JSON.parse(readFileSync(join('themes', dir, 'theme.json'), 'utf8'));
    const tokens = JSON.parse(readFileSync(join('themes', dir, 'tokens.json'), 'utf8'));
    expect(validateManifest(manifest)).toBe(true);
    expect(validateTokens(tokens)).toBe(true);
  });
});

describe('shared themes are treated as untrusted', () => {
  const base = () => JSON.parse(readFileSync('themes/default/tokens.json', 'utf8'));
  const withValue = (path: string[], value: string) => { const t = base(); let o = t; for (const k of path.slice(0, -1)) o = (o[k] ??= {}); o[path.at(-1)!] = value; return t; };

  test.each([
    [['colors', 'accent'], 'red; background: url(http://evil/x)'],
    [['colors', 'accent'], 'url(http://evil/x)'],
    [['colors', 'background'], 'var(--other)'],
    [['colors', 'surface'], '} body { display:none'],
    [['colors', 'border'], 'expression(alert(1))'],
    [['radius', 'small'], '12px; color:red'],
    [['radius', 'medium'], 'calc(1px + 2px)'],
    [['animation', 'fast'], 'url(x)'],
    [['animation', 'slow'], '1s infinite'],
    [['typography', 'headingWeight'], 'bold; x'],
    [['effects', 'backdrop'], 'linear-gradient(red, blue); }'],
    [['effects', 'glow'], '0 0 4px url(x)']
  ])('%j = %s is refused', (path, value) => {
    expect(validateTokens(withValue(path as string[], value))).toBe(false);
  });

  test('a manifest with markup or a bad id is refused', () => {
    const ok = { name: 'Nice', id: 'nice', version: '1.0.0', author: 'Me', description: 'A theme', engine: '1.x', license: 'MIT' };
    expect(validateManifest(ok)).toBe(true);
    expect(validateManifest({ ...ok, id: '../evil' })).toBe(false);
    expect(validateManifest({ ...ok, name: '<script>alert(1)</script>' })).toBe(false);
    expect(validateManifest({ ...ok, version: 'x' })).toBe(false);
  });
});
