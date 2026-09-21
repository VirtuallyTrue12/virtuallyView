import { randomBytes, randomInt } from 'node:crypto';

const LIFETIME_MS = 5 * 60 * 1000;
const MAX_PENDING = 200;

interface Pending {
  code: string;
  expiresAt: number;
  userId?: string;
  device?: string;
}

const bySecret = new Map<string, Pending>();

function sweep(): void {
  const now = Date.now();
  for (const [secret, entry] of bySecret) {
    if (entry.expiresAt <= now) bySecret.delete(secret);
  }
}

/** A device asks for a short code to show on screen and a secret only it knows. */
export function startQuickConnect(device?: string): { code: string; secret: string; expiresInSeconds: number } | null {
  sweep();
  if (bySecret.size >= MAX_PENDING) return null;
  let code = '';
  do { code = String(randomInt(0, 1_000_000)).padStart(6, '0'); } while ([...bySecret.values()].some(entry => entry.code === code));
  const secret = randomBytes(24).toString('hex');
  bySecret.set(secret, { code, expiresAt: Date.now() + LIFETIME_MS, ...(device ? { device } : {}) });
  return { code, secret, expiresInSeconds: LIFETIME_MS / 1000 };
}

/** A signed-in person types the code on their own device to sign the other device in as them. */
export function approveQuickConnect(code: string, userId: string): { ok: boolean; message?: string; device?: string } {
  sweep();
  const entry = [...bySecret.values()].find(item => item.code === code.trim());
  if (!entry) return { ok: false, message: 'That code is wrong or has expired.' };
  entry.userId = userId;
  return { ok: true, ...(entry.device ? { device: entry.device } : {}) };
}

/** The waiting device polls with its secret. An approved entry is consumed on the first read. */
export function pollQuickConnect(secret: string): { status: 'pending' | 'expired' } | { status: 'approved'; userId: string } {
  sweep();
  const entry = bySecret.get(secret);
  if (!entry) return { status: 'expired' };
  if (!entry.userId) return { status: 'pending' };
  bySecret.delete(secret);
  return { status: 'approved', userId: entry.userId };
}
