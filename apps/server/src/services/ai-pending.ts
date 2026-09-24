import { randomBytes } from 'node:crypto';
import type { Actor } from './user-context.js';

// A confirmation is a record the SERVER issued, not something the browser
// describes. It names the person it was issued to, the tool and its exact
// arguments, and works once, for a few minutes. Confirming sends only its id,
// so the browser cannot change what will run or replay an old confirmation.

interface Pending {
  userId: string;
  tool: string;
  arguments: Record<string, unknown>;
  expiresAt: number;
}

const TTL_MS = 5 * 60_000;
const MAX = 500;
const pending = new Map<string, Pending>();

export function issuePending(actor: Actor, tool: string, args: Record<string, unknown>): string {
  const now = Date.now();
  for (const [id, item] of pending) if (item.expiresAt <= now) pending.delete(id);
  while (pending.size >= MAX) pending.delete(pending.keys().next().value as string);
  const id = randomBytes(16).toString('hex');
  pending.set(id, { userId: actor.userId, tool, arguments: JSON.parse(JSON.stringify(args)) as Record<string, unknown>, expiresAt: now + TTL_MS });
  return id;
}

/** Removes and returns the confirmation if it is this person's, unused and unexpired. */
export function takePending(actor: Actor, id: string): { tool: string; arguments: Record<string, unknown> } | null {
  const item = typeof id === 'string' ? pending.get(id) : undefined;
  if (!item || item.userId !== actor.userId) return null;
  pending.delete(id);
  if (item.expiresAt <= Date.now()) return null;
  return { tool: item.tool, arguments: item.arguments };
}
