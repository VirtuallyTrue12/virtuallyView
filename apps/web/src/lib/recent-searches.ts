const KEY = 'vv-recent-searches';

export function getRecentSearches(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
  } catch { return []; }
}

export function addRecentSearch(query: string): string[] {
  const q = query.trim();
  if (q.length < 2) return getRecentSearches();
  const next = [q, ...getRecentSearches().filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
  return next;
}

export function removeRecentSearch(query: string): string[] {
  const next = getRecentSearches().filter(x => x !== query);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
  return next;
}

export function clearRecentSearches(): void {
  try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}
