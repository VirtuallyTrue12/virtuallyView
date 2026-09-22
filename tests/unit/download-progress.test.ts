import { describe, expect, it } from 'vitest';
import { downloadLabel, summarise, timeLeft } from '../../apps/web/src/lib/useDownloadProgress';

const row = (mediaId: string, status: string, progress: number, extra: Record<string, unknown> = {}) =>
  ({ id: `q-${mediaId}-${progress}`, title: 'x', mediaId, status, progress, ...extra }) as never;

describe('download progress on titles', () => {
  it('groups a show downloading several episodes into one average', () => {
    const map = summarise([row('sonarr-1', 'downloading', 20), row('sonarr-1', 'downloading', 60), row('radarr-2', 'queued', 0), row('radarr-9', 'completed', 100)]);
    expect(map.get('sonarr-1')).toMatchObject({ state: 'downloading', progress: 40, count: 2 });
    expect(map.get('radarr-2')?.state).toBe('queued');
    expect(map.has('radarr-9')).toBe(false);
  });

  it('shows the most active state when files disagree', () => {
    expect(summarise([row('sonarr-3', 'paused', 50), row('sonarr-3', 'importing', 100)]).get('sonarr-3')?.state).toBe('importing');
    expect(summarise([row('radarr-4', 'failed', 70, { message: 'No usable files' })]).get('radarr-4')).toMatchObject({ state: 'failed', message: 'No usable files' });
  });

  it('writes plain labels and time left', () => {
    expect(downloadLabel({ state: 'downloading', progress: 41.6, count: 1 })).toBe('Downloading 42%');
    expect(downloadLabel({ state: 'downloading', progress: 10, count: 3 })).toBe('Downloading 10% (3 files)');
    expect(downloadLabel({ state: 'importing', progress: 100, count: 1 })).toBe('Adding to library');
    expect(timeLeft('00:12:30')).toBe('13 min left');
    expect(timeLeft('02:05:00')).toBe('2 h 5 min left');
    expect(timeLeft('00:00:40')).toBe('less than 2 min left');
    expect(timeLeft(undefined)).toBe('');
  });
});
