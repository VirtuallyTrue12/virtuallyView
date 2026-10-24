import { useEffect, useState } from 'react';

const DEFAULT_TINT = '120, 128, 160';
const tints = new Map<string, string>();

/** The main colour of the artwork as "r, g, b", for the glow behind the Now Playing view. Falls back quietly. */
export function useArtworkTint(src?: string): string {
  const [tint, setTint] = useState(() => (src ? tints.get(src) : undefined) ?? DEFAULT_TINT);
  useEffect(() => {
    if (!src) { setTint(DEFAULT_TINT); return; }
    const known = tints.get(src);
    if (known) { setTint(known); return; }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      try {
        const size = 12;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let r = 0, g = 0, b = 0, weight = 0;
        for (let i = 0; i < data.length; i += 4) {
          const R = data[i]!, G = data[i + 1]!, B = data[i + 2]!;
          const max = Math.max(R, G, B), min = Math.min(R, G, B);
          const luma = (R + G + B) / 3;
          if (luma < 28 || luma > 232) continue; // near black or white says nothing about the picture
          const w = 0.15 + (max === 0 ? 0 : (max - min) / max);
          r += R * w; g += G * w; b += B * w; weight += w;
        }
        if (weight > 0) {
          const value = `${Math.round(r / weight)}, ${Math.round(g / weight)}, ${Math.round(b / weight)}`;
          tints.set(src, value);
          if (!cancelled) setTint(value);
        }
      } catch { /* a picture the canvas cannot read: keep the neutral glow */ }
    };
    img.src = src;
    return () => { cancelled = true; };
  }, [src]);
  return tint;
}
