import { useEffect, useRef, useState } from 'react';
import { api, type ApiError, type Lyrics } from '../../lib/api';

interface Props {
  artist?: string;
  title: string;
  album?: string;
  durationSeconds?: number;
  currentTime: number;
}

/** Lyrics for the playing track. Time-stamped lyrics follow along; plain ones just scroll. */
export default function LyricsPanel({ artist, title, album, durationSeconds, currentTime }: Props) {
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading');
  const activeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!artist) { setState('none'); return; }
    let cancelled = false;
    setState('loading');
    setLyrics(null);
    api.lyrics(artist, title, album, durationSeconds)
      .then(found => { if (!cancelled) { setLyrics(found); setState('ready'); } })
      .catch(err => { if (!cancelled) setState((err as ApiError).status === 404 ? 'none' : 'error'); });
    return () => { cancelled = true; };
  }, [artist, title, album, durationSeconds]);

  const activeIndex = lyrics?.synced
    ? lyrics.synced.reduce((found, line, i) => (line.time <= currentTime + 0.3 ? i : found), -1)
    : -1;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIndex]);

  return (
    <div className="lyrics" role="region" aria-label="Lyrics">
      {state === 'loading' && <p className="lyrics-note">Looking for lyrics...</p>}
      {state === 'none' && <p className="lyrics-note">No lyrics found for this track.</p>}
      {state === 'error' && <p className="lyrics-note">The lyrics service could not be reached.</p>}
      {state === 'ready' && lyrics?.synced && lyrics.synced.map((line, i) => (
        <p key={i} ref={i === activeIndex ? activeRef : undefined} className={`lyrics-line${i === activeIndex ? ' is-active' : ''}`}>{line.text || ' '}</p>
      ))}
      {state === 'ready' && !lyrics?.synced && lyrics?.plain && lyrics.plain.split('\n').map((line, i) => (
        <p key={i} className="lyrics-line">{line || ' '}</p>
      ))}
    </div>
  );
}
