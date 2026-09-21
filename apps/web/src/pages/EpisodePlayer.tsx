import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import WatchTogether from '../components/media/WatchTogether';
import { useWatchParty } from '../lib/useWatchParty';
import { api, type EpisodeItem, type MediaPlaybackInfo, type SeriesItem } from '../lib/api';
import { BackButton } from '../components/layout/BackButton';
import VideoPlayer, { type EpisodeGroup } from '../components/media/VideoPlayer';
import type { SubtitleTrack } from '../components/media/PlyrPlayer';
import { useProgressSaver } from '../lib/useProgressSaver';
import { audioLabels, imageSubtitleLabels } from '../lib/media-info';
import SubtitleManager from '../components/media/SubtitleManager';
import { MediaInfoPanel } from '../components/media/MediaInfoPanel';

function EpisodeInfo({ episodeId }: { episodeId: string }) {
  const load = useCallback(() => api.episodeInfo(episodeId), [episodeId]);
  return <MediaInfoPanel load={load} />;
}

const code = (e: EpisodeItem) => `S${String(e.seasonNumber).padStart(2, '0')}E${String(e.episodeNumber).padStart(2, '0')}`;

export default function EpisodePlayer() {
  const { id, episodeId } = useParams<{ id: string; episodeId: string }>();
  const navigate = useNavigate();
  const [series, setSeries] = useState<SeriesItem | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [playback, setPlayback] = useState<MediaPlaybackInfo | null>(null);
  const [infoDone, setInfoDone] = useState(false);
  const [resumeStart, setResumeStart] = useState<number | null>(null);
  const [subtitles, setSubtitles] = useState<SubtitleTrack[]>([]);
  const { onProgress } = useProgressSaver('episode', episodeId, id);
  const partyCode = useSearchParams()[0].get('party');
  const party = useWatchParty(partyCode);
  const [subTick, setSubTick] = useState(0);
  useEffect(() => {
    if (!episodeId || subTick === 0) return;
    api.subtitles(`/api/stream/episode/${encodeURIComponent(episodeId)}`).then(res => setSubtitles(res.subtitles ?? [])).catch(() => {});
  }, [episodeId, subTick]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api.serie(id).then(s => { if (!cancelled) setSeries(s); }).catch(() => {});
    api.serieEpisodes(id)
      .then(res => { if (!cancelled) setEpisodes(res.episodes); })
      .catch(err => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!episodeId) return;
    let cancelled = false;
    setPlayback(null); setInfoDone(false); setResumeStart(null); setSubtitles([]);
    api.episodeInfo(episodeId).then(i => { if (!cancelled) setPlayback(i); }).catch(() => {}).finally(() => { if (!cancelled) setInfoDone(true); });
    api.progress('episode', episodeId)
      .then(p => { if (!cancelled) setResumeStart(p.percent > 0 && p.percent < 96 ? p.positionSeconds : 0); })
      .catch(() => { if (!cancelled) setResumeStart(0); });
    api.subtitles(`/api/stream/episode/${encodeURIComponent(episodeId)}`)
      .then(res => { if (!cancelled) setSubtitles(res.subtitles ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [episodeId]);

  const ordered = useMemo(
    () => [...episodes].sort((a, b) => (a.seasonNumber || 999) - (b.seasonNumber || 999) || a.episodeNumber - b.episodeNumber),
    [episodes]
  );
  const playable = ordered.filter(e => e.hasFile);
  const current = ordered.find(e => e.id === episodeId);
  const at = playable.findIndex(e => e.id === episodeId);
  const nextEp = at >= 0 ? playable[at + 1] : undefined;
  const prevEp = at > 0 ? playable[at - 1] : undefined;

  const groups: EpisodeGroup[] = useMemo(() => {
    const by = new Map<number, EpisodeItem[]>();
    for (const e of ordered) by.set(e.seasonNumber, [...(by.get(e.seasonNumber) ?? []), e]);
    return [...by.entries()].sort((a, b) => (a[0] || 999) - (b[0] || 999)).map(([season, list]) => ({
      label: season === 0 ? 'Specials' : `Season ${season}`,
      items: list.map(e => ({
        id: e.id,
        label: `${e.episodeNumber}. ${e.title}${e.hasFile ? '' : ' (not downloaded)'}`,
        active: e.id === episodeId,
        disabled: !e.hasFile
      }))
    }));
  }, [ordered, episodeId]);

  const go = (target: EpisodeItem) => navigate(`/series/${id}/watch/${encodeURIComponent(target.id)}`, { replace: true });
  const back = `/series/${id}`;

  if (error) {
    return (
      <main className="page">
        <div className="loading-state">
          <Link to={back} className="btn btn-secondary">Back to series</Link>
          <p>Could not load episodes: {error}</p>
        </div>
      </main>
    );
  }
  if (!episodeId || !infoDone || resumeStart === null || (episodes.length > 0 && !current)) {
    return <main className="page"><div className="loading-state">Loading episode...</div></main>;
  }
  if (current && !current.hasFile) {
    return (
      <main className="page">
        <BackButton to={back} label="Back to series" />
        <h1>{series?.title}</h1>
        <p role="status">{code(current)} has not been downloaded yet.</p>
      </main>
    );
  }

  const needsTranscode = playback !== null && !playback.playable;
  const transcodeAvailable = playback?.transcodingAvailable ?? false;
  const title = current ? `${series?.title ?? ''} · ${code(current)} · ${current.title}` : series?.title;

  return (
    <main className="player">
      {series?.artwork?.backdrop && <img className="player-bg" src={series.artwork.backdrop} alt="" />}
      <div className="player-overlay" aria-hidden="true" />
      <div className="player-topbar">
        <BackButton to={back} label={series?.title ?? 'Back'} />
        <span className="player-title">{current ? `${code(current)} · ${current.title}` : ''}</span>
      </div>
      <div className="player-stage">
        {needsTranscode && !transcodeAvailable ? (
          <div className="player-intro" role="status">
            <div className="player-intro-shade" aria-hidden="true" />
            <div className="player-intro-content">
              <h1 className="player-intro-title">{current?.title}</h1>
              <p className="player-intro-sub">
                This episode uses a format this browser cannot play, and ffmpeg is not available on the
                server to convert it{playback?.reason ? ` (${playback.reason})` : ''}.
              </p>
              <Link to={back} className="btn btn-secondary">Back to series</Link>
            </div>
          </div>
        ) : (
          <VideoPlayer
            src={`/api/stream/episode/${encodeURIComponent(episodeId)}`}
            transcodeSrc={needsTranscode ? `/api/stream/episode/${encodeURIComponent(episodeId)}/transcode` : undefined}
            castTranscode={`/api/stream/episode/${encodeURIComponent(episodeId)}/transcode`}
            durationSeconds={playback?.durationSeconds ?? null}
            audioTracks={audioLabels(playback)}
            imageSubtitles={imageSubtitleLabels(playback)}
            sourceHeight={playback?.height ?? null}
            chapters={playback?.chapters ?? []}
            isEpisode
            poster={series?.artwork?.backdrop}
            title={title}
            subtitles={subtitles}
            startAt={resumeStart}
            onProgress={onProgress}
            party={partyCode ? { remote: party.remote, onLocal: party.onLocal } : undefined}
            next={nextEp ? { label: `${code(nextEp)} ${nextEp.title}`, onSelect: () => go(nextEp) } : undefined}
            previous={prevEp ? { label: `${code(prevEp)} ${prevEp.title}`, onSelect: () => go(prevEp) } : undefined}
            episodes={{ groups, onSelect: eid => { const t = ordered.find(e => e.id === eid); if (t) go(t); } }}
          />
        )}
      </div>
      <div className="player-meta">
        <span className="player-hint">Space play/pause, left/right arrows skip 10s, N next episode, C subtitles, F fullscreen</span>
      </div>
      <WatchTogether title={series?.title ?? 'An episode'} code={partyCode} watching={party.watching} />
      {id && episodeId && <SubtitleManager target={{ kind: 'episode', seriesId: id, episodeId }} onChanged={() => setSubTick(t => t + 1)} />}
      <EpisodeInfo episodeId={episodeId} />
    </main>
  );
}
