import { api } from './api';

export type Mode = 'system' | 'light' | 'dark';
export interface Appearance { mode: Mode; dark: string; light: string }

const KEY = 'vv-appearance';
const CACHE = 'vv-theme-cache';
let appliedKeys: string[] = [];

const osPrefersLight = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches === true;

export function hasSavedAppearance(): boolean {
  try { return localStorage.getItem(KEY) !== null; } catch { return false; }
}

export function loadAppearance(): Appearance {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Appearance> | null;
    if (raw && (raw.mode === 'system' || raw.mode === 'light' || raw.mode === 'dark')) {
      return { mode: raw.mode, dark: raw.dark || 'default', light: raw.light || 'light' };
    }
    // Older builds stored only a light/dark mode.
    const legacy = localStorage.getItem('vv-light-mode');
    if (legacy === 'light' || legacy === 'dark') return { mode: legacy, dark: 'default', light: 'light' };
  } catch { /* storage blocked */ }
  return { mode: 'system', dark: 'default', light: 'light' };
}

export function saveAppearance(a: Appearance): void {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent('vv-appearance'));
}

export const effectiveMode = (a: Appearance): 'light' | 'dark' =>
  a.mode === 'system' ? (osPrefersLight() ? 'light' : 'dark') : a.mode;

export const effectiveThemeId = (a: Appearance): string => (effectiveMode(a) === 'light' ? a.light : a.dark);

export function applyTheme(id: string, mode: 'light' | 'dark', vars: Record<string, string>): void {
  const root = document.documentElement;
  for (const key of appliedKeys) root.style.removeProperty(key);
  appliedKeys = Object.keys(vars);
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  root.dataset.theme = id;
  root.dataset.mode = mode;
  root.style.colorScheme = mode;
  try { localStorage.setItem(CACHE, JSON.stringify({ id, mode, vars })); } catch { /* storage blocked */ }
}

/** Paint the last-used theme synchronously so there is no flash before the API answers. */
export function paintCachedTheme(): void {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE) ?? 'null') as { id: string; mode: 'light' | 'dark'; vars: Record<string, string> } | null;
    if (cached?.vars) {
      // Only reuse the cache if it still matches the theme this device wants.
      const wanted = effectiveThemeId(loadAppearance());
      if (cached.id === wanted) { applyTheme(cached.id, cached.mode, cached.vars); return; }
    }
  } catch { /* no cache */ }
  document.documentElement.dataset.mode = effectiveMode(loadAppearance());
  document.documentElement.style.colorScheme = effectiveMode(loadAppearance());
}

/** Fetch and apply whichever theme this device currently wants. Needs a signed-in session. */
export async function syncTheme(): Promise<void> {
  if (!hasSavedAppearance()) {
    // First visit on this device: adopt the server's default theme as the starting point.
    try {
      const server = await api.activeTheme();
      const a = loadAppearance();
      saveAppearance({ mode: 'system', dark: server.mode === 'dark' ? server.id : a.dark, light: server.mode === 'light' ? server.id : a.light });
    } catch { /* keep defaults */ }
  }
  const a = loadAppearance();
  const id = effectiveThemeId(a);
  const theme = await api.theme(id);
  applyTheme(id, theme.mode, theme.cssVars);
}
