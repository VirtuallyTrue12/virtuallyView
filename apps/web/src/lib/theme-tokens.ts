/** Client-side twin of packages/themes: build a token set from a few choices and flatten it to CSS variables. */

export interface Tokens {
  colors: Record<string, string>;
  radius: { small: string; medium: string; large: string };
  animation: { fast: string; normal: string; slow: string };
  typography: { fontFamily: string; headingFamily: string; headingWeight: string; bodyWeight: string; letterSpacing: string };
  effects: Record<string, string>;
}

const MAP: Record<string, string> = {
  'colors.background': '--color-background', 'colors.surface': '--color-surface', 'colors.surfaceElevated': '--color-surface-elevated',
  'colors.surfaceOverlay': '--color-surface-overlay', 'colors.textPrimary': '--color-text-primary', 'colors.textSecondary': '--color-text-secondary',
  'colors.textMuted': '--color-text-muted', 'colors.accent': '--color-accent', 'colors.accentSoft': '--color-accent-soft', 'colors.border': '--color-border',
  'colors.borderFocus': '--color-border-focus', 'colors.success': '--color-success', 'colors.warning': '--color-warning', 'colors.danger': '--color-danger',
  'radius.small': '--radius-small', 'radius.medium': '--radius-medium', 'radius.large': '--radius-large',
  'animation.fast': '--duration-fast', 'animation.normal': '--duration-normal', 'animation.slow': '--duration-slow',
  'typography.fontFamily': '--font-family', 'typography.headingFamily': '--font-heading', 'typography.headingWeight': '--heading-weight',
  'typography.bodyWeight': '--body-weight', 'typography.letterSpacing': '--letter-spacing',
  'effects.shadowMedium': '--shadow-medium', 'effects.shadowLarge': '--shadow-large', 'effects.glow': '--shadow-glow',
  'effects.blurMedium': '--blur-medium', 'effects.blurLarge': '--blur-large', 'effects.backdrop': '--effect-backdrop',
  'effects.buttonRadius': '--button-radius', 'effects.buttonTransform': '--button-transform', 'effects.buttonWeight': '--button-weight',
  'effects.buttonTracking': '--button-tracking', 'effects.cardHover': '--card-hover'
};

const hex = (h: string) => { const v = h.replace('#', ''); const f = v.length === 3 ? v.split('').map(c => c + c).join('') : v; return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16)); };
const rgba = (h: string, a: number) => { const [r, g, b] = hex(h); return `rgba(${r}, ${g}, ${b}, ${a})`; };
const mix = (a: string, b: string, t: number) => { const x = hex(a), y = hex(b); return '#' + x.map((v, i) => Math.round(v * (1 - t) + y[i]! * t).toString(16).padStart(2, '0')).join(''); };

export function tokensToVars(tokens: Tokens): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, cssVar] of Object.entries(MAP)) {
    const [group, key] = path.split('.') as [keyof Tokens, string];
    const value = (tokens[group] as Record<string, string> | undefined)?.[key];
    if (value) out[cssVar] = value;
  }
  const acc = tokens.colors.accent ?? '#888888';
  const [r, g, b] = hex(acc);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  out['--color-accent-contrast'] = lum > 0.55 ? '#101014' : '#f4f5f7';
  return out;
}

export const FONTS = {
  sans: { label: 'Sans', stack: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif" },
  serif: { label: 'Serif', stack: "Georgia, 'Iowan Old Style', 'Palatino Linotype', serif" },
  mono: { label: 'Monospace', stack: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace" }
} as const;

export interface CreatorChoices {
  mode: 'dark' | 'light';
  background: string; text: string; accent: string;
  roundness: number;           // 0..28 (px for "medium")
  buttons: 'square' | 'rounded' | 'pill';
  uppercaseButtons: boolean;
  font: keyof typeof FONTS;
  headingWeight: number;       // 400..800
  depth: 'flat' | 'soft' | 'strong';
  glow: boolean;
  blur: number;                // 0..40
  backdrop: 'none' | 'accent-glow' | 'aurora';
  hover: 'none' | 'lift' | 'zoom';
}

export const START: CreatorChoices = {
  mode: 'dark', background: '#0b0c14', text: '#eef0f6', accent: '#d4a24e', roundness: 14, buttons: 'rounded',
  uppercaseButtons: false, font: 'sans', headingWeight: 700, depth: 'soft', glow: false, blur: 20, backdrop: 'accent-glow', hover: 'lift'
};

export function buildTokens(c: CreatorChoices): Tokens {
  const dark = c.mode === 'dark';
  const ink = dark ? '#ffffff' : '#000000';
  const shadowRgb = dark ? '0, 0, 0' : '30, 34, 50';
  const depth = { flat: [0, 0], soft: [dark ? 0.35 : 0.10, dark ? 0.45 : 0.16], strong: [dark ? 0.6 : 0.2, dark ? 0.75 : 0.3] }[c.depth];
  const r = c.roundness;
  const font = FONTS[c.font].stack;
  const backdrop = c.backdrop === 'accent-glow'
    ? `radial-gradient(900px 520px at 12% -10%, ${rgba(c.accent, dark ? 0.22 : 0.16)}, transparent 62%)`
    : c.backdrop === 'aurora'
      ? `radial-gradient(700px 480px at 8% 4%, ${rgba(c.accent, 0.3)}, transparent 62%), radial-gradient(760px 500px at 96% 0%, rgba(90, 160, 255, 0.28), transparent 60%), radial-gradient(800px 520px at 55% 100%, rgba(120, 230, 200, 0.22), transparent 62%)`
      : 'none';
  return {
    colors: {
      background: c.background,
      surface: rgba(ink, dark ? 0.05 : 0.035), surfaceElevated: rgba(ink, dark ? 0.09 : 0.06),
      surfaceOverlay: rgba(c.background, 0.88),
      textPrimary: c.text, textSecondary: mix(c.text, c.background, 0.32), textMuted: mix(c.text, c.background, 0.58),
      accent: c.accent, accentSoft: rgba(c.accent, 0.15), border: rgba(ink, dark ? 0.11 : 0.12), borderFocus: c.accent,
      success: dark ? '#5fd08a' : '#1f9d57', warning: dark ? '#e0b050' : '#a5731a', danger: dark ? '#e5685f' : '#c93c3c'
    },
    radius: { small: `${Math.round(r * 0.7)}px`, medium: `${r}px`, large: `${Math.round(r * 1.5)}px` },
    animation: { fast: '130ms', normal: '200ms', slow: '360ms' },
    typography: { fontFamily: font, headingFamily: font, headingWeight: String(c.headingWeight), bodyWeight: '400', letterSpacing: c.font === 'mono' ? '0' : '-0.02em' },
    effects: {
      shadowMedium: c.depth === 'flat' ? 'none' : `0 10px 32px rgba(${shadowRgb}, ${depth[0]})`,
      shadowLarge: c.depth === 'flat' ? 'none' : `0 24px 64px rgba(${shadowRgb}, ${depth[1]})`,
      glow: c.glow ? `0 0 34px ${rgba(c.accent, 0.35)}` : 'none',
      blurMedium: `${c.blur}px`, blurLarge: `${Math.round(c.blur * 1.8)}px`,
      backdrop,
      buttonRadius: c.buttons === 'square' ? '2px' : c.buttons === 'pill' ? '999px' : `${Math.max(4, Math.round(r * 0.8))}px`,
      buttonTransform: c.uppercaseButtons ? 'uppercase' : 'none',
      buttonWeight: c.uppercaseButtons ? '700' : '600',
      buttonTracking: c.uppercaseButtons ? '0.08em' : '0',
      cardHover: c.hover === 'lift' ? 'translateY(-6px)' : c.hover === 'zoom' ? 'scale(1.04)' : 'none'
    }
  };
}
