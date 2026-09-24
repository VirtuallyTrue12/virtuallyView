import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

// Optional encryption of stored service keys and notification tokens.
//
// Set VV_SECRET_KEY (any long random string) in the environment and those
// values are written encrypted (AES-256-GCM). The key lives in the environment,
// NOT in the data folder, so a copy of the data folder or of a backup does not
// contain what is needed to read them. Without it they are stored as plain text
// in files only the server can read, as before. Losing the key means saving
// those values again; nothing else depends on it.

const PREFIX = 'enc:v1:';
let cached: { secret: string; key: Buffer } | null = null;

function key(): Buffer | null {
  const secret = process.env.VV_SECRET_KEY;
  if (!secret) return null;
  if (cached?.secret !== secret) cached = { secret, key: scryptSync(secret, 'virtuallyview-secrets-v1', 32) };
  return cached.key;
}

export const secretsEnabled = () => key() !== null;

/** Encrypts when a key is configured; otherwise (and for empty or already encrypted text) returns the text unchanged. */
export function sealSecret(text: string): string {
  const k = key();
  if (!k || !text || text.startsWith(PREFIX)) return text;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

/** Decrypts sealed text. Text that was never encrypted passes through; a wrong or missing key gives '' rather than garbage. */
export function openSecret(text: string): string {
  if (typeof text !== 'string' || !text.startsWith(PREFIX)) return text;
  const k = key();
  if (!k) return '';
  try {
    const raw = Buffer.from(text.slice(PREFIX.length), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', k, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
