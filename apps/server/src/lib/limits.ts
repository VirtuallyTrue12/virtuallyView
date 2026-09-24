// Bounds on how many video conversions (ffmpeg) run at once, so one person
// with a few open tabs, or a stranger with a stolen link, cannot pin the CPU.
const MAX_TOTAL = Number(process.env.VV_MAX_CONVERSIONS ?? 3);
const MAX_PER_USER = Number(process.env.VV_MAX_CONVERSIONS_PER_USER ?? 2);
const perUser = new Map<string, number>();
let total = 0;

/** A release function when a slot was free, otherwise null. Calling release twice is harmless. */
export function acquireConversion(userId: string): (() => void) | null {
  if (total >= MAX_TOTAL || (perUser.get(userId) ?? 0) >= MAX_PER_USER) return null;
  total++;
  perUser.set(userId, (perUser.get(userId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    total--;
    const left = (perUser.get(userId) ?? 1) - 1;
    if (left <= 0) perUser.delete(userId); else perUser.set(userId, left);
  };
}

export const conversionLimits = { total: MAX_TOTAL, perUser: MAX_PER_USER };
/** Longest a single conversion may run before it is stopped. */
export const CONVERSION_MAX_MS = 12 * 3_600_000;
