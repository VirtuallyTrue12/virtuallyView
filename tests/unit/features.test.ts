import { describe, expect, it } from 'vitest';
import { ratingAllowed, filterByRating } from '../../apps/server/src/services/parental';
import { runAsActor } from '../../apps/server/src/services/user-context';
import { startQuickConnect, approveQuickConnect, pollQuickConnect } from '../../apps/server/src/services/quick-connect';
import { ffmpegTranscodeArgs } from '../../apps/server/src/services/transcode';

const kid = (maxRating: string) => ({ userId: 'k', username: 'kid', role: 'user' as const, maxRating });

describe('age limits', () => {
  it('ladders movie and TV ratings together', () => {
    runAsActor(kid('PG-13'), () => {
      expect(ratingAllowed('PG')).toBe(true);
      expect(ratingAllowed('PG-13')).toBe(true);
      expect(ratingAllowed('TV-14')).toBe(true);
      expect(ratingAllowed('R')).toBe(false);
      expect(ratingAllowed('TV-MA')).toBe(false);
    });
  });

  it('hides unrated titles from limited viewers only', () => {
    runAsActor(kid('G'), () => expect(ratingAllowed(undefined)).toBe(false));
    runAsActor({ userId: 'a', username: 'admin', role: 'admin', maxRating: 'G' }, () => expect(ratingAllowed('NC-17')).toBe(true));
    runAsActor({ userId: 'u', username: 'free', role: 'user' }, () => expect(ratingAllowed(undefined)).toBe(true));
  });

  it('never hides music', () => {
    runAsActor(kid('G'), () => {
      const shown = filterByRating([{ type: 'artist' }, { type: 'movie', certification: 'R' }, { type: 'series', certification: 'TV-G' }]);
      expect(shown.map(i => i.type)).toEqual(['artist', 'series']);
    });
  });
});

describe('quick connect', () => {
  it('approves once and hands the account to the waiting device', () => {
    const started = startQuickConnect('TV')!;
    expect(pollQuickConnect(started.secret)).toEqual({ status: 'pending' });
    expect(approveQuickConnect('nope', 'u1').ok).toBe(false);
    expect(approveQuickConnect(started.code, 'u1')).toMatchObject({ ok: true, device: 'TV' });
    expect(pollQuickConnect(started.secret)).toEqual({ status: 'approved', userId: 'u1' });
    expect(pollQuickConnect(started.secret)).toEqual({ status: 'expired' });
  });

  it('an unknown secret is expired, not pending', () => {
    expect(pollQuickConnect('x'.repeat(48))).toEqual({ status: 'expired' });
  });
});

describe('picture subtitles', () => {
  it('draws the chosen picture stream onto the video and re-encodes', () => {
    const args = ffmpegTranscodeArgs('/m/a.mkv', 0, { burn: 2, copyVideo: true, height: 720 });
    expect(args).toContain('-filter_complex');
    expect(args[args.indexOf('-filter_complex') + 1]).toBe('[0:v:0][0:s:2]overlay,scale=-2:720[v]');
    expect(args).toContain('[v]');
    expect(args).not.toContain('copy');
    expect(args).toContain('libx264');
  });

  it('leaves normal conversion untouched', () => {
    const args = ffmpegTranscodeArgs('/m/a.mkv', 0, { copyVideo: true });
    expect(args).not.toContain('-filter_complex');
    expect(args).toContain('copy');
  });
});

import { cinemaNotice, isStillInCinemas, warningsFor } from '../../apps/server/src/services/release-check';

describe('release checks', () => {
  const now = Date.parse('2026-09-21T12:00:00Z');
  const inCinemas = { status: 'inCinemas', inCinemas: '2026-07-15T00:00:00Z', digitalRelease: '2026-11-15T00:00:00Z', physicalRelease: '2026-11-17T00:00:00Z' };

  it('knows a film without a home release is still in cinemas', () => {
    expect(isStillInCinemas(inCinemas, now)).toBe(true);
    expect(isStillInCinemas({ ...inCinemas, digitalRelease: '2026-08-01T00:00:00Z' }, now)).toBe(false);
    expect(isStillInCinemas({ status: 'released' }, now)).toBe(false);
    expect(cinemaNotice(inCinemas, now)).toMatch(/camera recordings/);
    expect(cinemaNotice(inCinemas, now)).toMatch(/November/);
    expect(cinemaNotice({ status: 'announced', inCinemas: '2026-12-16T00:00:00Z' }, now)).toMatch(/not in cinemas until December 16, 2026/);
  });

  it('flags a file whose length does not match the film', () => {
    const warnings = warningsFor({ runtime: 173, quality: 'Bluray-1080p', fileInfo: { path: '/m/a.mp4', runtimeSeconds: 86 * 60 } }, now);
    expect(warnings.map(w => w.code)).toEqual(['suspect-file']);
    expect(warnings[0]?.message).toMatch(/86 minutes.*173/);
  });

  it('flags a web or disc label that predates the home release', () => {
    const warnings = warningsFor({ runtime: 173, quality: 'WEBRip-1080p', release: inCinemas, fileInfo: { path: '/m/a.mp4', runtimeSeconds: 173 * 60 } }, now);
    expect(warnings.map(w => w.code)).toEqual(['suspect-file']);
  });

  it('labels camera copies and leaves good files alone', () => {
    expect(warningsFor({ runtime: 100, quality: 'CAM', fileInfo: { path: '/m/a.mp4', runtimeSeconds: 6000 } }, now).map(w => w.code)).toEqual(['camera-copy']);
    expect(warningsFor({ runtime: 100, quality: 'Bluray-1080p', release: { status: 'released' }, fileInfo: { path: '/m/a.mp4', runtimeSeconds: 6100 } }, now)).toEqual([]);
    expect(warningsFor({ runtime: 100, quality: 'CAM' }, now)).toEqual([]);
  });
});

import { cleanReleaseName, releaseQualityLabel } from '../../apps/server/src/services/names';

describe('name sanitization', () => {
  it.each([
    ['Mr Robot S04E11 eXit 1080p AMZN WEB-DL DDP5 1 H 264-FLUX', 'Mr Robot S04E11 eXit'],
    ['Mr.Robot.S03.1080p.BluRay.x264-ROVERS', 'Mr Robot S03'],
    ['The Odyssey (2026) [1080p] [WEBRip] [5.1] [YTS.GG - YTS.BZ]', 'The Odyssey (2026)'],
    ['Captain Marvel (2019) [BluRay] [1080p] [YTS.AM]', 'Captain Marvel (2019)'],
    ['Linkin Park - Meteora (Tracks, Log, Cue, Scans) (2003) [FLAC] 88', 'Linkin Park - Meteora (2003) 88'],
    ['Troy.2004.DC.1080p.BluRay.x264.AAC-ETRG', 'Troy 2004 DC']
  ])('%s', (raw, clean) => expect(cleanReleaseName(raw)).toBe(clean));

  it('keeps a readable label for the technical part', () => {
    expect(releaseQualityLabel('Show S01E01 1080p AMZN WEB-DL DDP5 1 H 264-FLUX')).toBe('1080p WEB-DL');
    expect(releaseQualityLabel('Linkin Park - Living Things [2012] [Hi-Res] [FLAC-24Bit]')).toBe('FLAC 24-bit');
  });
});

import { detectIntent, inScope, bestMatch } from '../../apps/server/src/services/ai-router';

describe('assistant router', () => {
  it.each([
    ['What is downloading right now?', 'downloads'],
    ['show me the queue', 'downloads'],
    ['why is Linkin Park not showing any tracks', 'diagnose'],
    ['debug my downloads', 'diagnose'],
    ['any failed downloads?', 'diagnose'],
    ['how many movies do I have', 'library'],
    ['my requests', 'requests'],
    ['retry Mr Robot', 'retry'],
    ['pause Captain Marvel', 'download-action'],
    ['help', 'help'],
    ['which subtitles are missing', 'subtitles'],
    ['switch to midnight theme', 'themes']
  ])('%s -> %s', (text, kind) => expect(detectIntent(text)?.kind).toBe(kind));

  it('reads a request and its type', () => {
    expect(detectIntent('request the series Severance')).toEqual({ kind: 'request', mediaType: 'series', title: 'Severance' });
    expect(detectIntent('request Dune')).toEqual({ kind: 'request', mediaType: 'movie', title: 'Dune' });
    expect(detectIntent('request the artist Adele')).toEqual({ kind: 'request', mediaType: 'artist', title: 'Adele' });
  });

  it('stays on topic', () => {
    expect(inScope('what is the capital of France')).toBe(false);
    expect(inScope('write me a poem')).toBe(false);
    expect(inScope('is the server ok')).toBe(true);
    expect(inScope('why no episodes')).toBe(true);
  });

  it('matches a name loosely', () => {
    const names = ['Mr Robot S04E09 409 Conflict', 'Mr Robot', 'Captain Marvel (2019)'];
    expect(bestMatch('mr robot', names, n => n)).toBe('Mr Robot');
    expect(bestMatch('captain marvel', names, n => n)).toBe('Captain Marvel (2019)');
    expect(bestMatch('nothing here', names, n => n)).toBeUndefined();
  });
});

describe('assistant subjects', () => {
  it.each([
    ['why is Linkin Park not showing any tracks', 'linkin park'],
    ['why is Mr Robot season 4 missing', 'mr robot season 4'],
    ['retry Mr Robot', 'mr robot'],
    ['debug the odyssey', 'odyssey'],
    ["what's wrong with Taylor Swift", 'taylor swift']
  ])('%s -> %s', (text, subject) => {
    const intent = detectIntent(text) as { subject?: string } | null;
    expect(intent?.subject).toBe(subject);
  });
});

import { parseM3u, rewriteHls, verifyRelay } from '../../apps/server/src/services/live-tv';
import { inside, listFolder } from '../../apps/server/src/services/library-folders';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('live tv playlists', () => {
  const m3u = '#EXTM3U\n#EXTINF:-1 tvg-id="a" tvg-logo="http://x/l.png" group-title="News",Channel One\nhttp://h/one.m3u8\n#EXTINF:-1,Two\nhttp://h/two.ts\n#EXTINF:-1,Bad\nrtmp://h/nope\n';
  it('reads channels, groups and logos', () => {
    const channels = parseM3u(m3u, 'p');
    expect(channels.map(c => c.name)).toEqual(['Channel One', 'Two']);
    expect(channels[0]).toMatchObject({ group: 'News', logo: 'http://x/l.png', url: 'http://h/one.m3u8' });
  });
  it('sends every stream address back through the server, signed', () => {
    const out = rewriteHls('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nseg1.ts\n', 'http://h/live/index.m3u8');
    const link = /\/api\/live\/relay\?u=([^&]+)&e=(\d+)&s=(\w+)/.exec(out.split('\n')[3] ?? '')!;
    expect(decodeURIComponent(link[1]!)).toBe('http://h/live/seg1.ts');
    expect(verifyRelay('http://h/live/seg1.ts', link[3]!, link[2]!)).toBe(true);
    expect(verifyRelay('http://evil/x', link[3]!, link[2]!)).toBe(false);
    expect(verifyRelay('http://h/live/seg1.ts', link[3]!, String(Date.now() - 1000))).toBe(false);
    expect(out).toMatch(/URI="\/api\/live\/relay\?u=http%3A%2F%2Fh%2Flive%2Fkey\.bin/);
  });
});

describe('photo and book folders', () => {
  it('stay inside their root, links included', () => {
    const root = mkdtempSync(join(tmpdir(), 'vv-photos-'));
    const outside = mkdtempSync(join(tmpdir(), 'vv-outside-'));
    mkdirSync(join(root, 'trip'));
    writeFileSync(join(root, 'trip', 'a.jpg'), 'x');
    writeFileSync(join(root, 'trip', 'notes.txt'), 'x');
    writeFileSync(join(outside, 'secret.jpg'), 'x');
    symlinkSync(outside, join(root, 'link'));
    expect(inside(root, 'trip/a.jpg')).toBeTruthy();
    expect(inside(root, '../' + outside.split('/').pop())).toBeNull();
    expect(inside(root, 'link/secret.jpg')).toBeNull();
    expect(inside(root, '/etc/passwd')).toBeNull();
    expect(listFolder(root, 'trip', /\.jpg$/i)?.files.map(f => f.name)).toEqual(['a.jpg']);
    expect(listFolder(root, '..', /\.jpg$/i)).toBeNull();
  });
});
