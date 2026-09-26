import type { ProwlarrAdapter } from '@virtuallyview/integrations';
import { getAdapter, getManagedAdapters } from './registry.js';
import { getServerSettings } from './server-settings.js';
import { listUsers } from './auth.js';
import { listBackups } from './backup.js';
import { listChanges } from './settings-history.js';

/**
 * Everything the Settings home needs in one answer: how healthy each area is, and what a
 * person could do next, so nobody has to open every page to find out what is missing.
 */
export type Tone = 'ok' | 'warn' | 'bad' | 'off';
export interface AreaSummary { id: string; tone: Tone; line: string }
export interface Suggestion { id: string; title: string; detail: string; section: string; tone: 'warn' | 'info' }
export interface SettingsOverview {
  serverName: string;
  areas: AreaSummary[];
  suggestions: Suggestion[];
  changes: ReturnType<typeof listChanges>;
}

const bounded = <T>(work: Promise<T>, ms = 4000): Promise<T> => Promise.race([work, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))]);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function buildOverview(): Promise<SettingsOverview> {
  const settings = getServerSettings();
  const adapters = getManagedAdapters();
  const keys = Object.keys(adapters);
  const statuses = await Promise.all(keys.map(async key => {
    try { return { key, online: (await bounded(adapters[key]!.getStatus())).healthStatus === 'online' }; } catch { return { key, online: false }; }
  }));
  const online = statuses.filter(s => s.online).length;
  const down = statuses.filter(s => !s.online).map(s => s.key);

  let indexers: number | null = null;
  try { indexers = (await bounded((getAdapter('prowlarr') as unknown as ProwlarrAdapter).listIndexers())).length; } catch { /* Search service is not reachable */ }

  const users = listUsers();
  const admins = users.filter(u => u.role === 'admin').length;
  const backups = listBackups();
  const lastBackup = backups.map(b => b.createdAt).sort().at(-1);
  const channels = settings.notifications.channels.length;

  const areas: AreaSummary[] = [
    { id: 'services', tone: keys.length === 0 ? 'off' : online === keys.length ? 'ok' : online === 0 ? 'bad' : 'warn', line: keys.length === 0 ? 'No services yet' : `${online} of ${keys.length} running` },
    { id: 'sources', tone: indexers === null ? 'bad' : indexers === 0 ? 'warn' : 'ok', line: indexers === null ? 'Search service not answering' : indexers === 0 ? 'No search sources yet' : plural(indexers, 'search source') },
    { id: 'people', tone: 'ok', line: `${plural(users.length, 'person', 'people')}${admins ? `, ${plural(admins, 'administrator')}` : ''}${settings.allowSignup ? ', sign-up open' : ''}` },
    { id: 'notifications', tone: channels ? 'ok' : 'off', line: channels ? plural(channels, 'channel') : 'Bell only' },
    { id: 'backup', tone: settings.autoBackup ? (lastBackup ? 'ok' : 'warn') : 'warn', line: settings.autoBackup ? (lastBackup ? `Automatic, last ${new Date(lastBackup).toLocaleDateString()}` : 'Automatic, none made yet') : 'Manual only' },
    { id: 'network', tone: settings.outboundProxy.enabled ? 'ok' : 'off', line: settings.publicUrl ? 'Address for other devices set' : settings.outboundProxy.enabled ? `Proxy on (${settings.outboundProxy.kind})` : 'Direct connection' }
  ];

  const suggestions: Suggestion[] = [];
  if (down.length) suggestions.push({ id: 'services-down', title: `${plural(down.length, 'service')} not answering`, detail: 'Downloads and search depend on these. The health check shows what to try.', section: 'health', tone: 'warn' });
  if (indexers === 0) suggestions.push({ id: 'no-sources', title: 'Add somewhere to search', detail: 'Without search sources, requests find nothing to download.', section: 'sources', tone: 'warn' });
  if (!lastBackup) suggestions.push({ id: 'no-backup', title: 'Make your first backup', detail: 'One click saves accounts, history and settings.', section: 'backup', tone: 'info' });
  if (!channels) suggestions.push({ id: 'no-alerts', title: 'Get told when a download finishes', detail: 'Send alerts to your phone with ntfy, Telegram or Discord.', section: 'notifications', tone: 'info' });
  if (users.length === 1) suggestions.push({ id: 'one-person', title: 'Invite someone', detail: 'Create an account for family or friends, with their own list and age limit.', section: 'people', tone: 'info' });
  if (!settings.publicUrl) suggestions.push({ id: 'no-address', title: 'Set the address other devices use', detail: 'Makes the TV and phone sign-in links show the right address.', section: 'network', tone: 'info' });

  return { serverName: settings.serverName, areas, suggestions, changes: listChanges(12) };
}
