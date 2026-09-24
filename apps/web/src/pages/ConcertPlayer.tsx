import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type MediaPlaybackInfo } from '../lib/api';
import { BackButton } from '../components/layout/BackButton';
import VideoPlayer from '../components/media/VideoPlayer';
import { useProgressSaver } from '../lib/useProgressSaver';
import { audioLabels, imageSubtitleLabels } from '../lib/media-info';

/** Plays a concert or music video that is filed under an artist. */
export default function ConcertPlayer() {
  const { id, videoId } = useParams<{ id: string; videoId: string }>();
  const [title, setTitle] = useState('');
  const [playback, setPlayback] = useState<MediaPlaybackInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumeStart, setResumeStart] = useState<number | null>(null);
  const { onProgress } = useProgressSaver('movie', videoId);

  useEffect(() => {
    if (!id || !videoId) return;
    let cancelled = false;
    setError(null); setPlayback(null); setReady(false); setResumeStart(null);
    api.artistVideos(id).then(d => {
      const found = [...d.concerts, ...d.videos].find(v => v.id === videoId);
      if (cancelled) return;
      if (found) setTitle(found.title); else setError('That video is not in this artist\'s library any more.');
    }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load it.'); });
    api.mediaInfo(videoId).then(info => { if (!cancelled) setPlayback(info); }).catch(() => {}).finally(() => { if (!cancelled) setReady(true); });
    api.progress('movie', videoId)
      .then(p => { if (!cancelled) setResumeStart(p.percent > 0 && p.percent < 96 ? p.positionSeconds : 0); })
      .catch(() => { if (!cancelled) setResumeStart(0); });
    return () => { cancelled = true; };
  }, [id, videoId]);

  if (error) {
    return <main className="page"><BackButton to={`/music/${id ?? ''}`} label="Back to artist" /><p role="alert">{error}</p></main>;
  }
  if (!videoId || !ready || resumeStart === null || !title) return <main className="page"><div className="loading-state">Loading player...</div></main>;

  const needsTranscode = playback !== null && !playback.playable;
  const src = `/api/stream/${encodeURIComponent(videoId)}`;
  return (
    <main className="player">
      <div className="player-overlay" aria-hidden="true" />
      <div className="player-topbar">
        <BackButton to={`/music/${id ?? ''}`} label="Back" />
        <span className="player-title">{title}</span>
      </div>
      <div className="player-stage">
        {needsTranscode && !(playback?.transcodingAvailable ?? false) ? (
          <div className="player-intro" role="status">
            <div className="player-intro-content">
              <h1 className="player-intro-title">{title}</h1>
              <p className="player-intro-sub">This file uses a format this browser cannot play, and ffmpeg is not available on the server to convert it.</p>
            </div>
          </div>
        ) : (
          <VideoPlayer
            src={src}
            transcodeSrc={needsTranscode ? `${src}/transcode` : undefined}
            castTranscode={`${src}/transcode`}
            durationSeconds={playback?.durationSeconds ?? null}
            audioTracks={audioLabels(playback)}
            imageSubtitles={imageSubtitleLabels(playback)}
            sourceHeight={playback?.height ?? null}
            chapters={playback?.chapters ?? []}
            title={title}
            startAt={resumeStart}
            onProgress={onProgress}
          />
        )}
      </div>
    </main>
  );
}
