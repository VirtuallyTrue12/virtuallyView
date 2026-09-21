type Kind = 'movie' | 'series' | 'artist';

/** Last quality the viewer picked per media type; empty means the server default. */
export function getPreferredQuality(kind: Kind): string {
  try { return localStorage.getItem(`vv-quality-${kind}`) ?? ''; } catch { return ''; }
}

export function setPreferredQuality(kind: Kind, name: string): void {
  try { if (name) localStorage.setItem(`vv-quality-${kind}`, name); else localStorage.removeItem(`vv-quality-${kind}`); } catch { /* storage blocked */ }
}
