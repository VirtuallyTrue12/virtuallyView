/** Most dialogue sent to the assistant for one recap. The newest lines are kept when it is cut. */
export const RECAP_TEXT_CAP = 12000;
/** Recaps are cached and cut off at these steps, so one answer serves every point inside the step. */
export const RECAP_STEP_SECONDS = 300;
const MAX_BULLETS = 8;

export const RECAP_SYSTEM_PROMPT = [
  'You write a short, spoiler-safe recap from subtitle dialogue.',
  'Write 5 to 8 bullet points, one per line, each starting with "- ".',
  'Describe what happened so far, in order, in plain English.',
  'Use only the dialogue given. Never mention or hint at anything after the last line of dialogue.'
].join(' ');

/**
 * The point the recap is cut at: the viewer's position rounded DOWN to the step. Rounding down means
 * a cached answer never includes anything past where any viewer in that step actually is.
 */
export function recapCutoff(at: number): number {
  const safe = Number.isFinite(at) && at > 0 ? at : 0;
  return Math.floor(safe / RECAP_STEP_SECONDS) * RECAP_STEP_SECONDS;
}

/** Cache key for one recap: the item and the rounded cutoff, so every position in one step shares it. */
export function recapCacheKey(kind: 'episode' | 'movie', id: string, at: number): string {
  return `${kind}:${id}@${recapCutoff(at)}`;
}

const cache = new Map<string, string[]>();
const CACHE_LIMIT = 200;

export function getCachedRecap(key: string): string[] | undefined {
  return cache.get(key);
}

export function rememberRecap(key: string, bullets: string[]): void {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, bullets);
}

/** Bullet lines from the assistant's reply. Falls back to any non-empty line when it used no bullets. */
export function parseBullets(reply: string): string[] {
  const lines = reply.split('\n').map(line => line.trim()).filter(Boolean);
  const bulleted = lines.filter(line => /^([-*•]|\d+[.)])\s+/.test(line));
  const source = bulleted.length ? bulleted : lines;
  return source
    .map(line => line.replace(/^([-*•]|\d+[.)])\s*/, '').trim())
    .filter(line => line.length > 2)
    .slice(0, MAX_BULLETS);
}
