export interface AiActionRecord {
  timestamp: string;
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

export function recordAiAction(entry: Omit<AiActionRecord, 'timestamp'>): void {
  history = [{ ...entry, arguments: redact(entry.arguments), timestamp: new Date().toISOString() }, ...history].slice(0, MAX_ENTRIES);
}

export function getAiHistory(limit = 50): AiActionRecord[] {
  return history.slice(0, limit);
}
