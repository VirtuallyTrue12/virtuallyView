import path from 'node:path';
import type { SonarrAdapter } from '@virtuallyview/integrations';
import { getAdapter } from './registry.js';
import { outboundFetch } from './outbound.js';
import { fetchSpecial, searchYoutube, youtubeJobs } from './youtube.js';
import { logEvent, noteSearch } from './requests.js';

/**
 * TV specials (Season 0: behind-the-scenes, reunions, holiday episodes) are rarely on torrent indexers but often
 * on YouTube, Dailymotion or the Internet Archive. This looks there, picks the video whose title and length fit
 * the special best, saves it into the show's "Season 00" folder under the name the TV manager expects
 * ("Show - S00E05 - Title") and asks it to rescan, so it is imported like any other episode.
 */

export interface SpecialCandidate { source: string; title: string; seconds: number; site: string; score: number }

const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));
const STOP = new Set(['the', 'and', 'of', 'a', 'an', 'to', 'in', 'on', 'for', 'with', 'episode', 'special', 'official', 'full', 'hd', 'video']);

/** How well a video fits: the special's title words found in it, the show's name, and a plausible length. */
export function scoreCandidate(show: string, special: string, title: string, seconds: number, runtimeMin?: number): number {
  const t = new Set(words(title));
  const showWords = words(show);
  // The special's own words (its title without the show's name) must be there, most of them.
  const own = words(special).filter(w => !showWords.includes(w));
  const want = own.length ? own : words(special);
  if (!want.length) return 0;
  const hit = want.filter(w => t.has(w)).length / want.length;
  if (hit < 0.7) return 0;
  const showHit = showWords.length ? showWords.filter(w => t.has(w)).length / showWords.length : 0;
  let score = hit * 0.7 + showHit * 0.3;
  // Clips, trailers and reactions are not the special.
  if (/\b(trailer|promo|clip|reaction|review|recap|explained|scene|shorts?|teaser)\b/i.test(title)) score -= 0.35;
  if (runtimeMin && seconds > 0) {
    const ratio = seconds / (runtimeMin * 60);
    if (ratio < 0.5 || ratio > 2.2) score -= 0.5; else if (ratio > 0.8 && ratio < 1.3) score += 0.1;
  } else if (seconds > 0 && seconds < 240) score -= 0.3;
  return Math.max(0, Math.min(1, score));
}

async function dailymotion(q: string): Promise<Omit<SpecialCandidate, 'score'>[]> {
  try {
    const res = await outboundFetch(`https://api.dailymotion.com/videos?${new URLSearchParams({ search: q, fields: 'id,title,duration', limit: '10' })}`, { timeoutMs: 12_000 });
    if (!res.ok) return [];
    const data = await res.json() as { list?: { id: string; title: string; duration: number }[] };
    return (data.list ?? []).map(v => ({ source: `https://www.dailymotion.com/video/${v.id}`, title: v.title, seconds: v.duration, site: 'Dailymotion' }));
  } catch { return []; }
}

async function archive(q: string): Promise<Omit<SpecialCandidate, 'score'>[]> {
  try {
    const params = new URLSearchParams({ q: `(${q}) AND mediatype:movies`, rows: '10', output: 'json' });
    params.append('fl[]', 'identifier'); params.append('fl[]', 'title'); params.append('fl[]', 'runtime');
    const res = await outboundFetch(`https://archive.org/advancedsearch.php?${params}`, { timeoutMs: 12_000 });
    if (!res.ok) return [];
    const data = await res.json() as { response?: { docs?: { identifier: string; title: string; runtime?: string }[] } };
    const secs = (r?: string) => { const p = (r ?? '').split(':').map(Number); return p.length === 3 ? p[0]! * 3600 + p[1]! * 60 + p[2]! : p.length === 2 ? p[0]! * 60 + p[1]! : 0; };
    return (data.response?.docs ?? []).map(d => ({ source: `https://archive.org/details/${d.identifier}`, title: String(d.title), seconds: secs(d.runtime), site: 'Internet Archive' }));
  } catch { return []; }
}

async function youtube(q: string): Promise<Omit<SpecialCandidate, 'score'>[]> {
  try { return (await searchYoutube(q)).map(v => ({ source: `https://www.youtube.com/watch?v=${v.id}`, title: v.title, seconds: v.durationSeconds, site: 'YouTube' })); } catch { return []; }
}

/** The best video for one special across the sites, or null when nothing fits well enough. */
export async function findSpecial(show: string, special: string, runtimeMin?: number): Promise<SpecialCandidate | null> {
  const q = `${show} ${special}`;
  const found = (await Promise.all([youtube(q), youtube(special), dailymotion(q), archive(q)])).flat();
  const ranked = found.map(c => ({ ...c, score: scoreCandidate(show, special, c.title, c.seconds, runtimeMin) })).sort((a, b) => b.score - a.score);
  return ranked[0] && ranked[0].score >= 0.6 ? ranked[0] : null;
}

/**
 * Look online for the missing specials of a show (all of them, or one episode) and start downloading the ones
 * found. Returns a sentence for the person.
 */
export async function fetchMissingSpecials(seriesId: string, episodeId?: string): Promise<{ success: boolean; message: string; started: number }> {
  const sonarr = getAdapter<SonarrAdapter>('sonarr');
  const folder = await sonarr.getSeriesFolder(seriesId);
  if (!folder) return { success: false, message: 'That show is not in the TV library.', started: 0 };
  const missing = (await sonarr.getEpisodes(seriesId)).filter(e => e.seasonNumber === 0 && !e.hasFile && (!episodeId || e.id === episodeId));
  if (!missing.length) return { success: true, message: 'No special is missing.', started: 0 };
  const running = new Set((await youtubeJobs().catch(() => [])).filter(j => ['queued', 'downloading', 'merging'].includes(j.status)).map(j => j.title));
  let started = 0;
  const notFound: string[] = [];
  for (const ep of missing.slice(0, 15)) {
    const name = `${folder.title} - S00E${String(ep.episodeNumber).padStart(2, '0')} - ${ep.title}`.replace(/[\\/:*?"<>|]/g, ' ');
    if (running.has(name)) continue;
    const pick = await findSpecial(folder.title, ep.title, ep.runtime);
    if (!pick) { notFound.push(ep.title); continue; }
    await fetchSpecial(pick.source, path.posix.join(folder.path, 'Season 00'), name);
    const request = noteSearch(seriesId, folder.title, `S00E${String(ep.episodeNumber).padStart(2, '0')} · ${ep.title}`, 'series');
    logEvent(request.id, `Found "${pick.title}" on ${pick.site}; downloading it as a special`);
    started++;
  }
  if (started) watchAndRescan(seriesId);
  const nf = notFound.length ? ` Not found online: ${notFound.slice(0, 3).join(', ')}${notFound.length > 3 ? ` and ${notFound.length - 3} more` : ''}.` : '';
  return { success: started > 0 || !notFound.length, message: started ? `Downloading ${started} special${started === 1 ? '' : 's'} from video sites.${nf}` : `No good match on YouTube, Dailymotion or the Internet Archive.${nf}`, started };
}

const watching = new Set<string>();
/** When the special downloads finish, have the TV manager import them. */
function watchAndRescan(seriesId: string): void {
  if (watching.has(seriesId)) return;
  watching.add(seriesId);
  const tick = async (tries: number): Promise<void> => {
    const active = (await youtubeJobs().catch(() => [])).some(j => ['queued', 'downloading', 'merging'].includes(j.status) && / - S00E\d+ - /.test(j.title));
    if (active && tries < 120) { setTimeout(() => void tick(tries + 1), 30_000); return; }
    watching.delete(seriesId);
    await getAdapter<SonarrAdapter>('sonarr').rescanSeries(seriesId).catch(() => undefined);
  };
  setTimeout(() => void tick(0), 30_000);
}
