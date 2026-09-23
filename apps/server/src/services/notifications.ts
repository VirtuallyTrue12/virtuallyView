import nodemailer from 'nodemailer';
import { all, run } from '../db/app-db.js';
import { getServerSettings, type NotificationChannel } from './server-settings.js';
import { currentActor, type Actor } from './user-context.js';

export const EVENTS = [
  { key: 'request.pending', label: 'A request needs approval' },
  { key: 'request.approved', label: 'A request was approved' },
  { key: 'request.declined', label: 'A request was declined' },
  { key: 'request.available', label: 'A request is ready to watch' },
  { key: 'request.failed', label: 'A request failed' },
  { key: 'user.signup', label: 'Someone created an account' },
  { key: 'backup', label: 'A backup finished or failed' },
  { key: 'ai.digest', label: 'Assistant activity summary (every few hours, only when something happened)' }
] as const;

export interface NotifyInput {
  type: (typeof EVENTS)[number]['key'];
  title: string;
  body?: string;
  link?: string;
  /** Show to one user. Omit both to show to everyone; use role for all administrators. */
  userId?: string;
  role?: 'admin';
}

interface Row { id: number; type: string; title: string; body: string; link: string; created_at: string }

/** Record a notification for the in-app bell and send it to every enabled channel that listens for it. */
export function notify(input: NotifyInput): void {
  try {
    run(
      'INSERT INTO notifications (audience_user, audience_role, type, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      input.userId ?? null, input.role ?? null, input.type, input.title, input.body ?? '', input.link ?? '', new Date().toISOString()
    );
    // Keep the table small: the newest 500 are plenty.
    run('DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT 500)');
  } catch { /* a notification must never break the action that caused it */ }
  for (const channel of getServerSettings().notifications.channels) {
    if (channel.enabled && channel.events.includes(input.type)) void deliver(channel, input).catch(() => {});
  }
}

const visible = (a: Actor) =>
  `(audience_user = '${a.userId.replace(/'/g, "''")}' OR (audience_user IS NULL AND (audience_role IS NULL${a.role !== 'user' ? " OR audience_role = 'admin'" : ''})))`;

export function listNotifications(limit = 30) {
  const a = currentActor();
  const rows = all<Row & { read: number }>(
    `SELECT n.*, EXISTS(SELECT 1 FROM notification_reads r WHERE r.user_id = ? AND r.notification_id = n.id) AS read
     FROM notifications n WHERE ${visible(a)} ORDER BY n.id DESC LIMIT ?`,
    a.userId, limit
  );
  return {
    unread: rows.filter(r => !r.read).length,
    items: rows.map(r => ({ id: r.id, type: r.type, title: r.title, body: r.body, link: r.link, createdAt: r.created_at, read: !!r.read }))
  };
}

export function markRead(ids: number[] | 'all'): void {
  const a = currentActor();
  const targets = ids === 'all'
    ? all<{ id: number }>(`SELECT id FROM notifications WHERE ${visible(a)}`).map(r => r.id)
    : ids;
  for (const id of targets) {
    run('INSERT OR IGNORE INTO notification_reads (user_id, notification_id) VALUES (?, ?)', a.userId, id);
  }
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`The service answered ${res.status}.`);
}

/** Send one message to one channel. Throws with a readable message when the channel rejects it. */
export async function deliver(channel: NotificationChannel, n: Pick<NotifyInput, 'title' | 'body' | 'link' | 'type'>): Promise<void> {
  const c = channel.config;
  const text = [n.title, n.body].filter(Boolean).join('\n') + (n.link && c.baseUrl ? `\n${c.baseUrl}${n.link}` : '');
  switch (channel.kind) {
    case 'discord': return post(c.url ?? '', { content: text.slice(0, 1900) });
    case 'slack': return post(c.url ?? '', { text });
    case 'telegram': return post(`https://api.telegram.org/bot${c.token ?? ''}/sendMessage`, { chat_id: c.chatId, text });
    case 'ntfy': return post(c.url ?? '', n.body || n.title, { Title: n.title, ...(c.token ? { Authorization: `Bearer ${c.token}` } : {}) });
    case 'gotify': return post(`${(c.url ?? '').replace(/\/$/, '')}/message?token=${encodeURIComponent(c.token ?? '')}`, { title: n.title, message: n.body || n.title });
    case 'webhook': return post(c.url ?? '', { event: n.type, title: n.title, body: n.body ?? '', link: n.link ?? '', at: new Date().toISOString() });
    case 'email': {
      const transport = nodemailer.createTransport({
        host: c.host, port: Number(c.port) || 587, secure: c.secure === 'true',
        ...(c.user ? { auth: { user: c.user, pass: c.pass ?? '' } } : {}),
        connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000
      });
      await transport.sendMail({ from: c.from || c.user, to: c.to, subject: n.title, text });
      return;
    }
    default: throw new Error('Unknown channel type.');
  }
}

const KINDS = new Set(['discord', 'slack', 'telegram', 'ntfy', 'gotify', 'webhook', 'email']);
const EVENT_KEYS = new Set<string>(EVENTS.map(e => e.key));

/** Validate and normalise channels coming from the settings form. */
export function sanitizeChannels(input: unknown): NotificationChannel[] {
  if (!Array.isArray(input)) throw new Error('Channels must be a list.');
  return input.slice(0, 20).map((raw, i) => {
    const r = raw as Partial<NotificationChannel>;
    if (!r || !KINDS.has(String(r.kind))) throw new Error(`Channel ${i + 1}: choose a type.`);
    const config: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.config ?? {})) if (typeof v === 'string' && v.length < 500) config[k] = v;
    return {
      id: typeof r.id === 'string' && r.id ? r.id.slice(0, 40) : Math.random().toString(36).slice(2, 10),
      name: String(r.name ?? r.kind).slice(0, 60),
      kind: r.kind as NotificationChannel['kind'],
      enabled: r.enabled !== false,
      events: (Array.isArray(r.events) ? r.events : []).filter(e => EVENT_KEYS.has(e)),
      config
    };
  });
}
