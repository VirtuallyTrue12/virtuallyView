import { useEffect, useState } from 'react';
import { api, type MediaItem } from '../../lib/api';
import './RatingControls.css';

type Thumb = 1 | -1 | 0;

/** Thumbs up / down for the signed-in viewer. Pressing the lit button again clears the thumb. */
export function ThumbRating({ mediaType, mediaId, initial }: { mediaType: 'movie' | 'series'; mediaId: string; initial?: Thumb }) {
  const [thumb, setThumb] = useState<Thumb>(initial ?? 0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setThumb(initial ?? 0); }, [initial, mediaId]);

  const choose = async (value: 1 | -1) => {
    const next: Thumb = thumb === value ? 0 : value;
    setBusy(true);
    setFailed(false);
    try {
      setThumb((await api.setThumb(mediaType, mediaId, next)).thumb);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="thumb-rating" role="group" aria-label="Your rating">
      <button
        type="button"
        className={`thumb-btn${thumb === 1 ? ' is-on' : ''}`}
        aria-label="Thumbs up"
        aria-pressed={thumb === 1}
        title={thumb === 1 ? 'Clear thumbs up' : 'Thumbs up'}
        disabled={busy}
        onClick={() => void choose(1)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z" />
        </svg>
      </button>
      <button
        type="button"
        className={`thumb-btn is-down${thumb === -1 ? ' is-on' : ''}`}
        aria-label="Thumbs down"
        aria-pressed={thumb === -1}
        title={thumb === -1 ? 'Clear thumbs down' : 'Thumbs down'}
        disabled={busy}
        onClick={() => void choose(-1)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z" />
        </svg>
      </button>
      {failed && <span className="thumb-failed" role="status">Could not save</span>}
    </div>
  );
}

const ORDER = ['imdb', 'rottenTomatoes', 'tmdb', 'metacritic', 'tvdb'] as const;
const LABEL: Record<(typeof ORDER)[number], string> = {
  imdb: 'IMDb', rottenTomatoes: 'Rotten Tomatoes', tmdb: 'TMDB', metacritic: 'Metacritic', tvdb: 'TheTVDB'
};

/** The score chips to show for a title. Missing or zero scores are left out. */
export function scoreChips(ratings: MediaItem['ratings']): Array<{ key: string; label: string; text: string }> {
  if (!ratings) return [];
  return ORDER.flatMap(key => {
    const score = ratings[key];
    if (!score || !Number.isFinite(score.value) || score.value <= 0) return [];
    const value = key === 'rottenTomatoes' ? `${Math.round(score.value)}%`
      : key === 'metacritic' ? `${Math.round(score.value)}`
        : score.value.toFixed(1);
    return [{ key, label: LABEL[key], text: value }];
  });
}

/** Small labelled chips such as "IMDb 7.4" and "Rotten Tomatoes 92%", for the detail meta line. */
export function ScoreChips({ ratings }: { ratings: MediaItem['ratings'] }) {
  return (
    <>
      {scoreChips(ratings).map(chip => (
        <span key={chip.key} className="score-chip">{chip.label} <strong>{chip.text}</strong></span>
      ))}
    </>
  );
}
