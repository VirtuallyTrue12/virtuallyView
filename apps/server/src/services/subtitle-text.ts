import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isAllowedMediaFile } from './media-roots.js';
import { extractSubtitleVtt, probeMedia } from './transcode.js';

/** Browsers only load WebVTT in <track>; convert SRT/ASS sidecars on the fly. */
export function subtitleToVtt(text: string, ext: string): string {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (ext === '.vtt') return clean;
  if (ext === '.srt') {
    return 'WEBVTT\n\n' + clean.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  }
  // .ass / .ssa: keep Dialogue lines only, strip override tags.
  const toTime = (t: string) => {
    const m = /^(\d+):(\d{2}):(\d{2})[.](\d{2})$/.exec(t.trim());
    return m ? `${m[1].padStart(2, '0')}:${m[2]}:${m[3]}.${m[4]}0` : '00:00:00.000';
  };
  const cues: string[] = [];
  for (const line of clean.split('\n')) {
    if (!line.startsWith('Dialogue:')) continue;
    const parts = line.slice(9).split(',');
    if (parts.length < 10) continue;
    const body = parts.slice(9).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').trim();
    if (body) cues.push(`${toTime(parts[1])} --> ${toTime(parts[2])}\n${body}`);
  }
  return 'WEBVTT\n\n' + cues.join('\n\n');
}

/** "00:01:02.500" or "01:02.500" to seconds. */
function parseVttTime(t: string): number {
  const parts = t.trim().replace(',', '.').split(':').map(Number);
  if (parts.some(n => Number.isNaN(n))) return Number.NaN;
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

/**
 * Plain dialogue from a WebVTT file. Only cues that START before `beforeSeconds` are kept, so a recap
 * built from it never reaches past the viewer's point (null keeps every cue). Tags are stripped and
 * repeated lines in a row are dropped.
 */
export function vttPlainText(vtt: string, beforeSeconds: number | null = null): string {
  const lines: string[] = [];
  for (const block of vtt.split(/\n{2,}/)) {
    const parts = block.split('\n');
    const at = parts.findIndex(line => line.includes('-->'));
    if (at < 0) continue;
    const start = parseVttTime(parts[at].split('-->')[0]);
    if (Number.isNaN(start)) continue;
    if (beforeSeconds !== null && start >= beforeSeconds) continue;
    const text = parts.slice(at + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text && lines[lines.length - 1] !== text) lines.push(text);
  }
  return lines.join('\n');
}

/** The last `max` characters of `text`, starting at a line break where one is close, so the newest lines survive. */
export function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  const tail = text.slice(text.length - max);
  const newline = tail.indexOf('\n');
  return newline >= 0 && newline < 200 ? tail.slice(newline + 1) : tail;
}

const LANGUAGE_TAG = /^\.([a-z]{2,3})$/i;

/** The sidecar subtitle file for a media file: an English one first, then one with no language tag. */
function englishSidecar(mediaFilePath: string): string | null {
  const dir = path.dirname(mediaFilePath);
  const baseName = path.basename(mediaFilePath, path.extname(mediaFilePath)).toLowerCase();
  const entries = readdirSync(dir).filter(entry => {
    const ext = path.extname(entry).toLowerCase();
    return ['.srt', '.vtt', '.ass', '.ssa'].includes(ext) && entry.toLowerCase().startsWith(baseName);
  });
  let untagged: string | null = null;
  for (const entry of entries) {
    const candidate = path.join(dir, entry);
    if (!isAllowedMediaFile(candidate)) continue;
    // Between the show's file name and the extension: ".en", ".english" or nothing.
    const between = entry.slice(baseName.length, entry.length - path.extname(entry).length);
    if (!between) { untagged ??= candidate; continue; }
    const lang = LANGUAGE_TAG.exec(between)?.[1]?.toLowerCase();
    if (lang === 'en' || lang === 'eng') return candidate;
  }
  return untagged;
}

/**
 * The English subtitles for a media file as WebVTT: a sidecar file when there is one, otherwise the
 * first English text stream embedded in the file. Null when there are none (or they cannot be read).
 */
export async function englishSubtitleVtt(filePath: string): Promise<string | null> {
  try {
    const sidecar = englishSidecar(filePath);
    if (sidecar) {
      const ext = path.extname(sidecar).toLowerCase();
      return subtitleToVtt(readFileSync(sidecar, 'utf8'), ext);
    }
    const probe = await probeMedia(filePath);
    const stream = (probe.subtitleStreams ?? []).find(sub => sub.text && /^(en|eng)/i.test(sub.language));
    if (!stream) return null;
    return await extractSubtitleVtt(filePath, stream.index);
  } catch {
    return null;
  }
}
