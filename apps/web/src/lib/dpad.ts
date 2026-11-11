import { tick } from './remote-sound';

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
// Links and buttons marked tabindex=-1 are duplicates of another control (a card's title link): not remote stops.
const SKIP = '[tabindex="-1"]';
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
  // Within a screen of the viewport either way: far-off items are not "next". A sideways scrolling row is the
  // exception: its cards sit far to the right until focus scrolls them in.
  const sideways = r.right > -window.innerWidth && r.left < window.innerWidth * 2 || inRow(el);
  return r.bottom > -window.innerHeight && r.top < window.innerHeight * 2 && sideways;
}

function inRow(el: HTMLElement): boolean {
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
  }
  return false;
}

/** Focusable controls the remote can reach right now, skipping containers that hold other controls. */
function reachable(scope: ParentNode): HTMLElement[] {
  const all = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => visible(el) && !ownZone(el) && !el.matches(SKIP));
  return all.filter(el => !all.some(other => other !== el && el.contains(other)));
}

/** Inside something fixed to the screen (checked up to the page root). Sticky parts of a page (the guide's channel column) are page content. */
function isFixed(el: Element): boolean {
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    const position = getComputedStyle(n).position;
    if (position === 'fixed' || (position === 'sticky' && !n.closest('main'))) return true;
  }
  return false;
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
    tick();
    first.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
  }
  // Bars pinned to the screen (the music player, a tab bar) sit "below" everything. From the page, move through
  // the page first and reach a pinned bar only when nothing else lies that way; from inside a bar, anything goes.
  const pinned = (el: Element) => isFixed(el);
  const toBox = (el: HTMLElement) => ({ item: el, box: boxOf(el) });
  const inPage = pinned(active) ? candidates : candidates.filter(el => !pinned(el));
  const target = nearestInDirection(boxOf(active), inPage.map(toBox), dir)
    ?? (inPage.length !== candidates.length ? nearestInDirection(boxOf(active), candidates.map(toBox), dir) : null);
  if (!target) return false;
  tick();
  arm(target);
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return true;
}

function onKeyDown(e: KeyboardEvent) {
  if (!isTv() || e.altKey || e.ctrlKey || e.metaKey) return;
  const active = document.activeElement as HTMLElement | null;
  // Escape (the remote's Back on some TVs) closes an open dialog. Backspace is left to text boxes.
  if (e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack') {
    if (!e.isTrusted) return; // back() sends a fake Escape to the page's own handlers
    // Typing in a box: Escape leaves the box (highlighted again) instead of going back a page.
    if (e.key === 'Escape' && active?.matches(TEXT_ENTRY) && !isArmed(active)) { active.blur(); active.focus({ preventScroll: true }); e.preventDefault(); return; }
    if (back()) e.preventDefault();
    // Nothing open: a keyboard's Escape goes back a page like the remote's Back does (a TV browser does it by itself).
    else if (e.key === 'Escape' && !ownZone(active) && window.location.pathname !== '/' && window.history.length > 1) window.history.back();
    return;
  }
  // OK on a highlighted text box opens the keyboard; until then the box is only highlighted (see arm()).
  if (e.key === 'Enter' && active && isArmed(active)) {
    e.preventDefault();
    startTyping(active);
    return;
  }
  const dir = KEYS[e.key];
  if (!dir) return;
  if (active && active.matches(TEXT_ENTRY) && !isArmed(active)) {
    // Typing: left and right move inside the text; up and down leave the box, so the remote never gets stuck.
    if (dir === 'left' || dir === 'right') {
      // At the end of the text, Right leaves the box (to the Show button beside a password); at the start, Left does.
      const f = active as HTMLInputElement;
      const at = f.selectionStart;
      const edge = at === null || (f.selectionEnd === at && (dir === 'right' ? at === f.value.length : at === 0));
      if (!edge || !moveFocus(dir)) return;
      e.preventDefault(); e.stopPropagation();
      return;
    }
    if (moveFocus(dir)) { e.preventDefault(); e.stopPropagation(); }
    return;
  }
  // Areas with their own arrow keys (the video player, carousels that handle them) keep them while focus is in them.
  if (ownZone(active)) return;
  if (!active || active === document.body) {
    // A page-level area with its own keys (the video player) takes them; a small one in a pinned bar (the music
    // bar's seek slider) or an open menu must not swallow the first press on every other page.
    if ([...document.querySelectorAll('[data-dpad="own"]')].some(z => !isFixed(z))) return;
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
  // Menus and dialogs without a Close button all close on Escape: send it to them.
  const open = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], [role="menu"], [aria-haspopup][aria-expanded="true"]')].find(el => !ownZone(el));
  if (!open) return false;
  (document.activeElement && document.activeElement !== document.body ? document.activeElement : document).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return true;
}

/**
 * A text box the remote lands on is only highlighted: read-only, so Android does not pop its keyboard up just
 * because focus passed through. OK (Enter) makes it editable and opens the keyboard.
 */
function arm(el: HTMLElement): void {
  if (!isTv() || !el.matches(TEXT_ENTRY) || !('readOnly' in el)) return;
  const field = el as HTMLInputElement | HTMLTextAreaElement;
  if (field.readOnly) return; // read-only on its own: nothing to type into anyway
  field.readOnly = true;
  field.dataset.dpadArmed = '1';
}

export const isArmed = (el: Element): boolean => (el as HTMLElement).dataset?.dpadArmed === '1';

function disarm(el: HTMLElement): void {
  if (!isArmed(el)) return;
  (el as HTMLInputElement).readOnly = false;
  delete el.dataset.dpadArmed;
}

function startTyping(el: HTMLElement): void {
  disarm(el);
  // Focus again now that it is editable: that is what brings the on-screen keyboard up.
  typing = true;
  try {
    el.blur();
    el.focus({ preventScroll: true });
    el.click();
  } finally { typing = false; }
}

/** Keeps focus inside an open dialog when the remote moves it elsewhere; text boxes reached any way start highlighted. */
function onFocusIn(e: FocusEvent) {
  if (!isTv()) return;
  // A page that focuses its search box by itself must not throw the keyboard up either.
  if (e.target instanceof HTMLElement && e.target.matches(TEXT_ENTRY) && !isArmed(e.target) && !typing) arm(e.target);
  const dialog = openDialog();
  if (!dialog || !(e.target instanceof Node) || dialog.contains(e.target)) return;
  const first = reachable(dialog)[0];
  first?.focus({ preventScroll: true });
}

/** True only while startTyping refocuses a box, so that focus is not armed again. */
let typing = false;

function onFocusOut(e: FocusEvent) {
  if (e.target instanceof HTMLElement) disarm(e.target);
}

/**
 * After a page change, put focus on the first control of the page when it was lost (the card that was clicked is
 * gone). Focus left on the navigation bar stays there. Pages load lazily, so it tries for about two seconds.
 */
export function settleFocus(): void {
  if (!isTv()) return;
  let tries = 0;
  const attempt = () => {
    const active = document.activeElement;
    if (active && active !== document.body && document.contains(active)) return;
    const main = document.querySelector('main');
    const first = main && reachable(main).sort((x, y) => boxOf(x).top - boxOf(y).top || boxOf(x).left - boxOf(y).left)[0];
    if (first) { first.focus({ preventScroll: true }); first.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return; }
    if (++tries < 14) window.setTimeout(attempt, 150);
  };
  window.setTimeout(attempt, 150);
}

let started = false;

/** Turns on remote navigation once per page. Does nothing unless `html.tv` is set. */
export function initDpad(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  // Capture phase: this runs before the page's own key handlers, so it can take an arrow they would otherwise use.
  window.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  // The first load on the home page starts on the navigation, so the remote has somewhere to go.
  window.setTimeout(() => {
    if (!isTv() || window.location.pathname !== '/') return;
    if (document.activeElement && document.activeElement !== document.body) return;
    document.querySelector<HTMLElement>('nav a[href]')?.focus({ preventScroll: true });
  }, 700);
  (window as unknown as { vvBack?: () => boolean }).vvBack = back;
}
