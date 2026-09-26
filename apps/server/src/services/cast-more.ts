import { outboundFetch } from './outbound.js';
import { TMDB_HEADERS, type CastMember } from './cast.js';

/**
 * Cast beyond films: the people in a TV series (leads first, then recurring
 * and supporting), and the members of a band. Every source is optional; a
 * source being down just means a shorter list.
 */

const UA = { 'User-Agent': 'virtuallyView/1.0 (self-hosted media manager)' };
const decode = (t: string) => t.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').trim();

/** TMDB's full cast page for a series: billed order, with characters and episode counts. */
export function parseTvCastPage(html: string, limit = 40): CastMember[] {
  const start = html.indexOf('<ol class="people credits');
  const region = start >= 0 ? html.slice(start) : html;
  const out: CastMember[] = [];
  const seen = new Set<string>();
  for (const block of region.split('<li data-order=').slice(1)) {
    const name = decode(/<img[^>]+alt="([^"]+)"/.exec(block)?.[1] ?? /href="\/person\/[^"]*"[^>]*>\s*<p>\s*([^<]+)/.exec(block)?.[1] ?? '');
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const photo = /src="(https:\/\/media\.themoviedb\.org\/t\/p\/[^"]+)"/.exec(block)?.[1]?.replace(/w66_and_h66_face/, 'w138_and_h175_face').split('?')[0] ?? '';
    const roleMatch = /<p[^>]*>\s*<a[^>]*>([^<]+)<\/a>\s*<span>\((\d+)\s+Episodes?\)/i.exec(block);
    out.push({ name, role: decode(roleMatch?.[1] ?? ''), photo, episodes: Number(roleMatch?.[2] ?? 0) || undefined });
    if (out.length >= limit) break;
  }
  return withGroups(out);
}

/** Leads are the people in most of the episodes; everyone else is supporting. Order is kept. */
export function withGroups(cast: CastMember[]): CastMember[] {
  const top = Math.max(0, ...cast.map(c => c.episodes ?? 0));
  let leads = 0;
  return cast.map((c, i) => {
    const lead = top > 0 ? (c.episodes ?? 0) >= top * 0.4 && leads < 12 : i < 8;
    if (lead) leads++;
    return { ...c, group: lead ? 'main' as const : 'supporting' as const };
  });
}

export async function tmdbSeriesCast(tmdbId: number | string): Promise<CastMember[]> {
  const res = await outboundFetch(`https://www.themoviedb.org/tv/${encodeURIComponent(String(tmdbId))}/cast?language=en-US`, { headers: TMDB_HEADERS, timeoutMs: 20_000 });
  return res.ok ? parseTvCastPage(await res.text()) : [];
}

export async function tvMazeCast(tvMazeId: number | string): Promise<CastMember[]> {
  const res = await outboundFetch(`https://api.tvmaze.com/shows/${encodeURIComponent(String(tvMazeId))}/cast`, { headers: UA, timeoutMs: 10_000 });
  if (!res.ok) return [];
  const rows = await res.json() as Array<{ person?: { name?: string; image?: { medium?: string } }; character?: { name?: string } }>;
  return rows.filter(r => r.person?.name).map(r => ({ name: r.person!.name!, role: r.character?.name ?? '', photo: r.person!.image?.medium ?? '', group: 'main' as const }));
}

/** The people in a series, best source first. */
export async function seriesCast(ids: { tmdbId?: number | string; tvMazeId?: number | string }): Promise<CastMember[]> {
  if (ids.tmdbId) { try { const c = await tmdbSeriesCast(ids.tmdbId); if (c.length) return c; } catch { /* try the next source */ } }
  if (ids.tvMazeId) { try { return await tvMazeCast(ids.tvMazeId); } catch { /* none */ } }
  return [];
}

// ---------- Bands ----------

interface MbRelation { type?: string; direction?: string; begin?: string | null; end?: string | null; ended?: boolean; attributes?: string[]; artist?: { name?: string; id?: string } }

const ROLE_WORDS = /(vocal|guitar|bass|drum|keyboard|piano|synth|percussion|dj|turntable|sampler|violin|cello|saxophone|trumpet|flute|rap|lead|backing|programming)/i;

const yearsOf = (begin?: string | null, end?: string | null, ended?: boolean) => {
  const from = begin?.slice(0, 4), to = end?.slice(0, 4);
  return from ? `${from}–${to ?? (ended ? '' : 'present')}` : to ? `until ${to}` : '';
};

/** Members of a group, current first, from MusicBrainz. */
export function parseMembers(relations: MbRelation[]): CastMember[] {
  const seen = new Set<string>();
  const members: CastMember[] = [];
  for (const r of relations) {
    if (r.type !== 'member of band' || r.direction !== 'backward' || !r.artist?.name) continue;
    if (seen.has(r.artist.name)) continue;
    seen.add(r.artist.name);
    const roles = (r.attributes ?? []).filter(a => ROLE_WORDS.test(a));
    members.push({ name: r.artist.name, role: roles.length ? roles.join(', ') : 'Member', years: yearsOf(r.begin, r.end, r.ended), current: !r.ended && !r.end, photo: '' });
  }
  return members.sort((a, b) => Number(b.current) - Number(a.current));
}

const MUSICIAN = /(singer|vocalist|rapper|guitarist|bassist|drummer|keyboardist|pianist|musician|songwriter|composer|record producer|DJ|violinist|saxophonist|percussionist|multi-instrumentalist|rock|pop|hip hop)/i;

/** Names as people write them on Wikipedia: nicknames in quotes ("Joseph “Joe” Hahn" is "Joe Hahn"), then with "(musician)" for namesakes. */
export function portraitTitles(name: string): string[] {
  const nick = /^(\S+)\s+[“"']([^”"']+)[”"']\s+(.+)$/.exec(name);
  const plain = name.replace(/[“”"]/g, '').replace(/\s{2,}/g, ' ').trim();
  const base = [name, ...(nick ? [`${nick[2]} ${nick[3]}`, `${nick[1]} ${nick[3]}`] : []), plain];
  const unique = [...new Set(base)];
  return [...unique, ...unique.slice(0, 2).flatMap(n => [`${n} (musician)`, `${n} (drummer)`, `${n} (singer)`])];
}

async function summary(title: string): Promise<{ type?: string; description?: string; extract?: string; thumbnail?: { source?: string } } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await outboundFetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`, { headers: UA, timeoutMs: 8000 });
      if (res.ok) return await res.json() as never;
      if (res.status !== 429 && res.status < 500) return null;
    } catch { /* retry once */ }
    await new Promise(r => setTimeout(r, 700));
  }
  return null;
}

/** A portrait from Wikipedia, only when the page is about a musician (not a namesake). */
export async function wikipediaPortrait(name: string): Promise<string> {
  for (const title of portraitTitles(name)) {
    const page = await summary(title);
    if (!page || page.type !== 'standard' || !page.thumbnail?.source) continue;
    if (MUSICIAN.test(`${page.description ?? ''} ${(page.extract ?? '').slice(0, 300)}`)) return page.thumbnail.source;
  }
  return '';
}

export interface BandInfo { kind: 'band' | 'solo' | 'unknown'; members: CastMember[] }

export async function fetchBand(mbid: string | undefined, name: string): Promise<BandInfo> {
  let type = '';
  let relations: MbRelation[] = [];
  if (mbid) {
    try {
      const res = await outboundFetch(`https://musicbrainz.org/ws/2/artist/${encodeURIComponent(mbid)}?inc=artist-rels&fmt=json`, { headers: UA, timeoutMs: 12_000 });
      if (res.ok) { const data = await res.json() as { type?: string; relations?: MbRelation[] }; type = data.type ?? ''; relations = data.relations ?? []; }
    } catch { /* offline: fall through */ }
  }
  let members = parseMembers(relations);
  const kind: BandInfo['kind'] = members.length || /group|orchestra|choir/i.test(type) ? 'band' : /person/i.test(type) ? 'solo' : 'unknown';
  if (kind !== 'band') members = [{ name, role: 'Artist', photo: '', current: true }];
  // Portraits, a few at a time so Wikipedia is not hammered.
  const queue = [...members];
  await Promise.all(Array.from({ length: 2 }, async () => {
    for (let m = queue.shift(); m; m = queue.shift()) { m.photo = await wikipediaPortrait(m.name); }
  }));
  return { kind, members };
}
