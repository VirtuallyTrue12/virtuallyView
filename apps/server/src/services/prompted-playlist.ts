/**
 * Prompted playlists: a playlist described in words ("late-night drive, no ballads"),
 * built only from tracks that are in the library. The assistant picks ids from a
 * list it was given; anything it invents is dropped. With the assistant off, a
 * keyword match over genres, titles and artists does the same job.
 */
import type { CatalogTrack } from './music-mixes.js';

export const MAX_CANDIDATES = 400;
export const PLAYLIST_MIN = 15;
export const PLAYLIST_MAX = 30;

const NEGATORS = new Set(['no', 'not', 'without', 'nothing']);
const STOP_WORDS = new Set(['the', 'and', 'with', 'for', 'that', 'this', 'some', 'songs', 'song', 'music', 'tracks', 'playlist', 'like', 'about', 'from', 'put', 'make', 'mix', 'please', 'want', 'feel', 'feeling']);

/**
 * Spread the candidates across artists: one track from each artist in turn, so a
 * long catalogue from one band cannot crowd out everyone else.
 */
export function sampleCandidates(catalog: CatalogTrack[], max = MAX_CANDIDATES, rand: () => number = Math.random): CatalogTrack[] {
  const byArtist = new Map<string, CatalogTrack[]>();
  for (const t of catalog) {
    const list = byArtist.get(t.artistId) ?? [];
    list.push(t);
    byArtist.set(t.artistId, list);
  }
  const queues = [...byArtist.values()].map(list => {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  });
  for (let i = queues.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [queues[i], queues[j]] = [queues[j]!, queues[i]!];
  }
  const out: CatalogTrack[] = [];
  for (let round = 0; out.length < max; round++) {
    let added = false;
    for (const q of queues) {
      if (round < q.length && out.length < max) { out.push(q[round]!); added = true; }
    }
    if (!added) break;
  }
  return out;
}

/** One line per track for the model: id|title|artist|genre|year. Pipes in names are replaced so the format holds. */
export function candidateLines(tracks: CatalogTrack[]): string {
  const clean = (s: string | undefined) => (s ?? '').replace(/[|\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
  return tracks.map(t => [t.trackId, clean(t.title), clean(t.artistTitle), clean(t.genre), t.year ? String(t.year) : ''].join('|')).join('\n');
}

export function playlistMessages(prompt: string, lines: string): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: [
        'You build playlists from a music library. You may ONLY use track ids from the list the user gives you.',
        `Pick between ${PLAYLIST_MIN} and ${PLAYLIST_MAX} tracks that fit the request. Give the playlist a short name.`,
        'Reply with JSON only, in this shape: {"name": "...", "trackIds": ["id", "id"]}.',
        'Each line is id|title|artist|genre|year.'
      ].join('\n')
    },
    { role: 'user', content: `Request: ${prompt}\n\nTracks:\n${lines}` }
  ];
}

function extractJsonObject(text: string): unknown {
  const stripped = text.replace(/```(?:json)?/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Read the model's reply. Ids that are not in the library are dropped, duplicates
 * are merged, and the list is capped. Returns an empty list when nothing usable came back.
 */
export function parsePlaylistReply(text: string, validIds: Set<string>, fallbackName: string): { name: string; trackIds: string[] } {
  const parsed = extractJsonObject(text) as { name?: unknown; trackIds?: unknown } | null;
  const raw = Array.isArray(parsed?.trackIds) ? parsed!.trackIds as unknown[] : [];
  const seen = new Set<string>();
  const trackIds: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const id = String(value).trim();
    if (!id || seen.has(id) || !validIds.has(id)) continue;
    seen.add(id);
    trackIds.push(id);
    if (trackIds.length >= PLAYLIST_MAX) break;
  }
  const name = typeof parsed?.name === 'string' && parsed.name.trim() ? parsed.name.trim().slice(0, 80) : fallbackName;
  return { name, trackIds };
}

/** Words the person does not want ("no ballads" gives "ballads"), so tracks matching them are left out. */
export function excludedWords(prompt: string): string[] {
  const words = prompt.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (NEGATORS.has(words[i]!) && words[i + 1]) out.push(words[i + 1]!);
  }
  return out;
}

/** The words the person wants: longer than two letters, not filler, and not ruled out. */
export function promptWords(prompt: string): string[] {
  const negated = new Set(excludedWords(prompt));
  const all = prompt.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const out: string[] = [];
  for (let i = 0; i < all.length; i++) {
    const w = all[i]!;
    if (NEGATORS.has(w)) { i++; continue; }
    if (w.length > 2 && !STOP_WORDS.has(w) && !negated.has(w)) out.push(w);
  }
  return [...new Set(out)];
}

/**
 * Keyword fallback: score each track by how many request words appear in its
 * genre, title, artist or album, and keep the best matches. Tracks matching a
 * word the person ruled out are dropped.
 */
export function keywordPlaylist(prompt: string, catalog: CatalogTrack[]): { name: string; trackIds: string[] } {
  const words = promptWords(prompt);
  const banned = excludedWords(prompt);
  const name = (prompt.trim().replace(/\s+/g, ' ').slice(0, 60) || 'Playlist');
  if (!words.length) return { name, trackIds: [] };
  const scored: Array<{ id: string; score: number }> = [];
  for (const t of catalog) {
    const hay = `${t.genre ?? ''} ${t.title} ${t.artistTitle} ${t.albumTitle ?? ''}`.toLowerCase();
    // "ballads" also rules out "ballad": compare without a plural s.
    if (banned.some(b => hay.includes(b.replace(/s$/, '')))) continue;
    let score = 0;
    for (const w of words) if (hay.includes(w)) score++;
    if (score > 0) scored.push({ id: t.trackId, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return { name, trackIds: scored.slice(0, PLAYLIST_MAX).map(s => s.id) };
}
