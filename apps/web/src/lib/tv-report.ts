/**
 * On a TV, report how the page actually looks there (the TV's own browser version, the size it reports, the
 * scale applied, where the main parts sit, and any script errors) to the server. TV browsers cannot be inspected
 * without a cable; this is how problems on them get seen. Sent on load, after each page change and on errors.
 */
const errors: string[] = [];

function rectOf(selector: string): string {
  const el = document.querySelector(selector);
  if (!el) return `${selector}: none`;
  const r = el.getBoundingClientRect();
  return `${selector}: ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
}

/** Elements that stick out past the right edge: what "misaligned" usually is. */
function overflowing(): string[] {
  const out: string[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > window.innerWidth + 4 && getComputedStyle(el).position !== 'fixed') {
      out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} right=${Math.round(r.right)}`);
      if (out.length >= 8) break;
    }
  }
  return out;
}

function send(reason: string): void {
  const css = (q: string) => { try { return CSS.supports(q); } catch { return false; } };
  const body = {
    reason,
    path: location.pathname,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    screen: `${screen.width}x${screen.height}`,
    devicePixelRatio: window.devicePixelRatio,
    tvZoom: getComputedStyle(document.documentElement).getPropertyValue('--tv-zoom').trim(),
    bodyZoom: getComputedStyle(document.body).getPropertyValue('zoom'),
    htmlClass: document.documentElement.className,
    scrollWidth: document.documentElement.scrollWidth,
    supportsFlexGap: css('gap: 1px') && css('display: flex'),
    supportsZoom: css('zoom: 1'),
    supportsAspectRatio: css('aspect-ratio: 1'),
    supportsInset: css('inset: 0'),
    layout: ['nav', '.sidebar', 'main', '.hero', '.media-rail', '.detail-hero', 'h1'].map(rectOf),
    overflowing: overflowing(),
    errors: errors.slice(-10)
  };
  void fetch('/api/tv-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' }).catch(() => undefined);
}

let started = false;
export function startTvReports(): void {
  if (started || !document.documentElement.classList.contains('tv')) return;
  started = true;
  window.addEventListener('error', e => { errors.push(`${e.message} @ ${e.filename?.split('/').pop()}:${e.lineno}`); send('error'); });
  window.addEventListener('unhandledrejection', e => { errors.push(`promise: ${String((e.reason as Error)?.message ?? e.reason).slice(0, 200)}`); });
  window.setTimeout(() => send('load'), 4000);
  // Page changes in the app: report each new page once it has drawn.
  let last = location.pathname;
  window.setInterval(() => { if (location.pathname !== last) { last = location.pathname; window.setTimeout(() => send('page'), 2500); } }, 1000);
}
