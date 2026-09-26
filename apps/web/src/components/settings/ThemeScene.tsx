import type { CSSProperties } from 'react';

// A theme that ships no effects must not inherit the surrounding page's effects.
const NEUTRAL: Record<string, string> = {
  '--effect-backdrop': 'none', '--button-radius': 'var(--radius-medium)', '--button-transform': 'none', '--button-weight': '600',
  '--button-tracking': 'normal', '--shadow-medium': '0 8px 32px rgba(0, 0, 0, 0.3)', '--shadow-glow': 'none', '--card-hover': 'translateY(-4px)'
};
const CARDS = [['Dune', '2024', 'available'], ['Severance', '2022', 'downloading'], ['Alien', '1979', 'available'], ['Arrival', '2016', 'missing'], ['Heat', '1995', 'available']] as const;

/**
 * A small copy of the real app drawn with the theme's own variables and the app's own button, pill,
 * switch and card styles, so what you see while editing is what you get everywhere.
 */
export function ThemeScene({ vars, name }: { vars: Record<string, string>; name: string }) {
  return (
    <div className="tsc" style={{ ...NEUTRAL, ...vars } as CSSProperties} role="img" aria-label={`Live preview of the ${name} theme`}>
      <div className="tsc-nav">
        <span className="tsc-logo" /><b>virtuallyView</b>
        <span className="tsc-link">Home</span><span className="tsc-link is-on">Movies</span><span className="tsc-link">Music</span>
        <span className="tsc-avatar">A</span>
      </div>
      <div className="tsc-body">
        <div className="tsc-hero">
          <span className="tsc-eyebrow">Recently added</span>
          <strong className="tsc-title">{name}</strong>
          <span className="tsc-text">A quiet evening in your library, with everything one press away.</span>
          <div className="tsc-actions">
            <span className="btn btn-primary">Play</span><span className="btn btn-secondary">My List</span>
          </div>
        </div>
        <div className="tsc-cards">
          {CARDS.map(([t, y, s], i) => (
            <div className="tsc-card" key={t}>
              <span className="tsc-poster" style={{ ['--i' as string]: i } as CSSProperties}><span className={`ui-pill ui-pill--${s === 'available' ? 'ok' : s === 'downloading' ? 'info' : 'warn'}`}>{s}</span></span>
              <strong>{t}</strong><span>{y}</span>
            </div>
          ))}
        </div>
        <div className="tsc-panel">
          <div className="seg"><span className="seg-btn is-on">All</span><span className="seg-btn">Available</span><span className="seg-btn">Missing</span></div>
          <span className="settings-input tsc-input">Search your library…</span>
          <span className="ui-switch is-on"><span /></span>
          <div className="rq-bar tsc-bar"><div style={{ width: '62%' }} /></div>
          <div className="tsc-pills"><span className="ui-pill ui-pill--ok">Ready</span><span className="ui-pill ui-pill--warn">Waiting</span><span className="ui-pill ui-pill--bad">Failed</span></div>
          <span className="btn btn-danger btn-sm">Remove</span>
        </div>
      </div>
    </div>
  );
}
