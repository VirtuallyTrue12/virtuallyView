// Saved-for-offline library on this device. The index lives in IndexedDB, the files in the Origin Private
// File System (or Cache Storage where OPFS is missing), and watch progress made offline waits in IndexedDB
// until the phone is back online. Nothing here needs the server to read what is already saved.

import type { OfflineQuality } from './offline-plan';

export type OfflineKind = 'movie' | 'episode' | 'track';

export interface SavedItem {
  key: string;
  kind: OfflineKind;
  id: string;
  title: string;
  subtitle?: string;
  posterBlob?: Blob;
  size: number;
  savedAt: number;
  fileName: string;
  vttName?: string;
  seriesId?: string;
  durationSeconds?: number | null;
  quality?: OfflineQuality;
}

export interface LocalProgress {
  key: string;
  mediaType: 'movie' | 'episode';
  mediaId: string;
  positionSeconds: number;
  durationSeconds: number;
  seriesId?: string;
  updatedAt: number;
  synced: boolean;
}

const DB_NAME = 'vv-offline';
const DB_VERSION = 1;
const ITEMS = 'items';
const PROGRESS = 'progress';
const FILES_CACHE = 'vv-offline-files';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ITEMS)) db.createObjectStore(ITEMS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(PROGRESS)) db.createObjectStore(PROGRESS, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { dbPromise = null; reject(request.error); };
    });
  }
  return dbPromise;
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await openDb()).transaction(name, mode).objectStore(name);
}

/** Every saved item, newest first. */
export async function listSaved(): Promise<SavedItem[]> {
  const items = await req<SavedItem[]>((await store(ITEMS, 'readonly')).getAll());
  return items.sort((a, b) => b.savedAt - a.savedAt);
}

export async function getSaved(key: string): Promise<SavedItem | undefined> {
  return req<SavedItem | undefined>((await store(ITEMS, 'readonly')).get(key));
}

async function putSaved(item: SavedItem): Promise<void> {
  await req((await store(ITEMS, 'readwrite')).put(item));
}

/** The offline key for one item. A movie or episode is saved once, at the quality it was saved in. */
export const keyFor = (kind: OfflineKind, id: string) => `${kind}:${id}`;

// -- Files ---------------------------------------------------------------------

async function opfsDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (!navigator.storage?.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle('offline', { create: true });
  } catch {
    return null;
  }
}

const cacheUrl = (fileName: string) => `/offline-files/${encodeURIComponent(fileName)}`;

/** Where the bytes of a saved file live: OPFS first, then Cache Storage. */
async function openCache(): Promise<Cache | null> {
  try { return await caches.open(FILES_CACHE); } catch { return null; }
}

/** Writes a finished download. Chunks are written as they arrive, so a big film never sits whole in memory on OPFS. */
async function writeStream(fileName: string, chunks: AsyncIterable<Uint8Array>, mime: string): Promise<number> {
  const dir = await opfsDir();
  if (dir) {
    const handle = await dir.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    let size = 0;
    try {
      for await (const chunk of chunks) { await writable.write(chunk as unknown as BufferSource); size += chunk.byteLength; }
      await writable.close();
    } catch (err) {
      await writable.abort().catch(() => undefined);
      throw err;
    }
    return size;
  }
  const cache = await openCache();
  if (!cache) throw new Error('This browser cannot keep files on this device.');
  const parts: BlobPart[] = [];
  let size = 0;
  for await (const chunk of chunks) { parts.push(chunk as unknown as BlobPart); size += chunk.byteLength; }
  await cache.put(cacheUrl(fileName), new Response(new Blob(parts, { type: mime })));
  return size;
}

/** A saved file as a Blob, or null when it is gone (for example after the browser cleared site data). */
export async function readFile(fileName: string): Promise<Blob | null> {
  const dir = await opfsDir();
  if (dir) {
    try { return await (await dir.getFileHandle(fileName)).getFile(); } catch { /* try the cache */ }
  }
  const cache = await openCache();
  const hit = cache ? await cache.match(cacheUrl(fileName)) : undefined;
  return hit ? hit.blob() : null;
}

async function removeFile(fileName: string): Promise<void> {
  const dir = await opfsDir();
  if (dir) { try { await dir.removeEntry(fileName); } catch { /* already gone */ } }
  const cache = await openCache();
  if (cache) await cache.delete(cacheUrl(fileName));
}

/** Streams a URL to the device. `onProgress` gets a 0..1 fraction (or stays at 0 when the size is unknown). */
export async function downloadTo(url: string, fileName: string, mime: string, onProgress?: (fraction: number) => void): Promise<number> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok || !res.body) throw new Error('The file could not be downloaded.');
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  let received = 0;
  async function* chunks(): AsyncGenerator<Uint8Array> {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      received += value.byteLength;
      if (total > 0) onProgress?.(Math.min(1, received / total));
      yield value;
    }
  }
  return writeStream(fileName, chunks(), mime);
}

// -- Saving and removing -------------------------------------------------------

/** Asks the browser not to evict saved downloads under storage pressure. Returns whether it agreed. */
export async function persist(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) === true; } catch { return false; }
}

/** Bytes in use and the browser's quota for this site, when the browser reports them. */
export async function estimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e && e.quota ? { usage: e.usage ?? 0, quota: e.quota } : null;
  } catch {
    return null;
  }
}

/** A plain warning when `bytes` would not fit in what the browser lets this site keep, otherwise null. */
export async function spaceWarning(bytes: number | null): Promise<string | null> {
  const e = await estimate();
  if (!e || !bytes) return null;
  const free = e.quota - e.usage;
  return bytes > free ? `This needs about ${formatBytes(bytes)} but only ${formatBytes(Math.max(0, free))} is free on this device. Delete something or pick Smaller.` : null;
}

/** Saves one item's index entry (the file and subtitles are already on the device). */
export async function saveIndex(item: SavedItem): Promise<void> {
  await putSaved(item);
}

/** Deletes an item's file, subtitles and index entry. */
export async function deleteSaved(key: string): Promise<void> {
  const item = await getSaved(key);
  if (!item) return;
  await removeFile(item.fileName);
  if (item.vttName) await removeFile(item.vttName);
  await req((await store(ITEMS, 'readwrite')).delete(key));
}

// -- Local watch progress ------------------------------------------------------

/** Saves where the viewer got to. It is sent to the server once the device is online again. */
export async function recordProgress(p: { mediaType: 'movie' | 'episode'; mediaId: string; positionSeconds: number; durationSeconds: number; seriesId?: string }): Promise<void> {
  const key = `${p.mediaType}:${p.mediaId}`;
  await req((await store(PROGRESS, 'readwrite')).put({ ...p, key, updatedAt: Date.now(), synced: false } satisfies LocalProgress));
}

export async function localProgressFor(mediaType: 'movie' | 'episode', mediaId: string): Promise<LocalProgress | undefined> {
  return req<LocalProgress | undefined>((await store(PROGRESS, 'readonly')).get(`${mediaType}:${mediaId}`));
}

/** Sends every unsent progress entry to the server. Silent when offline or when a send fails (it is tried again later). */
export async function syncProgress(): Promise<number> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
  const pending = (await req<LocalProgress[]>((await store(PROGRESS, 'readonly')).getAll())).filter(p => !p.synced);
  let sent = 0;
  for (const p of pending) {
    try {
      const res = await fetch(`/api/progress/${p.mediaType}/${encodeURIComponent(p.mediaId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionSeconds: p.positionSeconds, durationSeconds: p.durationSeconds, ...(p.seriesId ? { seriesId: p.seriesId } : {}) })
      });
      if (!res.ok) continue;
      await req((await store(PROGRESS, 'readwrite')).put({ ...p, synced: true }));
      sent++;
    } catch {
      return sent;
    }
  }
  return sent;
}

// -- Save flow -----------------------------------------------------------------

export type SavePhase = { phase: 'preparing'; percent: number } | { phase: 'saving'; percent: number };

interface PrepareResponse { jobId: string; status: string; percent: number; size?: number; hasSubtitles: boolean; message?: string }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Asks the server to convert the item, waits for it, then copies the file and subtitles onto this device. */
export async function saveForOffline(
  meta: { kind: OfflineKind; id: string; title: string; subtitle?: string; posterUrl?: string; seriesId?: string; durationSeconds?: number | null; quality?: OfflineQuality },
  onPhase: (state: SavePhase) => void
): Promise<SavedItem> {
  // Asked for on the first download, so the browser is less likely to clear saved films under storage pressure.
  void persist();
  const prep = await fetch('/api/offline/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: meta.kind, id: meta.id, quality: meta.quality ?? 'standard' })
  });
  const started = (await prep.json().catch(() => ({}))) as Partial<PrepareResponse> & { message?: string };
  if (!prep.ok || !started.jobId) throw new Error(started.message ?? 'This could not be saved right now.');

  let job: PrepareResponse = started as PrepareResponse;
  onPhase({ phase: 'preparing', percent: job.percent ?? 0 });
  while (job.status !== 'ready') {
    if (job.status === 'failed') throw new Error(job.message ?? 'This could not be saved.');
    await sleep(1500);
    const poll = await fetch(`/api/offline/jobs/${encodeURIComponent(job.jobId)}`);
    if (!poll.ok) throw new Error('The download was lost. Try again.');
    job = (await poll.json()) as PrepareResponse;
    if (job.status !== 'ready') onPhase({ phase: 'preparing', percent: job.percent ?? 0 });
  }

  const ext = meta.kind === 'track' ? 'm4a' : 'mp4';
  const fileName = `${keyFor(meta.kind, meta.id).replace(/[^a-z0-9]+/gi, '_')}.${ext}`;
  const size = await downloadTo(`/api/offline/file/${encodeURIComponent(job.jobId)}`, fileName, meta.kind === 'track' ? 'audio/mp4' : 'video/mp4', fraction => {
    onPhase({ phase: 'saving', percent: Math.round(fraction * 100) });
  });

  let vttName: string | undefined;
  if (job.hasSubtitles) {
    try {
      vttName = `${fileName}.vtt`;
      await downloadTo(`/api/offline/subtitle/${encodeURIComponent(job.jobId)}`, vttName, 'text/vtt');
    } catch {
      vttName = undefined;
    }
  }

  let posterBlob: Blob | undefined;
  if (meta.posterUrl) {
    try {
      const res = await fetch(meta.posterUrl);
      if (res.ok) posterBlob = await res.blob();
    } catch { /* a poster is decoration; the list shows a placeholder without one */ }
  }

  const item: SavedItem = {
    key: keyFor(meta.kind, meta.id), kind: meta.kind, id: meta.id, title: meta.title,
    ...(meta.subtitle ? { subtitle: meta.subtitle } : {}),
    ...(posterBlob ? { posterBlob } : {}),
    size, savedAt: Date.now(), fileName,
    ...(vttName ? { vttName } : {}),
    ...(meta.seriesId ? { seriesId: meta.seriesId } : {}),
    durationSeconds: meta.durationSeconds ?? null,
    ...(meta.kind !== 'track' ? { quality: meta.quality ?? 'standard' } : {})
  };
  await putSaved(item);
  return item;
}

/** Human size, such as "1.4 GB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
