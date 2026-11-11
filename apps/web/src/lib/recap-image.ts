import type { YearReview } from './api';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "42 h", or minutes while it is under one hour. */
export const fmtHours = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${h.toLocaleString(undefined, { maximumFractionDigits: 1 })} h`);

/** The summary lines of a recap, in the order they are drawn. Empty ones are left out. */
export function summaryLines(r: YearReview): Array<[string, string]> {
  return ([
    ['Top artist', r.topArtists[0]?.name],
    ['Top song', r.topSongs[0]?.title],
    ['Top film', r.topFilms[0]?.title],
    ['Top series', r.topShows[0]?.title],
    ['Top channel', r.topChannels[0]?.name],
    ['Busiest day', r.busiest ? DAYS[r.busiest.weekday] : undefined]
  ] as Array<[string, string | undefined]>).filter((l): l is [string, string] => !!l[1]).slice(0, 5);
}

/** Shrinks the font until the text fits the width, then draws it. */
function fit(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, size: number, weight: number, family: string) {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${family}`; s -= 2; } while (ctx.measureText(text).width > max && s > 24);
  ctx.fillText(text, x, y);
}

/** Draws the summary card (1080x1350) in the current theme's colours. No pictures, so the canvas is never tainted. */
export function drawRecap(r: YearReview): HTMLCanvasElement {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const bg = token('--color-background', '#101014');
  const surface = token('--color-surface-elevated', '#1c1c22');
  const text = token('--color-text-primary', '#fff');
  const muted = token('--color-text-secondary', '#aaa');
  const accent = token('--color-accent', '#7c5cff');
  const family = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = surface;
  ctx.beginPath();
  ctx.roundRect(60, 60, W - 120, H - 120, 48);
  ctx.fill();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = accent;
  ctx.font = `700 40px ${family}`;
  ctx.fillText(`YOUR ${r.year} IN REVIEW`, 120, 170);
  ctx.fillStyle = text;
  fit(ctx, fmtHours(r.hours.total), 120, 360, W - 240, 190, 800, family);
  ctx.fillStyle = muted;
  ctx.font = `400 40px ${family}`;
  ctx.fillText('watched and listened', 120, 425);
  let y = 560;
  for (const [label, value] of summaryLines(r)) {
    ctx.fillStyle = muted;
    ctx.font = `600 30px ${family}`;
    ctx.fillText(label.toUpperCase(), 120, y);
    ctx.fillStyle = text;
    fit(ctx, value, 120, y + 56, W - 240, 56, 700, family);
    y += 150;
  }
  ctx.fillStyle = accent;
  ctx.font = `600 30px ${family}`;
  ctx.fillText('VirtuallyView', 120, H - 110);
  return canvas;
}

/** Renders the recap to a PNG and downloads it. */
export async function saveRecapImage(r: YearReview): Promise<void> {
  const blob = await new Promise<Blob | null>(res => drawRecap(r).toBlob(res, 'image/png'));
  if (!blob) throw new Error('no image');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `my-${r.year}-in-review.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
