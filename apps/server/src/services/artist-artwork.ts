import { outboundFetch } from './outbound.js';
import { normalizeArtist } from './music-videos.js';
import type { ArtistCoverCandidate } from './artist-covers.js';

/**
 * "Find more artwork": pictures OF the artist, not their album covers (those
 * already come with the music). Logos, portraits, group photos and live shots
 * from Lidarr's own art, Deezer, Wikipedia, Wikidata and Wikimedia Commons.
 * None need an account. Each source is optional: one being down just means
 * fewer results.
 */

const UA = { 'User-Agent': 'virtuallyView/1.0 (self-hosted media manager)' };

/** GET as JSON. Wikimedia answers 429 when asked too fast: wait as long as it says (a few seconds at most) and try again. */
async function json<T>(url: string, timeoutMs = 10_000): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await outboundFetch(url, { headers: UA, timeoutMs });
      if (res.ok) return await res.json() as T;
      if (res.status !== 429 && res.status < 500) return null;
      const wait = Math.min(4000, (Number(res.headers.get('retry-after')) || 1 + attempt) * 1000);
      await new Promise(r => setTimeout(r, wait));
    } catch { return null; }
  }
  return null;
}

const commonsFile = (name: string, width = 900) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name.replace(/^File:/, '').replace(/ /g, '_'))}?width=${width}`;

/** What Lidarr already has for the artist: logo, banner, poster, background. */
export function lidarrArtwork(images: Array<{ coverType: string; url: string }>): ArtistCoverCandidate[] {
  const label: Record<string, { text: string; kind: NonNullable<ArtistCoverCandidate['kind']> }> = {
    clearlogo: { text: 'Logo', kind: 'logo' }, logo: { text: 'Logo', kind: 'logo' }, poster: { text: 'Artist photo', kind: 'artist' },
    fanart: { text: 'Background', kind: 'banner' }, banner: { text: 'Banner', kind: 'banner' }
  };
  return images.flatMap(i => {
    const l = label[i.coverType.toLowerCase()];
    return l ? [{ url: i.url, source: 'lidarr', label: l.text, kind: l.kind }] : [];
  });
}

export async function deezerArtwork(name: string): Promise<ArtistCoverCandidate[]> {
  const found = await json<{ data?: Array<{ name: string; picture_xl?: string }> }>(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=5`);
  const artist = found?.data?.find(a => normalizeArtist(a.name) === normalizeArtist(name));
  const pic = artist?.picture_xl;
  return pic && !/d41d8cd98f00b204e9800998ecf8427e|\/artist\/\//.test(pic) ? [{ url: pic, source: 'deezer', label: 'Deezer photo', kind: 'artist' }] : [];
}

export async function wikipediaArtwork(name: string): Promise<ArtistCoverCandidate[]> {
  const list = await json<{ items?: Array<{ type?: string; title?: string; showInGallery?: boolean; srcset?: Array<{ src: string }> }> }>(`https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(name.replace(/ /g, '_'))}`);
  const out: ArtistCoverCandidate[] = [];
  for (const item of list?.items ?? []) {
    if (item.type !== 'image' || item.showInGallery === false || !/\.(jpe?g|png)$/i.test(item.title ?? '')) continue;
    // Icons, signatures, flags and maps make poor artist pictures; posters and album art are what we are avoiding.
    if (/logo|icon|signature|flag|map|symbol|commons-|wiki|stamp|cover|album|single|ep_|\bsvg\b|track/i.test(item.title ?? '')) continue;
    const src = item.srcset?.find(s => /\/(\d{3,4})px-/.test(s.src))?.src ?? item.srcset?.[0]?.src;
    if (!src) continue;
    const group = /band|group|members|lineup|line-up|together|left to right/i.test(item.title ?? '');
    out.push({ url: (src.startsWith('//') ? `https:${src}` : src).split('?')[0]!, source: 'wikipedia', label: `Wikipedia: ${(item.title ?? '').replace(/^File:/, '').replace(/_/g, ' ').replace(/\.\w+$/, '').slice(0, 56)}`, kind: group ? 'group' : 'artist' });
    if (out.length >= 12) break;
  }
  return out;
}

interface MbRels { relations?: Array<{ type?: string; url?: { resource?: string } }> }
interface WdClaims { entities?: Record<string, { claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: string } } }>> }> }

/** Logo, main picture and group photo, from the artist's Wikidata entry (found through MusicBrainz). */
export async function wikidataArtwork(mbid: string): Promise<{ candidates: ArtistCoverCandidate[]; commonsCategory?: string }> {
  const mb = await json<MbRels>(`https://musicbrainz.org/ws/2/artist/${encodeURIComponent(mbid)}?inc=url-rels&fmt=json`);
  const rels = mb?.relations ?? [];
  const candidates: ArtistCoverCandidate[] = [];
  for (const r of rels) {
    const file = /commons\.wikimedia\.org\/wiki\/File:(.+)$/.exec(r.url?.resource ?? '')?.[1];
    if (r.type === 'image' && file && !/\.svg$/i.test(file)) candidates.push({ url: commonsFile(decodeURIComponent(file)), source: 'wikimedia', label: 'Wikimedia photo', kind: 'artist' });
  }
  const qid = /wikidata\.org\/wiki\/(Q\d+)/.exec(rels.find(r => r.type === 'wikidata')?.url?.resource ?? '')?.[1];
  if (!qid) return { candidates };
  const wd = await json<WdClaims>(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, 15_000);
  const claims = wd?.entities?.[qid]?.claims ?? {};
  const value = (p: string) => claims[p]?.map(c => c.mainsnak?.datavalue?.value).filter((v): v is string => typeof v === 'string') ?? [];
  for (const f of value('P154')) candidates.push({ url: commonsFile(f, 800), source: 'wikimedia', label: 'Logo', kind: 'logo' });
  for (const f of value('P18')) candidates.push({ url: commonsFile(f), source: 'wikimedia', label: 'Main photo', kind: 'artist' });
  for (const f of value('P2716')) candidates.push({ url: commonsFile(f), source: 'wikimedia', label: 'Group photo', kind: 'group' });
  return { candidates, ...(value('P373')[0] ? { commonsCategory: value('P373')[0] } : {}) };
}

/** Photos from the artist's Wikimedia Commons category: live shots and press pictures. */
export async function commonsCategoryArtwork(category: string): Promise<ArtistCoverCandidate[]> {
  const data = await json<{ query?: { pages?: Record<string, { title?: string; imageinfo?: Array<{ thumburl?: string; url?: string; mime?: string }> }> } }>(
    `https://commons.wikimedia.org/w/api.php?action=query&generator=categorymembers&gcmtitle=${encodeURIComponent(`Category:${category}`)}&gcmtype=file&gcmlimit=30&prop=imageinfo&iiprop=url|mime&iiurlwidth=700&format=json`
  );
  const out: ArtistCoverCandidate[] = [];
  for (const page of Object.values(data?.query?.pages ?? {})) {
    const info = page.imageinfo?.[0];
    if (!info?.thumburl || !/^image\/(jpeg|png)$/.test(info.mime ?? '')) continue;
    if (/logo|cover|album|single|signature|map|poster|flag/i.test(page.title ?? '')) continue;
    const group = /band|group|members|lineup|together/i.test(page.title ?? '');
    out.push({ url: info.thumburl, source: 'wikimedia', label: (page.title ?? '').replace(/^File:/, '').replace(/_/g, ' ').replace(/\.\w+$/, '').slice(0, 56), kind: group ? 'group' : 'live' });
    if (out.length >= 14) break;
  }
  return out;
}

/** Everything the public sources have for one artist, without duplicates and without album covers. */
export async function findMoreArtwork(name: string, opts: { mbid?: string | undefined } = {}): Promise<ArtistCoverCandidate[]> {
  const [deezer, wiki, wikidata] = await Promise.all([deezerArtwork(name), wikipediaArtwork(name), opts.mbid ? wikidataArtwork(opts.mbid) : Promise.resolve({ candidates: [] as ArtistCoverCandidate[], commonsCategory: undefined as string | undefined })]);
  const commons = wikidata.commonsCategory ? await commonsCategoryArtwork(wikidata.commonsCategory) : [];
  const seen = new Set<string>();
  return [...wikidata.candidates, ...deezer, ...wiki, ...commons].filter(c => !seen.has(c.url) && !!seen.add(c.url));
}
