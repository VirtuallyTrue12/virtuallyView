import { useCallback, useEffect, useRef, useState } from 'react';
import VideoPlayer from '../components/media/VideoPlayer';
import { SvgIcon } from '../components/ui/SvgIcon';
import {
  deleteSaved, estimate, formatBytes, listSaved, localProgressFor, readFile, recordProgress, syncProgress, type SavedItem
} from '../lib/offline-store';
import './Offline.css';

interface VideoPlaying { item: SavedItem; videoUrl: string; vttUrl?: string; startAt: number }
interface TrackPlaying { index: number; url: string }

/**
 * "On this device": everything saved for offline viewing. It renders from this phone's own storage only,
 * so it works with no connection at all. Watch progress made here is kept and sent once the server is back.
 */
export default function Offline() {
  const [items, setItems] = useState<SavedItem[] | null>(null);
  const [space, setSpace] = useState<{ usage: number; quota: number } | null>(null);
  const [posters, setPosters] = useState<Record<string, string>>({});
  const [video, setVideo] = useState<VideoPlaying | null>(null);
  const [track, setTrack] = useState<TrackPlaying | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lastPosition = useRef<{ position: number; duration: number } | null>(null);
  const lastSaved = useRef(0);

  const load = useCallback(async () => {
    try {
      const list = await listSaved();
      setItems(list);
      setSpace(await estimate());
      const next: Record<string, string> = {};
      for (const item of list) if (item.posterBlob) next[item.key] = URL.createObjectURL(item.posterBlob);
      setPosters(prev => { Object.values(prev).forEach(URL.revokeObjectURL); return next; });
    } catch {
      setItems([]);
      setNotice('This browser could not open the saved list.');
    }
  }, []);

  useEffect(() => {
    void load();
    // Sends watch progress made offline, now that a connection may be back. Nothing here waits for it.
    const sync = () => { void syncProgress().catch(() => undefined); };
    sync();
    window.addEventListener('online', sync);
    return () => { window.removeEventListener('online', sync); };
  }, [load]);

  // Every poster URL is released when the page goes away.
  useEffect(() => () => { setPosters(prev => { Object.values(prev).forEach(URL.revokeObjectURL); return {}; }); }, []);

  // Object URLs for the open player are released when it closes.
  useEffect(() => {
    if (!video) return;
    return () => {
      URL.revokeObjectURL(video.videoUrl);
      if (video.vttUrl) URL.revokeObjectURL(video.vttUrl);
    };
  }, [video]);

  useEffect(() => {
    if (!track) return;
    return () => URL.revokeObjectURL(track.url);
  }, [track]);

  const songs = (items ?? []).filter(i => i.kind === 'track');
  const films = (items ?? []).filter(i => i.kind !== 'track');
  const usedBytes = (items ?? []).reduce((sum, i) => sum + i.size, 0);
  const freeBytes = space ? Math.max(0, space.quota - space.usage) : null;
  const smallQuota = space !== null && space.quota < 2 * 1024 ** 3;

  const playVideo = async (item: SavedItem) => {
    setNotice(null);
    const file = await readFile(item.fileName);
    if (!file) { setNotice(`"${item.title}" is no longer on this device. Remove it and save it again.`); return; }
    const vtt = item.vttName ? await readFile(item.vttName) : null;
    const progress = await localProgressFor(item.kind as 'movie' | 'episode', item.id).catch(() => undefined);
    lastPosition.current = null;
    setVideo({
      item,
      videoUrl: URL.createObjectURL(file),
      ...(vtt ? { vttUrl: URL.createObjectURL(vtt) } : {}),
      startAt: progress && progress.positionSeconds > 10 && progress.positionSeconds < (progress.durationSeconds || Infinity) - 30 ? progress.positionSeconds : 0
    });
  };

  const closeVideo = () => {
    const last = lastPosition.current;
    if (video && last && video.item.kind !== 'track' && last.position > 0) {
      void recordProgress({
        mediaType: video.item.kind as 'movie' | 'episode', mediaId: video.item.id,
        positionSeconds: last.position, durationSeconds: last.duration,
        ...(video.item.seriesId ? { seriesId: video.item.seriesId } : {})
      }).then(() => syncProgress()).catch(() => undefined);
    }
    setVideo(null);
  };

  const onProgress = (position: number, duration: number) => {
    if (!video || video.item.kind === 'track') return;
    lastPosition.current = { position, duration };
    // Saved every few seconds, not on every frame.
    if (Date.now() - lastSaved.current < 5000) return;
    lastSaved.current = Date.now();
    void recordProgress({
      mediaType: video.item.kind as 'movie' | 'episode', mediaId: video.item.id,
      positionSeconds: position, durationSeconds: duration,
      ...(video.item.seriesId ? { seriesId: video.item.seriesId } : {})
    }).catch(() => undefined);
  };

  const playTrack = async (index: number) => {
    const item = songs[index];
    if (!item) return;
    const file = await readFile(item.fileName);
    if (!file) { setNotice(`"${item.title}" is no longer on this device. Remove it and save it again.`); return; }
    setTrack({ index, url: URL.createObjectURL(file) });
  };

  const remove = async (item: SavedItem) => {
    if (confirmKey !== item.key) { setConfirmKey(item.key); return; }
    setConfirmKey(null);
    await deleteSaved(item.key);
    if (track && songs[track.index]?.key === item.key) setTrack(null);
    await load();
  };

  const nowSong = track ? songs[track.index] : undefined;

  if (video) {
    return (
      <div className="offline-player" role="dialog" aria-label={`Playing ${video.item.title}`}>
        <VideoPlayer
          src={video.videoUrl}
          title={video.item.title}
          heading={video.item.title}
          {...(video.item.subtitle ? { subheading: video.item.subtitle } : {})}
          durationSeconds={video.item.durationSeconds ?? null}
          subtitles={video.vttUrl ? [{ src: video.vttUrl, label: 'English', srclang: 'en', default: true }] : []}
          startAt={video.startAt}
          onBack={closeVideo}
          onProgress={onProgress}
          onEnded={closeVideo}
          onError={message => setNotice(message)}
        />
      </div>
    );
  }

  return (
    <main className="offline-page">
      <header className="offline-head">
        <div>
          <h1>On this device</h1>
          <p className="offline-sub">Saved downloads play here without a connection.</p>
        </div>
        {space && (
          <p className="offline-space" aria-label="Storage">
            {formatBytes(usedBytes)} used by downloads{freeBytes !== null ? ` · ${formatBytes(freeBytes)} free` : ''}
          </p>
        )}
      </header>

      {smallQuota && (
        <p className="offline-note">This browser only keeps about {formatBytes(space!.quota)} for this site, so save fewer films at a time.</p>
      )}
      {notice && <div className="notice notice--err" role="status">{notice}</div>}

      {items === null && <p className="offline-empty">Loading...</p>}

      {items !== null && items.length === 0 && (
        <div className="offline-empty">
          <p>Nothing is saved yet.</p>
          <p>Open a movie, an episode or an album and tap Download.</p>
        </div>
      )}

      {films.length > 0 && (
        <section aria-label="Movies and shows">
          <h2 className="offline-section">Movies and shows</h2>
          <ul className="offline-list">
            {films.map(item => (
              <li key={item.key} className="offline-row">
                <div className="offline-poster">
                  {posters[item.key] ? <img src={posters[item.key]} alt="" /> : <SvgIcon name="film" size={22} />}
                </div>
                <div className="offline-meta">
                  <span className="offline-title">{item.title}</span>
                  <span className="offline-sub">{[item.subtitle, formatBytes(item.size)].filter(Boolean).join(' · ')}</span>
                </div>
                <div className="offline-actions">
                  <button type="button" className="btn btn-primary" onClick={() => void playVideo(item)} aria-label={`Play ${item.title}`}>
                    <SvgIcon name="play" size={14} /> Play
                  </button>
                  <button type="button" className={`btn btn-secondary offline-delete${confirmKey === item.key ? ' is-confirm' : ''}`} onClick={() => void remove(item)} aria-label={`Delete ${item.title}`}>
                    {confirmKey === item.key ? 'Tap again to delete' : 'Delete'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {songs.length > 0 && (
        <section aria-label="Songs">
          <h2 className="offline-section">Songs</h2>
          <ol className="offline-songs">
            {songs.map((item, index) => (
              <li key={item.key} className={`offline-song${track?.index === index ? ' is-playing' : ''}`}>
                <button type="button" className="offline-song-play" onClick={() => void playTrack(index)} aria-label={`Play ${item.title}`}>
                  <span className="offline-song-num">{track?.index === index ? <SvgIcon name="play" size={12} /> : index + 1}</span>
                  <span className="offline-meta">
                    <span className="offline-title">{item.title}</span>
                    <span className="offline-sub">{item.subtitle ?? ''}</span>
                  </span>
                </button>
                <button type="button" className={`btn btn-secondary offline-delete${confirmKey === item.key ? ' is-confirm' : ''}`} onClick={() => void remove(item)} aria-label={`Delete ${item.title}`}>
                  {confirmKey === item.key ? 'Tap again' : 'Delete'}
                </button>
              </li>
            ))}
          </ol>
          {track && nowSong && (
            <div className="offline-audio" aria-label="Now playing">
              <span className="offline-title">{nowSong.title}</span>
              <audio
                controls
                autoPlay
                src={track.url}
                onEnded={() => { if (track.index + 1 < songs.length) void playTrack(track.index + 1); else setTrack(null); }}
              />
            </div>
          )}
        </section>
      )}
    </main>
  );
}
