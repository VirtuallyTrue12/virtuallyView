import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateManifest, validateTokens, type ThemeManifest, type ThemeTokens } from '@virtuallyview/themes';
import { DATA_DIR, THEMES_DIR } from '../lib/paths.js';

const ACTIVE_THEME_PATH = resolve(DATA_DIR, 'theme-settings.json');
const DEFAULT_THEME_ID = 'default';
// Themes people import or create live in the data volume, so they survive image rebuilds.
const CUSTOM_THEMES_DIR = resolve(DATA_DIR, 'custom-themes');

export interface ThemePackage {
  manifest: ThemeManifest;
  tokens: ThemeTokens;
}

function loadThemePackage(dirName: string, root = THEMES_DIR): ThemePackage | null {
  try {
    const base = resolve(root, dirName);
    const manifest = JSON.parse(readFileSync(resolve(base, 'theme.json'), 'utf8'));
    const tokens = JSON.parse(readFileSync(resolve(base, 'tokens.json'), 'utf8'));
    if (!validateManifest(manifest) || !validateTokens(tokens)) return null;
    return { manifest, tokens };
  } catch {
    return null;
  }
}

function loadAll(root: string): ThemePackage[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => loadThemePackage(entry.name, root))
    .filter((t): t is ThemePackage => t !== null);
}

export function listThemes(): ThemePackage[] {
  const bundled = loadAll(THEMES_DIR);
  const ids = new Set(bundled.map(t => t.manifest.id));
  return [...bundled, ...loadAll(CUSTOM_THEMES_DIR).filter(t => !ids.has(t.manifest.id))];
}

export function isCustomTheme(id: string): boolean {
  return loadAll(CUSTOM_THEMES_DIR).some(t => t.manifest.id === id);
}

/** Save an imported or created theme package. Bundled theme ids cannot be overwritten. */
export function saveCustomTheme(manifest: ThemeManifest, tokens: ThemeTokens): ThemePackage {
  if (!validateManifest(manifest) || !validateTokens(tokens)) throw new Error('That is not a valid theme.');
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(manifest.id)) throw new Error('Theme id must be lowercase letters, numbers and dashes.');
  if (loadAll(THEMES_DIR).some(t => t.manifest.id === manifest.id)) throw new Error(`"${manifest.id}" is a bundled theme id. Choose another id.`);
  const dir = resolve(CUSTOM_THEMES_DIR, manifest.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'theme.json'), JSON.stringify(manifest, null, 2), 'utf8');
  writeFileSync(resolve(dir, 'tokens.json'), JSON.stringify(tokens, null, 2), 'utf8');
  return { manifest, tokens };
}

export function deleteCustomTheme(id: string): boolean {
  if (!isCustomTheme(id)) return false;
  rmSync(resolve(CUSTOM_THEMES_DIR, id), { recursive: true, force: true });
  if (getActiveThemeId() === id) setActiveThemeId(DEFAULT_THEME_ID);
  return true;
}

export function getTheme(id: string): ThemePackage | null {
  return listThemes().find(t => t.manifest.id === id) ?? null;
}

export function getActiveThemeId(): string {
  try {
    if (!existsSync(ACTIVE_THEME_PATH)) return DEFAULT_THEME_ID;
    const data = JSON.parse(readFileSync(ACTIVE_THEME_PATH, 'utf8')) as { activeThemeId?: string };
    return data.activeThemeId ?? DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function setActiveThemeId(id: string): ThemePackage {
  const theme = getTheme(id);
  if (!theme) throw new Error(`No theme with id "${id}" is installed.`);
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(ACTIVE_THEME_PATH, JSON.stringify({ activeThemeId: id }, null, 2), 'utf8');
  return theme;
}

export function getActiveTheme(): ThemePackage {
  const id = getActiveThemeId();
  return getTheme(id) ?? listThemes()[0] ?? {
    manifest: { name: 'Default', id: 'default', version: '1.0.0', author: '', description: '', engine: '1.x', license: 'MIT' },
    tokens: {
      colors: {
        background: '#0a0a10', surface: 'rgba(255,255,255,0.04)', surfaceElevated: 'rgba(255,255,255,0.07)',
        surfaceOverlay: 'rgba(10,10,16,0.78)', textPrimary: '#f0f1f4', textSecondary: '#a8adbf', textMuted: '#6b7186',
        accent: '#d4a24e', accentSoft: 'rgba(212,162,78,0.14)', border: 'rgba(255,255,255,0.07)', borderFocus: '#d4a24e',
        success: '#6fcd8f', warning: '#d4a24e', danger: '#e06a6a'
      },
      radius: { small: '10px', medium: '14px', large: '20px' },
      animation: { fast: '140ms', normal: '220ms', slow: '380ms' }
    }
  };
}
