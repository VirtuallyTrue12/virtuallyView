import { currentUser, issueSession, listUsers, revoke, sessionIsLongLived, switchTarget, type PublicUser } from './auth.js';

/** Wrong PINs allowed before a profile is locked for a minute. */
export const PIN_ATTEMPTS = 5;
export const PIN_LOCK_MS = 60_000;

const wrong = new Map<string, { count: number; lockedUntil: number }>();

export function resetProfileLocks(): void {
  wrong.clear();
}

/** The "Who's watching?" list: profiles marked shown, with no hashes. */
export function pickerProfiles(): Array<{ id: string; name: string; avatar: PublicUser['profileAvatar']; hasPin: boolean; isKid: boolean }> {
  return listUsers()
    .filter(user => user.shown)
    .map(user => ({ id: user.id, name: user.username, avatar: user.profileAvatar, hasPin: user.hasPin, isKid: user.isKid }));
}

export type SwitchOutcome =
  | { ok: true; token: string; stayLoggedIn: boolean }
  | { ok: false; status: number; message: string; needs?: 'pin' | 'password'; passwordAllowed?: boolean; retryAfterSeconds?: number; attemptsLeft?: number };

const locked = (ms: number): SwitchOutcome => ({
  ok: false, status: 429, message: 'Too many wrong PINs. Wait a minute and try again.', retryAfterSeconds: Math.ceil(ms / 1000)
});

/**
 * Switch the device to another household profile. Rules:
 * - the caller must be signed in (any account on this server);
 * - the target must be shown in the picker;
 * - a profile with a PIN needs that PIN;
 * - an administrator always needs a secret: the PIN when one is set, otherwise the password
 *   (the password also works when a PIN is set);
 * - wrong secrets are counted per profile: PIN_ATTEMPTS in a row locks it for PIN_LOCK_MS.
 * On success the device's old session is ended and a new one is started for the target.
 */
export function switchProfile(fromToken: string | undefined, input: { targetId: string; pin?: unknown; password?: unknown }, meta: { device?: string; ip?: string } = {}): SwitchOutcome {
  const from = currentUser(fromToken);
  if (!from || !fromToken) return { ok: false, status: 401, message: 'Authentication required.' };
  const target = typeof input.targetId === 'string' ? switchTarget(input.targetId) : null;
  // A hidden profile looks the same as one that does not exist.
  if (!target || !target.shown) return { ok: false, status: 404, message: 'That profile is not available.' };
  if (target.id === from.id) return { ok: true, token: fromToken, stayLoggedIn: sessionIsLongLived(fromToken) };

  const lock = wrong.get(target.id);
  if (lock && lock.lockedUntil > Date.now()) return locked(lock.lockedUntil - Date.now());

  const pin = typeof input.pin === 'string' ? input.pin : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const needsSecret = target.hasPin || target.role === 'admin';
  if (!needsSecret) return complete(fromToken, target.id, meta);

  const needs: 'pin' | 'password' = target.hasPin ? 'pin' : 'password';
  // An administrator may use the password instead of the PIN. Everyone else with a PIN must give the PIN.
  const given = target.role === 'admin' ? pin !== '' || password !== '' : pin !== '';
  if (!given) {
    return { ok: false, status: 403, message: needs === 'pin' ? 'Enter the PIN for this profile.' : 'Enter the password for this profile.', needs, passwordAllowed: target.role === 'admin' };
  }
  const accepted = (pin !== '' && target.checkPin(pin)) || (target.role === 'admin' && password !== '' && target.checkPassword(password));
  if (accepted) return complete(fromToken, target.id, meta);

  const count = (lock?.count ?? 0) + 1;
  if (count >= PIN_ATTEMPTS) {
    wrong.set(target.id, { count: 0, lockedUntil: Date.now() + PIN_LOCK_MS });
    return locked(PIN_LOCK_MS);
  }
  wrong.set(target.id, { count, lockedUntil: 0 });
  return {
    ok: false, status: 403, needs, passwordAllowed: target.role === 'admin', attemptsLeft: PIN_ATTEMPTS - count,
    message: needs === 'pin' ? 'That PIN is not right. Try again.' : 'That password is not right. Try again.'
  };
}

function complete(fromToken: string, targetId: string, meta: { device?: string; ip?: string }): SwitchOutcome {
  wrong.delete(targetId);
  const stayLoggedIn = sessionIsLongLived(fromToken);
  const token = issueSession(targetId, stayLoggedIn, meta);
  if (!token) return { ok: false, status: 500, message: 'Could not switch profiles. Try again.' };
  revoke(fromToken);
  return { ok: true, token, stayLoggedIn };
}
