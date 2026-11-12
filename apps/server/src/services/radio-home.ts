import type { Station, Topic } from './radio.js';

// The radio home page: a row of featured stations, then rows by topic (and, for India, by language). Built from
// the directory's most played stations of the country, already marked by the health check.

export interface HomeRow { id: string; title: string; stations: Station[] }
export interface RadioHome { featured: Station[]; rows: HomeRow[] }

const ROW = 30;
const FEATURED = 12;
const TOPIC_ROWS: Array<[Topic, string]> = [['news', 'News'], ['music', 'Music'], ['talk', 'Talk'], ['sports', 'Sports'], ['devotional', 'Devotional']];
const INDIAN_LANGUAGES = ['hindi', 'tamil', 'telugu', 'malayalam', 'kannada', 'bengali', 'marathi', 'punjabi', 'gujarati', 'urdu', 'odia', 'assamese', 'konkani', 'bhojpuri', 'sanskrit', 'rajasthani', 'kashmiri', 'sindhi', 'nepali', 'tulu'];
const title = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const languagesOf = (s: Station) => (s.language ?? '').toLowerCase().split(/[,;/]+/).map(l => l.trim()).filter(Boolean);

/**
 * `stations` in popularity order; `near` the user's region, when one was given. Rows with no station are left out;
 * a language row needs three, so one stray tag does not make a row.
 */
export function buildHome(stations: Station[], opts: { country: string; near?: Station[]; region?: string }): RadioHome {
  // Checked and working first, then not checked yet; each in popularity order.
  const working = (list: Station[]) => [...list].sort((a, b) => Number(a.health !== 'ok') - Number(b.health !== 'ok'));
  const featured = working(stations.filter(s => s.logo)).slice(0, FEATURED);
  const rows: HomeRow[] = [];
  if (opts.near?.length) rows.push({ id: 'near', title: opts.region ? `Near you · ${opts.region}` : 'Near you', stations: opts.near.slice(0, ROW) });
  for (const [topic, name] of TOPIC_ROWS) rows.push({ id: topic, title: name, stations: stations.filter(s => s.topics?.includes(topic)).slice(0, ROW) });
  if (opts.country.toUpperCase() === 'IN') {
    const byLanguage = INDIAN_LANGUAGES.map(l => ({ l, list: stations.filter(s => languagesOf(s).includes(l)) })).filter(x => x.list.length >= 3);
    for (const { l, list } of byLanguage.sort((a, b) => b.list.length - a.list.length)) rows.push({ id: `lang-${l}`, title: title(l), stations: list.slice(0, ROW) });
  }
  return { featured, rows: rows.filter(r => r.stations.length) };
}
