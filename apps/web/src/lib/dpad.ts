/**
 * Remote-control navigation for TV browsers and the Android TV app (`html.tv`).
 *
 * Arrow keys move focus to the nearest control in that direction, so a remote's
 * D-pad can reach every card and button. Typing in a text box is left alone, and
 * so is any area that handles its own arrow keys (marked `data-dpad="own"`, such as
 * the video player). An open dialog keeps focus inside itself.
 */

export interface Box { left: number; top: number; right: number; bottom: number }
export type Direction = 'up' | 'down' | 'left' | 'right';
export interface Candidate<T> { item: T; box: Box }

const KEYS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/**
 * The candidate that is nearest to `from` in `dir`. Only candidates that lie ahead of
 * `from` count. Distance along the direction counts in full, and sideways distance
 * counts twice, so a control in the same row beats one far off to the side.
 * Pure, so it can be tested without a browser.
 */
export function nearestInDirection<T>(from: Box, candidates: Candidate<T>[], dir: Direction): T | null {
  const fx = (from.left + from.right) / 2;
  const fy = (from.top + from.bottom) / 2;
  let best: T | null = null;
  let bestScore = Infinity;
  for (const { item, box } of candidates) {
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    const dx = cx - fx;
    const dy = cy - fy;
    const ahead = dir === 'right' ? dx > 0 : dir === 'left' ? dx < 0 : dir === 'down' ? dy > 0 : dy < 0;
    if (!ahead) continue;
    const primary = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy);
    const cross = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = primary + 2 * cross;
    if (score < bestScore) { bestScore = score; best = item; }
  }
  return best;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const TEXT_ENTRY = 'input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="password"], input[type="number"], input[type="tel"], textarea, select, [contenteditable="true"]';

const isTv = () => document.documentElement.classList.contains('tv');
const ownZone = (el: Element | null) => el?.closest('[data-dpad="own"]') ?? null;

/** The open modal dialog, if any. Focus stays inside it while it is open. */
function openDialog(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], dialog[open]');
  return all.length ? all[all.length - 1]! : null;
}

function visible(el: HTMLElement): boolean {
  if (el.closest('[hidden], [aria-hidden="true"]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  // Within a screen of the viewport either way: far-off items are not "next".
  return r.bottom > -window.innerHeight && r.top < window.innerHeight * 2 && r.right > -window.innerWidth && r.left < window.innerWidth * 2;
}

/** Focusable controls the remote can reach right now, skipping containers that hold other controls. */
function reachable(scope: ParentNode): HTMLElement[] {
  const all = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => visible(el) && !ownZone(el));
  return all.filter(el => !all.some(other => other !== el && el.contains(other)));
}

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};

function scopeRoot(): ParentNode {
  return openDialog() ?? document;
}

/** Focus the control nearest in `dir` from the current focus. True when focus moved. */
export function moveFocus(dir: Direction): boolean {
  const scope = scopeRoot();
  const active = document.activeElement as HTMLElement | null;
  const candidates = reachable(scope).filter(el => el !== active);
  if (!active || active === document.body) {
    // Nothing focused yet: start from the first control in reading order.
    const first = candidates.sort((a, b) => boxOf(a).top - boxOf(b).top || boxOf(a).left - boxOf(b).left)[0];
    if (!first) return false;
    first.focus({ preventScroll: true });
    first.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
  }
  const target = nearestInDirection(boxOf(active), candidates.map(el => ({ item: el, box: boxOf(el) })), dir);
  if (!target) return false;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return true;
}

function onKeyDown(e: KeyboardEvent) {
  if (!isTv() || e.altKey || e.ctrlKey || e.metaKey) return;
  const active = document.activeElement as HTMLElement | null;
  // Escape (the remote's Back on some TVs) closes an open dialog. Backspace is left to text boxes.
  if (e.key === 'Escape') {
    if (back()) e.preventDefault();
    return;
  }
  const dir = KEYS[e.key];
  if (!dir) return;
  // Typing and the arrow keys inside a text box belong to the text box.
  if (active && active.matches(TEXT_ENTRY)) return;
  // Areas with their own arrow keys (the video player, carousels that handle them) keep them while focus is in them.
  if (ownZone(active)) return;
  if (!active || active === document.body) {
    if (ownZone(document.querySelector('[data-dpad="own"]'))) return;
  }
  if (moveFocus(dir)) {
    // Stop the page's own arrow handling (a rail that scrolls) from also reacting.
    e.preventDefault();
    e.stopPropagation();
  }
}

/** Back: close the open dialog or menu if there is one. Returns true when something closed. */
export function back(): boolean {
  const close = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"] button[aria-label="Close"]');
  if (close) { close.click(); return true; }
  return false;
}

/** Keeps focus inside an open dialog when the remote moves it elsewhere. */
function onFocusIn(e: FocusEvent) {
  if (!isTv()) return;
  const dialog = openDialog();
  if (!dialog || !(e.target instanceof Node) || dialog.contains(e.target)) return;
  const first = reachable(dialog)[0];
  first?.focus({ preventScroll: true });
}

let started = false;

/** Turns on remote navigation once per page. Does nothing unless `html.tv` is set. */
export function initDpad(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  // Capture phase: this runs before the page's own key handlers, so it can take an arrow they would otherwise use.
  window.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('focusin', onFocusIn);
  // The first load on the home page starts on the navigation, so the remote has somewhere to go.
  window.setTimeout(() => {
    if (!isTv() || window.location.pathname !== '/') return;
    if (document.activeElement && document.activeElement !== document.body) return;
    document.querySelector<HTMLElement>('nav a[href]')?.focus({ preventScroll: true });
  }, 700);
  (window as unknown as { vvBack?: () => boolean }).vvBack = back;
}
