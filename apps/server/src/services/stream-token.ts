import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/paths.js';
import { getServerSettings } from './server-settings.js';

// A TV or cast receiver fetches the video itself and has no login cookie. A
// short-lived link signed for one path and one person lets it play that one
// file and nothing else.
const LIFETIME_MS = 6 * 60 * 60 * 1000;
let secret: Buffer | null = null;

function key(): Buffer {
  if (secret) return secret;
  const file = resolve(DATA_DIR, 'stream.key');
  if (existsSync(file)) {
    secret = Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
  } else {
    secret = randomBytes(32);
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(file, secret.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  }
  return secret;
}

const mac = (expires: number, userId: string, path: string) =>
  createHmac('sha256', key()).update(`${expires}.${userId}.${path}`).digest('hex').slice(0, 40);

/** Only playback paths can be signed. */
export const isStreamPath = (path: string) => /^\/api\/(stream|music\/stream)\/[^?]+$/.test(path) && !path.includes('..');

export function signStreamPath(path: string, userId: string): string {
  const expires = Date.now() + LIFETIME_MS;
  return `${expires}.${userId}.${mac(expires, userId, path)}`;
}

/** The person a valid token was issued to, or null. */
export function verifyStreamToken(token: string | undefined, path: string): string | null {
  if (!token || !isStreamPath(path)) return null;
  const [expires, userId, sig] = token.split('.');
  const at = Number(expires);
  if (!userId || !sig || !Number.isFinite(at) || at < Date.now()) return null;
  const expected = Buffer.from(mac(at, userId, path));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? userId : null;
}

/** First private IPv4 address of this machine, for links a TV can reach. */
export function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address)) return item.address;
    }
  }
  return null;
}

/** Address another device should use to reach this server. */
export function shareOrigin(requestHost: string | undefined, protocol: string): string {
  const configured = getServerSettings().publicUrl?.trim().replace(/\/$/, '');
  if (configured) return configured;
  const host = requestHost ?? '';
  const port = /:(\d+)$/.exec(host)?.[1] ?? '3000';
  if (!host || /^(localhost|127\.|\[::1\])/.test(host)) {
    const lan = lanAddress();
    if (lan) return `${protocol}://${lan}:${port}`;
  }
  return `${protocol}://${host}`;
}
