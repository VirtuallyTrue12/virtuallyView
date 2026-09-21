import { currentActor } from './user-context.js';

// Movie and TV ratings collapsed onto one ladder so a limit of PG-13 also
// covers TV-14, and a limit of PG covers TV-PG and below.
const RANK: Record<string, number> = {
  'G': 1, 'TV-Y': 1, 'TV-Y7': 1, 'TV-G': 1,
  'PG': 2, 'TV-PG': 2,
  'PG-13': 3, 'TV-14': 3,
  'R': 4, 'TV-MA': 4, 'NC-17': 5
};

/**
 * True when the signed-in viewer may see an item with this certification.
 * Administrators and unrestricted viewers see everything. For a restricted
 * viewer an unrated title is hidden, because "unknown" is not "safe".
 */
export function ratingAllowed(certification: string | undefined): boolean {
  const actor = currentActor();
  const limit = actor.maxRating ? RANK[actor.maxRating] : undefined;
  if (!limit || actor.role !== 'user') return true;
  const rank = certification ? RANK[certification.trim().toUpperCase()] : undefined;
  return rank !== undefined && rank <= limit;
}

/** Drop movies and shows above the viewer's limit. Music has no rating and always passes. */
export function filterByRating<T extends { type?: string; certification?: string }>(items: T[]): T[] {
  return items.filter(item => (item.type !== 'movie' && item.type !== 'series') || ratingAllowed(item.certification));
}
