/** Pure rules for the "For you" home rail: which kinds a viewer may see, and how the kinds are mixed. */

export type ForYouKind = 'movie' | 'series' | 'artist' | 'video';

export interface ForYouItem {
  id: string;
  kind: ForYouKind;
  /** Short line under the title, like "Because you watched Heat". */
  reason: string;
  [key: string]: unknown;
}

export const FOR_YOU_LIMIT = 20;
const KIND_ORDER: ForYouKind[] = ['movie', 'series', 'artist', 'video'];

/**
 * Takes each kind's items (best first) and deals them out one kind at a time, so no kind runs the rail.
 * A kind never holds more than half the rail. A repeated id shows once. Kids get movies and shows only
 * (the callers have already filtered those by rating).
 */
export function mixForYou(groups: Partial<Record<ForYouKind, ForYouItem[]>>, opts: { kid: boolean; limit?: number }): ForYouItem[] {
  const limit = opts.limit ?? FOR_YOU_LIMIT;
  const cap = Math.ceil(limit / 2);
  const kinds = KIND_ORDER.filter(k => !opts.kid || k === 'movie' || k === 'series');
  const queues = kinds.map(k => (groups[k] ?? []).slice(0, cap));
  const seen = new Set<string>();
  const out: ForYouItem[] = [];
  for (let round = 0; out.length < limit && queues.some(q => q.length > round); round++) {
    for (const queue of queues) {
      const item = queue[round];
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
      if (out.length >= limit) break;
    }
  }
  return out;
}
