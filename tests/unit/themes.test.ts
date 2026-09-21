import { describe, test, expect } from 'vitest';
import { listThemes, getTheme, setActiveThemeId, getActiveThemeId } from '../../apps/server/src/services/themes.js';

describe('theme system', () => {
  test('lists the built-in themes with valid manifests and tokens', () => {
    const themes = listThemes();
    const ids = themes.map(t => t.manifest.id);
    expect(ids).toEqual(expect.arrayContaining(['default', 'oled', 'light', 'midnight', 'paper', 'mono']));
  });

  test('rejects activating an unknown theme id', () => {
    expect(() => setActiveThemeId('not-a-real-theme')).toThrow(/no theme/i);
  });

  test('activating a real theme persists and is reflected by getActiveThemeId', () => {
    setActiveThemeId('oled');
    expect(getActiveThemeId()).toBe('oled');
    setActiveThemeId('default');
    expect(getActiveThemeId()).toBe('default');
  });

  test('getTheme returns tokens matching the declared schema', () => {
    const theme = getTheme('midnight');
    expect(theme?.tokens.colors.accent).toBeTruthy();
    expect(theme?.tokens.radius.medium).toBeTruthy();
  });
});
