import { get, run } from '../db/app-db.js';
import { outboundFetch } from './outbound.js';
import { artProxyUrl } from '@virtuallyview/integrations';

export interface ArtistCoverCandidate {
  url: string;
  source: string;
  label?: string;
  /** A photo of the artist, or an album cover. */
  kind?: 'artist' | 'album';
}

/**
 * Artist artwork that the user picked from the candidates. Stored server-side
 * so every device shows the same cover (the Linkin Park case: Lidarr alone
 * often has no artist image at all, so we collect candidates from a few public
 * sources and let the user choose once).
 */
/**
 * A stored cover address as the pages should load it. Older saves hold Lidarr's
 * own address (only reachable from this machine, sometimes with a wrong path);
 * those and public art hosts are served through /api/art.
 */
export function servedCover(url: string | undefined): string | undefined {
  if (!url) return url;
  const old = /^https?:\/\/(?:localhost|127\.0\.0\.1|lidarr)(?::\d+)?(?:\/config)?(\/MediaCover\/[^?]+)/.exec(url)?.[1];
  return old ? `/api/art?u=${encodeURIComponent(`lidarr:${old}`)}` : artProxyUrl(url);
}

export function getArtistCover(artistId: string): { covers: ArtistCoverCandidate[]; chosen?: string; updatedAt: string } | null {
  const row = get<{ artist_id: string; covers: string; chosen: string | null; updated_at: string }>(
    'SELECT artist_id, covers, chosen, updated_at FROM artist_covers WHERE artist_id = ?',
    artistId
  );
  if (!row) return null;
  let covers: ArtistCoverCandidate[] = [];
  try {
    covers = JSON.parse(row.covers) as ArtistCoverCandidate[];
  } catch {
    covers = [];
  }
  return { covers, chosen: row.chosen ?? undefined, updatedAt: row.updated_at };
}

export function saveArtistCovers(artistId: string, covers: ArtistCoverCandidate[], chosen?: string): void {
  run(
    `INSERT INTO artist_covers (artist_id, covers, chosen, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(artist_id) DO UPDATE SET covers = excluded.covers, chosen = excluded.chosen, updated_at = excluded.updated_at`,
    artistId,
    JSON.stringify(covers),
    chosen ?? null,
    new Date().toISOString()
  );
}

export function chooseArtistCover(artistId: string, url: string): ArtistCoverCandidate[] {
  const existing = getArtistCover(artistId);
  const candidates = existing?.covers ?? [];
  const target = candidates.find(c => c.url === url);
  if (!target) return candidates;
  run(
    'UPDATE artist_covers SET chosen = ?, updated_at = ? WHERE artist_id = ?',
    url,
    new Date().toISOString(),
    artistId
  );
  return candidates;
}

/**
 * Candidate cover sources for one artist. Lidarr provides the artist poster
 * when it has one; MusicBrainz release-group covers give real album artwork the
 * user can pick from when the artist photo is missing (most common case).
 */
export async function gatherCoverCandidates(
  artistId: string,
  title: string,
  lidarrImages: string[]
): Promise<{ candidates: ArtistCoverCandidate[]; chosen?: string }> {
  const saved = getArtistCover(artistId);
  const candidates: ArtistCoverCandidate[] = [];

  for (const url of lidarrImages) {
    if (url && (url.startsWith('http') || url.startsWith('/api/art')) && !candidates.some(c => c.url === url)) {
      candidates.push({ url, source: 'lidarr', label: 'Lidarr artwork', kind: 'artist' });
    }
  }

  if (!candidates.length) {
    // Wikipedia artist image as a last fallback so the artist tile is
    // never a blank rectangle when Lidarr has no artwork.
    try {
      const res = await outboundFetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { timeoutMs: 8000 }
      );
      if (res.ok) {
        const data = (await res.json()) as { thumbnail?: { source?: string } };
        if (data.thumbnail?.source && !candidates.some(c => c.url === data.thumbnail!.source)) {
          candidates.push({ url: data.thumbnail.source, source: 'wikipedia', label: 'Wikipedia image', kind: 'artist' });
        }
      }
    } catch {
      // offline: no candidates, the frontend shows an empty state
    }
  }

  // Artwork found earlier with "Find more artwork" stays in the list.
  for (const earlier of saved?.covers ?? []) if (!candidates.some(c => c.url === earlier.url)) candidates.push(earlier);
  const chosen = saved?.chosen && candidates.some(c => c.url === saved.chosen) ? saved.chosen : undefined;
  saveArtistCovers(artistId, candidates, chosen);
  return { candidates, chosen };
}