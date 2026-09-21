export interface ThemeTokens {
  colors: {
    background: string;
    surface: string;
    surfaceElevated: string;
    surfaceOverlay: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    accent: string;
    accentSoft: string;
    border: string;
    borderFocus: string;
    success: string;
    warning: string;
    danger: string;
  };
  radius: {
    small: string;
    medium: string;
    large: string;
  };
  animation: {
    fast: string;
    normal: string;
    slow: string;
  };
  /**
   * Optional depth tokens. They let a theme change more than its palette:
   * heading type, letter spacing, and layout density. Older themes that only
   * ship colors/radius/animation still validate and apply unchanged.
   */
  typography?: {
    /** Body font stack. */
    fontFamily?: string;
    /** Heading font stack; falls back to the body font when absent. */
    headingFamily?: string;
    /** Heading font weight (numeric string, e.g. "650"). */
    headingWeight?: string;
    /** Body font weight (numeric string). */
    bodyWeight?: string;
    /** Heading letter spacing (e.g. "-0.02em" or "0"). */
    letterSpacing?: string;
  };
  /**
   * Structural styling beyond color: shadows, glass blur, a background
   * gradient, button shape and card hover. Values are plain CSS literals; the
   * validator rejects url(), var(), imports and anything that could break out
   * of a declaration.
   */
  effects?: {
    shadowMedium?: string;
    shadowLarge?: string;
    glow?: string;
    blurMedium?: string;
    blurLarge?: string;
    /** A CSS gradient painted behind the whole app. */
    backdrop?: string;
    buttonRadius?: string;
    buttonTransform?: string;
    buttonWeight?: string;
    buttonTracking?: string;
    /** transform applied to a media card on hover. */
    cardHover?: string;
  };
  density?: {
    xs?: string;
    sm?: string;
    md?: string;
    lg?: string;
    xl?: string;
    xxl?: string;
  };
}

export interface ThemeManifest {
  name: string;
  id: string;
  version: string;
  author: string;
  description: string;
  engine: string;
  license: string;
  categories?: string[];
}

const CSS_VAR_MAP: Record<string, string> = {
  'colors.background': '--color-background',
  'colors.surface': '--color-surface',
  'colors.surfaceElevated': '--color-surface-elevated',
  'colors.surfaceOverlay': '--color-surface-overlay',
  'colors.textPrimary': '--color-text-primary',
  'colors.textSecondary': '--color-text-secondary',
  'colors.textMuted': '--color-text-muted',
  'colors.accent': '--color-accent',
  'colors.accentSoft': '--color-accent-soft',
  'colors.border': '--color-border',
  'colors.borderFocus': '--color-border-focus',
  'colors.success': '--color-success',
  'colors.warning': '--color-warning',
  'colors.danger': '--color-danger',
  'radius.small': '--radius-small',
  'radius.medium': '--radius-medium',
  'radius.large': '--radius-large',
  'animation.fast': '--duration-fast',
  'animation.normal': '--duration-normal',
  'animation.slow': '--duration-slow',
  'typography.fontFamily': '--font-family',
  'typography.headingFamily': '--font-heading',
  'typography.headingWeight': '--heading-weight',
  'typography.bodyWeight': '--body-weight',
  'typography.letterSpacing': '--letter-spacing',
  'effects.shadowMedium': '--shadow-medium',
  'effects.shadowLarge': '--shadow-large',
  'effects.glow': '--shadow-glow',
  'effects.blurMedium': '--blur-medium',
  'effects.blurLarge': '--blur-large',
  'effects.backdrop': '--effect-backdrop',
  'effects.buttonRadius': '--button-radius',
  'effects.buttonTransform': '--button-transform',
  'effects.buttonWeight': '--button-weight',
  'effects.buttonTracking': '--button-tracking',
  'effects.cardHover': '--card-hover',
  'density.xs': '--spacing-xs',
  'density.sm': '--spacing-sm',
  'density.md': '--spacing-md',
  'density.lg': '--spacing-lg',
  'density.xl': '--spacing-xl',
  'density.xxl': '--spacing-xxl'
};

/**
 * Picks the readable text color for a button sitting on the accent color.
 * Themes only declare the accent itself, so the contrast color is derived
 * from its relative luminance: dark text on light accents, white on dark.
 */
function parseRgb(value: string): { r: number; g: number; b: number } | null {
  const hex = value.trim().match(/^#([0-9a-f]{6}|[0-9a-f]{3})/i);
  if (hex) {
    const raw = hex[1];
    const full = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16)
    };
  }
  const rgb = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  }
  return null;
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const DARK_TEXT = '#101014';
const LIGHT_TEXT = '#f4f5f7';

function accentContrastFor(accent: string): string {
  const parsed = parseRgb(accent);
  if (!parsed) return DARK_TEXT;
  const l = relativeLuminance(parsed);
  // WCAG contrast ratio against black versus white; pick the higher one.
  const againstBlack = (l + 0.05) / 0.05;
  const againstWhite = 1.05 / (l + 0.05);
  return againstBlack >= againstWhite ? DARK_TEXT : LIGHT_TEXT;
}

/** Flattens a theme's token object into the CSS custom properties the app's design system already reads. No JS is ever executed from a theme package: only these declarative values are applied. */
export function tokensToCssVars(tokens: ThemeTokens): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, cssVar] of Object.entries(CSS_VAR_MAP)) {
    const [group, key] = path.split('.') as [keyof ThemeTokens, string];
    const value = (tokens[group] as Record<string, string> | undefined)?.[key];
    if (typeof value === 'string' && value.length > 0) out[cssVar] = value;
  }
  // Derive a readable text color for accent-filled buttons from the accent
  // itself, so light themes never fall back to near-black button text.
  if (out['--color-accent']) {
    out['--color-accent-contrast'] = accentContrastFor(out['--color-accent']);
  }
  return out;
}

const REQUIRED_MANIFEST_FIELDS = ['name', 'id', 'version', 'author', 'description', 'engine', 'license'] as const;
const REQUIRED_COLOR_KEYS = [
  'background', 'surface', 'surfaceElevated', 'surfaceOverlay', 'textPrimary', 'textSecondary',
  'textMuted', 'accent', 'accentSoft', 'border', 'borderFocus', 'success', 'warning', 'danger'
] as const;

export function validateManifest(manifest: unknown): manifest is ThemeManifest {
  if (typeof manifest !== 'object' || manifest === null) return false;
  const m = manifest as Record<string, unknown>;
  return REQUIRED_MANIFEST_FIELDS.every(field => typeof m[field] === 'string' && m[field] !== '');
}

export function validateTokens(tokens: unknown): tokens is ThemeTokens {
  if (typeof tokens !== 'object' || tokens === null) return false;
  const t = tokens as Record<string, unknown>;
  const colors = t.colors as Record<string, unknown> | undefined;
  const radius = t.radius as Record<string, unknown> | undefined;
  const animation = t.animation as Record<string, unknown> | undefined;
  if (!colors || !radius || !animation) return false;
  if (!REQUIRED_COLOR_KEYS.every(key => typeof colors[key] === 'string')) return false;
  if (!['small', 'medium', 'large'].every(key => typeof radius[key] === 'string')) return false;
  if (!['fast', 'normal', 'slow'].every(key => typeof animation[key] === 'string')) return false;

  // Optional depth groups: when present every provided value must be a plain
  // literal string. Missing keys fall back to the app defaults.
  const optionalGroups: Array<Record<string, unknown> | undefined> = [
    t.typography as Record<string, unknown> | undefined,
    t.density as Record<string, unknown> | undefined,
    t.effects as Record<string, unknown> | undefined
  ];
  for (const group of optionalGroups) {
    if (group === undefined) continue;
    if (typeof group !== 'object' || group === null) return false;
    if (!Object.values(group).every(value => typeof value === 'string')) return false;
  }

  // Token depth is deliberately one level: a token value is a literal color or
  // size, never a reference to another variable. Cross-token references would
  // make theme layering (custom theme over light/dark mode) ambiguous and
  // defeat validation, so they are rejected here rather than silently applied.
  const values = [
    ...REQUIRED_COLOR_KEYS.map(k => colors[k]),
    ...['small', 'medium', 'large'].map(k => radius[k]),
    ...['fast', 'normal', 'slow'].map(k => animation[k]),
    ...optionalGroups.flatMap(group => (group ? Object.values(group) : []))
  ];
  if (!values.every(value => typeof value === 'string' && !value.includes('var('))) return false;
  // Effects carry gradients and shadows: keep them declarative and contained.
  const effectValues = Object.values((t.effects as Record<string, string> | undefined) ?? {});
  return effectValues.every(value => value.length <= 1500 && !/[;{}@<>\\]|url\s*\(|expression|javascript|import/i.test(value));
}
