import { getAdapter } from './registry.js';

/**
 * "Find my existing media": files put into the library folders by hand are invisible to Radarr, Sonarr and Lidarr until each
 * title is added. This lists the folders they do not track yet, guesses which title each one is from its name, and adds the
 * title with that folder as its home, so the files are imported and nothing is downloaded.
 */
export type ImportKind = 'movies' | 'series' | 'artists';
const KIND: Record<ImportKind, { service: 'radarr' | 'sonarr' | 'lidarr'; type: 'movie' | 'series' | 'artist' }> = {
  movies: { service: 'radarr', type: 'movie' }, series: { service: 'sonarr', type: 'series' }, artists: { service: 'lidarr', type: 'artist' }
};

export interface Candidate { provider: string; providerId: string; title: string; year?: number; overview?: string; poster?: string }
export interface UnmappedFolder { folder: string; path: string; term: string; year?: number; best: Candidate | null; options: Candidate[] }

/** "The.Office.US.2005.1080p" or "Dune (2021) [Bluray]" to a search term and a year. */
export function folderTerm(name: string): { term: string; year?: number } {
  let text = name.replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ').replace(/[._]+/g, ' ');
  let year: number | undefined;
  const paren = /\((19|20)\d{2}\)/.exec(text);
  if (paren) { year = Number(paren[0].slice(1, 5)); text = text.replace(paren[0], ' '); }
  else { const tail = /\s((?:19|20)\d{2})(?=\s|$)/.exec(text); if (tail && tail.index > 0) { year = Number(tail[1]); text = text.slice(0, tail.index); } }
  text = text.replace(/\b(2160p|1080p|720p|480p|bluray|brrip|webrip|web-dl|hdtv|x26[45]|hevc|aac|dts|remux|complete|season\s*\d+|s\d{1,2})\b.*$/i, ' ');
  return { term: text.replace(/\s+/g, ' ').trim(), ...(year ? { year } : {}) };
}

const norm = (t: string) => t.toLowerCase().replace(/^(the|a|an)\s+/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The candidate that clearly is this folder, or null when it is a guess the person should confirm. */
export function pickBest(term: string, year: number | undefined, options: Candidate[]): Candidate | null {
  const same = options.filter(o => norm(o.title) === norm(term));
  return same.find(o => year && o.year === year) ?? (same.length === 1 ? same[0]! : same[0] && !year ? same[0] : null);
}

type Lister = { unmappedFolders: () => Promise<Array<{ name: string; path: string }>>; lookupCandidates: (t: string) => Promise<Candidate[]>; add: (r: Record<string, unknown>) => Promise<{ success: boolean; message: string }> };
const adapterFor = (kind: ImportKind) => getAdapter(KIND[kind].service) as unknown as Lister;

export async function findUnmapped(kind: ImportKind, adapter: Lister = adapterFor(kind)): Promise<UnmappedFolder[]> {
  const folders = (await adapter.unmappedFolders()).slice(0, 80);
  const out: UnmappedFolder[] = new Array(folders.length);
  let next = 0;
  const worker = async () => {
    while (next < folders.length) {
      const i = next++;
      const f = folders[i]!;
      const { term, year } = folderTerm(f.name);
      let options: Candidate[] = [];
      try { options = term ? (await adapter.lookupCandidates(term)).slice(0, 6) : []; } catch { /* the lookup service is unreachable: the folder is still listed */ }
      out[i] = { folder: f.name, path: f.path, term, ...(year ? { year } : {}), best: pickBest(term, year, options), options };
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return out;
}

export async function importFolders(kind: ImportKind, items: Array<{ path: string; providerId: string; title: string; year?: number }>, adapter: Lister = adapterFor(kind)): Promise<Array<{ path: string; success: boolean; message: string }>> {
  // Only folders the media app really lists as untracked may be used: never a path a caller made up.
  const allowed = new Set((await adapter.unmappedFolders()).map(f => f.path));
  const results: Array<{ path: string; success: boolean; message: string }> = [];
  for (const item of items.slice(0, 80)) {
    if (!allowed.has(item.path)) { results.push({ path: item.path, success: false, message: 'That folder is no longer waiting to be imported.' }); continue; }
    try {
      const r = await adapter.add({ title: item.title, type: KIND[kind].type, ...(item.year ? { year: item.year } : {}), selectedProviderId: item.providerId, existingPath: item.path });
      results.push({ path: item.path, success: r.success, message: r.success ? `Added "${item.title}". Its files are being imported.` : r.message });
    } catch (error) {
      results.push({ path: item.path, success: false, message: error instanceof Error ? error.message : 'Could not add it.' });
    }
  }
  return results;
}
