import { currentActor } from './user-context.js';

export interface AiActionRecord {
  timestamp: string;
  /** Who the assistant acted for; other people do not see this entry. */
  userId: string;
  tool: string;
  arguments: Record<string, unknown>;
  success: boolean;
  requiredConfirmation: boolean;
  message: string;
}

const MAX_ENTRIES = 200;
let history: AiActionRecord[] = [];

const REDACT_KEYS = new Set(['apiKey', 'api_key', 'password', 'token']);

function redact(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = REDACT_KEYS.has(key) ? '[redacted]' : value;
  }
  return out;
}

export function recordAiAction(entry: Omit<AiActionRecord, 'timestamp' | 'userId'>): void {
  history = [{ ...entry, userId: currentActor().userId, arguments: redact(entry.arguments), timestamp: new Date().toISOString() }, ...history].slice(0, MAX_ENTRIES);
}

/** Administrators see everyone's; everyone else sees only their own. */
export function getAiHistory(limit = 50): AiActionRecord[] {
  const actor = currentActor();
  const visible = actor.role === 'user' ? history.filter(entry => entry.userId === actor.userId) : history;
  return visible.slice(0, limit);
}
