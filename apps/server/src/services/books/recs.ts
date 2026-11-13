import { currentUserId } from '../user-context.js';
import { matchLibrary, type BookItem } from './index.js';
import type { BookState } from './state.js';
import { listGutenberg, type BookResult } from './sources.js';

// Recommendations: what a person opens, reads, finishes and favourites becomes a taste vector over subjects, authors
// and language; shelves rank the library by how close each book is to it, and Discover looks for books that are not
// in the library yet in the free sources.

export interface BookCard extends BookItem { favorite: boolean; percent: number; finished: boolean; lastOpenedAt: number }
export interface Shelf { id: string; title: string; kind: 'continue' | 'recent' | 'because' | 'forYou' | 'author' | 'subject' | 'audiobooks' | 'favorites'; items: BookCard[] }

/** Subjects split into plain lowercase topics: "Philosophy -- Ancient, Stoics" gives philosophy, ancient, stoics. */
export function topics(subjects: string[]): string[] {
  const out = new Set<string>();
  for (const s of subjects) for (const part of s.toLowerCase().split(/\s*(?:--|,|;|\/)\s*/)) { const t = part.replace(/[^\p{L}\p{N} '&-]/gu, '').trim(); if (t.length > 2 && t.length < 40 && !/^(fiction|general|texts?|books?)$/.test(t)) out.add(t); }
  return [...out].slice(0, 30);
}

type Features = Map<string, number>;
export function features(b: { subjects?: string[]; authors?: string[]; language?: string }): Features {
  const f: Features = new Map();
  const subj = topics(b.subjects ?? []);
  for (const t of subj) f.set(`s:${t}`, 1 / Math.sqrt(subj.length));
  for (const a of b.authors ?? []) f.set(`a:${a.toLowerCase()}`, 1.5);
  if (b.language) f.set(`l:${b.language.toLowerCase().slice(0, 2)}`, 0.2);
  return f;
}
const dot = (a: Features, b: Features) => { let n = 0; for (const [k, v] of a) n += v * (b.get(k) ?? 0); return n; };
const norm = (a: Features) => Math.sqrt(dot(a, a)) || 1;
export const similarity = (a: Features, b: Features): number => dot(a, b) / (norm(a) * norm(b));

/** How much one book says about taste: finished counts most, then progress, then having been opened, plus favourites. */
export function engagement(state: BookState | undefined, favorite: boolean): number {
  let w = favorite ? 2 : 0;
  if (state) w += state.finished ? 3 : state.percent >= 3 ? 1 + state.percent / 50 : state.openedAt ? 0.5 : 0;
  return w;
}

export function tasteOf(items: BookCard[]): Features {
  const taste: Features = new Map();
  for (const b of items) {
    const w = engagement(b.percent || b.finished || b.lastOpenedAt ? { position: '', percent: b.percent, finished: b.finished, openedAt: b.lastOpenedAt, updatedAt: 0 } : undefined, b.favorite);
    if (w > 0) for (const [k, v] of features(b)) taste.set(k, (taste.get(k) ?? 0) + w * v);
  }
  return taste;
}

const stateOf = (b: BookCard): BookState | undefined => (b.percent || b.finished || b.lastOpenedAt ? { position: '', percent: b.percent, finished: b.finished, openedAt: b.lastOpenedAt, updatedAt: 0 } : undefined);

/** The shelves for the library: Continue, For you, Because you read X, Recently added, More by an author, subjects. */
export function buildShelves(items: BookCard[], limit = 20): Shelf[] {
  const shelves: Shelf[] = [];
  const used = new Set<string>();
  const add = (shelf: Shelf, minimum = 1) => { if (shelf.items.length >= minimum) shelves.push({ ...shelf, items: shelf.items.slice(0, limit) }); };
  const continuing = items.filter(b => !b.finished && b.percent > 0 && b.percent < 98 && b.lastOpenedAt).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  add({ id: 'continue', title: 'Continue reading and listening', kind: 'continue', items: continuing });
  const taste = tasteOf(items);
  const unread = items.filter(b => !b.finished && !b.lastOpenedAt);
  if (taste.size) {
    const forYou = unread.map(b => ({ b, s: similarity(taste, features(b)) })).filter(x => x.s > 0.05).sort((a, b) => b.s - a.s).map(x => x.b);
    add({ id: 'for-you', title: 'For you', kind: 'forYou', items: forYou });
    // The most recent thing that mattered to this person, and the books closest to it.
    const anchor = items.filter(b => engagement(stateOf(b), b.favorite) >= 1).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0];
    if (anchor) {
      const like = features(anchor);
      add({ id: `because-${anchor.id}`, title: `Because you read ${anchor.title}`, kind: 'because', items: items.filter(b => b.id !== anchor.id && !b.finished).map(b => ({ b, s: similarity(like, features(b)) })).filter(x => x.s > 0.1).sort((a, b) => b.s - a.s).map(x => x.b) });
    }
  }
  add({ id: 'recent', title: 'Recently added', kind: 'recent', items: [...items].sort((a, b) => b.addedAt - a.addedAt) });
  const fav = items.filter(b => b.favorite);
  add({ id: 'favorites', title: 'Your favourites', kind: 'favorites', items: fav });
  // More by the author the person has spent the most time with (else the author with the most books).
  const byAuthor = new Map<string, BookCard[]>();
  for (const b of items) for (const a of b.authors.slice(0, 2)) (byAuthor.get(a) ?? byAuthor.set(a, []).get(a)!).push(b);
  const weight = (list: BookCard[]) => list.reduce((n, b) => n + engagement(stateOf(b), b.favorite), 0);
  const author = [...byAuthor.entries()].filter(([, l]) => l.length >= 2).sort((a, b) => weight(b[1]) - weight(a[1]) || b[1].length - a[1].length)[0];
  if (author) add({ id: `author-${author[0].toLowerCase()}`, title: `More by ${author[0]}`, kind: 'author', items: author[1] });
  const audio = items.filter(b => b.kind === 'audiobook');
  add({ id: 'audiobooks', title: 'Audiobooks', kind: 'audiobooks', items: audio });
  // Subject rows: the person's favourite topics first, then whatever the library has most of.
  const counts = new Map<string, BookCard[]>();
  for (const b of items) for (const t of topics(b.subjects)) (counts.get(t) ?? counts.set(t, []).get(t)!).push(b);
  const ranked = [...counts.entries()].filter(([, l]) => l.length >= 3).sort((a, b) => (taste.get(`s:${b[0]}`) ?? 0) - (taste.get(`s:${a[0]}`) ?? 0) || b[1].length - a[1].length);
  const titled = (t: string) => t.replace(/\b\p{L}/gu, c => c.toUpperCase());
  for (const [t, list] of ranked.slice(0, 4)) { for (const b of list) used.add(b.id); add({ id: `subject-${t}`, title: titled(t), kind: 'subject', items: list }, 3); }
  return shelves;
}

// ---------- Discover: books that are not in the library yet ----------
export interface DiscoverRow { id: string; title: string; results: BookResult[] }
const rowCache = new Map<string, { at: number; results: BookResult[] }>();
const ROW_MS = 30 * 60_000;

async function gutenbergRow(id: string, title: string, topic: string, language: string): Promise<DiscoverRow | null> {
  const key = `${currentUserId()}|${id}|${language}`;
  let hit = rowCache.get(key);
  if (!hit || Date.now() - hit.at > ROW_MS) {
    try { hit = { at: Date.now(), results: (await listGutenberg(topic, language)).map(({ urls: _u, ...r }: BookResult & { urls?: unknown }) => r) }; } catch { return null; }
    rowCache.set(key, hit);
    if (rowCache.size > 300) rowCache.delete(rowCache.keys().next().value!);
  }
  // What is already in the library is left out each time, so a book pulled a minute ago disappears from Discover.
  const results = hit.results.filter(r => !matchLibrary(r.title, r.authors, r.source, r.id)).slice(0, 20);
  return results.length ? { id, title, results } : null;
}

/** Rows of free books matching the person's taste (or popular classics to start with), minus what they already have. */
export async function discover(items: BookCard[]): Promise<DiscoverRow[]> {
  const taste = tasteOf(items);
  const lang = [...taste.entries()].filter(([k]) => k.startsWith('l:')).sort((a, b) => b[1] - a[1])[0]?.[0].slice(2) ?? items.find(b => b.language)?.language?.slice(0, 2) ?? 'en';
  const liked = [...taste.entries()].filter(([k]) => k.startsWith('s:')).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k.slice(2));
  const title = (t: string) => t.replace(/\b\p{L}/gu, c => c.toUpperCase());
  // Nothing read yet: popular classics plus a few broad topics. Otherwise the topics the person keeps coming back to.
  const wanted = liked.length ? liked.map(t => ({ id: `topic-${t}`, title: `More ${title(t)}`, topic: t })) : [{ id: 'philosophy', title: 'Philosophy', topic: 'philosophy' }, { id: 'adventure', title: 'Adventure', topic: 'adventure' }, { id: 'poetry', title: 'Poetry', topic: 'poetry' }];
  const rows = await Promise.all([gutenbergRow('popular', 'Popular classics', '', lang), ...wanted.map(w => gutenbergRow(w.id, w.title, w.topic, lang))]);
  // A book shows in the first row that has it, not in every row.
  const seen = new Set<string>();
  return rows.filter((r): r is DiscoverRow => !!r).map(r => ({ ...r, results: r.results.filter(b => !seen.has(b.id) && !!seen.add(b.id)) })).filter(r => r.results.length > 0);
}
