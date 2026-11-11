import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/paths.js';
import type { Channel } from './live-tv.js';
import { outboundFetch } from './outbound.js';

// Many free public streams are dead or limited to one country. A slow background pass tests each
// channel's stream (playlist, one variant, one segment) and remembers the answer for a day.

export interface Health { ok: boolean; /** Failed checks in a row. */ fails: number; at: number }
export const TTL_MS = 24 * 3_600_000;
const CONCURRENCY = 8;
const PAUSE_MS = 150;
const FILE = resolve(DATA_DIR, 'live-health.json');

export const isFresh = (h: Health | undefined, now = Date.now()): boolean => !!h && now - h.at < TTL_MS;
/** Hidden from the lists after two failed checks in a row. */
export const isDead = (h: Health | undefined): boolean => !!h && !h.ok && h.fails >= 2;
export const decide = (prev: Health | undefined, ok: boolean, now = Date.now()): Health => ({ ok, fails: ok ? 0 : (prev?.fails ?? 0) + 1, at: now });

let cache: Record<string, Health> | null = null;
const health = (): Record<string, Health> => {
  if (!cache) { try { cache = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, Health> : {}; } catch { cache = {}; } }
  return cache;
};
const persist = () => { try { mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(FILE, JSON.stringify(health())); } catch { /* read-only data folder: results stay in memory */ } };
export const healthOf = (id: string): Health | undefined => health()[id];
export const deadIds = (): string[] => Object.entries(health()).filter(([, h]) => isDead(h)).map(([id]) => id);

type Fetcher = (url: string, init?: { headers?: Record<string, string>; timeoutMs?: number }) => Promise<Response>;
const MAX_PLAYLIST = 512 * 1024;
const refs = (text: string) => text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));

/** True when the stream answers: playlist, then one variant playlist if it is a master, then a segment. */
export async function probeStream(url: string, fetcher: Fetcher = outboundFetch): Promise<boolean> {
  try {
    let target = url;
    for (let depth = 0; depth < 3; depth++) {
      const res = await fetcher(target, { timeoutMs: 8000 });
      if (res.status !== 200 && res.status !== 206) { void res.body?.cancel(); return false; }
      const type = res.headers.get('content-type') ?? '';
      if (!/mpegurl/i.test(type) && !/\.m3u8?(\?|$)/i.test(target)) { void res.body?.cancel(); return true; } // a plain TS/MP4 stream that answers
      const text = (await res.text()).slice(0, MAX_PLAYLIST);
      if (!text.trimStart().startsWith('#EXTM3U')) return false;
      const items = refs(text);
      if (!items.length) return false;
      const base = res.url || target;
      if (/#EXT-X-STREAM-INF/.test(text)) { target = new URL(items[0]!, base).toString(); continue; }
      const seg = await fetcher(new URL(items[items.length - 1]!, base).toString(), { timeoutMs: 8000, headers: { Range: 'bytes=0-1023' } });
      void seg.body?.cancel();
      return seg.status === 200 || seg.status === 206;
    }
    return false;
  } catch { return false; }
}

const record = (id: string, ok: boolean): Health => (health()[id] = decide(health()[id], ok));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const queue: Channel[] = [];
const queued = new Set<string>();
let running = false;

async function drain(): Promise<void> {
  running = true;
  let done = 0;
  const retry: Channel[] = [];
  const work = async (list: Channel[], again: boolean) => {
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      for (let c = list.shift(); c; c = list.shift()) {
        const h = record(c.id, await probeStream(c.url));
        // One more try at the end of the pass before a channel counts as dead.
        if (!h.ok && again && h.fails < 2) retry.push(c);
        if (++done % 100 === 0) persist();
        await sleep(PAUSE_MS);
      }
    }));
  };
  try { await work(queue, true); await work(retry, false); } finally { persist(); queued.clear(); running = false; }
}

/** Add channels never checked, or whose answer is a day old, to the slow background pass. */
export function scheduleProbes(channels: Channel[]): number {
  let added = 0;
  for (const c of channels) if (!queued.has(c.id) && !isFresh(healthOf(c.id))) { queued.add(c.id); queue.push(c); added++; }
  if (added && !running) void drain();
  return added;
}

/** Test these channels now (an administrator asked), ignoring the day-long memory; a failure is tried twice. */
export async function checkNow(channels: Channel[]): Promise<{ dead: string[]; alive: string[] }> {
  const dead: string[] = [], alive: string[] = [];
  const list = [...channels];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let c = list.shift(); c; c = list.shift()) {
      const ok = (await probeStream(c.url)) || (await probeStream(c.url));
      health()[c.id] = ok ? decide(health()[c.id], true) : { ok: false, fails: 2, at: Date.now() };
      (ok ? alive : dead).push(c.id);
    }
  }));
  persist();
  return { dead, alive };
}
