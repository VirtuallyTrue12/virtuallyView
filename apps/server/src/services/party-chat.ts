// Watch-party chat rules: plain text only, escaped, length-capped, rate-limited. Messages live in memory with the party.

export const CHAT_MAX = 300;
export const REACTIONS = ['👍', '😂', '😮', '❤️', '👏'];

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Clean one chat line: drop control characters, trim, cap, escape. Returns null when nothing is left. */
export function cleanChat(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, CHAT_MAX).trim();
  return text ? text.replace(/[&<>"']/g, c => ESCAPES[c]!) : null;
}

/** Sliding-window limit: true (and the send is recorded) when fewer than `max` sends happened in the last `windowMs`. */
export function allowSend(stamps: number[], now: number, max: number, windowMs: number): boolean {
  while (stamps.length && now - stamps[0]! >= windowMs) stamps.shift();
  if (stamps.length >= max) return false;
  stamps.push(now);
  return true;
}
