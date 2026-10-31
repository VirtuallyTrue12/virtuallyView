/**
 * "Made for you" mixes. A pure function: the play history and the library go in,
 * up to three mixes come out. The same user in the same ISO week always gets the
 * same mixes, so they only change on Monday.
 */

/** One playable track in the library, as the music routes describe it. */
export interface CatalogTrack {
  trackId: string;
  title: string;
  artistId: string;
  artistTitle: string;
  albumId?: string;
  albumTitle?: string;
  genre?: string;
  year?: number;
  cover?: string;
  durationMs?: number;
  quality?: string;
}

/** One play, as stored in music_plays. */
export interface PlayRecord {
  trackId: string;
  playedAt: string;
}

export interface WeeklyMix {
  id: 'favourites' | 'rediscover' | 'deep-cuts';
  name: string;
  blurb: string;
  /** The ISO week this mix was made for, such as 2026-W44. */
  week: string;
  tracks: CatalogTrack[];
  /** Up to four distinct album covers, for the 2x2 cover. */
  covers: string[];
}

export const MIX_SIZE = 25;
const RECENT_DAYS = 60;
const MIN_TRACKS = 5;
const TOP_ARTISTS = 5;
const REDISCOVER_MIN_PLAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** FNV-1a: a small, stable string hash used to seed the shuffle. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded random generator, so the same seed gives the same sequence. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ISO week key in UTC, for example "2026-W44". Weeks start on Monday. */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = d.getUTCDay() || 7; // Monday = 1 ... Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNumber); // the Thursday of this week decides the year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function topKeys(counts: Map<string, number>, limit: number): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([key]) => key);
}

function coversOf(tracks: CatalogTrack[]): string[] {
  const seen = new Set<string>();
  for (const t of tracks) if (t.cover) seen.add(t.cover);
  return [...seen].slice(0, 4);
}

export interface MixInput {
  userId: string;
  now: Date;
  plays: PlayRecord[];
  catalog: CatalogTrack[];
}

/**
 * Favourites: the most played tracks in the last 60 days.
 * Rediscover: tracks played often before that window, and not in it since.
 * Deep cuts: tracks by your top artists that you have never played.
 * Each mix needs at least five tracks, or it is left out.
 */
export function buildWeeklyMixes(input: MixInput): WeeklyMix[] {
  const week = isoWeekKey(input.now);
  const rand = seededRandom(hashSeed(`${input.userId}|${week}`));
  const nowMs = input.now.getTime();
  const windowStart = nowMs - RECENT_DAYS * DAY_MS;
  const byId = new Map(input.catalog.map(t => [t.trackId, t]));

  const recent = new Map<string, number>();
  const older = new Map<string, number>();
  const everPlayed = new Set<string>();
  const artistPlays = new Map<string, number>();
  for (const play of input.plays) {
    const at = Date.parse(play.playedAt);
    if (Number.isNaN(at)) continue;
    everPlayed.add(play.trackId);
    const bucket = at >= windowStart ? recent : older;
    bucket.set(play.trackId, (bucket.get(play.trackId) ?? 0) + 1);
    const artistId = byId.get(play.trackId)?.artistId;
    if (artistId) artistPlays.set(artistId, (artistPlays.get(artistId) ?? 0) + 1);
  }

  const toTracks = (ids: string[]) => ids.map(id => byId.get(id)).filter((t): t is CatalogTrack => !!t);
  const build = (id: WeeklyMix['id'], name: string, blurb: string, tracks: CatalogTrack[]): WeeklyMix | null => {
    if (tracks.length < MIN_TRACKS) return null;
    const picked = shuffled(tracks, rand).slice(0, MIX_SIZE);
    return { id, name, blurb, week, tracks: picked, covers: coversOf(picked) };
  };

  // Ids are picked by how often they were played, then the order is shuffled by the week's seed.
  const favourites = build(
    'favourites',
    'Your favourites',
    'What you played most lately.',
    toTracks(topKeys(recent, MIX_SIZE))
  );

  const rediscoverIds = topKeys(older, Number.MAX_SAFE_INTEGER).filter(id => (older.get(id) ?? 0) >= REDISCOVER_MIN_PLAYS && !recent.has(id));
  const rediscover = build('rediscover', 'Rediscover', 'Old favourites you have not played in a while.', toTracks(rediscoverIds));

  const topArtists = new Set(topKeys(artistPlays, TOP_ARTISTS));
  const deepCutIds = input.catalog.filter(t => topArtists.has(t.artistId) && !everPlayed.has(t.trackId)).map(t => t.trackId);
  const deepCuts = build('deep-cuts', 'Deep cuts', 'Tracks you have not heard yet, by artists you love.', toTracks(deepCutIds));

  return [favourites, rediscover, deepCuts].filter((m): m is WeeklyMix => m !== null);
}
