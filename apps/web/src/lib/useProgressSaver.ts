import { useCallback, useEffect, useRef } from 'react';
import { api } from './api';

const SAVE_INTERVAL_MS = 5000;

/** Saves watch position server-side every few seconds and on leave. */
export function useProgressSaver(kind: 'movie' | 'episode', id: string | undefined, seriesId?: string) {
  const latest = useRef<{ position: number; duration: number } | null>(null);
  const sentAt = useRef(0);

  const flush = useCallback(() => {
    const value = latest.current;
    if (!id || !value) return;
    sentAt.current = Date.now();
    void api.saveProgress(kind, id, value.position, value.duration, seriesId).catch(() => {});
  }, [kind, id, seriesId]);

  const onProgress = useCallback((position: number, duration: number) => {
    if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return;
    latest.current = { position, duration };
    if (Date.now() - sentAt.current >= SAVE_INTERVAL_MS) flush();
  }, [flush]);

  useEffect(() => {
    latest.current = null;
    sentAt.current = 0;
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [id, flush]);

  return { onProgress, flush };
}
