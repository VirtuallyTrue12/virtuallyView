// The maths behind Watch together: the clock offset, where the video should be, and what to do about drift.

export interface SharedState { playing: boolean; position: number; rate: number; seq: number; from: string; at: number; waiting: string[] }
export interface ClockSample { sent: number; received: number; server: number }

/** How far this device's clock is behind the server's (add it to Date.now()). The sample with the shortest round trip is the most trustworthy. */
export function clockOffset(samples: ClockSample[]): number {
  const best = [...samples].sort((a, b) => (a.received - a.sent) - (b.received - b.sent))[0];
  return best ? best.server - (best.sent + best.received) / 2 : 0;
}

/** Where everyone's video should be right now. */
export function expectedPosition(state: SharedState, serverNow: number): number {
  return state.playing && state.waiting.length === 0 ? state.position + ((serverNow - state.at) / 1000) * state.rate : state.position;
}

export type DriftAction = { kind: 'none' } | { kind: 'nudge'; rate: number; ms: number } | { kind: 'seek' };

export const NUDGE = 0.05;

/**
 * `drift` is my position minus where I should be (negative: I am behind).
 * Tiny drift is left alone, small drift is caught up by playing slightly faster or slower for a few seconds
 * (capped at 5%), large drift seeks.
 */
export function driftAction(drift: number, baseRate = 1): DriftAction {
  const size = Math.abs(drift);
  if (size < 0.08) return { kind: 'none' };
  if (size > 2) return { kind: 'seek' };
  const rate = (1 + (drift < 0 ? NUDGE : -NUDGE)) * baseRate;
  return { kind: 'nudge', rate, ms: Math.min(10_000, Math.max(1000, Math.ceil((size / NUDGE) * 1000))) };
}

/** Chat text comes from the server with & < > " ' escaped; show it as the person typed it (React escapes it again). */
export function unescapeChat(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]!);
}
