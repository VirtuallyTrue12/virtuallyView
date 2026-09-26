import { all, run } from '../db/app-db.js';
import { currentActor } from './user-context.js';
import type { ServerSettings } from './server-settings.js';

/**
 * "Who changed what": a short, plain-words trail of changes made under Settings. It records what
 * was changed, never the values of anything secret (keys, passwords, webhook addresses).
 */
export interface SettingsChange { id: number; at: string; actor: string; area: string; summary: string }

const KEEP = 300;

export function recordChange(area: string, summary: string): void {
  try {
    const actor = currentActor();
    run('INSERT INTO settings_history (at, actor, area, summary) VALUES (?, ?, ?, ?)', new Date().toISOString(), actor.role === 'system' ? 'the server' : actor.username, area, summary.slice(0, 200));
    run('DELETE FROM settings_history WHERE id NOT IN (SELECT id FROM settings_history ORDER BY id DESC LIMIT ?)', KEEP);
  } catch { /* a history entry must never break a save */ }
}

export function listChanges(limit = 30): SettingsChange[] {
  try {
    return all<SettingsChange>('SELECT id, at, actor, area, summary FROM settings_history ORDER BY id DESC LIMIT ?', Math.min(Math.max(1, Math.trunc(limit) || 30), 100));
  } catch { return []; }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const onOff = (v: boolean) => (v ? 'on' : 'off');

/** What differs between two saved copies of the server settings, in words. */
export function describeSettingsChange(before: ServerSettings, after: ServerSettings): Array<{ area: string; summary: string }> {
  const out: Array<{ area: string; summary: string }> = [];
  const add = (area: string, summary: string) => out.push({ area, summary });
  if (before.serverName !== after.serverName) add('General', `Server name changed to "${after.serverName}"`);
  for (const key of ['movies', 'tv', 'music', 'staging'] as const) {
    if (before.mediaRoots[key] !== after.mediaRoots[key]) add('Folders', `The ${key === 'tv' ? 'TV' : key} folder was changed`);
  }
  if (!same(before.outboundProxy, after.outboundProxy)) add('Network', after.outboundProxy.enabled ? `Outbound proxy turned on (${after.outboundProxy.kind})` : 'Outbound proxy turned off');
  if (!same(before.requests, after.requests)) add('Requests', `Request rules changed (approval ${after.requests.approval === 'users' ? 'required for people' : 'off'}, limit ${after.requests.limit === 0 ? 'none' : `${after.requests.limit} per ${after.requests.window}`})`);
  if (!same(before.defaultQuality, after.defaultQuality)) add('Quality', 'Default download quality changed');
  if (before.autoBackup !== after.autoBackup) add('Backup', `Automatic backups turned ${onOff(after.autoBackup)}`);
  if (before.allowSignup !== after.allowSignup) add('People', `Self sign-up turned ${onOff(after.allowSignup)}`);
  if (before.trustLocalNetwork !== after.trustLocalNetwork) add('Network', `Trusting services on the home network turned ${onOff(after.trustLocalNetwork)}`);
  if (before.publicUrl !== after.publicUrl) add('Network', after.publicUrl ? 'The address for other devices was changed' : 'The address for other devices was cleared');
  if (before.logLevel !== after.logLevel) add('System', `Log level set to ${after.logLevel}`);
  if (before.coverSource !== after.coverSource) add('System', `Cover art source set to ${after.coverSource}`);
  const b = before.notifications.channels.length, a = after.notifications.channels.length;
  if (a !== b) add('Notifications', a > b ? `A notification channel was added (${a} now)` : `A notification channel was removed (${a} now)`);
  else if (!same(before.notifications, after.notifications)) add('Notifications', 'A notification channel was changed');
  return out;
}

export function recordSettingsDiff(before: ServerSettings, after: ServerSettings): void {
  for (const c of describeSettingsChange(before, after)) recordChange(c.area, c.summary);
}
