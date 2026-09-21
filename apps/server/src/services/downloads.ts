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

export function getDownloads(): DownloadState[] {
  return downloads.map(d => ({ ...d }));
}

export function findDownload(id: string): DownloadState | undefined {
  return downloads.find(d => d.id === id);
}

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

function update(id: string, patch: Partial<DownloadState>) {
  downloads = downloads.map(d => (d.id === id ? { ...d, ...patch } : d));
}

export function pauseDownload(id: string): DownloadState | undefined {
  const target = downloads.find(d => d.id === id);
  if (!target || target.status === 'importing' || target.status === 'completed') return target;
  update(id, { status: 'paused', speed: undefined, eta: undefined });
  return downloads.find(d => d.id === id);
}

export function resumeDownload(id: string): DownloadState | undefined {
  const target = downloads.find(d => d.id === id);
  if (!target) return target;
  update(id, { status: 'downloading', speed: '18.2 MB/s', eta: 'Computed on refresh' });
  return downloads.find(d => d.id === id);
}

export function removeDownload(id: string): boolean {
  const before = downloads.length;
  downloads = downloads.filter(d => d.id !== id);
  return downloads.length !== before;
}

export function removeDownloadByMediaId(mediaId: string): boolean {
  const before = downloads.length;
  downloads = downloads.filter(d => d.mediaId !== mediaId);
  return downloads.length !== before;
}