import { useEffect, useMemo, useState } from 'react';
import { api, type MediaItem, type DownloadItem, type RequestItem, type StorageReport } from '../lib/api';
import { BackButton } from '../components/layout/BackButton';

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

  return (
    <main className="page">

      <BackButton to="/" label="Home" />
      <div className="page-head">
        <h1>Statistics</h1>
        <span className="page-count">Your library at a glance</span>
      </div>

      <div className="stats-grid">
        <section className="stats-card">
          <h2>Movies</h2>
          <p className="stats-big">{availableMovies}</p>
          <p className="stats-sub">
            downloaded · {missingMovies} missing of {totalMovies} tracked
          </p>
        </section>

        <section className="stats-card">
          <h2>TV Series</h2>
          <p className="stats-big">{availableSeries}</p>
          <p className="stats-sub">downloaded · {totalSeries} tracked</p>
        </section>

        <section className="stats-card">
          <h2>Music artists</h2>
          <p className="stats-big">{totalArtists}</p>
          <p className="stats-sub">{artistTitles.length} albums across your Music service</p>
        </section>

        <section className="stats-card">
          <h2>Active downloads</h2>
          <p className="stats-big">{activeDownloads}</p>
          <p className="stats-sub">transferring or importing now</p>
        </section>

        <section className="stats-card">
          <h2>Completed</h2>
          <p className="stats-big">{completedDownloads}</p>
          <p className="stats-sub">
            {completedDownloads === 1 ? 'title finished' : 'titles finished'} and ready to import
          </p>
        </section>

        <section className="stats-card">
          <h2>Requests</h2>
          <p className="stats-big">{pendingRequests + availableRequests}</p>
          <p className="stats-sub">
            {pendingRequests} in progress · {availableRequests} available
          </p>
        </section>

        <section className="stats-card">
          <h2>Storage on device</h2>
          <p className="stats-big">{formatBytes(storage?.mediaBytes ?? 0)}</p>
          <p className="stats-sub">
            {storage
              ? `${storage.mediaFiles.toLocaleString()} files in your media folders`
              : 'reading media folders...'}
          </p>
        </section>
      </div>

      <section className="stats-detail">
        <h2>Storage on this server</h2>
        {!storage ? (
          <div className="empty-state">Reading the media folders...</div>
        ) : (
          <>
            <ul className="stats-list">
              {storage.roots.map(root => (
                <li key={root.path}>
                  <span className="stats-list-title">{root.name}</span>
                  <span className="stats-list-status">
                    {root.exists ? `${root.files.toLocaleString()} files` : 'folder not found'}
                  </span>
                  <span className="stats-list-size">{root.exists ? formatBytes(root.bytes) : 'no data'}</span>
                </li>
              ))}
            </ul>
            {storage.disk ? (
              <p className="stats-note">
                {formatBytes(storage.disk.freeBytes)} free of {formatBytes(storage.disk.totalBytes)} on the media drive.
              </p>
            ) : (
              <p className="stats-note">
                No media folder is reachable yet, so only transfer sizes are known.
              </p>
            )}
            {totalStorage > 0 && (
              <p className="stats-note">{formatSize(totalStorage)} currently in active transfers.</p>
            )}
            {storage.truncated && (
              <p className="stats-note">A folder was very large, so this total is partial.</p>
            )}
          </>
        )}
      </section>

      <section className="stats-detail">
        <h2>Downloads in detail</h2>
        {unique.length === 0 ? (
          <div className="empty-state">No downloads are running right now.</div>
        ) : (
          <ul className="stats-list">
            {unique.map(d => {
              const inLibrary = libraryTitles.has((d.title ?? '').trim().toLowerCase());
              return (
                <li key={d.id}>
                  <span className="stats-list-title">{d.title}</span>
                  <span className="stats-list-status">
                    {inLibrary && d.status === 'completed' ? 'in library' : d.status}
                  </span>
                  <span className="stats-list-progress">{d.progress}%</span>
                  {d.size && <span className="stats-list-size">{d.size}</span>}
                </li>
              );
            })}
          </ul>
        )}
        {downloads.length !== unique.length && (
          <p className="stats-note">
            {downloads.length - unique.length} duplicate report{downloads.length - unique.length === 1 ? '' : 's'} from
            download clients were merged into a single count.
          </p>
        )}
      </section>
    </main>
  );
}