import type { Media } from '@virtuallyview/types';
import { all } from '../db/app-db.js';
import { getAdapter } from './registry.js';
import { filterByRating } from './parental.js';
import { channelsFor, listPlaylists } from './live-tv.js';
import { searchStations } from './radio.js';
import { searchChannels, searchVideos } from './invidious.js';
import { searchAll, searchLibrary } from './search-detect.js';

export type SourceResult = { source: string; ok: boolean; data?: unknown };
export interface SearchSource { name: string; timeoutMs: number; run: () => Promise<unknown> }

/**
 * Runs every source at once and reports each one the moment it finishes, so fast sources
 * show first. A source that fails or runs past its timeout reports ok:false and never holds the others up.
 */
export async function fanOut(sources: SearchSource[], emit: (r: SourceResult) => void): Promise<void> {
  await Promise.all(sources.map(async s => {
    let timer: NodeJS.Timeout | undefined;
    try {
      const data = await Promise.race([
        s.run(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), s.timeoutMs); })
      ]);
      emit({ source: s.name, ok: true, data });
    } catch {
      emit({ source: s.name, ok: false });
    } finally { clearTimeout(timer); }
  }));
}

const norm = (v: string) => v.normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/** Cast and directors the library already knows (the cast cache), whose name contains every word typed. */
async function people(query: string) {
  const words = norm(query).split(' ').filter(Boolean);
  const found = new Map<string, { name: string; photo?: string; ids: Set<string> }>();
  for (const row of all<{ media_id: string; payload: string }>('SELECT media_id, payload FROM cast_cache')) {
    try {
      const parsed = JSON.parse(row.payload) as { cast?: Array<{ name: string; photo?: string }> };
      for (const c of parsed.cast ?? []) {
        const n = norm(c.name ?? '');
        if (!n || !words.every(w => n.includes(w))) continue;
        const f = found.get(n) ?? { name: c.name, ids: new Set<string>() };
        f.ids.add(row.media_id);
        if (c.photo && !f.photo) f.photo = c.photo;
        found.set(n, f);
      }
    } catch { /* skip unreadable row */ }
  }
  if (!found.size) return { people: [] };
  const titles: Media[] = [];
  for (const key of ['radarr', 'sonarr']) { try { titles.push(...filterByRating((await getAdapter(key).getItems()) as Media[])); } catch { /* offline */ } }
  const list = [...found.values()].map(f => ({
    name: f.name, ...(f.photo ? { photo: f.photo } : {}),
    titles: titles.filter(t => f.ids.has(t.id)).slice(0, 12).map(t => ({
      id: t.id, title: t.title, ...(t.year ? { year: t.year } : {}), type: t.type, ...(t.status ? { status: t.status } : {}),
      ...(t.artwork?.poster ? { poster: t.artwork.poster } : {})
    }))
  })).filter(p => p.titles.length).sort((a, b) => b.titles.length - a.titles.length).slice(0, 8);
  return { people: list };
}

async function liveChannels(query: string) {
  const q = norm(query);
  const out: Array<{ id: string; name: string; logo?: string; group?: string }> = [];
  for (const playlist of listPlaylists()) {
    try {
      for (const c of await channelsFor(playlist)) if (norm(c.name).includes(q)) out.push({ id: c.id, name: c.name, ...(c.logo ? { logo: c.logo } : {}), ...(c.group ? { group: c.group } : {}) });
    } catch { /* playlist unreachable */ }
  }
  return { channels: out.slice(0, 24), total: out.length };
}

/** Everything the search page can show, one entry per section. Library sections are quick; videos and request lookups are slow. */
export function everythingSources(query: string): SearchSource[] {
  const q = query.trim();
  return [
    { name: 'library', timeoutMs: 4000, run: async () => ({ library: filterByRating((await searchLibrary(q)).library) }) },
    { name: 'people', timeoutMs: 4000, run: () => people(q) },
    { name: 'live', timeoutMs: 4000, run: () => liveChannels(q) },
    { name: 'radio', timeoutMs: 6000, run: async () => ({ stations: (await searchStations({ q, limit: 12 })).stations }) },
    { name: 'videos', timeoutMs: 9000, run: async () => ({ videos: (await searchVideos(q)).slice(0, 12) }) },
    { name: 'channels', timeoutMs: 9000, run: async () => ({ channels: (await searchChannels(q)).slice(0, 12) }) },
    { name: 'request', timeoutMs: 12000, run: async () => { const r = await searchAll(q); return { movies: r.movies, series: r.series, artists: r.artists, tracks: r.tracks }; } }
  ];
}
