import type { RadarrAdapter, SonarrAdapter, LidarrAdapter } from '@virtuallyview/integrations';
import { getAdapter } from './registry.js';
import { outboundFetch } from './outbound.js';

export type DetectKind = 'movie' | 'series' | 'artist' | 'track';

export interface MetadataCandidate {
  provider: 'tmdb' | 'tvdb' | 'musicbrainz';
  providerId: string;
  title: string;
  year?: number;
  type: Exclude<DetectKind, 'track'>;
  overview?: string;
}

export interface DetectResult {
  kind: DetectKind | 'ambiguous';
  query: string;
  source: 'library' | 'metadata' | 'musicbrainz' | 'ambiguous';
  title?: string;
  year?: number;
  artist?: string;
  /** Present when the query is also an exact song title (homonym case). */
  track?: { title: string; artist: string; year?: number; owned?: boolean };
  candidates: MetadataCandidate[];
}

type LibraryItem = {
  id: string; title: string; year?: number; type?: string; status?: string;
  provider?: { metadata?: Record<string, unknown> };
};

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Token-overlap similarity in [0,1]. Punctuation-stripped, language-agnostic. */
function similarity(a: string, b: string): number {
  const ta = new Set(normalize(a).split(' ').filter(Boolean));
  const tb = new Set(normalize(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let both = 0;
  for (const token of ta) if (tb.has(token)) both++;
  return both / Math.max(ta.size, tb.size);
}

type Adapter = RadarrAdapter | SonarrAdapter | LidarrAdapter;

const KINDS: Array<{ kind: Exclude<DetectKind, 'track'>; key: string; label: string }> = [
  { kind: 'movie', key: 'radarr', label: 'movie' },
  { kind: 'series', key: 'sonarr', label: 'TV show' },
  { kind: 'artist', key: 'lidarr', label: 'artist' }
];

function libraryItemsOf(adapter: Adapter): Promise<LibraryItem[]> {
  return adapter.getItems() as Promise<LibraryItem[]>;
}

async function lookupWithRetry(key: string, query: string): Promise<MetadataCandidate[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const list = await getAdapter<Adapter>(key).lookupCandidates(query) as unknown as MetadataCandidate[];
      if (list.length) return list;
      if (attempt === 0) continue;
      return list;
    } catch {
      if (attempt === 0) continue; // retry once, then give up on this kind
      return [];
    }
  }
  return [];
}

/**
 * Single-song detection via MusicBrainz recording search. Returns the best
 * recording plus its artist when the title matches well enough.
 */
async function detectTrack(query: string, localArtists: ReadonlySet<string>): Promise<{ title: string; artist: string; year?: number } | null> {
  const parts = query.split(/\s+[---·|]\s+/).filter(Boolean);
  const prime = parts[parts.length - 1] ?? query;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await outboundFetch(
        `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(`recording:"${prime}"`)}&fmt=json&limit=20`,
        { headers: { 'User-Agent': 'virtuallyView/1.0' }, timeoutMs: 8000 }
      );
      if (!res.ok) {
        if (attempt === 0) {
          await new Promise(r => setTimeout(r, 900)); // MusicBrainz rate-limits: brief pause, then retry once
          continue;
        }
        return null;
      }
    const data = await res.json() as {
      recordings?: Array<{
        title?: string;
        'artist-credit'?: Array<{ name?: string; joinphrase?: string }>;
        'first-release-date'?: string;
      }>;
    };
    const recordings = (data.recordings ?? []).filter(r => r.title);
    if (!recordings.length) return null;
    // MusicBrainz returns every cover, live and video take of a title with the
    // same score, in unstable order. Rank by a quality signal instead: the
    // canonical studio recording on an album beats music videos, live takes,
    // covers and demo edits.
    const best = recordings
      .map(r => ({
        r,
        mbScore: Number((r as unknown as { score?: number }).score) || 0,
        quality: recordingQuality(r as Record<string, unknown>) + (localArtists.has(normalize(artistOf(r as Record<string, unknown>))) ? 4 : 0),
        score: similarity(r.title ?? '', prime)
      }))
      .sort((x, y) =>
        (y.quality - x.quality) ||
        (y.mbScore - x.mbScore) ||
        (y.score - x.score))[0];
    if (!best || best.score < 0.5) return null;
    const artist = artistOf(best.r as Record<string, unknown>);
    const year = best.r['first-release-date'] ? Number(best.r['first-release-date'].slice(0, 4)) : undefined;
    if (!best.r.title || !artist) return null;
    return { title: best.r.title, artist, ...(year && year > 1800 ? { year } : {}) };
  } catch {
    return null;
  }
  }
  return null;
}

/**
 * Auto-detects what a search query means: a movie, TV show, artist or a single
 * song. The library is checked first (cheap and authoritative); otherwise the
 * connected *arr metadata lookups run in parallel for movie/series/artist and
 * MusicBrainz is queried for recordings. The best-scoring identity wins.
 */
export async function detectMediaKind(query: string): Promise<DetectResult> {
  const cleaned = query.trim();
  const ql = normalize(cleaned);

  // 1. Library-first: the exact identity is already local.
  const libraryCandidates: Array<{ item: LibraryItem; kind: Exclude<DetectKind, 'track'> }> = [];
  for (const { kind, key } of KINDS) {
    try {
      for (const item of await libraryItemsOf(getAdapter<Adapter>(key))) {
        if (item.title && normalize(item.title) === ql) libraryCandidates.push({ item, kind });
      }
    } catch {
      // service offline: skip
    }
  }
  if (libraryCandidates.length === 1) {
    const hit = libraryCandidates[0];
    return {
      kind: hit.kind,
      query: cleaned,
      source: 'library',
      title: hit.item.title,
      year: hit.item.year,
      candidates: []
    };
  }

  // 2. Metadata lookups, scored by title similarity. Run all three so an
  // ambiguous query like "house" can still be classified correctly. Each kind
  // is retried once because the *arr services occasionally stall on a cold
  // metadata search; a skipped kind would silently flip the classification.
  // Deterministic tie-break: score first, then kind priority (movie, series,
  // artist), then the order the service returned. Without the priority key a
  // tie like "Superbad" (movie) vs a band Superbad would be decided by which
  // *arr service answered first.
  const KIND_PRIORITY: Record<Exclude<DetectKind, 'track'>, number> = { movie: 0, series: 1, artist: 2 };
  const scored: Array<{ kind: Exclude<DetectKind, 'track'>; score: number; candidate: MetadataCandidate }> = [];
  await Promise.all(KINDS.map(async ({ kind, key }) => {
    const list = await lookupWithRetry(key, cleaned);
    for (const candidate of list) {
      const score = similarity(candidate.title, cleaned);
      if (score > 0) scored.push({ kind, score, candidate });
    }
  }));
  const sorted = scored.sort((a, b) =>
    (b.score - a.score) || (KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]));
  const best = sorted[0];

  // Artists present in the user's own music library make a song attribution far
  // more trustworthy: a query almost always means the version by an artist the
  // user owns, not a cover by an unrelated band.
  const localArtists = new Set<string>();
  try {
    for (const item of await libraryItemsOf(getAdapter<Adapter>('lidarr'))) {
      if (item.title) localArtists.add(normalize(item.title));
    }
  } catch {
    // Lidarr offline: song detection falls back to release-quality ranking only
  }

  // 3. Single-song detection.
  const track = await detectTrack(cleaned, localArtists);
  const trackSim = track ? similarity(track.title, normalizePrime(cleaned)) : 0;

  // When two kinds score within 0.1 of each other (e.g. a band and a movie
  // share an exact name like "Matrix"), stay ambiguous and offer every
  // matching identity instead of guessing. An exact dated match (a movie or
  // series with a release year) beats an undated homonym, so "superbad" stays
  // the 2007 movie even if a band shares the name. Two versions of the same
  // title within one kind (Superbad 2007 vs 2016) are a within-kind question
  // resolved by the candidate grid, not a kind ambiguity.
  const runnerUp = best ? sorted.find(s => s.kind !== best.kind) : undefined;
  const bestHasYear = Boolean(best?.candidate.year);
  const runnerUpHasYear = Boolean(runnerUp?.candidate.year);
  const datedBeat = best && best.score >= 0.95 && bestHasYear && !runnerUpHasYear;
  const nearTie = best && runnerUp && !datedBeat && runnerUp.score >= best.score - 0.1;

  // The grid always includes every kind that nearly ties with the winner, so a
  // homonym artist stays pickable even when a movie wins the hero.
  const allCandidates = [...new Map(scored.map(s => [s.candidate.providerId, s.candidate])).values()];
  const winners = [...new Map(scored
    .filter(s => s.kind === best?.kind || (nearTie && s.score >= best!.score - 0.1))
    .map(s => [s.candidate.providerId, s.candidate]))
    .values()];

  // The song wins when the recording title matches the query at least as well
  // as the best movie/TV/artist candidate AND that match is not already exact
  // (e.g. "the emptiness machine" is the Linkin Park song even though Lidarr
  // finds a low-confidence artist; a query that exactly names a movie stays a
  // movie even if a song shares the title). When BOTH are exact homonyms
  // ("in the end" is a song and a movie), stay ambiguous and offer both.
  const exactBoth = Boolean(track && trackSim >= 0.95 && best && best.score >= 0.95);
  const trackCandidate = track && trackSim >= 0.55
    ? {
        title: track.title,
        artist: track.artist,
        ...(track.year ? { year: track.year } : {}),
        owned: localArtists.has(normalize(track.artist))
      }
    : undefined;
  if (track && trackSim >= 0.55 && !exactBoth && (!nearTie || trackSim >= best!.score) && (!best || (best.score < 0.95 && trackSim >= best.score))) {
    return {
      kind: 'track',
      query: cleaned,
      source: 'musicbrainz',
      title: track.title,
      artist: track.artist,
      year: track.year,
      track: trackCandidate,
      candidates: winners
    };
  }
  if (best && (nearTie || exactBoth)) {
    return {
      kind: 'ambiguous',
      query: cleaned,
      source: 'metadata',
      title: best.candidate.title,
      year: best.candidate.year,
      track: exactBoth ? trackCandidate : undefined,
      candidates: winners
    };
  }
  if (best && best.score >= 0.6) {
    return {
      kind: best.kind,
      query: cleaned,
      source: 'metadata',
      title: best.candidate.title,
      year: best.candidate.year,
      candidates: winners
    };
  }
  if (best) {
    return {
      kind: 'ambiguous',
      query: cleaned,
      source: 'metadata',
      title: best.candidate.title,
      year: best.candidate.year,
      candidates: allCandidates
    };
  }
  return { kind: 'ambiguous', query: cleaned, source: 'metadata', candidates: [] };
}

function normalizePrime(query: string): string {
  const parts = query.split(/\s+[---·|]\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? query;
}

type RecordingRow = Record<string, unknown>;

function artistOf(r: RecordingRow): string {
  const credit = Array.isArray(r['artist-credit']) ? r['artist-credit'] as Array<Record<string, unknown>> : [];
  return credit.map(a => (typeof a.name === 'string' ? a.name : '') + (typeof a.joinphrase === 'string' ? a.joinphrase : '')).join('').trim();
}

/**
 * Ranks candidate recordings of a searched title. MusicBrainz ties every
 * recording at score 100, so use the release data: the canonical studio
 * version on an album outranks music videos, live takes, covers, karaoke and
 * demo edits.
 */
function recordingQuality(r: RecordingRow): number {
  const disambig = typeof r.disambiguation === 'string' ? r.disambiguation.toLowerCase() : '';
  const video = r.video === true;
  const releases = Array.isArray(r.releases) ? r.releases as Array<Record<string, unknown>> : [];
  let quality = 0;
  if (video || /video|live|cover|karaoke|demo|remix|instrumental|acapella|youtube|edit|tribute|taken from/.test(disambig)) quality -= 2;
  if (!disambig) quality += 1;
  const albums = releases.filter(x => x['primary-type'] === 'Album');
  if (albums.length) quality += 2;
  quality += Math.min(releases.length, 4) / 4;
  return quality;
}
// ---------------------------------------------------------------------------
// Combined search: library + every request source in one call.
// ---------------------------------------------------------------------------

export interface SearchLibraryHit {
  id: string; title: string; year?: number; type: string; status?: string;
  poster?: string; rating?: number; watchProgress?: number;
}
export interface SearchTrackHit { title: string; artist: string; year?: number }
export interface SearchAllResult {
  query: string;
  library: SearchLibraryHit[];
  movies: MetadataCandidate[];
  series: MetadataCandidate[];
  artists: MetadataCandidate[];
  tracks: SearchTrackHit[];
}

async function searchTracks(query: string): Promise<SearchTrackHit[]> {
  const prime = normalizePrime(query);
  try {
    const res = await outboundFetch(
      `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(`recording:"${prime}"`)}&fmt=json&limit=25`,
      { headers: { 'User-Agent': 'virtuallyView/1.0' }, timeoutMs: 8000 }
    );
    if (!res.ok) return [];
    const data = await res.json() as { recordings?: Array<Record<string, unknown> & { title?: string }> };
    const seen = new Set<string>();
    return (data.recordings ?? [])
      .filter(r => r.title && similarity(r.title, prime) >= 0.6)
      .map(r => ({ r, quality: recordingQuality(r), artist: artistOf(r) }))
      .filter(x => x.artist)
      .sort((a, b) => b.quality - a.quality)
      .flatMap(({ r, artist }) => {
        const key = `${normalize(r.title ?? '')}|${normalize(artist)}`;
        if (seen.has(key)) return [];
        seen.add(key);
        const date = typeof r['first-release-date'] === 'string' ? Number((r['first-release-date'] as string).slice(0, 4)) : undefined;
        return [{ title: r.title as string, artist, ...(date && date > 1800 ? { year: date } : {}) }];
      })
      .slice(0, 6);
  } catch {
    return [];
  }
}

const searchAllCache = new Map<string, { at: number; value: SearchAllResult }>();

export async function searchAll(rawQuery: string): Promise<SearchAllResult> {
  const query = rawQuery.trim();
  const cacheKey = query.toLowerCase();
  const hit = searchAllCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;

  const q = normalize(query);
  const libraries = await Promise.all((['radarr', 'sonarr', 'lidarr'] as const).map(async key => {
    try { return await libraryItemsOf(getAdapter<Adapter>(key)); } catch { return []; }
  }));
  const all = libraries.flat() as Array<LibraryItem & { artwork?: { poster?: string }; rating?: number }>;
  const rank = (title: string) => { const t = normalize(title); return t === q ? 0 : t.startsWith(q) ? 1 : 2; };
  const library = all
    .filter(i => normalize(i.title).includes(q))
    .sort((a, b) => rank(a.title) - rank(b.title) || a.title.localeCompare(b.title))
    .slice(0, 24)
    .map(i => ({
      id: i.id, title: i.title, ...(i.year ? { year: i.year } : {}), type: i.type ?? 'movie',
      ...(i.status ? { status: i.status } : {}), ...(i.artwork?.poster ? { poster: i.artwork.poster } : {}),
      ...(typeof i.rating === 'number' ? { rating: i.rating } : {})
    }));
  const owned = new Set(all.map(i => `${normalize(i.title)}|${i.year ?? ''}`));
  const fresh = (list: MetadataCandidate[]) => list.filter(c => !owned.has(`${normalize(c.title)}|${c.year ?? ''}`)).slice(0, 8);

  const [movies, series, artists, tracks] = query.length >= 2
    ? await Promise.all([lookupWithRetry('radarr', query), lookupWithRetry('sonarr', query), lookupWithRetry('lidarr', query), searchTracks(query)])
    : [[], [], [], []] as [MetadataCandidate[], MetadataCandidate[], MetadataCandidate[], SearchTrackHit[]];

  const value: SearchAllResult = { query, library, movies: fresh(movies), series: fresh(series), artists: fresh(artists), tracks };
  if (searchAllCache.size > 60) searchAllCache.clear();
  searchAllCache.set(cacheKey, { at: Date.now(), value });
  return value;
}
