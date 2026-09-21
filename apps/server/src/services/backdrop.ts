import type { Media } from '@virtuallyview/types';
import { getAdapter } from './registry.js';

export interface AuthBackdrop {
  title: string;
  poster?: string;
  backdrop?: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; value: AuthBackdrop | null } | null = null;

async function safeItems(adapter: { getItems: () => Promise<Media[]> }): Promise<Media[]> {
  try {
    return await adapter.getItems();
  } catch {
    return [];
  }
}

async function pickBackdrop(): Promise<AuthBackdrop | null> {
  const radarr = getAdapter('radarr');
  const sonarr = getAdapter('sonarr');
  const [movies, series] = await Promise.all([safeItems(radarr), safeItems(sonarr)]);
  const all = [...movies, ...series].filter(item => item.artwork?.backdrop);
  if (!all.length) return null;
  // Prefer something already downloaded so the art matches what the user owns.
  const available = all.filter(item => item.status === 'available');
  const pool = available.length ? available : all;
  const item = pool[Math.floor(Math.random() * pool.length)];
  return {
    title: item.title,
    poster: item.artwork?.poster,
    backdrop: item.artwork?.backdrop
  };
}

/**
 * A piece of cover art from the user's own library for the sign-in screen.
 * This endpoint is deliberately public (it runs before authentication) and
 * exposes nothing but artwork URLs the library already shows.
 */
export async function getAuthBackdrop(): Promise<AuthBackdrop | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  let value: AuthBackdrop | null = null;
  try {
    value = await pickBackdrop();
  } catch {
    value = null;
  }
  cache = { at: Date.now(), value };
  return value;
}
