/**
 * A tiny in-memory cache for one slow, frequently-repeated lookup (an *arr API call that almost never
 * changes between one request and the next). A byte-range video player asks its "can I play this, and is
 * it within this viewer's age limit" question, and its "which file is this" question, again for every
 * range of a file and every HLS segment — tens or hundreds of times over one playback, each one otherwise
 * a fresh round trip (or two) to Radarr/Sonarr. This is not a correctness relaxation: the answer genuinely
 * does not change within the few seconds this holds it, and every entry expires on its own.
 */
export class TtlCache<T> {
  private entries = new Map<string, { value: T; at: number }>();
  constructor(private ttlMs: number, private max = 500) {}

  async get(key: string, fill: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    const value = await fill();
    if (this.entries.size >= this.max) this.entries.delete(this.entries.keys().next().value as string);
    this.entries.set(key, { value, at: Date.now() });
    return value;
  }

  /** Drops one key (or everything) so the next read is fresh — used right after a change this cache would otherwise still be serving stale. */
  clear(key?: string): void {
    if (key === undefined) this.entries.clear(); else this.entries.delete(key);
  }
}
