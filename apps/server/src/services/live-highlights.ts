import { outboundFetch } from './outbound.js';
import { channelsFor, guideSources, listPlaylists, type Channel } from './live-tv.js';
import { programmesFor } from './epg.js';

/**
 * "What is worth watching": the big matches and races of the next day or so, and which of the person's own channels
 * carry them. Fixtures, live status and TV networks come from ESPN's public scoreboards (no key, no account); a
 * channel is matched by its name against the network, and by the person's own programme guide when it has one.
 * Nothing here needs setup, and a failure just means no panel.
 */

export interface HighlightChannel { id: string; name: string; logo?: string }
export interface Highlight {
  id: string;
  title: string;
  sport: string;
  league: string;
  start: number;
  end: number;
  live: boolean;
  /** Channels from the person's playlists that show it. */
  channels: HighlightChannel[];
  /** Broadcasters the listing names that are not in the person's playlists. */
  elsewhere: string[];
  score: number;
}

interface League { path: string; label: string; weight: number; sport: string }
const LEAGUES: League[] = [
  { path: 'soccer/uefa.champions', label: 'UEFA Champions League', weight: 10, sport: 'Soccer' }, { path: 'soccer/eng.1', label: 'Premier League', weight: 10, sport: 'Soccer' },
  { path: 'soccer/uefa.europa', label: 'UEFA Europa League', weight: 8, sport: 'Soccer' }, { path: 'soccer/esp.1', label: 'La Liga', weight: 8, sport: 'Soccer' },
  { path: 'soccer/ita.1', label: 'Serie A', weight: 8, sport: 'Soccer' }, { path: 'soccer/ger.1', label: 'Bundesliga', weight: 8, sport: 'Soccer' },
  { path: 'soccer/fra.1', label: 'Ligue 1', weight: 8, sport: 'Soccer' }, { path: 'soccer/fifa.world', label: 'FIFA World Cup', weight: 12, sport: 'Soccer' },
  { path: 'soccer/uefa.nations', label: 'UEFA Nations League', weight: 8, sport: 'Soccer' }, { path: 'soccer/conmebol.libertadores', label: 'Copa Libertadores', weight: 8, sport: 'Soccer' },
  { path: 'soccer/eng.fa', label: 'FA Cup', weight: 8, sport: 'Soccer' }, { path: 'soccer/usa.1', label: 'MLS', weight: 6, sport: 'Soccer' }, { path: 'soccer/ind.1', label: 'Indian Super League', weight: 7, sport: 'Soccer' },
  { path: 'racing/f1', label: 'Formula 1', weight: 12, sport: 'Motorsport' }, { path: 'basketball/nba', label: 'NBA', weight: 10, sport: 'Basketball' },
  { path: 'football/nfl', label: 'NFL', weight: 10, sport: 'American Football' }, { path: 'hockey/nhl', label: 'NHL', weight: 7, sport: 'Ice Hockey' },
  { path: 'baseball/mlb', label: 'MLB', weight: 7, sport: 'Baseball' }, { path: 'mma/ufc', label: 'UFC', weight: 8, sport: 'Fighting' },
  { path: 'cricket/8048', label: 'Indian Premier League', weight: 12, sport: 'Cricket' }, { path: 'rugby/164205', label: 'Rugby World Cup', weight: 8, sport: 'Rugby' }
];
const FAMOUS = /real madrid|barcelona|manchester (united|city)|liverpool|arsenal|chelsea|tottenham|bayern|paris saint|psg|juventus|\bmilan\b|inter |dortmund|atl[eé]tico|napoli|india|australia|england|pakistan|brazil|argentina|france|germany|spain|portugal|netherlands|south africa|new zealand|mumbai indians|chennai super kings|royal challengers|kolkata knight|lakers|warriors|celtics|knicks|bulls|cowboys|chiefs|patriots|packers|49ers|eagles|bills|red bull|ferrari|mercedes|mclaren|max verstappen|hamilton|leclerc|norris/i;
const LENGTH_H: Record<string, number> = { Soccer: 2, Motorsport: 2.5, Cricket: 7, 'American Football': 3.5, Basketball: 2.5, 'Ice Hockey': 2.75, Baseball: 3.25, Tennis: 3.5, Fighting: 4, Rugby: 2 };

interface EspnCompetition { date?: string; type?: { text?: string; abbreviation?: string }; status?: { type?: { state?: string } }; broadcasts?: Array<{ names?: string[] }>; geoBroadcasts?: Array<{ media?: { shortName?: string } }> }
interface EspnEvent { id: string; name?: string; shortName?: string; date?: string; status?: { type?: { state?: string } }; competitions?: EspnCompetition[] }

const cache = new Map<string, { at: number; value: unknown }>();
async function scoreboard(league: League, range: string): Promise<EspnEvent[]> {
  const path = `/apis/site/v2/sports/${league.path}/scoreboard?dates=${range}&limit=80`;
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value as EspnEvent[];
  try {
    const res = await outboundFetch(`https://site.api.espn.com${path}`, { timeoutMs: 10_000, headers: { 'User-Agent': 'virtuallyView' } });
    if (!res.ok) return hit ? (hit.value as EspnEvent[]) : [];
    const events = ((await res.json()) as { events?: EspnEvent[] }).events ?? [];
    cache.set(path, { at: Date.now(), value: events });
    return events;
  } catch { return hit ? (hit.value as EspnEvent[]) : []; }
}

const STOP = new Set(['hd', 'fhd', 'uhd', 'sd', '4k', 'tv', 'channel', 'network', 'the', 'live', 'plus', 'us', 'uk', 'in', 'ca', 'au', 'de', 'fr', 'es', 'it', 'usa']);
/** Words of a channel name without quality and country tags, and the numbers in it (ESPN and ESPN 2 differ). */
function words(name: string): { text: string[]; digits: string[] } {
  const tokens = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\+/g, ' plus ').split(/[^a-z0-9]+/).filter(Boolean);
  const kept = tokens.filter(t => !STOP.has(t));
  return { text: kept.filter(t => !/^\d+$/.test(t)), digits: kept.filter(t => /^\d+$/.test(t)) };
}
export function sameChannel(listing: string, playlistName: string): boolean {
  const a = words(listing), b = words(playlistName);
  if (!a.text.length || !b.text.length) return false;
  if (a.digits.join() !== b.digits.join()) return false;
  const [small, big] = a.text.length <= b.text.length ? [a.text, b.text] : [b.text, a.text];
  if (!small.every(t => big.includes(t))) return false;
  return small.length >= 2 || (small[0] ?? '').length >= 4;
}

export function scoreEvent(e: { weight: number; title: string; hasTv: boolean }): number {
  const famous = (e.title.match(new RegExp(FAMOUS.source, 'gi')) ?? []).length;
  return e.weight + Math.min(famous, 2) * 3 + (e.hasTv ? 2 : 0);
}

async function myChannels(): Promise<Channel[]> {
  const out: Channel[] = [];
  for (const p of listPlaylists()) { try { out.push(...await channelsFor(p)); } catch { /* an unreachable playlist */ } }
  return out;
}

const SPORTY = /sport|f1|racing|football|soccer|cricket|nba|nfl|espn|fox|sky|bein|dazn|star|willow|ten |eurosport|tnt|nbc|cbs|abc|premier|motor/i;
const filler = new Set(['at', 'vs', 'v', 'the', 'fc', 'cf', 'sc', 'and', 'grand', 'prix', 'gp', 'qatar', 'airways', 'formula', 'race', 'heineken', 'aramco']);
const sig = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 2 && !filler.has(w));

/** Channels whose own programme guide lists this event (its title has the teams or the place). Only what the guide already holds is used. */
function fromGuides(title: string, start: number, end: number, channels: Channel[]): HighlightChannel[] {
  const words = sig(title);
  if (words.length < 1) return [];
  const found: HighlightChannel[] = [];
  const playlists = new Map(listPlaylists().map(p => [p.id, p]));
  for (const c of channels) {
    if (!c.tvgId || !(SPORTY.test(c.group ?? '') || SPORTY.test(c.name))) continue;
    const p = playlists.get(c.playlist);
    const urls = p?.epgUrl ? [p.epgUrl] : guideSources(c.playlist);
    for (const url of urls) {
      const hit = programmesFor(url, c.tvgId, start - 30 * 60_000, end).some(pr => {
        const t = sig(pr.title);
        const matched = words.filter(w => t.includes(w)).length;
        return matched >= Math.min(2, words.length) && matched > 0;
      });
      if (hit) { found.push({ id: c.id, name: c.name, ...(c.logo ? { logo: c.logo } : {}) }); break; }
    }
    if (found.length >= 4) break;
  }
  return found;
}

const stamp = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

export async function liveHighlights(options: { country?: string } = {}): Promise<Highlight[]> {
  void options;
  const now = Date.now();
  // ESPN takes one day at a time for some sports (a range is refused), so yesterday, today and tomorrow are three asks.
  const days = [-1, 0, 1].map(n => stamp(new Date(now + n * 86_400_000)));
  const [lists, channels] = await Promise.all([
    (async () => {
      const jobs = LEAGUES.flatMap(l => days.map(d => [l, d] as const));
      const done = new Map<League, Map<string, EspnEvent>>();
      let next = 0;
      const worker = async () => {
        while (next < jobs.length) {
          const [l, d] = jobs[next++]!;
          const seen = done.get(l) ?? new Map<string, EspnEvent>();
          for (const ev of await scoreboard(l, d)) seen.set(ev.id, ev);
          done.set(l, seen);
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      return [...done].map(([l, events]) => [l, [...events.values()]] as [League, EspnEvent[]]);
    })(),
    myChannels()
  ]);
  const out: Highlight[] = [];
  for (const [league, events] of lists) {
    for (const ev of events) {
      const comps = ev.competitions ?? [];
      // A race weekend has several sessions; only qualifying, sprints and the race matter.
      const sessions = comps.length > 1 && league.sport === 'Motorsport' ? comps.filter(c => /race|qual|sprint/i.test(c.type?.text ?? c.type?.abbreviation ?? '')) : comps.slice(0, 1);
      for (const comp of sessions.length ? sessions : []) {
        const startIso = comp.date ?? ev.date;
        const start = Date.parse(startIso ?? '');
        if (!Number.isFinite(start)) continue;
        const state = comp.status?.type?.state ?? ev.status?.type?.state;
        const end = start + (LENGTH_H[league.sport] ?? 3) * 3_600_000;
        if (state === 'post' || end < now || start > now + 36 * 3_600_000) continue;
        const session = comps.length > 1 ? (comp.type?.text ?? '').trim() : '';
        const title = `${(ev.name ?? ev.shortName ?? '').trim()}${session ? ` · ${session}` : ''}`;
        if (!title.trim()) continue;
        const networks = [...new Set([...(comp.broadcasts ?? []).flatMap(b => b.names ?? []), ...(comp.geoBroadcasts ?? []).map(b => b.media?.shortName ?? '')].map(n => n.trim()).filter(Boolean))];
        const mine = new Map<string, HighlightChannel>();
        const elsewhere: string[] = [];
        for (const name of networks) {
          const matches = channels.filter(c => sameChannel(name, c.name));
          for (const c of matches) mine.set(c.id, { id: c.id, name: c.name, ...(c.logo ? { logo: c.logo } : {}) });
          if (!matches.length) elsewhere.push(name);
        }
        if (mine.size === 0) for (const c of fromGuides(title, start, end, channels)) mine.set(c.id, c);
        const live = state === 'in' || (start <= now && now < end);
        out.push({
          id: `${ev.id}-${session || 'main'}`, title, sport: league.sport, league: league.label, start, end, live,
          channels: [...mine.values()].slice(0, 6), elsewhere: elsewhere.slice(0, 4),
          score: scoreEvent({ weight: league.weight, title, hasTv: networks.length > 0 }) + (mine.size ? 6 : 0) + (live ? 4 : 0)
        });
      }
    }
  }
  // Best first (live ones get a bonus), and no single competition fills the row.
  const perLeague = new Map<string, number>();
  return out.filter(h => h.score >= 9).sort((a, b) => b.score - a.score || a.start - b.start)
    .filter(h => { const n = (perLeague.get(h.league) ?? 0) + 1; perLeague.set(h.league, n); return n <= 4; }).slice(0, 16);
}
