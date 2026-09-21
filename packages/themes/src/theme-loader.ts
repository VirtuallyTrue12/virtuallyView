import { readFileSync, existsSync, readdirSync, statSync, copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ThemeManifest, ThemeTokens, validateManifest, validateTokens } from './theme-engine.js';

export interface InstalledTheme {
  manifest: ThemeManifest;
  tokens?: ThemeTokens;
  installedAt: string;
  active: boolean;
  sourceDir: string;
}

const here = dirname(fileURLToPath(import.meta.url));
/**
 * Repository root, resolved relative to this module rather than
 * process.cwd(), which npm sets to the workspace directory under
 * `npm run dev/start --workspace=apps/server`. A cwd-relative path silently
 * finds no themes and the theme store shows up empty in production.
 */
const REPO_ROOT = resolve(here, '..', '..', '..');
const THEMES_DIR = resolve(REPO_ROOT, 'themes');

export function discoverThemePackages(): string[] {
  try {
    return readdirSync(THEMES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .filter(name => {
        const manifestPath = resolve(THEMES_DIR, name, 'theme.json');
        return existsSync(manifestPath);
      });
  } catch {
    return [];
  }
}

export function loadThemePackage(id: string): InstalledTheme | null {
  const dir = resolve(THEMES_DIR, id);
  const manifestPath = resolve(dir, 'theme.json');
  const tokensPath = resolve(dir, 'tokens.json');
  if (!existsSync(manifestPath)) return null;

  try {
    const manifestRaw = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!validateManifest(manifestRaw)) return null;
    const manifest = manifestRaw as ThemeManifest;

    let tokens: ThemeTokens | undefined;
    if (existsSync(tokensPath)) {
      const tokensRaw = JSON.parse(readFileSync(tokensPath, 'utf8'));
      if (validateTokens(tokensRaw)) tokens = tokensRaw as ThemeTokens;
    }
    return { manifest, tokens, installedAt: new Date().toISOString(), active: false, sourceDir: dir };
  } catch {
    return null;
  }
}

export function loadInstalledThemes(): InstalledTheme[] {
  return discoverThemePackages().map(id => {
    const pkg = loadThemePackage(id);
    return pkg ? { ...pkg, active: id === 'midnight' } : null;
  }).filter((t): t is InstalledTheme => !!t);
}
