export type DownloadState = {
  id: string;
  title: string;
  year?: number;
  progress: number;
  status: 'downloading' | 'importing' | 'paused' | 'queued' | 'completed';
  speed?: string;
  eta?: string;
  size?: string;
  mediaId?: string;
  mediaType?: string;
  artwork?: { poster?: string; backdrop?: string };
};

let downloads: DownloadState[] = [];

let seq = 1000;

export function createDownload(input: Omit<DownloadState, 'id'> & { id?: string }): DownloadState {
  const download: DownloadState = {
    id: input.id ?? `download-${seq++}`,
    title: input.title,
    year: input.year,
    progress: input.progress ?? 0,
    status: input.status ?? 'downloading',
    speed: input.speed,
    eta: input.eta,
    size: input.size,
    mediaId: input.mediaId,
    mediaType: input.mediaType,
    artwork: input.artwork
  };
  downloads = [...downloads, download];
  return download;
}

export function updateDownload(id: string, patch: Partial<DownloadState>): DownloadState | undefined {
  downloads = downloads.map(d => (d.id === id ? { ...d, ...patch } : d));
  return downloads.find(d => d.id === id);
}

