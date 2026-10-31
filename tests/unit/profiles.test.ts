import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const disk = vi.hoisted(() => ({ exists: false, contents: '', sessions: null as string | null, unreadable: false }));
vi.mock('node:fs', () => {
  const isSessions = (p: unknown) => String(p).endsWith('sessions.json');
  return {
    existsSync: (p: string) => (isSessions(p) ? disk.sessions !== null : disk.exists),
    mkdirSync: vi.fn(),
    readFileSync: (p: string) => {
      if (disk.unreadable) throw new Error('unreadable');
      if (isSessions(p)) {
        if (disk.sessions === null) throw new Error('ENOENT');
        return disk.sessions;
      }
      return disk.contents;
    },
    writeFileSync: vi.fn((p: string, data: unknown) => {
      if (isSessions(p)) {
        disk.sessions = String(data);
        return;
      }
      disk.exists = true;
      disk.contents = String(data);
    })
  };
});

import {
  authenticate,
  createAccount,
  currentUser,
  isAuthenticated,
  listUsers,
  setUserRole,
  switchTarget,
  updateAccountProfile,
  updateProfile
} from '../../apps/server/src/services/auth.js';
import { PIN_ATTEMPTS, PIN_LOCK_MS, pickerProfiles, resetProfileLocks, switchProfile, type SwitchOutcome } from '../../apps/server/src/services/profiles.js';
import { kidsBlocked } from '../../apps/server/src/services/kids.js';

const password = 'household-password';
const idOf = (name: string) => listUsers().find(u => u.username === name)!.id;
const token = (name: string) => authenticate(name, password)!;
const tokenOf = (outcome: SwitchOutcome) => {
  if (!outcome.ok) throw new Error(`switch refused: ${outcome.message}`);
  return outcome.token;
};

beforeEach(() => {
  disk.exists = false;
  disk.contents = '';
  disk.sessions = null;
  disk.unreadable = false;
  vi.stubEnv('DASHBOARD_AUTH_PASSWORD', '');
  vi.stubEnv('DASHBOARD_AUTH_USERNAME', 'root');
  vi.useFakeTimers();
  resetProfileLocks();
  // A household: one administrator, a second administrator (parent), a teen and a kid.
  createAccount('owner', password);
  createAccount('parent', password, 'admin');
  createAccount('teen', password);
  createAccount('kid', password);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('switching profiles', () => {
  test('a profile with a PIN needs that PIN', () => {
    expect(updateAccountProfile(idOf('kid'), { pin: '1234' }).ok).toBe(true);
    const from = token('teen');
    expect(switchProfile(from, { targetId: idOf('kid') })).toMatchObject({ ok: false, status: 403, needs: 'pin' });
    expect(switchProfile(from, { targetId: idOf('kid'), pin: '0000' })).toMatchObject({ ok: false, status: 403, attemptsLeft: PIN_ATTEMPTS - 1 });
    // A password does not stand in for a PIN on an ordinary profile.
    expect(switchProfile(from, { targetId: idOf('kid'), password })).toMatchObject({ ok: false, status: 403, needs: 'pin' });
    const next = tokenOf(switchProfile(from, { targetId: idOf('kid'), pin: '1234' }));
    expect(currentUser(next)?.username).toBe('kid');
    // The device's old session is ended; the new one belongs to the kid profile.
    expect(isAuthenticated(from)).toBe(false);
  });

  test('a profile without a PIN switches without a secret, and a hidden profile cannot be switched to', () => {
    const next = switchProfile(token('teen'), { targetId: idOf('kid') });
    expect(next.ok).toBe(true);
    expect(updateAccountProfile(idOf('kid'), { shown: false }).ok).toBe(true);
    expect(switchProfile(token('teen'), { targetId: idOf('kid') })).toMatchObject({ ok: false, status: 404 });
    expect(pickerProfiles().map(p => p.name)).not.toContain('kid');
  });

  test('an administrator always needs a secret: the password when there is no PIN', () => {
    expect(switchProfile(token('teen'), { targetId: idOf('owner') })).toMatchObject({ ok: false, status: 403, needs: 'password' });
    // A PIN is not a secret for an administrator without one, so a guessed PIN is refused.
    expect(switchProfile(token('teen'), { targetId: idOf('owner'), pin: '1234' })).toMatchObject({ ok: false, status: 403 });
    expect(switchProfile(token('teen'), { targetId: idOf('owner'), password }).ok).toBe(true);
  });

  test('an administrator with a PIN accepts the PIN or the password, never nothing', () => {
    expect(updateAccountProfile(idOf('parent'), { pin: '4321' }).ok).toBe(true);
    expect(switchProfile(token('teen'), { targetId: idOf('parent') })).toMatchObject({ ok: false, status: 403, needs: 'pin' });
    expect(switchProfile(token('teen'), { targetId: idOf('parent'), pin: '4321' }).ok).toBe(true);
    expect(switchProfile(token('teen'), { targetId: idOf('parent'), password }).ok).toBe(true);
  });

  test('a Kids profile cannot switch into an administrator', () => {
    expect(updateAccountProfile(idOf('kid'), { isKid: true }).ok).toBe(true);
    expect(switchProfile(token('kid'), { targetId: idOf('owner') })).toMatchObject({ ok: false, needs: 'password' });
    expect(switchProfile(token('kid'), { targetId: idOf('owner'), pin: '0000' })).toMatchObject({ ok: false });
  });

  test('a signed-out device cannot switch at all', () => {
    expect(switchProfile(undefined, { targetId: idOf('kid') })).toMatchObject({ ok: false, status: 401 });
  });

  test('five wrong PINs lock the profile for a minute, even against the right PIN', () => {
    updateAccountProfile(idOf('kid'), { pin: '1234' });
    const from = token('teen');
    const target = idOf('kid');
    for (let i = 1; i < PIN_ATTEMPTS; i++) {
      expect(switchProfile(from, { targetId: target, pin: '0000' })).toMatchObject({ ok: false, status: 403 });
    }
    expect(switchProfile(from, { targetId: target, pin: '0000' })).toMatchObject({ ok: false, status: 429, retryAfterSeconds: 60 });
    expect(switchProfile(from, { targetId: target, pin: '1234' })).toMatchObject({ ok: false, status: 429 });
    vi.advanceTimersByTime(PIN_LOCK_MS - 1);
    expect(switchProfile(from, { targetId: target, pin: '1234' })).toMatchObject({ ok: false, status: 429 });
    vi.advanceTimersByTime(1);
    expect(switchProfile(from, { targetId: target, pin: '1234' }).ok).toBe(true);
  });

  test('a successful switch clears the wrong-PIN count', () => {
    updateAccountProfile(idOf('kid'), { pin: '1234' });
    const from = token('teen');
    for (let i = 0; i < PIN_ATTEMPTS - 1; i++) switchProfile(from, { targetId: idOf('kid'), pin: '0000' });
    expect(switchProfile(from, { targetId: idOf('kid'), pin: '1234' }).ok).toBe(true);
    // Back on the teen account: a fresh run of wrong guesses starts from zero again.
    const again = token('teen');
    expect(switchProfile(again, { targetId: idOf('kid'), pin: '0000' })).toMatchObject({ ok: false, status: 403, attemptsLeft: PIN_ATTEMPTS - 1 });
  });
});

describe('Kids profiles', () => {
  test('a Kids profile is held to PG at most (G stays G), whatever limit the account had', () => {
    updateProfile(idOf('kid'), { maxRating: 'R' });
    expect(updateAccountProfile(idOf('kid'), { isKid: true }).ok).toBe(true);
    const session = token('kid');
    expect(currentUser(session)).toMatchObject({ isKid: true, maxRating: 'PG' });
    updateProfile(idOf('kid'), { maxRating: 'G' });
    expect(currentUser(session)?.maxRating).toBe('G');
  });

  test('an administrator account cannot be a Kids profile, and promoting a Kids profile clears it', () => {
    expect(updateAccountProfile(idOf('owner'), { isKid: true })).toMatchObject({ ok: false });
    expect(updateAccountProfile(idOf('teen'), { isKid: true }).ok).toBe(true);
    expect(setUserRole(idOf('teen'), 'admin').ok).toBe(true);
    expect(listUsers().find(u => u.username === 'teen')).toMatchObject({ role: 'admin', isKid: false });
  });

  test('a Kids profile cannot request, download or open settings through the API', () => {
    const blocked: Array<[string, string]> = [
      ['GET', '/api/requests'], ['POST', '/api/requests'], ['GET', '/api/downloads'], ['POST', '/api/downloads/abc/retry'],
      ['GET', '/api/settings/overview'], ['GET', '/api/server-settings'], ['GET', '/api/diagnostics'], ['GET', '/api/apps'],
      ['GET', '/api/integrations'], ['GET', '/api/system/storage'], ['POST', '/api/movies/m1/search'],
      ['POST', '/api/series/s1/specials'], ['POST', '/api/artists/a1/search']
    ];
    for (const [method, path] of blocked) expect(kidsBlocked(true, method, path), `${method} ${path}`).toBe(true);
  });

  test('a Kids profile keeps its home, titles, progress and profile switching', () => {
    const open: Array<[string, string]> = [
      ['GET', '/api/dashboard'], ['GET', '/api/movies'], ['GET', '/api/series'], ['GET', '/api/auth/status'],
      ['POST', '/api/profiles/switch'], ['PUT', '/api/profiles/me'], ['GET', '/api/music']
    ];
    for (const [method, path] of open) expect(kidsBlocked(true, method, path), `${method} ${path}`).toBe(false);
  });

  test('the rule never applies to other profiles', () => {
    expect(kidsBlocked(false, 'GET', '/api/requests')).toBe(false);
    expect(kidsBlocked(false, 'POST', '/api/movies/m1/search')).toBe(false);
  });
});

describe('PINs stay private', () => {
  test('no list, picker or session view carries the PIN or its hash', () => {
    expect(updateAccountProfile(idOf('kid'), { pin: '2468' }).ok).toBe(true);
    const stored = JSON.parse(disk.contents) as Array<{ username: string; pinHash?: string }>;
    const hash = stored.find(u => u.username === 'kid')!.pinHash!;
    expect(hash).toMatch(/^scrypt\$/);
    const views = JSON.stringify({ users: listUsers(), picker: pickerProfiles(), me: currentUser(token('kid')) });
    expect(views).not.toContain(hash);
    expect(views).not.toContain('pinHash');
    expect(listUsers().find(u => u.username === 'kid')?.hasPin).toBe(true);
    expect(pickerProfiles().find(p => p.name === 'kid')).toMatchObject({ hasPin: true });
  });

  test('the PIN must be exactly 4 digits, and null removes it', () => {
    expect(updateAccountProfile(idOf('kid'), { pin: '123' }).ok).toBe(false);
    expect(updateAccountProfile(idOf('kid'), { pin: 'abcd' }).ok).toBe(false);
    expect(updateAccountProfile(idOf('kid'), { pin: '12345' }).ok).toBe(false);
    expect(updateAccountProfile(idOf('kid'), { pin: '1234' }).ok).toBe(true);
    expect(switchTarget(idOf('kid'))?.hasPin).toBe(true);
    expect(updateAccountProfile(idOf('kid'), { pin: null }).ok).toBe(true);
    expect(switchTarget(idOf('kid'))?.hasPin).toBe(false);
  });

  test('a PIN only ever checks against its own profile', () => {
    updateAccountProfile(idOf('kid'), { pin: '1234' });
    const kid = switchTarget(idOf('kid'))!;
    expect(kid.checkPin('1234')).toBe(true);
    expect(kid.checkPin('1235')).toBe(false);
    expect(switchTarget(idOf('teen'))!.checkPin('1234')).toBe(false);
  });
});
