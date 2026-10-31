/**
 * Pure rules behind the personal home page: what is "like" a title, which titles
 * the household is watching, and how a viewer's saved rail order applies.
 * No database or network here, so every rule can be unit-tested directly.
 */

export interface SimilarTitle {
  id: string;
  genres?: string[];
  collection?: string;
}

export interface TasteSignals {
  /** Titles the viewer has finished (marked watched). */
  finished: Set<string>;
  thumbsDown: Set<string>;
  thumbsUp: Set<string>;
}

const GENRE_WEIGHT = 4;      // Jaccard overlap of genres, scaled to 0..4
const COLLECTION_WEIGHT = 2; // same franchise or collection
const LIKED_TITLE_BOOST = 1; // the title itself is thumbed up
const LIKED_GENRE_STEP = 0.25; // per liked title that shares a genre with the candidate
const LIKED_GENRE_CAP = 1;

/**
 * Titles similar to `anchor`, best first. Candidates must share at least one genre or the same
 * collection. The anchor, anything finished and anything thumbed down are never returned.
 */
export function similarTitles<T extends SimilarTitle>(anchor: SimilarTitle, library: T[], signals: TasteSignals, limit = 12): Array<{ item: T; score: number }> {
  const anchorGenres = new Set(anchor.genres ?? []);

  // How often each genre appears among the titles the viewer thumbed up.
  const likedGenres = new Map<string, number>();
  for (const item of library) {
    if (!signals.thumbsUp.has(item.id)) continue;
    for (const genre of new Set(item.genres ?? [])) likedGenres.set(genre, (likedGenres.get(genre) ?? 0) + 1);
  }

  const scored: Array<{ item: T; score: number }> = [];
  for (const item of library) {
    if (item.id === anchor.id || signals.finished.has(item.id) || signals.thumbsDown.has(item.id)) continue;
    const genres = new Set(item.genres ?? []);
    let shared = 0;
    for (const genre of genres) if (anchorGenres.has(genre)) shared++;
    const union = anchorGenres.size + genres.size - shared;
    const genreScore = union > 0 ? (shared / union) * GENRE_WEIGHT : 0;
    const sameCollection = !!anchor.collection && item.collection === anchor.collection;
    if (genreScore === 0 && !sameCollection) continue;

    let likedShare = 0;
    for (const genre of genres) likedShare += likedGenres.get(genre) ?? 0;
    const boost = (signals.thumbsUp.has(item.id) ? LIKED_TITLE_BOOST : 0)
      + Math.min(LIKED_GENRE_CAP, likedShare * LIKED_GENRE_STEP);

    scored.push({ item, score: genreScore + (sameCollection ? COLLECTION_WEIGHT : 0) + boost });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
    .slice(0, limit);
}

export interface AnchorEvent {
  /** Library id of a movie or series. */
  id: string;
  /** ISO time of the last watch or change. */
  at: string;
}

/**
 * The most recent titles to base "Because you watched" rails on. Each title counts once, at its
 * latest time. Thumbed-down titles and titles no longer in the library are skipped.
 */
export function pickAnchors(events: AnchorEvent[], thumbsDown: Set<string>, inLibrary: Set<string>, limit = 2): string[] {
  const newestFirst = [...events].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const event of newestFirst) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    if (thumbsDown.has(event.id) || !inLibrary.has(event.id)) continue;
    picked.push(event.id);
    if (picked.length >= limit) break;
  }
  return picked;
}

export interface ViewRow {
  userId: string;
  /** Library id of the title that was watched. */
  id: string;
  /** ISO time of the watch. */
  at: string;
}

/**
 * Titles the whole household watched most in the last `windowDays` days. A title scores one per
 * viewer, so two people each watching it count twice and one person watching it twice counts once.
 */
export function topHousehold(rows: ViewRow[], now: Date, windowDays = 7, limit = 10): Array<{ id: string; viewers: number; lastAt: string }> {
  const since = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  const byTitle = new Map<string, { users: Set<string>; lastAt: string }>();
  for (const row of rows) {
    const at = Date.parse(row.at);
    if (!Number.isFinite(at) || at < since) continue;
    const entry = byTitle.get(row.id) ?? { users: new Set<string>(), lastAt: row.at };
    entry.users.add(row.userId);
    if (row.at > entry.lastAt) entry.lastAt = row.at;
    byTitle.set(row.id, entry);
  }
  return [...byTitle.entries()]
    .map(([id, entry]) => ({ id, viewers: entry.users.size, lastAt: entry.lastAt }))
    .sort((a, b) => b.viewers - a.viewers || (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export interface LayoutRow {
  railId: string;
  hidden: boolean;
  position: number;
}

/**
 * Apply a viewer's saved order and hidden flags to the default rails. A rail with a saved position
 * sorts by it; a rail without one keeps its default place. Every rail comes back, flagged hidden or not.
 */
export function applyHomeLayout<T extends { id: string }>(rails: T[], layout: LayoutRow[]): Array<T & { hidden: boolean }> {
  const saved = new Map(layout.map(row => [row.railId, row]));
  return rails
    .map((rail, index) => {
      const row = saved.get(rail.id);
      return { rail, hidden: row?.hidden === true, key: row ? row.position : index, index };
    })
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map(({ rail, hidden }) => ({ ...rail, hidden }));
}
