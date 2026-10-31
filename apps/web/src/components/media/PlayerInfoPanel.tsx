import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type RecapResult } from '../../lib/api';
import './PlayerInfoPanel.css';

/** What the Info panel shows about what is on screen. */
export interface PlayerInfo {
  /** Whose cast to list: the film, or the show an episode belongs to. */
  cast: { kind: 'movie' | 'series'; id: string };
  /** The film's synopsis, or the show's for an episode. */
  synopsis?: string;
  /** For an episode: its own title and synopsis, and the show it belongs to. */
  episode?: { id: string; seriesId: string; title: string; synopsis?: string };
}

interface CastMember { name: string; role?: string; photo?: string }

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase() ?? '').join('');

/**
 * Side panel over the video: who is on screen, a short synopsis, and a spoiler-safe recap up to the
 * current point. It leaves the controls free. Escape or a click outside closes it.
 */
export default function PlayerInfoPanel({ info, getPosition, onClose }: { info: PlayerInfo; getPosition: () => number; onClose: () => void }) {
  const panelRef = useRef<HTMLElement>(null);
  const [cast, setCast] = useState<CastMember[] | null>(null);
  const [castFailed, setCastFailed] = useState(false);
  const [recap, setRecap] = useState<RecapResult | 'loading' | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load: Promise<CastMember[]> = info.cast.kind === 'movie' ? api.movieCast(info.cast.id) : api.seriesCast(info.cast.id);
    load
      .then(list => { if (!cancelled) setCast(list); })
      .catch(() => { if (!cancelled) setCastFailed(true); });
    return () => { cancelled = true; };
  }, [info.cast.kind, info.cast.id]);

  // Escape closes; so does a press anywhere outside the panel (the Info button itself toggles it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: PointerEvent) => {
      const target = e.target instanceof Node ? e.target : null;
      if (target && panelRef.current?.contains(target)) return;
      if (e.target instanceof Element && e.target.closest('.vp-info-btn')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  const askRecap = async () => {
    setRecap('loading');
    // The point it asks about is where the picture is right now.
    const at = getPosition();
    try {
      const result = info.episode
        ? await api.recap('episode', info.episode.id, at, info.episode.seriesId)
        : await api.recap('movie', info.cast.id, at);
      setRecap(result);
    } catch {
      setRecap({ available: false, message: 'The recap could not be reached. Try again in a moment.' });
    }
  };

  return (
    <aside ref={panelRef} className="vp-info" role="dialog" aria-label="Who is on screen" onClick={e => e.stopPropagation()}>
      <div className="vp-info-head">
        <h2>Who&apos;s on screen</h2>
        <button type="button" className="vp-info-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="vp-info-body">
        {info.episode && (
          <section>
            <h3>This episode: {info.episode.title}</h3>
            <p className="vp-info-text">{info.episode.synopsis || 'No synopsis for this episode yet.'}</p>
          </section>
        )}
        {info.synopsis && (
          <section>
            <h3>{info.episode ? 'About the show' : 'About the film'}</h3>
            <p className="vp-info-text">{info.synopsis}</p>
          </section>
        )}

        <section>
          <h3>Cast</h3>
          {cast === null && !castFailed && <p className="vp-info-muted">Loading cast...</p>}
          {(castFailed || cast?.length === 0) && <p className="vp-info-muted">The cast is not available for this title yet.</p>}
          {cast && cast.length > 0 && (
            <ul className="vp-cast">
              {cast.map((member, i) => (
                <li key={`${member.name}-${i}`}>
                  <Link to={`/people/${encodeURIComponent(member.name)}`} className="vp-cast-link">
                    <span className="vp-cast-photo">
                      {member.photo ? <img src={member.photo} alt="" loading="lazy" /> : <span aria-hidden="true">{initials(member.name)}</span>}
                    </span>
                    <span className="vp-cast-text">
                      <strong>{member.name}</strong>
                      {member.role && <span>{member.role}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          {recap === null && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void askRecap()}>
              {info.episode ? 'Recap' : 'Catch me up'}
            </button>
          )}
          {recap === 'loading' && <p className="vp-info-muted" role="status">Writing the recap...</p>}
          {recap && recap !== 'loading' && recap.available && (
            <>
              <h3>{info.episode ? 'Previously on' : 'So far'}</h3>
              <ul className="vp-recap">
                {recap.bullets.map((bullet, i) => <li key={i}>{bullet}</li>)}
              </ul>
            </>
          )}
          {recap && recap !== 'loading' && !recap.available && <p className="vp-info-muted" role="status">{recap.message}</p>}
        </section>
      </div>
    </aside>
  );
}
