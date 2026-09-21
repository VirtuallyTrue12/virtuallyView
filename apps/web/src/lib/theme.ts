const LIGHT_MODE_STORAGE = 'vv-light-mode'; // 'light' | 'dark' | 'system'

function getSavedLightMode(): string {
  try {
    const raw = localStorage.getItem(LIGHT_MODE_STORAGE);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
    return 'system';
  } catch {
    return 'system';
  }
}

export function setSavedLightMode(mode: string) {
  try { localStorage.setItem(LIGHT_MODE_STORAGE, mode); } catch { /* ignore */ }
}

export function computeTheme(): 'light' | 'dark' {
  if (getSavedLightMode() === 'light') return 'light';
  if (getSavedLightMode() === 'dark') return 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyCssVars(cssVars: Record<string, string>) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(cssVars)) {
    root.style.setProperty(key, value);
  }
}

const DARK_TEXT = '#101014';
const LIGHT_TEXT = '#f4f5f7';

function parseRgbColor(value: string): { r: number; g: number; b: number } | null {
  const hex = value.trim().match(/^#([0-9a-f]{6}|[0-9a-f]{3})/i);
  if (hex) {
    const raw = hex[1];
    const full = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw;
    return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
  }
  const rgb = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  return null;
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Same decision the theme engine makes server-side: WCAG contrast against
 *  black vs white on the accent, choosing the higher-contrast text color. */
export function accentContrast(accent: string): string {
  const parsed = parseRgbColor(accent);
  if (!parsed) return DARK_TEXT;
  const l = relativeLuminance(parsed);
  const againstBlack = (l + 0.05) / 0.05;
  const againstWhite = 1.05 / (l + 0.05);
  return againstBlack >= againstWhite ? DARK_TEXT : LIGHT_TEXT;
}

/**
 * Recomputes --color-accent-contrast from the currently-effective accent.
 * The light/dark toggle overrides --color-accent on <body> via a class without
 * touching the contrast the theme engine derived at activation - that mismatch
 * is the mechanism behind stale/black button text. Run after any mode or theme
 * change so buttons always use the text color that fits the accent in use.
 */
export function syncAccentContrast(target: HTMLElement = document.body): void {
  const accent = getComputedStyle(target).getPropertyValue('--color-accent').trim();
  if (!accent) return;
  target.style.setProperty('--color-accent-contrast', accentContrast(accent));
}
