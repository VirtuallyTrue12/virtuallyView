/// <reference types="vite/client" />
// Install-as-an-app helpers: service worker registration, the Chromium install prompt, and device checks.

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

/** Registers the service worker. Production builds only, and only where the browser supports it. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* Offline shell is a bonus, the app works without it. */ });
  });
}

// Chromium fires beforeinstallprompt early, often before Settings is open, so keep the event here.
let deferredPrompt: InstallPromptEvent | null = null;
const installListeners = new Set<() => void>();
const notifyInstall = () => installListeners.forEach(fn => fn());

/** Call once at startup. Catches the install prompt and the installed event. */
export function startInstallCapture(): void {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredPrompt = e as InstallPromptEvent;
    notifyInstall();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notifyInstall();
  });
}

/** The saved install prompt, or null when the browser has not offered one. */
export function getInstallPrompt(): InstallPromptEvent | null {
  return deferredPrompt;
}

/** Runs when the install prompt or install state changes. Returns an unsubscribe function. */
export function subscribeInstall(fn: () => void): () => void {
  installListeners.add(fn);
  return () => { installListeners.delete(fn); };
}

/** Shows the browser's own install dialog. The prompt can only be used once. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | null> {
  const event = deferredPrompt;
  if (!event) return null;
  deferredPrompt = null;
  notifyInstall();
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome;
}

/** True when the app is already open from the home screen or as an installed window. */
export function isInstalledApp(): boolean {
  const standaloneMedia = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  // iOS Safari sets navigator.standalone instead of the media query.
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standaloneMedia || iosStandalone;
}

/** iPhone, iPad and iPod, plus iPadOS which reports itself as a Mac with touch. */
export function isIosDevice(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Add to Home Screen only exists in Safari on iOS, not in Chrome or Firefox on iOS. */
export function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  return isIosDevice() && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}
