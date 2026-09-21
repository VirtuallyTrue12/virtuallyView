import { useEffect, useState } from 'react';
import SubtitleManager from '../components/media/SubtitleManager';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import WatchTogether from '../components/media/WatchTogether';
import { useWatchParty } from '../lib/useWatchParty';
import { api, type MediaItem, type MediaPlaybackInfo } from '../lib/api';
import { BackButton } from '../components/layout/BackButton';
import VideoPlayer from '../components/media/VideoPlayer';
import type { SubtitleTrack } from '../components/media/PlyrPlayer';
import { useProgressSaver } from '../lib/useProgressSaver';
import { audioLabels, imageSubtitleLabels } from '../lib/media-info';

export default function Player() {
  const { id } = useParams<{ id: string }>();
  const [movie, setMovie] = useState<MediaItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resumeStart, setResumeStart] = useState<number | null>(null);
  const [subtitles, setSubtitles] = useState<SubtitleTrack[]>([]);
  const [playback, setPlayback] = useState<MediaPlaybackInfo | null>(null);
  const [infoDone, setInfoDone] = useState(false);
  const { onProgress } = useProgressSaver('movie', id);
  const partyCode = useSearchParams()[0].get('party');
  const party = useWatchParty(partyCode);
  const [subTick, setSubTick] = useState(0);

  // After a subtitle is downloaded or uploaded, list the tracks again without reloading the video.
  useEffect(() => {
    if (!id || subTick === 0) return;
    fetch(`/api/stream/${encodeURIComponent(id)}/subtitles`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((res: { subtitles?: SubtitleTrack[] } | SubtitleTrack[]) => { const list = Array.isArray(res) ? res : res.subtitles; if (Array.isArray(list)) setSubtitles(list); })
      .catch(() => {});
  }, [id, subTick]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setMovie(null); setError(null); setResumeStart(null); setPlayback(null); setInfoDone(false); setSubtitles([]);
    api.movie(id).then(m => { if (!cancelled) setMovie(m); }).catch(err => { if (!cancelled) setError(err.message); });
    // Can this browser decode the file? If not, the server converts it live.
    api.mediaInfo(id).then(info => { if (!cancelled) setPlayback(info); }).catch(() => {}).finally(() => { if (!cancelled) setInfoDone(true); });
    api.progress('movie', id)
      .then(p => { if (!cancelled) setResumeStart(p.percent > 0 && p.percent < 96 ? p.positionSeconds : 0); })
      .catch(() => { if (!cancelled) setResumeStart(0); });
    fetch(`/api/stream/${encodeURIComponent(id)}/subtitles`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((res: { subtitles?: SubtitleTrack[] } | SubtitleTrack[]) => {
        const list = Array.isArray(res) ? res : res.subtitles;
        if (!cancelled && Array.isArray(list)) setSubtitles(list);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [id]);

  if (error) {
    return (
      <main className="page">
        <div className="loading-state">
          <Link to="/movies" className="btn btn-secondary">Back to Movies</Link>
          <p>Could not start playback: {error}</p>
        </div>
      </main>
    );
  }
  if (!movie || !infoDone || resumeStart === null) {
    return <main className="page"><div className="loading-state">Loading player...</div></main>;
  }
  if (movie.status !== 'available') {
    return (
      <main className="page">
        <BackButton to={`/movies/${movie.id}`} label="Back to movie" />
        <h1>{movie.title}</h1>
        <p role="status">This movie has no imported file available for playback yet.</p>
      </main>
    );
  }

  const needsTranscode = playback !== null && !playback.playable;
  const transcodeAvailable = playback?.transcodingAvailable ?? false;

  return (
    <main className="player">
      {movie.artwork?.backdrop && <img className="player-bg" src={movie.artwork.backdrop} alt="" />}
      <div className="player-overlay" aria-hidden="true" />
      <div className="player-topbar">
        <BackButton to={`/movies/${movie.id}`} label="Back" />
        <span className="player-title">{movie.title} <span className="player-year">{movie.year ? `(${movie.year})` : ''}</span></span>
      </div>
      <div className="player-stage">
        {needsTranscode && !transcodeAvailable ? (
          <div className="player-intro" role="status">
            <div className="player-intro-shade" aria-hidden="true" />
            <div className="player-intro-content">
              <h1 className="player-intro-title">{movie.title}</h1>
              <p className="player-intro-sub">
                This file uses a format this browser cannot play, and ffmpeg is not available on the
                server to convert it{playback?.reason ? ` (${playback.reason})` : ''}.
              </p>
              <Link to={`/movies/${movie.id}`} className="btn btn-secondary">Back to movie</Link>
            </div>
          </div>
        ) : (
          <VideoPlayer
            src={`/api/stream/${encodeURIComponent(movie.id)}`}
            transcodeSrc={needsTranscode ? `/api/stream/${encodeURIComponent(movie.id)}/transcode` : undefined}
            castTranscode={`/api/stream/${encodeURIComponent(movie.id)}/transcode`}
            durationSeconds={playback?.durationSeconds ?? null}
            audioTracks={audioLabels(playback)}
            imageSubtitles={imageSubtitleLabels(playback)}
            sourceHeight={playback?.height ?? null}
            chapters={playback?.chapters ?? []}
            poster={movie.artwork?.backdrop}
            title={movie.title}
            subtitles={subtitles}
            startAt={resumeStart}
            onProgress={onProgress}
            party={partyCode ? { remote: party.remote, onLocal: party.onLocal } : undefined}
          />
        )}
      </div>
      <div className="player-meta">
        <span className="player-hint">
          {needsTranscode
            ? 'Converting this file for browser playback. Seeking restarts the conversion at the new position.'
            : 'Space play/pause, left/right arrows skip 10s, up/down arrows volume, C subtitles, F fullscreen'}
        </span>
      </div>
      <WatchTogether title={movie?.title ?? 'A film'} code={partyCode} watching={party.watching} />
      {id && <SubtitleManager target={{ kind: 'movie', id }} onChanged={() => setSubTick(t => t + 1)} />}
    </main>
  );
}
