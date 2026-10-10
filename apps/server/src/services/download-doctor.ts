import type { QBittorrentAdapter } from '@virtuallyview/integrations';
import { all, get, run } from '../db/app-db.js';
import { getAdapter } from './registry.js';
import { getDownloadsDetailed, type QueueItem } from './real-downloads.js';
import { getServerSettings } from './server-settings.js';
import { notify } from './notifications.js';
import { retryDownload } from './retry.js';

/**
 * The download doctor. Public sources are messy, and two things keep going wrong by themselves:
 *
 *  - A release nobody shares any more ("stalled with no connections"). It sits at 0% for ever, and
 *    Radarr, Sonarr and Lidarr never give up on it, so the request never finishes.
 *  - A finished download that cannot be matched to the title ("Couldn't find similar album ...",
 *    "no files found"). It waits in the queue for a person to notice.
 *
 * After a grace period the doctor rejects that release (it is blocklisted, so it is never picked
 * again) and the media manager searches for another. Safety rules keep it from doing harm:
 *
 *  - It never acts while the downloader or its VPN is down: then everything looks stalled and nothing
 *    is the release's fault.
 *  - It never acts on problems a different release cannot fix (full disk, unreadable folder).
 *  - It gives each title at most three replacements a day, then tells an administrator.
 */

export type Trouble = 'stalled' | 'metadata' | 'import' | 'other';
export interface DoctorEntry { id: string; title: string; kind: Trouble; since: string; fixAt: string | null; gaveUp: boolean; needsYou: string | null }

export const GRACE_MINUTES: Record<Trouble, number> = { stalled: 25, metadata: 90, import: 20, other: 60 };
export const MAX_FIXES_PER_DAY = 3;
const TICK_MS = 5 * 60_000;

/** Problems where another release would not help: something on this machine needs a person. */
const ENVIRONMENT_RE = /disk|space|permission|denied|read-only|readonly|no such (file|directory)|mount|path (does not|is not)|not accessible|cannot be written|invalid path|could not be moved|unable to (write|create)|antivirus|timed out|timeout/i;
const METADATA_RE = /downloading metadata/i;

/** What is wrong with a queue row, or null when nothing is. Pure so it can be tested. */
export function classify(row: Pick<QueueItem, 'status' | 'message' | 'progress'>): { kind: Trouble; needsYou: string | null } | null {
  const message = row.message ?? '';
  if (row.status === 'stalled') return { kind: 'stalled', needsYou: null };
  if (METADATA_RE.test(message) && row.progress < 1 && row.status !== 'completed') return { kind: 'metadata', needsYou: null };
  if (row.status === 'failed') {
    if (ENVIRONMENT_RE.test(message)) return { kind: 'other', needsYou: 'This needs something on the server to change (free disk space or folder permissions). Another release would fail the same way.' };
    // A failure with no explanation is the download client's own error state (qBittorrent "error" /
    // "missing files"): almost always a full disk or a folder it cannot write. Treating it as a bad
    // release blocklisted perfectly good downloads, three a day, while the real problem stayed.
    if (!message.trim()) return { kind: 'other', needsYou: 'The download client reports an error with this download, usually a full disk or a folder it cannot write to. Another release would fail the same way.' };
    return { kind: 'import', needsYou: null };
  }
  return null;
}


const titleKey = (row: QueueItem) => (row.mediaId ?? row.title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 80);
const since = (iso: string) => (Date.now() - Date.parse(iso)) / 60_000;

async function downloaderHealthy(): Promise<boolean> {
  try {
    const c = await getAdapter<QBittorrentAdapter>('qbittorrent').connectionStatus();
    return c.status === 'connected';
  } catch { return false; }
}

export interface DoctorResult { fixed: string[]; waiting: number; needsYou: string[]; skippedBecauseOffline: boolean; gaveUp: string[] }
let running = false;

/** One pass over the queue. `force` acts on every troubled download now instead of waiting out the grace period. */
export async function runDoctor(options: { force?: boolean } = {}): Promise<DoctorResult> {
  const result: DoctorResult = { fixed: [], waiting: 0, needsYou: [], skippedBecauseOffline: false, gaveUp: [] };
  if (running) return result;
  running = true;
  try {
    let rows: QueueItem[];
    let answered: Set<string>;
    try { ({ rows, answered } = await getDownloadsDetailed()); } catch { return result; }
    const troubled = rows.map(row => ({ row, c: classify(row) })).filter((x): x is { row: QueueItem; c: NonNullable<ReturnType<typeof classify>> } => x.c !== null);

    // Forget rows that healed or left the queue.
    const live = new Set(troubled.map(t => t.row.id));
    // Only when its own source answered: qBittorrent behind the VPN times out now and then, and treating that
    // as "healed" reset every grace period and dropped the gave-up flag, so nothing ever got replaced.
    for (const stored of all<{ key: string }>('SELECT key FROM download_doctor')) {
      const source = /^queue-([a-z]+)-/.exec(stored.key)?.[1] ?? '';
      if (!live.has(stored.key) && answered.has(source)) run('DELETE FROM download_doctor WHERE key = ?', stored.key);
    }
    if (troubled.length === 0) return result;

    const online = await downloaderHealthy();
    const now = new Date().toISOString();
    for (const { row, c } of troubled) {
      const known = get<{ first_seen: string; gave_up: number }>('SELECT first_seen, gave_up FROM download_doctor WHERE key = ?', row.id);
      if (!known) run('INSERT INTO download_doctor (key, kind, title, first_seen, gave_up) VALUES (?, ?, ?, ?, 0)', row.id, c.kind, row.title.slice(0, 160), now);
      else run('UPDATE download_doctor SET kind = ? WHERE key = ?', c.kind, row.id);
      if (c.needsYou) { result.needsYou.push(row.title); continue; }
      if (known?.gave_up) { result.gaveUp.push(row.title); continue; }
      // While the downloader or its VPN is down, everything stalls: the release is not to blame.
      if (!online && c.kind !== 'import') { result.skippedBecauseOffline = true; continue; }
      const waited = since(known?.first_seen ?? now);
      if (!options.force && waited < GRACE_MINUTES[c.kind]) { result.waiting++; continue; }

      const key = titleKey(row);
      const recent = get<{ n: number }>("SELECT COUNT(*) AS n FROM download_fixes WHERE title_key = ? AND at > ?", key, new Date(Date.now() - 86_400_000).toISOString())?.n ?? 0;
      if (recent >= MAX_FIXES_PER_DAY) {
        run('UPDATE download_doctor SET gave_up = 1 WHERE key = ?', row.id);
        result.gaveUp.push(row.title);
        notify({ type: 'downloads.fixed', role: 'admin', title: `No working copy of "${row.title}" yet`, body: `${MAX_FIXES_PER_DAY} releases were tried today and none worked. Add more search sources, or pick a release by hand from Requests.`, link: '/downloads' });
        continue;
      }
      const outcome = await retryDownload(row.id);
      if (outcome.success) {
        run('INSERT INTO download_fixes (title_key, title, kind, at) VALUES (?, ?, ?, ?)', key, row.title.slice(0, 160), c.kind, now);
        run('DELETE FROM download_doctor WHERE key = ?', row.id);
        result.fixed.push(row.title);
      }
    }

    if (result.fixed.length) {
      const why = (k: string) => (k === 'import' ? 'could not be matched to the title' : 'had nobody sharing it');
      notify({
        type: 'downloads.fixed', role: 'admin',
        title: result.fixed.length === 1 ? `Replaced a download: ${result.fixed[0]}` : `Replaced ${result.fixed.length} downloads that were stuck`,
        body: `${result.fixed.slice(0, 3).join(', ')}${result.fixed.length > 3 ? ' and more' : ''} ${why(troubled[0]?.c.kind ?? 'stalled')}. Each was rejected, so it is not picked again, and a new search has started.`,
        link: '/downloads'
      });
    }
    return result;
  } finally { running = false; }
}

/** What the Downloads page shows next to each troubled row: what is wrong and when it fixes itself. */
export function doctorEntries(): DoctorEntry[] {
  const enabled = getServerSettings().autoFixDownloads;
  return all<{ key: string; kind: Trouble; title: string; first_seen: string; gave_up: number }>('SELECT * FROM download_doctor').map(r => ({
    id: r.key, title: r.title, kind: r.kind, since: r.first_seen, gaveUp: r.gave_up === 1,
    fixAt: enabled && !r.gave_up && r.kind !== 'other' ? new Date(Date.parse(r.first_seen) + GRACE_MINUTES[r.kind] * 60_000).toISOString() : null,
    needsYou: r.kind === 'other' ? 'This needs something on the server to change (free disk space or folder permissions).' : null
  }));
}

export function startDownloadDoctor(): void {
  const tick = () => { if (getServerSettings().autoFixDownloads) void runDoctor().catch(() => undefined); };
  setTimeout(tick, 2 * 60_000).unref();
  setInterval(tick, TICK_MS).unref();
}
