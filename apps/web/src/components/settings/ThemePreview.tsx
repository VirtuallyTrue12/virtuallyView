import type { CSSProperties } from 'react';

// A theme that ships no effects must not inherit the surrounding page's effects.
const NEUTRAL: Record<string, string> = {
  '--effect-backdrop': 'none', '--button-radius': 'var(--radius-medium)', '--button-transform': 'none', '--button-weight': '600',
  '--button-tracking': 'normal', '--shadow-medium': '0 8px 32px rgba(0, 0, 0, 0.3)', '--shadow-glow': 'none'
};

/** A miniature app rendered with the theme's own CSS variables, so the preview is the real look. */
export function ThemePreview({ vars, name }: { vars: Record<string, string>; name: string }) {
  return (
    <div className="tp" style={{ ...NEUTRAL, ...vars } as CSSProperties} aria-hidden="true">
      <div className="tp-nav"><span className="tp-dot" /><span className="tp-line" /><span className="tp-line tp-line--short" /><span className="tp-line tp-line--short" /></div>
      <div className="tp-hero">
        <span className="tp-eyebrow">Now playing</span>
        <strong className="tp-title">{name}</strong>
        <span className="tp-text">A quiet evening in your library.</span>
        <div className="tp-actions"><span className="tp-btn tp-btn--primary">Play</span><span className="tp-btn">Details</span></div>
      </div>
      <div className="tp-row">
        <span className="tp-card"><i /></span><span className="tp-card"><i /></span><span className="tp-card"><i /></span>
        <span className="tp-pill">available</span>
      </div>
    </div>
  );
}
