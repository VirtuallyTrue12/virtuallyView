import type { ItemDownload } from './api';

/** One short phrase for what is happening to a single episode, track or album. */
export function itemDownloadLabel(d: ItemDownload): string {
  switch (d.status) {
    case 'downloading': return d.progress > 0 ? `Downloading ${d.progress}%${d.timeleft ? ` · ${d.timeleft} left` : ''}` : 'Downloading';
    case 'importing': return 'Adding to your library';
    case 'queued': return 'Waiting to download';
    case 'paused': return 'Download paused';
    case 'stalled': return 'Download stuck, no sources yet';
    case 'failed': return 'Download failed, will be replaced';
    default: return 'Download in progress';
  }
}

export const isArriving = (d?: ItemDownload): d is ItemDownload => !!d && d.status !== 'completed';
