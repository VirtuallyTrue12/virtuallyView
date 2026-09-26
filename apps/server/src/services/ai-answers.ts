import type { BazarrAdapter, ProwlarrAdapter } from '@virtuallyview/integrations';
import { getAdapter, getManagedAdapters } from './registry.js';
import { getDownloads, actOnDownload, type QueueItem } from './real-downloads.js';
import { getRequests } from './requests.js';
import { retryDownload, retryTitle } from './retry.js';
import { listThemes } from './themes.js';
import { bestMatch, HELP_TEXT, type Intent } from './ai-router.js';
import type { AgentReply } from './ai.js';
import { currentActor } from './user-context.js';

const say = (text: string): AgentReply => ({ kind: 'message', text });
const ADMIN_ONLY = 'Only an administrator can do that. Ask the person who runs this server.';
const isAdminUser = () => currentActor().role !== 'user';
const NAMES: Record<string, string> = {
  radarr: 'Radarr (movies)', sonarr: 'Sonarr (TV)', lidarr: 'Lidarr (music)', prowlarr: 'Prowlarr (indexers)',
  bazarr: 'Bazarr (subtitles)', qbittorrent: 'qBittorrent (downloads)', nzbget: 'NZBGet (downloads)'
};

async function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

async function downloadsOrNull(): Promise<QueueItem[] | null> {
  try { return await getDownloads(); } catch { return null; }
}

const line = (d: QueueItem) => `- ${d.title}${d.qualityLabel ? ` (${d.qualityLabel})` : ''}`;

export async function answerDownloads(): Promise<AgentReply> {
  const rows = await downloadsOrNull();
  if (!rows) return say('I cannot reach the download services right now. Ask me "what is wrong?" and I will check which one is down.');
  const active = rows.filter(r => ['downloading', 'queued', 'importing'].includes(r.status));
  const failed = rows.filter(r => r.status === 'failed');
  const paused = rows.filter(r => r.status === 'paused');
  const done = rows.filter(r => r.status === 'completed').length;
  if (!active.length && !failed.length && !paused.length) {
    return say(done ? `Nothing is downloading. ${done} download${done === 1 ? '' : 's'} finished.` : 'Nothing is downloading and the queue is empty.');
  }
  const out: string[] = [];
  if (active.length) out.push(`Downloading now (${active.length}):`, ...active.map(d => `${line(d)} ${Math.round(d.progress)}%${d.eta ? `, ${d.eta} left` : ''}${d.speed ? `, ${d.speed}` : ''}`));
  if (paused.length) out.push(`Paused (${paused.length}):`, ...paused.map(d => `${line(d)} ${Math.round(d.progress)}%`));
  if (failed.length) out.push(`Needs attention (${failed.length}):`, ...failed.map(d => `${line(d)}${d.message ? `: ${d.message}` : ''}`));
  if (done) out.push(`${done} more finished.`);
  if (!active.length && failed.length) out.push('Say "retry <name>" to reject a bad release and search for another.');
  return say(out.join('\n'));
}

export async function answerDiagnose(subject?: string): Promise<AgentReply> {
  const issues: string[] = [];
  const managed = getManagedAdapters();
  await Promise.all(Object.entries(managed).map(async ([key, adapter]) => {
    const health = await within(adapter.healthCheck().catch(() => ({ healthy: false, status: 'unreachable' })), 4000, { healthy: false, status: 'timed out' });
    if (!health.healthy && health.status !== 'disabled') {
      issues.push(`${NAMES[key] ?? key} is not responding (${health.status}). Fix: open Settings > Services, check the address and key, or run "docker compose up -d".`);
    }
  }));

  const rows = await downloadsOrNull();
  const failed = rows?.filter(r => r.status === 'failed') ?? [];
  const related = subject ? failed.filter(r => bestMatch(subject, [r], i => `${i.title} ${i.rawTitle ?? ''}`)) : [];
  const shown = related.length ? related : failed;
  // The same reason repeated is one problem: group by reason and list a few names.
  const byReason = new Map<string, QueueItem[]>();
  for (const row of shown) byReason.set(row.message ?? 'The download failed.', [...(byReason.get(row.message ?? 'The download failed.') ?? []), row]);
  for (const [reason, group] of byReason) {
    const names = group.slice(0, 3).map(r => r.title).join('; ') + (group.length > 3 ? `; and ${group.length - 3} more` : '');
    issues.push(`${group.length === 1 ? '1 download' : `${group.length} downloads`} did not import: ${reason.replace(/\.$/, '')}. (${names}). Fix: say "retry ${group[0]!.title}" or use Retry on the Downloads page.`);
  }
  if (related.length === 0 && failed.length > shown.length) issues.push(`${failed.length - shown.length} other downloads also failed.`);
  for (const request of getRequests().filter(r => r.status === 'failed' && r.message).slice(0, 5)) {
    issues.push(`Request "${request.title}" failed: ${String(request.message).replace(/\.$/, '')}.`);
  }

  try {
    const indexers = await within(getAdapter<ProwlarrAdapter>('prowlarr').listIndexers(), 4000, null);
    if (indexers && indexers.length === 0) issues.push('No indexers are set up, so searches find nothing. Fix: Settings > Search sources > add public sources.');
  } catch { /* Prowlarr offline is reported above */ }
  try {
    const bazarr = getAdapter<BazarrAdapter>('bazarr');
    const health = await within(bazarr.healthCheck(), 3000, { healthy: false, status: 'timed out' });
    if (!health.healthy && health.status === 'setup_required') issues.push('Bazarr is not connected, so no subtitles are downloaded. Fix: Settings > Services > Bazarr.');
  } catch { /* not configured */ }

  let about = '';
  if (subject) {
    const found = await describeTitle(subject, rows ?? []);
    if (found) about = found;
  }
  const head = issues.length ? `I found ${issues.length} thing${issues.length === 1 ? '' : 's'} to fix:` : 'Everything I can check looks healthy: services answer, no failed downloads, no failed requests.';
  return say([about, head, ...issues.map(i => `- ${i}`)].filter(Boolean).join('\n'));
}

/** What the library knows about a title the person asked about. */
async function describeTitle(subject: string, rows: QueueItem[]): Promise<string> {
  const pools: Array<{ key: 'radarr' | 'sonarr' | 'lidarr'; label: string }> = [
    { key: 'radarr', label: 'movie' }, { key: 'sonarr', label: 'show' }, { key: 'lidarr', label: 'artist' }
  ];
  for (const pool of pools) {
    let items: Array<Record<string, unknown> & { id: string; title: string }> = [];
    try { items = (await getAdapter(pool.key).getItems()) as unknown as typeof items; } catch { continue; }
    const hit = bestMatch(subject, items, i => i.title);
    if (!hit) continue;
    const queue = rows.filter(r => r.mediaId === hit.id || r.title.toLowerCase().includes(hit.title.toLowerCase()));
    const bits: string[] = [];
    if (pool.label === 'artist') {
      const have = Number(hit.trackFileCount ?? 0), total = Number(hit.totalTrackCount ?? 0);
      bits.push(`${hit.title} has ${have} of ${total} tracks on disk.`);
    } else if (pool.label === 'show') {
      const have = Number(hit.episodeFileCount ?? 0);
      bits.push(`${hit.title} has ${have} episode${have === 1 ? '' : 's'} on disk.`);
    } else {
      bits.push(`${hit.title} is ${hit.status === 'available' ? 'in the library with a file' : 'in the library but has no file yet'}.`);
    }
    const bad = queue.filter(r => r.status === 'failed');
    const complete = pool.label === 'artist' && Number(hit.totalTrackCount ?? 0) > 0 && Number(hit.trackFileCount ?? 0) >= Number(hit.totalTrackCount ?? 0);
    if (bad.length === 1) bits.push(`Its download "${bad[0]!.title}" is stuck${bad[0]!.message ? `: ${bad[0]!.message.replace(/\.$/, '')}` : ''}.`);
    else if (bad.length > 1) bits.push(`${bad.length} of its downloads did not import.`);
    if (bad.length && complete) bits.push('Every track is already in the library, so those stuck downloads can simply be removed from the Downloads page.');
    else if (queue.some(r => ['downloading', 'queued'].includes(r.status))) bits.push('A download is still running.');
    else if (!bad.length && !/with a file|of \d+ tracks on disk|episodes? on disk/.test(bits[0] ?? '')) bits.push('Nothing is downloading for it. Say "retry" to search again.');
    return bits.join(' ');
  }
  return '';
}

export async function answerRetry(subject: string): Promise<AgentReply> {
  if (!isAdminUser()) return say(ADMIN_ONLY);
  if (!subject) return say('Which one? Say for example "retry Mr Robot" or "retry Linkin Park".');
  const rows = await downloadsOrNull();
  const failed = rows?.filter(r => r.status === 'failed') ?? [];
  const download = bestMatch(subject, failed, r => r.title);
  if (download) return say((await retryDownload(download.id)).message);
  for (const key of ['radarr', 'sonarr', 'lidarr'] as const) {
    try {
      const items = (await getAdapter(key).getItems()) as unknown as Array<{ id: string; title: string }>;
      const hit = bestMatch(subject, items, i => i.title);
      if (hit) {
        const result = await retryTitle(hit.id);
        return say(result.success ? `${hit.title}: ${result.message}` : `${hit.title}: ${result.message}`);
      }
    } catch { /* service offline: try the next */ }
  }
  return say(`I could not find "${subject}" in your library. Check the spelling, or request it first.`);
}

export async function answerDownloadAction(action: 'pause' | 'resume' | 'remove', subject: string): Promise<AgentReply> {
  if (!isAdminUser()) return say(ADMIN_ONLY);
  const rows = await downloadsOrNull();
  const hit = rows ? bestMatch(subject, rows, r => `${r.title} ${r.rawTitle ?? ''}`) : undefined;
  if (!hit) return say(`I could not find a download matching "${subject}". Ask "what is downloading?" to see the names.`);
  if (action === 'remove') {
    return { kind: 'confirmation', tool: 'remove_download', arguments: { download_id: hit.id }, description: `Remove "${hit.title}" from the download queue` };
  }
  const result = await actOnDownload(hit.id, action);
  return say(result.success ? `${action === 'pause' ? 'Paused' : 'Resumed'} ${hit.title}.` : `Could not ${action} it: ${result.message}`);
}

export async function answerRequests(): Promise<AgentReply> {
  const requests = getRequests().slice(0, 12);
  if (!requests.length) return say('There are no requests yet.');
  return say(['Requests:', ...requests.map(r => `- ${r.title}${r.year ? ` (${r.year})` : ''}: ${r.status}${r.progress ? ` ${r.progress}%` : ''}${r.status === 'failed' && r.message ? ` (${r.message})` : ''}`)].join('\n'));
}

export async function answerLibrary(): Promise<AgentReply> {
  const parts: string[] = [];
  for (const [key, noun] of [['radarr', 'movies'], ['sonarr', 'TV shows'], ['lidarr', 'artists']] as const) {
    try {
      const items = (await getAdapter(key).getItems()) as Array<{ status?: string }>;
      const have = items.filter(i => i.status === 'available').length;
      parts.push(`${items.length} ${noun} (${have} with files)`);
    } catch {
      parts.push(`${noun}: service not reachable`);
    }
  }
  return say(`Your library: ${parts.join(', ')}.`);
}

export async function answerSubtitles(subject?: string): Promise<AgentReply> {
  try {
    const missing = await getAdapter<BazarrAdapter>('bazarr').getMissingSubtitles();
    const list = subject ? missing.filter(m => bestMatch(subject, [m], i => i.title)) : missing;
    if (!list.length) return say(subject ? `No missing subtitles found for "${subject}".` : 'Nothing is missing subtitles.');
    return say([`Missing subtitles (${list.length}):`, ...list.slice(0, 15).map(i => `- ${i.title}: ${i.missingLanguages.join(', ') || 'unknown language'}`), 'Open the title and use Subtitles > Search, or upload a file yourself.'].join('\n'));
  } catch {
    return say('Subtitles are handled by Bazarr and it is not connected. Open Settings > Services > Bazarr to connect it.');
  }
}

export async function answerThemes(name?: string): Promise<AgentReply> {
  const themes = listThemes().map(t => t.manifest);
  if (name && !isAdminUser()) return say(ADMIN_ONLY);
  if (!name) return say(`Installed themes: ${themes.map(t => t.name).join(', ')}. Say "switch to <name>" to change the server default.`);
  const hit = bestMatch(name, themes, t => `${t.name} ${t.id}`);
  if (!hit) return say(`No theme called "${name}". Installed: ${themes.map(t => t.name).join(', ')}.`);
  return { kind: 'confirmation', tool: 'change_theme', arguments: { theme_id: hit.id }, description: `Switch the server default theme to ${hit.name}` };
}

export function answerHelp(): AgentReply {
  return say(HELP_TEXT);
}

export async function answerIntent(intent: Intent): Promise<AgentReply | null> {
  switch (intent.kind) {
    case 'help': return answerHelp();
    case 'downloads': return answerDownloads();
    case 'diagnose': return answerDiagnose(intent.subject);
    case 'library': return answerLibrary();
    case 'requests': return answerRequests();
    case 'retry': return answerRetry(intent.subject);
    case 'download-action': return answerDownloadAction(intent.action, intent.subject);
    case 'subtitles': return answerSubtitles(intent.subject);
    case 'themes': return answerThemes(intent.name);
    case 'request':
      return {
        kind: 'confirmation',
        tool: intent.mediaType === 'series' ? 'request_series' : intent.mediaType === 'artist' ? 'request_artist' : 'request_movie',
        arguments: { title: intent.title },
        description: `Request the ${intent.mediaType === 'series' ? 'TV show' : intent.mediaType} "${intent.title}"`
      };
  }
}
