import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';

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
  authEnabled,
  createAccount,
  currentUser,
  deleteUser,
  isAuthenticated,
  listUsers,
  readSessionCookie,
  revoke,
  setUserRole,
  setupRequired
} from '../../apps/server/src/services/auth.js';

const password = 'isolated-test-password';
function account() {
  disk.exists = true;
  disk.contents = JSON.stringify({ username: 'owner', passwordHash: createHash('sha256').update(password).digest('hex') });
}

beforeEach(() => {
  disk.exists = false;
  disk.contents = '';
  disk.sessions = null;
  disk.unreadable = false;
  vi.stubEnv('DASHBOARD_AUTH_PASSWORD', '');
  vi.stubEnv('DASHBOARD_AUTH_USERNAME', 'root');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('isolated authentication lifecycle', () => {
  test('unconfigured installation requires setup and cannot log in', () => {
    expect(authEnabled()).toBe(false);
    expect(setupRequired()).toBe(true);
    expect(authenticate('root', '')).toBeNull();
  });
  test('first account is the administrator and later accounts are regular users', () => {
    expect(createAccount('ab', password).ok).toBe(false);
    expect(createAccount('owner', 'abc').ok).toBe(false);
    expect(createAccount(' owner ', password).ok).toBe(true);
    expect(setupRequired()).toBe(false);
    expect(authenticate('owner', password)).toBeTruthy();
    // Open sign-up: a second account is allowed and defaults to the user role.
    expect(createAccount('viewer', password).ok).toBe(true);
    const users = listUsers();
    expect(users.find(u => u.username === 'owner')?.role).toBe('admin');
    expect(users.find(u => u.username === 'viewer')?.role).toBe('user');
    // Duplicate usernames are still rejected.
    expect(createAccount('viewer', password).ok).toBe(false);
  });
  test('sessions remember which user signed in', () => {
    createAccount('owner', password);
    createAccount('viewer', password);
    const token = authenticate('viewer', password)!;
    expect(currentUser(token)?.username).toBe('viewer');
    expect(currentUser(token)?.role).toBe('user');
    revoke(token);
    expect(currentUser(token)).toBeNull();
  });
  test('administrators can promote and remove users, but the last admin is protected', () => {
    createAccount('owner', password);
    createAccount('viewer', password);
    const owner = listUsers().find(u => u.username === 'owner')!;
    const viewer = listUsers().find(u => u.username === 'viewer')!;
    expect(setUserRole(viewer.id, 'admin').ok).toBe(true);
    expect(setUserRole(owner.id, 'user').ok).toBe(true);
    // viewer is now the only administrator and cannot be demoted or removed.
    expect(setUserRole(viewer.id, 'user').ok).toBe(false);
    expect(deleteUser(viewer.id).ok).toBe(false);
    // The regular account can be removed.
    expect(deleteUser(owner.id).ok).toBe(true);
    expect(listUsers().map(u => u.username)).toEqual(['viewer']);
  });
  test.each(['{', 'null', '[]', '{}', '{"username":"owner","passwordHash":"bad"}', '{"username":12,"passwordHash":"abc"}'])(
    'corrupt data stays closed: %s', contents => {
      disk.exists = true;
      disk.contents = contents;
      vi.stubEnv('DASHBOARD_AUTH_PASSWORD', password);
      expect(authEnabled()).toBe(true);
      expect(setupRequired()).toBe(false);
      expect(authenticate('root', password)).toBeNull();
      expect(createAccount('replacement', password).ok).toBe(false);
      expect(disk.contents).toBe(contents);
    }
  );
  test('unreadable data does not enable signup or environment fallback', () => {
    disk.exists = true;
    disk.unreadable = true;
    expect(authEnabled()).toBe(true);
    expect(authenticate('root', password)).toBeNull();
    expect(createAccount('owner', password).ok).toBe(false);
  });
  test('correct password creates independent sessions; logout revokes only its session', () => {
    account();
    expect(authenticate('owner', 'incorrect')).toBeNull();
    expect(authenticate('other', password)).toBeNull();
    const first = authenticate('owner', password)!;
    const second = authenticate('owner', password)!;
    expect(first).not.toBe(second);
    expect(isAuthenticated(first)).toBe(true);
    revoke(first);
    expect(isAuthenticated(first)).toBe(false);
    expect(isAuthenticated(second)).toBe(true);
    revoke(second);
  });
  test('sessions expire on the server after 24 hours', () => {
    vi.useFakeTimers();
    account();
    const token = authenticate('owner', password)!;
    vi.advanceTimersByTime(86_400_000 - 1);
    expect(isAuthenticated(token)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isAuthenticated(token)).toBe(false);
  });
  test('environment auth works without overriding a saved account', () => {
    vi.stubEnv('DASHBOARD_AUTH_PASSWORD', password);
    const token = authenticate('root', password)!;
    expect(isAuthenticated(token)).toBe(true);
    revoke(token);
    account();
    expect(authenticate('root', password)).toBeNull();
  });
  test('session cookie is extracted without confusing similarly named cookies', () => {
    expect(readSessionCookie('other=1; vv_session=abc; last=2')).toBe('abc');
    expect(readSessionCookie('not_vv_session=abc')).toBeUndefined();
    expect(readSessionCookie(undefined)).toBeUndefined();
    expect(isAuthenticated(undefined)).toBe(false);
  });
  test('stay-signed-in sessions survive a server restart', async () => {
    account();
    const first = await import('../../apps/server/src/services/auth.js');
    const token = first.authenticate('owner', password, true)!;
    expect(first.isAuthenticated(token)).toBe(true);
    // Simulate a process restart: fresh module instance, same on-disk store.
    vi.resetModules();
    const restarted = await import('../../apps/server/src/services/auth.js');
    expect(restarted.isAuthenticated(token)).toBe(true);
  });
});
