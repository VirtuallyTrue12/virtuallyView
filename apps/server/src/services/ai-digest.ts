import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/paths.js';
import { getRequests, type RequestItem } from './requests.js';
import { getDownloads } from './real-downloads.js';
import { notify } from './notifications.js';

// A periodic natural-language summary of what happened - new titles ready to
// watch, anything stuck - instead of a stream of one-line-per-event
// notifications, or none at all if the user never checks the requests page.

const FILE = resolve(DATA_DIR, 'ai-digest.json');
const INTERVAL_MS = 6 * 3_600_000;

function lastRunAt(): number {
  try {
    if (!existsSync(FILE)) return 0;
    return (JSON.parse(readFileSync(FILE, 'utf8')) as { at?: number }).at ?? 0;
  } catch {
    return 0;
  }
}

function saveRunAt(at: number): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify({ at }), { encoding: 'utf8', mode: 0o600 });
}

const list = (titles: string[]): string =>
  titles.length <= 3
    ? titles.join(', ').replace(/, ([^,]*)$/, ' and $1')
    : `${titles.slice(0, 2).join(', ')} and ${titles.length - 2} more`;

/** Builds one digest, or null when nothing worth mentioning happened since the last one. */
export async function buildDigest(sinceMs: number): Promise<{ title: string; body: string } | null> {
  let requests: RequestItem[];
  try { requests = getRequests(); } catch { requests = []; }
  const downloads = await getDownloads().catch(() => []);

  const since = new Date(sinceMs).toISOString();
  const newlyAvailable = requests.filter(r => r.status === 'available' && r.updatedAt > since);
  const newlyFailed = requests.filter(r => r.status === 'failed' && r.updatedAt > since);
  const activeDownloads = downloads.filter(d => ['downloading', 'importing', 'queued'].includes(d.status));
  const failedDownloads = downloads.filter(d => d.status === 'failed');

  if (!newlyAvailable.length && !newlyFailed.length && !failedDownloads.length) return null;

  const sentences: string[] = [];
  if (newlyAvailable.length) {
    const noun = newlyAvailable.length === 1 ? 'One title is' : `${newlyAvailable.length} titles are`;
    sentences.push(`${noun} now ready to watch: ${list(newlyAvailable.map(r => r.title))}.`);
  }
  if (newlyFailed.length) {
    const noun = newlyFailed.length === 1 ? 'This one needs attention' : 'These need attention';
    sentences.push(`${noun}: ${list(newlyFailed.map(r => r.title))}.`);
  }
  if (failedDownloads.length) {
    sentences.push(`${failedDownloads.length} download${failedDownloads.length === 1 ? '' : 's'} failed and ${failedDownloads.length === 1 ? 'is' : 'are'} sitting in the queue.`);
  }
  if (activeDownloads.length) {
    sentences.push(`${activeDownloads.length} download${activeDownloads.length === 1 ? ' is' : 's are'} in progress right now.`);
  }

  return { title: 'Since you were last here', body: sentences.join(' ') };
}

async function tick(): Promise<void> {
  const since = lastRunAt();
  if (since && Date.now() - since < INTERVAL_MS) return;
  const from = since || Date.now() - INTERVAL_MS;
  try {
    const digest = await buildDigest(from);
    if (digest) notify({ type: 'ai.digest', role: 'admin', title: digest.title, body: digest.body, link: '/requests' });
  } finally {
    saveRunAt(Date.now());
  }
}

export function startAiDigest(): void {
  setTimeout(() => void tick(), 90_000).unref();
  setInterval(() => void tick(), 3_600_000).unref();
}
