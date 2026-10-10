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
  // Single-flight: a byte-range player can fire a dozen requests for the same key within milliseconds
  // of each other, right as a 10s TTL expires. Without this, every one of them starts its own upstream
  // fetch before the first finishes - the exact request storm this cache exists to prevent, just moved
  // from "always" to "right when the cache turns over". Concurrent callers for the same key instead
  // share one in-flight fetch and get the same answer.
  private inflight = new Map<string, Promise<T>>();
  /**
   * `staleMs`, when set, is how long a value already served keeps answering past its TTL: returned at
   * once while a refresh runs in the background, and kept if that refresh fails (a brief Radarr/Sonarr
   * restart or timeout). Without the background part, every video seek more than a TTL after the last
   * one waited on a full library fetch before its first byte. Left unset (the default) an expired entry
   * always waits for a fresh answer and a failure always throws - the right choice for anything
   * security-relevant, like an age rating: an answer that cannot be confirmed must fail closed. It is for
   * availability caches (a library list) where a few-minutes-old answer beats a stalled stream.
   */
  constructor(private ttlMs: number, private max = 500, private staleMs = 0) {}

  async get(key: string, fill: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    if (hit && this.staleMs > 0 && Date.now() - hit.at < this.staleMs) {
      void this.refresh(key, fill, hit).catch(() => undefined);
      return hit.value;
    }
    return this.refresh(key, fill, hit);
  }

  private refresh(key: string, fill: () => Promise<T>, hit: { value: T; at: number } | undefined): Promise<T> {
    const already = this.inflight.get(key);
    if (already) return already;
    const promise = (async () => {
      try {
        const value = await fill();
        if (this.entries.size >= this.max) this.entries.delete(this.entries.keys().next().value as string);
        this.entries.set(key, { value, at: Date.now() });
        return value;
      } catch (error) {
        if (hit && this.staleMs > 0 && Date.now() - hit.at < this.staleMs) return hit.value;
        throw error;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    return promise;
  }

  /** Drops one key (or everything) so the next read is fresh — used right after a change this cache would otherwise still be serving stale. */
  clear(key?: string): void {
    if (key === undefined) this.entries.clear(); else this.entries.delete(key);
  }
}
