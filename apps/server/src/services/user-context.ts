import { AsyncLocalStorage } from 'node:async_hooks';

export interface Actor {
  userId: string;
  username: string;
  /** 'system' is used outside a signed-in request (tests, background jobs) and is treated as an administrator. */
  role: 'admin' | 'user' | 'system';
  /** Age limit for this viewer (see RATING_LIMITS); empty or missing means unrestricted. */
  maxRating?: string;
}

const SYSTEM: Actor = { userId: 'shared', username: 'system', role: 'system' };
const store = new AsyncLocalStorage<Actor>();

/** Run `fn` as the given user; services read it with currentActor() / currentUserId(). */
export function runAsActor<T>(actor: Actor, fn: () => T): T {
  return store.run(actor, fn);
}

/** Kept for callers that only know a user id. */
export function runAsUser<T>(userId: string, fn: () => T): T {
  return store.run({ userId, username: userId, role: 'user' }, fn);
}

export const currentActor = (): Actor => store.getStore() ?? SYSTEM;
export const currentUserId = (): string => currentActor().userId;
export const isAdminActor = (): boolean => currentActor().role !== 'user';
