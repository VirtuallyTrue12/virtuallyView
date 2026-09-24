import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DATA_DIR } from '../lib/paths.js';

export type Role = 'admin' | 'user';

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  createdAt: string;
  /** Small profile picture as a data URL, or empty for the initial-letter default. */
  avatar?: string;
  /** Highest age rating this person may watch, such as PG-13. Empty means no limit. */
  maxRating?: string;
}

interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
  avatar?: string;
  maxRating?: string;
}

interface Session {
  expiresAt: number;
  userId: string;
  device?: string;
  ip?: string;
  createdAt?: number;
}

export interface SessionInfo {
  id: string;
  userId: string;
  username: string;
  device: string;
  ip: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export interface SessionMeta { device?: string; ip?: string }

const LEGACY_AUTH_PATH = resolve(DATA_DIR, 'auth.json');
const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const PERSISTENT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, "stay signed in"
const sessions = new Map<string, Session>();

/**
 * User accounts live in a JSON file next to the database. The very first
 * account created becomes the administrator; every later account is a regular
 * user (open sign-up), and an administrator can promote or remove accounts.
 * The legacy single-account `auth.json` is read transparently so existing
 * installs keep working without a manual migration.
 */
function storeDir(): string {
  return process.env.VV_DATA_DIR ? resolve(process.env.VV_DATA_DIR) : DATA_DIR;
}

export function usersPath(): string {
  return resolve(storeDir(), 'users.json');
}

function sessionsPath(): string {
  return resolve(storeDir(), 'sessions.json');
}

let sessionsLoaded = false;

function loadSessions(): void {
  if (sessionsLoaded) return;
  sessionsLoaded = true;
  try {
    const file = sessionsPath();
    if (!existsSync(file)) return;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    // Version 2 files hold token hashes; older files held the tokens themselves.
    const hashed = raw.v === 2;
    const parsed = (hashed ? raw.sessions : raw) as Record<string, unknown>;
    const now = Date.now();
    for (const [stored, value] of Object.entries(parsed ?? {})) {
      const token = hashed ? stored : tokenKey(stored);
      if (typeof value === 'number' && Number.isFinite(value) && value > now) {
        // Pre-multi-user session: keep it as an environment/admin session.
        sessions.set(token, { expiresAt: value, userId: 'env' });
      } else if (value && typeof value === 'object') {
        const record = value as { expiresAt?: unknown; userId?: unknown; device?: unknown; ip?: unknown; createdAt?: unknown };
        if (typeof record.expiresAt === 'number' && Number.isFinite(record.expiresAt) && record.expiresAt > now) {
          sessions.set(token, {
            expiresAt: record.expiresAt,
            userId: typeof record.userId === 'string' ? record.userId : 'env',
            ...(typeof record.device === 'string' ? { device: record.device } : {}),
            ...(typeof record.ip === 'string' ? { ip: record.ip } : {}),
            ...(typeof record.createdAt === 'number' ? { createdAt: record.createdAt } : {})
          });
        }
      }
    }
  } catch {
    // Corrupt or unreadable session store: start signed out rather than
    // crashing. The next successful login rewrites the file.
  }
}

function persistSessions(): void {
  try {
    const now = Date.now();
    const record: Record<string, Session> = {};
    for (const [token, session] of sessions) {
      if (session.expiresAt > now) record[token] = session;
      else sessions.delete(token);
    }
    mkdirSync(dirname(sessionsPath()), { recursive: true });
    writeFileSync(sessionsPath(), JSON.stringify({ v: 2, sessions: record }), { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Read-only volume: sessions still work for this process lifetime, they
    // just do not survive a restart.
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

// Passwords are stored as scrypt with a per-account salt. Accounts created
// before this used a single unsalted SHA-256; those still sign in and are
// rehashed on their next successful login.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SCRYPT_FORMAT = /^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]{32}\$[0-9a-f]{128}$/;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function isStoredHash(value: unknown): value is string {
  return isSha256(value) || (typeof value === 'string' && SCRYPT_FORMAT.test(value));
}

export function verifyPassword(stored: string, candidate: string): boolean {
  if (/^[0-9a-f]{64}$/i.test(stored)) return timingSafeEqual(Buffer.from(stored, 'hex'), digest(candidate));
  const [, n, r, p, salt, hash] = stored.split('$');
  if (!SCRYPT_FORMAT.test(stored) || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(candidate, Buffer.from(salt, 'hex'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(expected, actual);
}

// A real hash to compare against when the username does not exist, so a wrong
// name and a wrong password take about the same time.
const DUMMY_HASH = hashPassword(randomBytes(8).toString('hex'));

/** Session tokens are never stored: only their SHA-256, so a leaked file or backup cannot be replayed. */
const tokenKey = (token: string) => createHash('sha256').update(token).digest('hex');

function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'user';
}

function toPublic(user: StoredUser): PublicUser {
  return {
    id: user.id, username: user.username, role: user.role, createdAt: user.createdAt,
    ...(user.avatar ? { avatar: user.avatar } : {}),
    ...(user.maxRating ? { maxRating: user.maxRating } : {})
  };
}

function makeId(): string {
  return randomBytes(9).toString('hex');
}

/** True when a users file (current or legacy) is present on disk. */
function storeExists(): boolean {
  return existsSync(usersPath()) || existsSync(LEGACY_AUTH_PATH);
}

/**
 * Parse a stored account payload. Accepts the multi-user array format as well
 * as the legacy single-account object. Anything malformed throws so callers
 * fail closed instead of silently enabling auth or open sign-up.
 */
function parseUsers(raw: string): StoredUser[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Stored user data is corrupt.');
  }
  if (Array.isArray(parsed)) {
    const users: StoredUser[] = [];
    for (const entry of parsed) {
      const user = entry as Partial<StoredUser>;
      if (!user || typeof user.username !== 'string' || !isStoredHash(user.passwordHash)) {
        throw new Error('Stored user data is corrupt.');
      }
      users.push({
        id: typeof user.id === 'string' && user.id ? user.id : makeId(),
        username: user.username,
        passwordHash: user.passwordHash,
        role: isRole(user.role) ? user.role : 'user',
        createdAt: typeof user.createdAt === 'string' ? user.createdAt : new Date(0).toISOString(),
        ...(typeof user.avatar === 'string' && user.avatar ? { avatar: user.avatar } : {}),
        ...(typeof user.maxRating === 'string' && user.maxRating ? { maxRating: user.maxRating } : {})
      });
    }
    return users;
  }
  const legacy = parsed as Partial<StoredUser>;
  if (legacy && typeof legacy.username === 'string' && isSha256(legacy.passwordHash)) {
    return [{
      id: typeof legacy.id === 'string' && legacy.id ? legacy.id : 'admin',
      username: legacy.username,
      passwordHash: legacy.passwordHash,
      role: 'admin',
      createdAt: typeof legacy.createdAt === 'string' ? legacy.createdAt : new Date(0).toISOString()
    }];
  }
  throw new Error('Stored user data is corrupt.');
}

function readUsersStrict(): StoredUser[] {
  const file = usersPath();
  if (existsSync(file)) return parseUsers(readFileSync(file, 'utf8'));
  if (existsSync(LEGACY_AUTH_PATH)) return parseUsers(readFileSync(LEGACY_AUTH_PATH, 'utf8'));
  return [];
}

function writeUsers(users: StoredUser[]): void {
  mkdirSync(storeDir(), { recursive: true });
  writeFileSync(usersPath(), JSON.stringify(users), { encoding: 'utf8', mode: 0o600 });
}

function envPassword(): string | null {
  const value = process.env.DASHBOARD_AUTH_PASSWORD?.trim();
  return value ? value : null;
}

function envUsername(): string {
  return process.env.DASHBOARD_AUTH_USERNAME?.trim() || 'root';
}

export function authEnabled(): boolean {
  try {
    if (readUsersStrict().length > 0) return true;
    if (storeExists()) return true; // present-but-empty store: fail closed
    return Boolean(envPassword());
  } catch {
    // Corrupt account data: auth is enabled (signup stays closed) and login
    // fails until the file is repaired.
    return true;
  }
}

export function setupRequired(): boolean {
  return !authEnabled();
}

export const MIN_PASSWORD_LENGTH = 4;
export const MIN_USERNAME_LENGTH = 3;

export type CreateAccountResult = { ok: true } | { ok: false; message: string };

/**
 * Create an account. The first account ever created is the administrator;
 * later accounts are regular users unless an administrator requests a role.
 * Nothing is written when validation fails or the store is corrupt. This is a
 * home server, so the rules are deliberately light: a short username and a
 * password of a few characters.
 */
export function createAccount(username: string, candidate: string, role?: Role): CreateAccountResult {
  if (typeof username !== 'string' || typeof candidate !== 'string') return { ok: false, message: 'Enter a username and a password.' };
  const name = username.trim();
  if (name.length < MIN_USERNAME_LENGTH) return { ok: false, message: `Username must be at least ${MIN_USERNAME_LENGTH} characters.` };
  if (name.length > 40) return { ok: false, message: 'Username can be at most 40 characters.' };
  if (candidate.length < MIN_PASSWORD_LENGTH) return { ok: false, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  let existing: StoredUser[];
  try {
    existing = readUsersStrict();
  } catch {
    // corrupt store: never overwrite it implicitly
    return { ok: false, message: "The account file could not be read. Check the server's data folder." };
  }
  if (existing.length === 0 && storeExists()) return { ok: false, message: "The account file is empty. Check the server's data folder." };
  if (existing.some(user => user.username.toLowerCase() === name.toLowerCase())) return { ok: false, message: 'That username is already taken.' };
  const isFirst = existing.length === 0 && !envPassword();
  const user: StoredUser = {
    id: makeId(),
    username: name,
    passwordHash: hashPassword(candidate),
    role: isFirst ? 'admin' : (role ?? 'user'),
    createdAt: new Date().toISOString()
  };
  try {
    writeUsers([...existing, user]);
    return { ok: true };
  } catch {
    return { ok: false, message: "The account could not be saved. The server's data folder may be read-only." };
  }
}

export function authenticate(username: string, candidate: string, stayLoggedIn = false, meta: SessionMeta = {}): string | null {
  if (typeof username !== 'string' || typeof candidate !== 'string') return null;
  let users: StoredUser[];
  try {
    users = readUsersStrict();
  } catch {
    // Corrupt account data: fail closed with a normal rejection rather than
    // a 500, and never fall back to env-based auth.
    return null;
  }
  const name = username.trim();
  // The environment credential is only a bootstrap: as soon as a stored
  // account exists it stops being accepted.
  const useEnv = !storeExists() && Boolean(envPassword());
  const account = users.find(user => user.username.toLowerCase() === name.toLowerCase());
  let ok = false;
  if (account) {
    ok = verifyPassword(account.passwordHash, candidate);
    if (ok && isSha256(account.passwordHash)) {
      try { writeUsers(users.map(user => (user.id === account.id ? { ...user, passwordHash: hashPassword(candidate) } : user))); } catch { /* keeps the old hash; tried again next login */ }
    }
  } else if (useEnv && name === envUsername()) {
    ok = timingSafeEqual(digest(envPassword() ?? ''), digest(candidate));
  } else {
    verifyPassword(DUMMY_HASH, candidate);
  }
  if (!ok) return null;

  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  loadSessions();
  for (const [session, value] of sessions) {
    if (value.expiresAt <= now) sessions.delete(session);
  }
  const ttl = stayLoggedIn ? PERSISTENT_LIFETIME_MS : SESSION_LIFETIME_MS;
  sessions.set(tokenKey(token), {
    expiresAt: now + ttl, userId: account?.id ?? 'env', createdAt: now,
    ...(meta.device ? { device: meta.device } : {}), ...(meta.ip ? { ip: meta.ip } : {})
  });
  persistSessions();
  return token;
}

/** Start a session for an account that has already been verified another way (Quick Connect). */
export function issueSession(userId: string, stayLoggedIn = false, meta: SessionMeta = {}): string | null {
  try {
    if (!readUsersStrict().some(user => user.id === userId)) return null;
  } catch {
    return null;
  }
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  loadSessions();
  for (const [session, value] of sessions) {
    if (value.expiresAt <= now) sessions.delete(session);
  }
  sessions.set(tokenKey(token), {
    expiresAt: now + (stayLoggedIn ? PERSISTENT_LIFETIME_MS : SESSION_LIFETIME_MS), userId, createdAt: now,
    ...(meta.device ? { device: meta.device } : {}), ...(meta.ip ? { ip: meta.ip } : {})
  });
  persistSessions();
  return token;
}

const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export const MAX_AVATAR_CHARS = 200_000;
export const RATING_LIMITS = ['G', 'PG', 'PG-13', 'R'] as const;

/** Change the profile picture (own account or any, by an administrator) or the age limit (administrator). */
export function updateProfile(id: string, patch: { avatar?: string; maxRating?: string }): { ok: boolean; message?: string } {
  if (patch.avatar && (patch.avatar.length > MAX_AVATAR_CHARS || !AVATAR_PATTERN.test(patch.avatar))) {
    return { ok: false, message: 'Use a PNG, JPEG or WebP picture under about 150 KB.' };
  }
  if (patch.maxRating && !(RATING_LIMITS as readonly string[]).includes(patch.maxRating)) {
    return { ok: false, message: 'Unknown age rating.' };
  }
  let users: StoredUser[];
  try {
    users = readUsersStrict();
  } catch {
    return { ok: false, message: 'Stored user data is corrupt.' };
  }
  const target = users.find(user => user.id === id);
  if (!target) return { ok: false, message: 'User not found.' };
  const next: StoredUser = { ...target };
  if (patch.avatar !== undefined) { if (patch.avatar) next.avatar = patch.avatar; else delete next.avatar; }
  if (patch.maxRating !== undefined) { if (patch.maxRating) next.maxRating = patch.maxRating; else delete next.maxRating; }
  try {
    writeUsers(users.map(user => (user.id === id ? next : user)));
  } catch {
    return { ok: false, message: 'Could not write the user store.' };
  }
  return { ok: true };
}

export function isAuthenticated(token: string | undefined): boolean {
  if (!token) return false;
  loadSessions();
  const session = sessions.get(tokenKey(token));
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(tokenKey(token));
    persistSessions();
    return false;
  }
  return true;
}

/** The signed-in user for a session token, or null when unknown/expired. */
export function currentUser(token: string | undefined): PublicUser | null {
  if (!token || !isAuthenticated(token)) return null;
  loadSessions();
  const userId = sessions.get(tokenKey(token))?.userId;
  if (!userId) return null;
  if (userId === 'env') {
    if (!envPassword() || storeExists()) return null;
    return { id: 'env', username: envUsername(), role: 'admin', createdAt: new Date(0).toISOString() };
  }
  try {
    const user = readUsersStrict().find(entry => entry.id === userId);
    return user ? toPublic(user) : null;
  } catch {
    return null;
  }
}

export function isAdmin(token: string | undefined): boolean {
  return currentUser(token)?.role === 'admin';
}

export function listUsers(): PublicUser[] {
  try {
    const users = readUsersStrict();
    if (users.length === 0 && envPassword()) {
      return [{ id: 'env', username: envUsername(), role: 'admin', createdAt: new Date(0).toISOString() }];
    }
    return users.map(toPublic);
  } catch {
    return [];
  }
}

/** Remove an account and every session it owns. Refuses to remove the last admin. */
export function deleteUser(id: string): { ok: boolean; message?: string } {
  let users: StoredUser[];
  try {
    users = readUsersStrict();
  } catch {
    return { ok: false, message: 'Stored user data is corrupt.' };
  }
  const target = users.find(user => user.id === id);
  if (!target) return { ok: false, message: 'User not found.' };
  if (target.role === 'admin' && users.filter(user => user.role === 'admin').length <= 1) {
    return { ok: false, message: 'The last administrator account cannot be removed.' };
  }
  try {
    writeUsers(users.filter(user => user.id !== id));
  } catch {
    return { ok: false, message: 'Could not write the user store.' };
  }
  loadSessions();
  let changed = false;
  for (const [token, session] of sessions) {
    if (session.userId === id) {
      sessions.delete(token);
      changed = true;
    }
  }
  if (changed) persistSessions();
  return { ok: true };
}

export function setUserRole(id: string, role: Role): { ok: boolean; message?: string } {
  let users: StoredUser[];
  try {
    users = readUsersStrict();
  } catch {
    return { ok: false, message: 'Stored user data is corrupt.' };
  }
  const target = users.find(user => user.id === id);
  if (!target) return { ok: false, message: 'User not found.' };
  if (target.role === 'admin' && role !== 'admin' && users.filter(user => user.role === 'admin').length <= 1) {
    return { ok: false, message: 'The last administrator account cannot be demoted.' };
  }
  try {
    writeUsers(users.map(user => (user.id === id ? { ...user, role } : user)));
  } catch {
    return { ok: false, message: 'Could not write the user store.' };
  }
  return { ok: true };
}

export function revoke(token: string | undefined): void {
  if (!token) return;
  loadSessions();
  if (sessions.delete(tokenKey(token))) persistSessions();
}

export function readSessionCookie(header: string | undefined): string | undefined {
  return header?.split(';').map(part => part.trim()).find(part => part.startsWith('vv_session='))?.slice('vv_session='.length);
}

/** Admin reset: set a new password and sign the account out everywhere. */
export function setUserPassword(id: string, password: string): { ok: boolean; message?: string } {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return { ok: false, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  let users: StoredUser[];
  try {
    users = readUsersStrict();
  } catch {
    return { ok: false, message: 'Stored user data is corrupt.' };
  }
  if (!users.some(user => user.id === id)) return { ok: false, message: 'User not found.' };
  try {
    writeUsers(users.map(user => (user.id === id ? { ...user, passwordHash: hashPassword(password) } : user)));
  } catch {
    return { ok: false, message: 'Could not write the user store.' };
  }
  loadSessions();
  let changed = false;
  for (const [token, session] of sessions) {
    if (session.userId === id) { sessions.delete(token); changed = true; }
  }
  if (changed) persistSessions();
  return { ok: true };
}

/** Self-service change: needs the current password; other devices are signed out. */
export function changeOwnPassword(id: string, current: string, next: string, keepToken?: string): { ok: boolean; message?: string } {
  let users: StoredUser[];
  try {
    users = readUsersStrict();
  } catch {
    return { ok: false, message: 'Stored user data is corrupt.' };
  }
  const account = users.find(user => user.id === id);
  if (!account) return { ok: false, message: 'Password changes are only available for stored accounts.' };
  if (typeof current !== 'string' || !verifyPassword(account.passwordHash, current)) {
    return { ok: false, message: 'Current password is incorrect.' };
  }
  const result = setUserPassword(id, next);
  if (!result.ok) return result;
  // setUserPassword signed everything out; re-issue nothing, caller keeps its own session.
  if (keepToken) {
    loadSessions();
    sessions.set(tokenKey(keepToken), { expiresAt: Date.now() + SESSION_LIFETIME_MS, userId: id, createdAt: Date.now() });
    persistSessions();
  }
  return { ok: true };
}

const shortId = (key: string) => key.slice(0, 16);

/** Signed-in devices: everyone's for an admin, otherwise only the caller's own. */
export function listSessions(asUserId: string, admin: boolean, currentToken?: string): SessionInfo[] {
  loadSessions();
  const names = new Map(listUsers().map(user => [user.id, user.username]));
  const now = Date.now();
  const out: SessionInfo[] = [];
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) continue;
    if (!admin && session.userId !== asUserId) continue;
    out.push({
      id: shortId(token), userId: session.userId, username: names.get(session.userId) ?? session.userId,
      device: session.device ?? 'Unknown device', ip: session.ip ?? '',
      createdAt: session.createdAt ? new Date(session.createdAt).toISOString() : '',
      expiresAt: new Date(session.expiresAt).toISOString(), current: currentToken !== undefined && token === tokenKey(currentToken)
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function revokeSessionById(id: string, asUserId: string, admin: boolean): boolean {
  loadSessions();
  for (const [token, session] of sessions) {
    if (shortId(token) !== id) continue;
    if (!admin && session.userId !== asUserId) return false;
    sessions.delete(token);
    persistSessions();
    return true;
  }
  return false;
}

/** Sign the user out everywhere except the session making the request. Returns how many were removed. */
export function revokeOtherSessions(userId: string, keepToken: string): number {
  loadSessions();
  let removed = 0;
  for (const [token, session] of sessions) {
    if (session.userId === userId && token !== tokenKey(keepToken)) { sessions.delete(token); removed++; }
  }
  if (removed) persistSessions();
  return removed;
}
