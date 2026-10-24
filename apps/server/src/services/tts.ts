import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../lib/paths.js';

/**
 * Natural speech for DJ mode and radio announcements, from the optional local KittenTTS service (`kitten`, see
 * docker/kitten). Runs on this machine, so no text leaves it. Each line is cached as a WAV file, because the
 * same intros come up again and again.
 */

export const TTS_VOICES = [
  { id: 'Jasper', name: 'Jasper (radio host)' },
  { id: 'Bruno', name: 'Bruno (deep)' },
  { id: 'Hugo', name: 'Hugo' },
  { id: 'Leo', name: 'Leo' },
  { id: 'Bella', name: 'Bella' },
  { id: 'Luna', name: 'Luna' },
  { id: 'Rosie', name: 'Rosie' },
  { id: 'Kiki', name: 'Kiki (bright)' }
] as const;
export const DEFAULT_VOICE = 'Jasper';

const BASE = (process.env.KITTEN_URL ?? 'http://kitten:8020').replace(/\/$/, '');
const CACHE_DIR = path.join(DATA_DIR, 'tts-cache');

let downUntil = 0;

/** A WAV of the line, or null when no voice service is running (the page then uses the browser's own voice). */
export async function speech(text: string, voice: string): Promise<Buffer | null> {
  const name = TTS_VOICES.some(v => v.id === voice) ? voice : DEFAULT_VOICE;
  const file = path.join(CACHE_DIR, `${createHash('sha1').update(`kitten|${name}|${text}`).digest('hex')}.wav`);
  if (existsSync(file)) return readFileSync(file);
  if (Date.now() < downUntil) return null;
  try {
    const res = await fetch(`${BASE}/tts?${new URLSearchParams({ text, voice: name })}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    const audio = Buffer.from(await res.arrayBuffer());
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, audio);
    return audio;
  } catch (e) {
    // Not installed or not running: do not try again on every track change.
    if (!(e instanceof Error && e.name === 'TimeoutError')) downUntil = Date.now() + 60_000;
    return null;
  }
}

/** True once the voice service has its model loaded. */
export async function ttsAvailable(): Promise<boolean> {
  try { return (await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}
