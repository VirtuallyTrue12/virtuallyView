import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/paths.js';
import { outboundFetch } from './outbound.js';

// Many free public streams (Live TV channels, radio stations) are dead or limited to one country. A slow
// background pass tests each stream (playlist, one variant, one segment; or the first audio bytes) and
// remembers the answer for a day.

export interface Health { ok: boolean; /** Failed checks in a row. */ fails: number; at: number }
export const TTL_MS = 24 * 3_600_000;
const PAUSE_MS = 150;

export const isFresh = (h: Health | undefined, now = Date.now()): boolean => !!h && now - h.at < TTL_MS;
/** Hidden from the lists after two failed checks in a row. */
export const isDead = (h: Health | undefined): boolean => !!h && !h.ok && h.fails >= 2;
export const decide = (prev: Health | undefined, ok: boolean, now = Date.now()): Health => ({ ok, fails: ok ? 0 : (prev?.fails ?? 0) + 1, at: now });

export type Fetcher = (url: string, init?: { headers?: Record<string, string>; timeoutMs?: number }) => Promise<Response>;
const MAX_PLAYLIST = 512 * 1024;
/** A plain (non-HLS) stream must send this much real audio or video before it counts as working. */
const PLAIN_BYTES = 4096;
const refs = (text: string) => text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
// A sign-in page or an error message served with 200 is not media.
const isText = (res: Response) => /^(text\/|application\/(json|xml|xhtml))/i.test(res.headers.get('content-type') ?? '');

/** True once `min` bytes of the body arrive; the rest is cancelled. */
async function bytesArrive(res: Response, min: number): Promise<boolean> {
  if (!res.body) return false;
  const reader = res.body.getReader();
  let got = 0;
  try {
    while (got < min) { const { done, value } = await reader.read(); if (done) break; got += value.byteLength; }
  } catch { /* cut off */ } finally { void reader.cancel().catch(() => undefined); }
  return got >= min;
}

/** True when the stream really plays: playlist, then one variant playlist if it is a master, then real bytes of the
 * last segment. A plain stream (no playlist) must send its first few KB of audio or video. */
export async function probeStream(url: string, fetcher: Fetcher = outboundFetch): Promise<boolean> {
  try {
    let target = url;
    for (let depth = 0; depth < 3; depth++) {
      const res = await fetcher(target, { timeoutMs: 8000 });
      if (res.status !== 200 && res.status !== 206) { void res.body?.cancel(); return false; }
      const type = res.headers.get('content-type') ?? '';
      if (!/mpegurl/i.test(type) && !/\.m3u8?(\?|$)/i.test(target)) {
        if (isText(res)) { void res.body?.cancel(); return false; }
        return await bytesArrive(res, PLAIN_BYTES);
      }
      const text = (await res.text()).slice(0, MAX_PLAYLIST);
      if (!text.trimStart().startsWith('#EXTM3U')) return false;
      const items = refs(text);
      if (!items.length) return false;
      const base = res.url || target;
      if (/#EXT-X-STREAM-INF/.test(text)) { target = new URL(items[0]!, base).toString(); continue; }
      const seg = await fetcher(new URL(items[items.length - 1]!, base).toString(), { timeoutMs: 8000, headers: { Range: 'bytes=0-1023' } });
      if ((seg.status !== 200 && seg.status !== 206) || isText(seg)) { void seg.body?.cancel(); return false; }
      return await bytesArrive(seg, 1);
    }
    return false;
  } catch { return false; }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Health answers for one kind of stream, kept in DATA_DIR/<file>: a slow background queue (`concurrency` checks at a
 * time) and an on-demand check for administrators.
 */
export function healthStore<T extends { id: string; url: string }>(file: string, opts: { concurrency: number; probe: (url: string) => Promise<boolean> }) {
  const path = resolve(DATA_DIR, file);
  let cache: Record<string, Health> | null = null;
  const health = (): Record<string, Health> => {
    if (!cache) { try { cache = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, Health> : {}; } catch { cache = {}; } }
    return cache;
  };
  const persist = () => { try { mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(path, JSON.stringify(health())); } catch { /* read-only data folder: results stay in memory */ } };
  const healthOf = (id: string): Health | undefined => health()[id];
  const deadIds = (): string[] => Object.entries(health()).filter(([, h]) => isDead(h)).map(([id]) => id);
  const record = (id: string, ok: boolean): Health => (health()[id] = decide(health()[id], ok));

  const queue: T[] = [];
  const queued = new Set<string>();
  let running = false;

  async function drain(): Promise<void> {
    running = true;
    let done = 0;
    const retry: T[] = [];
    const work = async (list: T[], again: boolean) => {
      await Promise.all(Array.from({ length: opts.concurrency }, async () => {
        for (let c = list.shift(); c; c = list.shift()) {
          const h = record(c.id, await opts.probe(c.url));
          // One more try at the end of the pass before a stream counts as dead.
          if (!h.ok && again && h.fails < 2) retry.push(c);
          if (++done % 100 === 0) persist();
          await sleep(PAUSE_MS);
        }
      }));
    };
    try { await work(queue, true); await work(retry, false); } finally { persist(); queued.clear(); running = false; }
  }

  /** Add streams never checked, or whose answer is a day old, to the slow background pass. */
  function scheduleProbes(items: T[]): number {
    let added = 0;
    for (const c of items) if (!queued.has(c.id) && !isFresh(healthOf(c.id))) { queued.add(c.id); queue.push(c); added++; }
    if (added && !running) void drain();
    return added;
  }

  /** Test these now (an administrator asked), ignoring the day-long memory; a failure is tried twice. */
  async function checkNow(items: T[]): Promise<{ dead: string[]; alive: string[] }> {
    const dead: string[] = [], alive: string[] = [];
    const list = [...items];
    await Promise.all(Array.from({ length: opts.concurrency }, async () => {
      for (let c = list.shift(); c; c = list.shift()) {
        const ok = (await opts.probe(c.url)) || (await opts.probe(c.url));
        health()[c.id] = ok ? decide(health()[c.id], true) : { ok: false, fails: 2, at: Date.now() };
        (ok ? alive : dead).push(c.id);
      }
    }));
    persist();
    return { dead, alive };
  }

  return { healthOf, deadIds, scheduleProbes, checkNow };
}

// Live TV channels: free public lists, so eight at a time.
export const { healthOf, deadIds, scheduleProbes, checkNow } = healthStore<{ id: string; url: string }>('live-health.json', { concurrency: 8, probe: url => probeStream(url) });
