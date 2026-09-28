import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type VideoResult } from '../lib/api';
import { BackButton } from '../components/layout/BackButton';

const views = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M views` : n >= 1_000 ? `${Math.round(n / 1_000)}K views` : n ? `${n} views` : '');

/** Its own page (not a popup) so a video can be linked to, reloaded, and left with the browser's own back button. */
export default function VideoWatch() {
  const { id } = useParams<{ id: string }>();
  const [video, setVideo] = useState<VideoResult | null>(null);
  const [embed, setEmbed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setVideo(null); setEmbed(null); setError(null);
    api.video(id).then(r => {
      if (cancelled) return;
      if (!r.embed) { setError('This video cannot be played: the video service is off.'); return; }
      setVideo(r.video); setEmbed(r.embed);
      void api.videoWatched(id).catch(() => undefined);
    }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load it.'); });
    return () => { cancelled = true; };
  }, [id]);

  if (error) {
    return <main className="page"><BackButton to="/videos" label="Back to Videos" /><p role="alert">{error}</p></main>;
  }
  if (!video || !embed) return <main className="page"><div className="loading-state">Loading video...</div></main>;

  return (
    <main className="player">
      <div className="player-overlay" aria-hidden="true" />
      <div className="player-topbar">
        <BackButton to="/videos" label="Back" />
        <span className="player-title">{video.title}</span>
      </div>
      <div className="player-stage">
        <div className="vid-player">
          <iframe
            src={embed} title={video.title}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            referrerPolicy="no-referrer"
          />
        </div>
      </div>
      <p className="vid-player-sub">{video.channel}{video.views ? ` · ${views(video.views)}` : ''}</p>
      {video.description && <p className="vid-player-desc">{video.description}</p>}
    </main>
  );
}
