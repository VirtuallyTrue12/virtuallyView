import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import path from 'node:path';
import { DATA_DIR } from '../lib/paths.js';

/**
 * Natural speech for DJ mode and radio announcements, from a local Piper voice server (the optional `piper`
 * service, which speaks the Wyoming protocol). Runs on this machine, so no text leaves it. Each line is cached
 * as a WAV file, because the same intros come up again and again.
 */

export const TTS_VOICES = [
  { id: 'en_US-ryan-high', name: 'Ryan (US, radio host)' },
  { id: 'en_US-lessac-medium', name: 'Lessac (US, warm)' },
  { id: 'en_US-amy-medium', name: 'Amy (US)' },
  { id: 'en_GB-alan-medium', name: 'Alan (UK)' },
  { id: 'en_GB-jenny_dioco-medium', name: 'Jenny (UK)' }
] as const;
export const DEFAULT_VOICE = 'en_US-ryan-high';

const HOST = process.env.PIPER_HOST ?? 'piper';
const PORT = Number(process.env.PIPER_PORT ?? 10200);
const CACHE_DIR = path.join(DATA_DIR, 'tts-cache');

type Header = { type: string; data?: Record<string, unknown>; data_length?: number; payload_length?: number };

/** Asks the voice server for one line and collects the raw PCM it streams back. */
function synthesize(text: string, voice: string, timeoutMs = 20000): Promise<{ pcm: Buffer; rate: number; width: number; channels: number }> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: HOST, port: PORT });
    const chunks: Buffer[] = [];
    let format = { rate: 22050, width: 2, channels: 1 };
    let buf = Buffer.alloc(0);
    let pending: Header | null = null;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error); else resolve({ pcm: Buffer.concat(chunks), ...format });
    };
    const timer = setTimeout(() => finish(new Error('The voice server took too long.')), timeoutMs);
    socket.on('error', e => finish(e));
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ type: 'synthesize', data: { text, voice: { name: voice } } })}\n`);
    });
    socket.on('data', data => {
      buf = Buffer.concat([buf, data]);
      for (;;) {
        if (!pending) {
          const nl = buf.indexOf(10);
          if (nl < 0) return;
          pending = JSON.parse(buf.subarray(0, nl).toString('utf8')) as Header;
          buf = buf.subarray(nl + 1);
        }
        const dataLen = pending.data_length ?? 0;
        const payloadLen = pending.payload_length ?? 0;
        if (buf.length < dataLen + payloadLen) return;
        const extra = dataLen ? JSON.parse(buf.subarray(0, dataLen).toString('utf8')) as Record<string, unknown> : {};
        const payload = buf.subarray(dataLen, dataLen + payloadLen);
        buf = buf.subarray(dataLen + payloadLen);
        const event = { ...pending, data: { ...pending.data, ...extra } };
        pending = null;
        if (event.type === 'audio-start' || event.type === 'audio-chunk') {
          const d = event.data as { rate?: number; width?: number; channels?: number };
          format = { rate: d.rate ?? format.rate, width: d.width ?? format.width, channels: d.channels ?? format.channels };
          if (event.type === 'audio-chunk') chunks.push(Buffer.from(payload));
        } else if (event.type === 'audio-stop') { finish(); return; }
        else if (event.type === 'error') { finish(new Error(String(event.data?.text ?? 'The voice server failed.'))); return; }
      }
    });
    socket.on('close', () => finish(chunks.length ? undefined : new Error('The voice server closed the connection.')));
  });
}

export function wav(pcm: Buffer, rate: number, width: number, channels: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * width * channels, 28); header.writeUInt16LE(width * channels, 32);
  header.writeUInt16LE(width * 8, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

let downUntil = 0;
const unreachable = (e: unknown) => /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH/.test(String((e as NodeJS.ErrnoException)?.code ?? e));

/** A WAV of the line, or null when no voice server is running (the page then uses the browser's own voice). */
export async function speech(text: string, voice: string): Promise<Buffer | null> {
  const name = TTS_VOICES.some(v => v.id === voice) ? voice : DEFAULT_VOICE;
  const file = path.join(CACHE_DIR, `${createHash('sha1').update(`${name}|${text}`).digest('hex')}.wav`);
  if (existsSync(file)) return readFileSync(file);
  if (Date.now() < downUntil) return null;
  try {
    let out;
    // A voice other than the default downloads on its first use (about 60 MB), so it gets longer.
    try { out = await synthesize(text, name, name === DEFAULT_VOICE ? 20000 : 120000); }
    catch (e) { if (name === DEFAULT_VOICE || unreachable(e)) throw e; out = await synthesize(text, DEFAULT_VOICE); }
    if (!out.pcm.length) return null;
    const audio = wav(out.pcm, out.rate, out.width, out.channels);
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, audio);
    return audio;
  } catch (e) {
    // Not installed or not running: do not try again on every track change.
    if (unreachable(e)) downUntil = Date.now() + 60_000;
    return null;
  }
}

export async function ttsAvailable(): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect({ host: HOST, port: PORT });
    const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(1500, () => done(false));
    socket.on('connect', () => done(true));
    socket.on('error', () => done(false));
  });
}
