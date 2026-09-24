import { openSecret, sealSecret } from '../lib/secrets.js';
import { all, run } from '../db/app-db.js';

export interface ServerSettings {
  serverName: string;
  mediaRoots: { movies: string; tv: string; music: string; staging: string };
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  bindAddress: string;
  port: number;
  /** When true, changing a media root requires the matching confirmation phrase. */
  folderChangeRequiresConfirmation: boolean;
  /** Preferred cover art service for search: 'tmdb' | 'duckduckgo' | 'wikipedia'. */
  coverSource: 'tmdb' | 'duckduckgo' | 'wikipedia';
  /** VPN / Tor outbound routing for blocked integration lookups. */
  outboundProxy: { enabled: boolean; kind: 'tor' | 'socks5' | 'http'; host: string; port: number };
  /** True once the first-run setup wizard has been completed or dismissed. */
  onboardingComplete: boolean;
  /** When true, anyone who can reach the server may create their own account. */
  allowSignup: boolean;
  /** An administrator says services on this private network (192.168.x.x, 10.x.x.x) are theirs to connect to. */
  trustLocalNetwork: boolean;
  /** Address other devices should use (shown in Settings > Server). */
  publicUrl: string;
  /** Preferred quality profile name per media type; blank = Standard for music, HD-1080p for movies and TV. */
  defaultQuality: { movie: string; series: string; artist: string };
  /** Who may request what: optional admin approval and a per-person limit. */
  requests: { approval: 'off' | 'users'; limit: number; window: 'day' | 'week' };
  /** Where notifications go besides the in-app bell. */
  notifications: { channels: NotificationChannel[] };
  autoBackup: boolean;
  updatedAt?: string;
}

export type ChannelKind = 'discord' | 'slack' | 'telegram' | 'ntfy' | 'gotify' | 'webhook' | 'email';
export interface NotificationChannel {
  id: string;
  name: string;
  kind: ChannelKind;
  enabled: boolean;
  events: string[];
  config: Record<string, string>;
}

const DEFAULTS: ServerSettings = {
  serverName: 'virtuallyView',
  mediaRoots: { movies: '/media/movies', tv: '/media/tv', music: '/media/music', staging: '/downloads' },
  logLevel: 'info',
  bindAddress: '0.0.0.0',
  port: 3000,
  folderChangeRequiresConfirmation: true,
  coverSource: 'duckduckgo',
  outboundProxy: { enabled: false, kind: 'tor', host: '127.0.0.1', port: 9050 },
  onboardingComplete: false,
  allowSignup: false,
  trustLocalNetwork: false,
  publicUrl: '',
  defaultQuality: { movie: '', series: '', artist: '' },
  requests: { approval: 'off', limit: 0, window: 'week' },
  notifications: { channels: [] },
  autoBackup: true
};

const KEY = 'server';

/** Channel settings hold webhook URLs, tokens and passwords: seal them when a key is configured. */
function mapChannelSecrets<T extends { config?: Record<string, string> }>(channel: T, fn: (text: string) => string): T {
  return { ...channel, config: Object.fromEntries(Object.entries(channel.config ?? {}).map(([k, v]) => [k, fn(v)])) };
}

function parse(value: unknown): ServerSettings {
  const raw = (typeof value === 'string' ? JSON.parse(value) : value ?? {}) as Partial<ServerSettings>;
  return {
    ...DEFAULTS,
    ...raw,
    mediaRoots: { ...DEFAULTS.mediaRoots, ...(raw.mediaRoots ?? {}) },
    outboundProxy: { ...DEFAULTS.outboundProxy, ...(raw.outboundProxy ?? {}) },
    onboardingComplete: raw.onboardingComplete === true,
    allowSignup: raw.allowSignup === true,
    trustLocalNetwork: raw.trustLocalNetwork === true,
    publicUrl: typeof raw.publicUrl === 'string' ? raw.publicUrl : '',
    defaultQuality: { ...DEFAULTS.defaultQuality, ...(raw.defaultQuality ?? {}) },
    requests: { ...DEFAULTS.requests, ...(raw.requests ?? {}) },
    notifications: { channels: Array.isArray(raw.notifications?.channels) ? raw.notifications!.channels.map(channel => mapChannelSecrets(channel, openSecret)) : [] },
    autoBackup: raw.autoBackup !== false
  };
}

export function getServerSettings(): ServerSettings {
  try {
    const row = all<{ key: string; value: string }>('SELECT key, value FROM server_settings WHERE key = ?', KEY)[0];
    return row ? parse(row.value) : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function saveServerSettings(patch: Partial<ServerSettings>): ServerSettings {
  const current = getServerSettings();
  const next: ServerSettings = {
    ...current,
    ...patch,
    mediaRoots: { ...current.mediaRoots, ...(patch.mediaRoots ?? {}) },
    outboundProxy: { ...current.outboundProxy, ...(patch.outboundProxy ?? {}) },
    defaultQuality: { ...current.defaultQuality, ...(patch.defaultQuality ?? {}) },
    requests: { ...current.requests, ...(patch.requests ?? {}) },
    notifications: patch.notifications ?? current.notifications,
    updatedAt: new Date().toISOString()
  };
  run(
    `INSERT INTO server_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    KEY, JSON.stringify({ ...next, notifications: { channels: next.notifications.channels.map(channel => mapChannelSecrets(channel, sealSecret)) } }), next.updatedAt ?? new Date().toISOString()
  );
  return getServerSettings();
}