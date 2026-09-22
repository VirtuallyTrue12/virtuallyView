import { DownloadPanel } from '../components/media/DownloadPanel';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { SearchAgain } from '../components/media/SearchAgain';
import { MediaCard } from '../components/media/MediaCard';
import { SourceCheck } from '../components/media/SourceCheck';
import { StatusPill } from '../components/media/StatusPill';
import { BackButton } from '../components/layout/BackButton';
import { TitleQuality } from '../components/media/TitleQuality';
import { RemoveTitle } from '../components/media/RemoveTitle';
import { FavoriteButton } from '../components/media/UserFlagButtons';
import { api, type EpisodeItem, type MediaDescription, type SeriesItem } from '../lib/api';
import { SvgIcon } from '../components/ui/SvgIcon';

export default function SeriesDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [series, setSeries] = useState<SeriesItem | null>(null);
  const [library, setLibrary] = useState<SeriesItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState<MediaDescription | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeItem[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(true);
  const [episodesError, setEpisodesError] = useState<string | null>(null);
  const [season, setSeason] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setError(null);
    setDescription(null);
    setEpisodes([]);
    setEpisodesError(null);
    setEpisodesLoading(true);
    setSeason(null);
    api.serie(id).then(s => { if (!cancelled) setSeries(s); }).catch(err => { if (!cancelled) setError(err.message); });
    api.series().then(items => { if (!cancelled) setLibrary(items); }).catch(() => {});
    api.mediaDescription(id).then(desc => { if (!cancelled) setDescription(desc); }).catch(() => {});
    api.serieEpisodes(id)
      .then(res => { if (!cancelled) setEpisodes(res.episodes); })
      .catch(err => { if (!cancelled) setEpisodesError((err as Error).message); })
      .finally(() => { if (!cancelled) setEpisodesLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const ordered = useMemo(
    () => [...episodes].sort((a, b) => (a.seasonNumber || 999) - (b.seasonNumber || 999) || a.episodeNumber - b.episodeNumber),
    [episodes]
  );
  const seasonNumbers = useMemo(
    () => [...new Set(ordered.map(e => e.seasonNumber))],
    [ordered]
  );
  useEffect(() => {
    if (season === null && seasonNumbers.length) {
      // Open on the season of the next thing to watch.
      const next = ordered.find(e => e.hasFile && (e.watchProgress ?? 0) < 96) ?? ordered.find(e => e.hasFile);
      setSeason(next?.seasonNumber ?? seasonNumbers.find(n => n > 0) ?? seasonNumbers[0]);
    }
  }, [season, seasonNumbers, ordered]);

  const watch = (episode: EpisodeItem) =>
    navigate(`/series/${encodeURIComponent(series?.id ?? id ?? '')}/watch/${encodeURIComponent(episode.id)}`);

  if (error) {
    return (
      <main className="page">
        <div className="loading-state">
          <Link to="/series" className="btn btn-secondary">Back to TV Shows</Link>
          <p>Could not load this series: {error}</p>
        </div>
      </main>
    );
  }

  if (!series) {
    return <main className="page"><div className="loading-state">Loading series...</div></main>;
  }

  const similar = library
    .filter(s => s.id !== series.id)
    .filter(s => s.genres?.some(g => series.genres?.includes(g)) ?? false)
    .slice(0, 6);
  const sharedGenres = series.genres?.length
    ? series.genres.length > 3
      ? series.genres.slice(0, 3)
      : series.genres
    : [];
  const totalEpisodes = (series.seasons ?? []).reduce((sum, s) => sum + s.episodes, 0);
  const availableEpisodes = (series.seasons ?? []).reduce((sum, s) => sum + (s.availableEpisodes ?? 0), 0);

  const playable = ordered.filter(e => e.hasFile);
  // Continue where the viewer left off: first partly-watched, else first unwatched.
  const resumeEpisode = playable.find(e => (e.watchProgress ?? 0) > 0 && (e.watchProgress ?? 0) < 96);
  const nextEpisode = resumeEpisode ?? playable.find(e => (e.watchProgress ?? 0) < 96) ?? playable[0];
  const seasonEpisodes = ordered.filter(e => e.seasonNumber === season);

  return (
    <main className="detail">
      <section className="detail-hero">
        {series.artwork?.backdrop ? (
          <img className="detail-backdrop" src={series.artwork.backdrop} alt="" />
        ) : (
          <div className="detail-backdrop detail-backdrop--placeholder" />
        )}
        <div className="detail-overlay" aria-hidden="true" />

        <div className="detail-body">
          <BackButton to="/series" label="TV Shows" />
          <div className="detail-main">
            <div className="detail-poster">
              {series.artwork?.poster && (
                <img src={series.artwork.poster} alt={`${series.title} poster`} />
              )}
            </div>
            <div className="detail-info">
              <h1 className="detail-title">{series.title}</h1>

              <div className="detail-meta">
                {series.year && <span>{series.year}</span>}
                {series.seasons?.length ? <span>{series.seasons.filter(s => s.number > 0).length} seasons</span> : null}
                {totalEpisodes > 0 && <span>{availableEpisodes}/{totalEpisodes} episodes</span>}
                {series.rating ? <span className="rating"><SvgIcon name="star" size={14} /> {series.rating.toFixed(1)}</span> : null}
                {series.quality && <span>{series.quality}</span>}
                {series.certification && <span className="cert-badge">{series.certification}</span>}
                {series.studio && <Link to={`/series?studio=${encodeURIComponent(series.studio)}`}>{series.studio}</Link>}
                <StatusPill status={series.status} />
              </div>

              {sharedGenres.length > 0 && (
                <div className="genres">
                  {sharedGenres.map(g => <span key={g}>{g}</span>)}
                </div>
              )}

              {series.overview && <p className="detail-overview">{series.overview}</p>}
              {/^sonarr-/.test(series.id) && <DownloadPanel mediaId={series.id} />}

              <div className="hero-actions">
                {nextEpisode ? (
                  <button className="btn btn-primary" type="button" onClick={() => watch(nextEpisode)}>
                    {resumeEpisode ? 'Resume' : (nextEpisode.watchProgress ?? 0) >= 96 || playable[0] === nextEpisode ? 'Play' : 'Play next'}
                    {' '}S{nextEpisode.seasonNumber}E{nextEpisode.episodeNumber}
                  </button>
                ) : (
                  <button className="btn btn-primary" type="button" disabled title={episodesError ?? 'No episodes are downloaded yet'}>
                    {episodesLoading ? 'Loading episodes...' : episodesError ? 'Episodes unavailable' : 'No episodes downloaded'}
                  </button>
                )}
                <FavoriteButton mediaType="series" mediaId={series.id} initial={series.favorite} />
                <RemoveTitle kind="series" id={series.id} title={series.title} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/^sonarr-/.test(series.id) && <TitleQuality mediaType="series" id={series.id} />}

      {(description?.description || series.overview) && (
        <section className="page detail-story-section">
          <div className="rail-head">
            <h2 className="rail-title">Storyline</h2>
          </div>
          <p className="detail-story">
            {description?.description || series.overview}
          </p>
          {description && description.source !== 'library' && (
            <span className="detail-story-source">Description pulled from {description.source}</span>
          )}
        </section>
      )}

      <section className="page detail-sources-section">
        <SourceCheck id={series.id} />
      </section>

      {(ordered.length > 0 || episodesError) && (
        <section className="page">
          <div className="rail-head">
            <h2 className="rail-title">Episodes</h2>
            {playable.length > 0 && <span className="page-count">{playable.length} of {ordered.length} ready to play</span>}
          </div>
          {episodesError && <div className="loading-state">Could not load episodes: {episodesError}</div>}
          <div className="season-tabs" role="tablist" aria-label="Seasons">
            {seasonNumbers.map(n => (
              <button
                key={n} type="button" role="tab" aria-selected={season === n}
                className={`season-tab${season === n ? ' is-active' : ''}`}
                onClick={() => setSeason(n)}
              >{n === 0 ? 'Specials' : `Season ${n}`}</button>
            ))}
          </div>
          {seasonEpisodes.some(e => !e.hasFile) && (
            <div className="episode-search">
              <SearchAgain label={`Search for ${seasonEpisodes.filter(e => !e.hasFile).length} missing`} run={() => api.searchSeries(series.id)} />
            </div>
          )}
          <div className="episode-grid">
            {seasonEpisodes.map(episode => {
              const progress = Math.min(100, Math.round(episode.watchProgress ?? 0));
              return (
                <div className="episode-wrap" key={episode.id}>
                <button
                  type="button" className="episode-card"
                  disabled={!episode.hasFile}
                  onClick={() => watch(episode)}
                  aria-label={`${episode.hasFile ? 'Play' : 'Not downloaded:'} episode ${episode.episodeNumber}, ${episode.title}`}
                >
                  <div
                    className="episode-card-art"
                    style={{ backgroundImage: series.artwork?.backdrop ? `url(${series.artwork.backdrop})` : undefined }}
                  >
                    <span className="episode-card-num">E{episode.episodeNumber}</span>
                    {episode.hasFile && <span className="episode-card-play" aria-hidden="true"><SvgIcon name="play" size={18} /></span>}
                    {episode.watched && <span className="episode-card-watched">Watched</span>}
                    {progress > 0 && <div className="episode-card-progress"><span style={{ width: `${progress}%` }} /></div>}
                  </div>
                  <div className="episode-card-body">
                    <span className="episode-card-title">{episode.title}</span>
                    <span className="episode-card-sub">
                      {episode.hasFile ? '' : 'Not downloaded · '}
                      {episode.airDate ?? ''}{episode.runtime ? ` · ${episode.runtime} min` : ''}
                      {progress > 0 ? ` · ${progress}% watched` : ''}
                    </span>
                    {episode.overview && <span className="episode-card-overview">{episode.overview}</span>}
                  </div>
                </button>
                {!episode.hasFile && (
                  <div className="episode-search">
                    <SearchAgain label="Search for this episode" run={() => api.searchSeries(series.id, episode.id)} />
                  </div>
                )}
                {episode.hasFile && (
                  <button
                    type="button"
                    className={`episode-watch-toggle${episode.watched ? ' is-on' : ''}`}
                    aria-pressed={episode.watched === true}
                    title={episode.watched ? 'Mark as unwatched' : 'Mark as watched'}
                    onClick={async () => {
                      const next = !episode.watched;
                      await api.setFlags('episode', episode.id, { watched: next });
                      setEpisodes(list => list.map(e => (e.id === episode.id ? { ...e, watched: next, ...(next ? { watchProgress: 0 } : {}) } : e)));
                    }}
                  ><SvgIcon name="check" size={14} /></button>
                )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {series.seasons && series.seasons.length > 0 && ordered.length === 0 && !episodesError && !episodesLoading && (
        <section className="page">
          <div className="rail-head">
            <h2 className="rail-title">Seasons</h2>
          </div>
          <div className="season-list">
            {series.seasons.map(s => (
              <article className="season-card" key={s.number}>
                <h3>Season {s.number}</h3>
                <span className="season-meta">{s.availableEpisodes ?? 0}/{s.episodes} episodes</span>
                {s.overview && <p className="season-overview">{s.overview}</p>}
              </article>
            ))}
          </div>
        </section>
      )}

      {similar.length > 0 && (
        <section className="page">
          <div className="rail-head">
            <h2 className="rail-title">More Like This</h2>
          </div>
          <div className="rail-scroll">
            {similar.map(s => (
              <MediaCard key={s.id} item={s} to={`/series/${s.id}`} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
