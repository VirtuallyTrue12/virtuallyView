import { useEffect, useMemo, useState } from 'react';
import { api, type MediaItem, type DownloadItem, type RequestItem, type StorageReport } from '../lib/api';
import { Link } from 'react-router-dom';
import { PageHeader, Section, StatTile } from '../components/ui/Page';
import { SvgIcon } from '../components/ui/SvgIcon';

function uniqueCompleted(downloads: DownloadItem[]): DownloadItem[] {
  // One movie can be reported as a completed transfer by qBittorrent AND as a
  // completed manager row by Radarr/Sonarr, so the same title shows up 2-3
  // times. Deduplicate against the strongest identity we have (mediaId, then
  // normalized title + year) so "1 downloaded movie" never reads as "3".
  const seen = new Set<string>();
  const unique: DownloadItem[] = [];
  for (const d of downloads) {
    const key = d.mediaId ?? `${(d.title ?? '').trim().toLowerCase()}::${d.year ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(d);
  }
  return unique;
}

function formatSize(gb: number): string {
  if (!Number.isFinite(gb) || gb <= 0) return '0 GB';
  if (gb >= 1024) return `${(gb / 1024).toFixed(2)} TB`;
  if (gb >= 100) return `${Math.round(gb)} GB`;
  return `${gb.toFixed(1)} GB`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  const rounded = value >= 100 || index < 2 ? Math.round(value) : value.toFixed(1);
  return `${rounded} ${units[index]}`;
}

export default function Statistics() {
  const [movies, setMovies] = useState<MediaItem[]>([]);
  const [series, setSeries] = useState<MediaItem[]>([]);
  const [artists, setArtists] = useState<MediaItem[]>([]);
  const [artistTitles, setArtistTitles] = useState<string[]>([]);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [storage, setStorage] = useState<StorageReport | null>(null);

  useEffect(() => {
    // Music has no bulk "all albums" endpoint, so every artist's albums are
    // fetched in parallel; a failing fetch drops only that artist's albums.
    const loadArtists = () =>
      api.artists()
        .then(async list => {
          setArtists(list);
          const albumLists = await Promise.all(list.map(a =>
            api.artistAlbums(a.id).then(r => r.albums.map(b => b.title)).catch(() => [])
          ));
          setArtistTitles(albumLists.flat());
        })
        .catch(() => setArtists([]));

    Promise.all([
      api.movies().then(setMovies).catch(() => setMovies([])),
      api.series().then(setSeries).catch(() => setSeries([])),
      loadArtists(),
      api.downloads().then(setDownloads).catch(() => setDownloads([])),
      api.requests().then(setRequests).catch(() => setRequests([])),
      api.systemStorage().then(setStorage).catch(() => setStorage(null))
    ]);
  }, []);

  const totalMovies = movies.length;
  const availableMovies = movies.filter(m => m.status === 'available').length;
  const missingMovies = movies.filter(m => m.status === 'missing').length;
  const totalSeries = series.length;
  const availableSeries = series.filter(s => s.status === 'available').length;
  const totalArtists = artists.length;

  const unique = useMemo(() => uniqueCompleted(downloads), [downloads]);
  const activeDownloads = unique.filter(d => d.status === 'downloading' || d.status === 'importing').length;
  // A completed transfer whose title is already in the library is the same
  // movie shown twice, not a second download. Only count completed items that
  // have not been imported into the library yet.
  const libraryTitles = new Set(
    [
      ...movies.map(m => m.title.trim().toLowerCase()),
      ...series.map(s => s.title.trim().toLowerCase()),
      ...artists.map(a => a.title.trim().toLowerCase()),
      ...artistTitles.map(t => t.trim().toLowerCase())
    ]
  );
  const completedDownloads = unique.filter(d => {
    if (d.status !== 'completed') return false;
    return !libraryTitles.has((d.title ?? '').trim().toLowerCase());
  }).length;

  const pendingRequests = requests.filter(r => ['pending', 'searching', 'downloading', 'importing'].includes(r.status)).length;
  const availableRequests = requests.filter(r => r.status === 'available').length;

  // Size is normalized per queue row; report it only per unique item.
  const totalStorage = unique.reduce((sum, d) => {
    if (!d.size) return sum;
    const gb = parseFloat(d.size.replace(/[^0-9.]/g, ''));
    return sum + (isNaN(gb) ? 0 : gb);
  }, 0);

  const stalled = downloads.filter(d => d.status === 'stalled' || d.status === 'failed').length;
  const disk = storage?.disk ?? null;
  const diskPct = disk && disk.totalBytes > 0 ? Math.round((disk.usedBytes / disk.totalBytes) * 100) : null;
  const rootsTotal = storage ? Math.max(1, storage.roots.reduce((sum, r) => sum + (r.exists ? r.bytes : 0), 0)) : 1;
  const insights: Array<{ tone: 'warn' | 'info' | 'ok'; text: string; to?: string; cta?: string }> = [];
  if (diskPct !== null && diskPct >= 90) insights.push({ tone: 'warn', text: `The media drive is ${diskPct}% full. Free some space before more downloads arrive.` });
  if (stalled > 0) insights.push({ tone: 'warn', text: `${stalled} download${stalled === 1 ? '' : 's'} failed or stalled.`, to: '/downloads', cta: 'Open downloads' });
  if (missingMovies > 0) insights.push({ tone: 'info', text: `${missingMovies} movie${missingMovies === 1 ? '' : 's'} in your list ${missingMovies === 1 ? 'is' : 'are'} not downloaded yet.`, to: '/movies', cta: 'See movies' });
  if (pendingRequests > 0) insights.push({ tone: 'info', text: `${pendingRequests} request${pendingRequests === 1 ? ' is' : 's are'} still in progress.`, to: '/requests', cta: 'Open requests' });
  if (insights.length === 0) insights.push({ tone: 'ok', text: 'Nothing needs your attention.' });

  return (
    <main className="page">
      <PageHeader title="Statistics" sub="Your library at a glance" actions={<button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}><SvgIcon name="refresh" size={17} /> Refresh</button>} />

      <div className="ui-stats">
        <StatTile label="Movies" value={availableMovies} hint={`of ${totalMovies} tracked`} />
        <StatTile label="TV shows" value={availableSeries} hint={`of ${totalSeries} tracked`} />
        <StatTile label="Artists" value={totalArtists} hint={`${artistTitles.length} albums`} />
        <StatTile label="Downloading" value={activeDownloads} hint={completedDownloads ? `${completedDownloads} waiting to file` : 'idle'} />
        <StatTile label="Requests" value={pendingRequests + availableRequests} hint={`${pendingRequests} in progress`} />
        <StatTile label="Media size" value={storage ? formatBytes(storage.mediaBytes) : '…'} hint={storage ? `${storage.mediaFiles.toLocaleString()} files` : 'reading folders'} />
      </div>

      <Section title="Worth a look">
        <ul className="stt-insights">
          {insights.map((i, n) => (
            <li key={n} className={`stt-insight stt-insight--${i.tone}`}>
              <SvgIcon name={i.tone === 'ok' ? 'check' : i.tone === 'warn' ? 'alert' : 'info'} size={18} />
              <span>{i.text}</span>
              {i.to && <Link className="btn btn-secondary btn-sm" to={i.to}>{i.cta}</Link>}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Storage" help={storage?.disk ? `${formatBytes(storage.disk.freeBytes)} free of ${formatBytes(storage.disk.totalBytes)} on the media drive.` : undefined}>
        {!storage ? <div className="loading-state">Reading the media folders…</div> : (
          <div className="ui-card">
            {disk && diskPct !== null && (
              <div className="stt-disk" role="img" aria-label={`Drive ${diskPct}% full`}>
                <div className="stt-disk-bar">
                  {storage.roots.map((r, i) => r.exists && r.bytes > 0 ? <span key={r.path} className={`stt-seg stt-seg--${i % 6}`} style={{ width: `${Math.max(0.5, (r.bytes / disk.totalBytes) * 100)}%` }} title={`${r.name}: ${formatBytes(r.bytes)}`} /> : null)}
                  <span className="stt-seg stt-seg--other" style={{ width: `${Math.max(0, diskPct - (storage.mediaBytes / disk.totalBytes) * 100)}%` }} title="Everything else on the drive" />
                </div>
                <div className="stt-disk-key"><span>{diskPct}% used</span><span>{formatBytes(disk.freeBytes)} free</span></div>
              </div>
            )}
            <ul className="stt-roots">
              {storage.roots.map((root, i) => (
                <li key={root.path}>
                  <span className={`stt-dot stt-seg--${i % 6}`} />
                  <span className="stt-root-name">{root.name}</span>
                  <span className="stt-root-bar"><span style={{ width: `${root.exists ? (root.bytes / rootsTotal) * 100 : 0}%` }} /></span>
                  <span className="stt-root-size">{root.exists ? `${formatBytes(root.bytes)} · ${root.files.toLocaleString()} files` : 'folder not found'}</span>
                </li>
              ))}
            </ul>
            {totalStorage > 0 && <p className="ui-help">{formatSize(totalStorage)} in transfers right now.</p>}
            {storage.truncated && <p className="ui-help">A folder was very large, so this total is partial.</p>}
          </div>
        )}
      </Section>

      <details className="settings-section st-details">
        <summary><span>Downloads in detail</span><span className="ui-badge">{unique.length}</span></summary>
        {unique.length === 0 ? <p className="ui-help">No downloads are running right now.</p> : (
          <ul className="stats-list">
            {unique.map(d => {
              const inLibrary = libraryTitles.has((d.title ?? '').trim().toLowerCase());
              return (
                <li key={d.id}>
                  <span className="stats-list-title">{d.title}</span>
                  <span className="stats-list-status">{inLibrary && d.status === 'completed' ? 'in library' : d.status}</span>
                  <span className="stats-list-progress">{d.progress}%</span>
                  {d.size && <span className="stats-list-size">{d.size}</span>}
                </li>
              );
            })}
          </ul>
        )}
        {downloads.length !== unique.length && <p className="ui-help">{downloads.length - unique.length} duplicate report{downloads.length - unique.length === 1 ? '' : 's'} from download clients were merged into one.</p>}
      </details>
    </main>
  );
}
