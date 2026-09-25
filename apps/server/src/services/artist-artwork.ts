import { outboundFetch } from './outbound.js';
import { normalizeArtist } from './music-videos.js';
import type { ArtistCoverCandidate } from './artist-covers.js';

/**
 * "Find more artwork": photos of the artist and album covers from several
 * public sources at once (Deezer, Apple's iTunes catalogue, Wikipedia, and
 * Cover Art Archive for the albums already in the library). None of them need
 * an account. Each source is optional: one being down just means fewer results.
 */

const UA = { 'User-Agent': 'virtuallyView/1.0' };

async function json<T>(url: string): Promise<T | null> {
  try {
    const res = await outboundFetch(url, { headers: UA, timeoutMs: 9000 });
    return res.ok ? await res.json() as T : null;
  } catch { return null; }
}

export async function deezerArtwork(name: string): Promise<ArtistCoverCandidate[]> {
  const found = await json<{ data?: Array<{ id: number; name: string; picture_xl?: string }> }>(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=5`);
  const artist = found?.data?.find(a => normalizeArtist(a.name) === normalizeArtist(name));
  if (!artist) return [];
  const out: ArtistCoverCandidate[] = [];
  if (artist.picture_xl && !/\/artist\/\/|d41d8cd98f00b204e9800998ecf8427e/.test(artist.picture_xl)) out.push({ url: artist.picture_xl, source: 'deezer', label: 'Deezer photo', kind: 'artist' });
  const albums = await json<{ data?: Array<{ title: string; cover_xl?: string }> }>(`https://api.deezer.com/artist/${artist.id}/albums?limit=40`);
  for (const a of albums?.data ?? []) if (a.cover_xl) out.push({ url: a.cover_xl, source: 'deezer', label: `Deezer: ${a.title}`, kind: 'album' });
  return out;
}

export async function itunesArtwork(name: string): Promise<ArtistCoverCandidate[]> {
  const found = await json<{ results?: Array<{ artistName?: string; collectionName?: string; artworkUrl100?: string }> }>(`https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=album&limit=50`);
  return (found?.results ?? [])
    .filter(r => r.artworkUrl100 && r.artistName && normalizeArtist(r.artistName) === normalizeArtist(name))
    // The catalogue serves any size: ask for a large one.
    .map(r => ({ url: r.artworkUrl100!.replace(/\/\d+x\d+(bb)?\.(jpg|png)$/i, '/1000x1000bb.$2'), source: 'itunes', label: `Apple Music: ${r.collectionName ?? 'album'}`, kind: 'album' as const }));
}

export async function wikipediaArtwork(name: string): Promise<ArtistCoverCandidate[]> {
  const list = await json<{ items?: Array<{ type?: string; title?: string; showInGallery?: boolean; srcset?: Array<{ src: string }> }> }>(`https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(name.replace(/ /g, '_'))}`);
  const out: ArtistCoverCandidate[] = [];
  for (const item of list?.items ?? []) {
    if (item.type !== 'image' || item.showInGallery === false || !/\.(jpe?g|png)$/i.test(item.title ?? '')) continue;
    // Skip logos, icons, signatures and maps: they make poor artist pictures.
    if (/logo|icon|signature|flag|map|symbol|commons-|wiki|stamp|\bsvg\b/i.test(item.title ?? '')) continue;
    const src = item.srcset?.find(s => /\/(\d{3,4})px-/.test(s.src))?.src ?? item.srcset?.[0]?.src;
    if (!src) continue;
    out.push({ url: src.startsWith('//') ? `https:${src}`.split('?')[0]! : src.split('?')[0]!, source: 'wikipedia', label: `Wikipedia: ${(item.title ?? '').replace(/^File:/, '').replace(/_/g, ' ').replace(/\.\w+$/, '').slice(0, 60)}`, kind: 'artist' });
    if (out.length >= 12) break;
  }
  return out;
}

export function coverArtArchiveArtwork(albums: Array<{ title: string; mbid: string }>): ArtistCoverCandidate[] {
  return albums.slice(0, 40).map(a => ({ url: `https://coverartarchive.org/release-group/${encodeURIComponent(a.mbid)}/front-500`, source: 'musicbrainz', label: `MusicBrainz: ${a.title}`, kind: 'album' as const }));
}

/** Everything the public sources have, without duplicates. */
export async function findMoreArtwork(name: string, albums: Array<{ title: string; mbid: string }>): Promise<ArtistCoverCandidate[]> {
  const batches = await Promise.all([deezerArtwork(name), itunesArtwork(name), wikipediaArtwork(name)]);
  const all = [...batches.flat(), ...coverArtArchiveArtwork(albums)];
  const seen = new Set<string>();
  return all.filter(c => !seen.has(c.url) && !!seen.add(c.url));
}
