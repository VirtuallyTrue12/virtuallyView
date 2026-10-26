import { useEffect, useSyncExternalStore } from 'react';

/**
 * Small notices in the corner for things that finished on their own ("English subtitles on", "Ready to watch"),
 * each with at most one action (Undo, Play). They go away by themselves. Call `toast()` from anywhere.
 */
export interface ToastItem { id: number; text: string; tone: 'ok' | 'err' | 'info'; action?: { label: string; run: () => void }; ms: number }

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export function toast(text: string, opts: { tone?: ToastItem['tone']; action?: ToastItem['action']; ms?: number } = {}): number {
  const item: ToastItem = { id: ++seq, text, tone: opts.tone ?? 'ok', action: opts.action, ms: opts.ms ?? (opts.action ? 7000 : 4000) };
  items = [...items.slice(-3), item];
  emit();
  return item.id;
}

export function dismissToast(id: number): void {
  items = items.filter(t => t.id !== id);
  emit();
}

function ToastRow({ t }: { t: ToastItem }) {
  useEffect(() => { const timer = window.setTimeout(() => dismissToast(t.id), t.ms); return () => window.clearTimeout(timer); }, [t]);
  return (
    <div className={`toast toast--${t.tone}`} role={t.tone === 'err' ? 'alert' : 'status'}>
      <span className="toast-text">{t.text}</span>
      {t.action && <button type="button" className="toast-action" onClick={() => { t.action!.run(); dismissToast(t.id); }}>{t.action.label}</button>}
      <button type="button" className="toast-close" onClick={() => dismissToast(t.id)} aria-label="Dismiss">×</button>
    </div>
  );
}

export function Toaster() {
  const list = useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => items, () => items);
  return <div className="toaster" aria-live="polite">{list.map(t => <ToastRow key={t.id} t={t} />)}</div>;
}
