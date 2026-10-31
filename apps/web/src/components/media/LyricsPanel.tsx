import { useEffect, useRef, useState } from 'react';
import { api, type ApiError, type Lyrics } from '../../lib/api';

interface Props {
  artist?: string;
  title: string;
  album?: string;
  durationSeconds?: number;
  currentTime: number;
}

const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: 'english', label: 'English' },
  { value: 'hindi', label: 'Hindi' },
  { value: 'spanish', label: 'Spanish' },
  { value: 'french', label: 'French' },
  { value: 'japanese', label: 'Japanese' },
  { value: 'korean', label: 'Korean' },
  { value: 'romanised', label: 'Romanised pronunciation' }
];

/** Lyrics for the playing track. Time-stamped lyrics follow along; plain ones just scroll. */
export default function LyricsPanel({ artist, title, album, durationSeconds, currentTime }: Props) {
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading');
  const activeRef = useRef<HTMLParagraphElement>(null);
  const [language, setLanguage] = useState('english');
  const [translation, setTranslation] = useState<string[] | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateNote, setTranslateNote] = useState<string | null>(null);

  useEffect(() => {
    if (!artist) { setState('none'); return; }
    let cancelled = false;
    setState('loading');
    setLyrics(null);
    setTranslation(null);
    setTranslateNote(null);
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

  const lines: string[] = state !== 'ready' || !lyrics
    ? []
    : lyrics.synced
      ? lyrics.synced.map(line => line.text)
      : (lyrics.plain ?? '').split('\n');

  // One translated line for each lyric line, in the same order, so the timing still lines up.
  const translate = async () => {
    if (!artist || !lines.length || translating) return;
    setTranslating(true);
    setTranslateNote(null);
    try {
      const result = await api.translateLyrics({ artist, title, album, language, lines });
      setTranslation(result.lines);
    } catch (err) {
      setTranslation(null);
      setTranslateNote(err instanceof Error ? err.message : 'The translation could not be made.');
    } finally {
      setTranslating(false);
    }
  };

  const translatedLine = (i: number) => (translation?.[i] ? <span className="lyrics-tr">{translation[i]}</span> : null);

  return (
    <div className="lyrics" role="region" aria-label="Lyrics">
      {state === 'loading' && <p className="lyrics-note">Looking for lyrics...</p>}
      {state === 'none' && <p className="lyrics-note">No lyrics found for this track.</p>}
      {state === 'error' && <p className="lyrics-note">The lyrics service could not be reached.</p>}
      {state === 'ready' && lines.length > 0 && (
        <div className="lyrics-translate">
          <label>
            <span className="visually-hidden">Translate to</span>
            <select value={language} onChange={e => { setLanguage(e.target.value); setTranslation(null); setTranslateNote(null); }} disabled={translating}>
              {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-secondary" onClick={() => void translate()} disabled={translating}>
            {translating ? 'Translating...' : 'Translate'}
          </button>
          {translateNote && <p className="lyrics-note" role="status">{translateNote}</p>}
        </div>
      )}
      {state === 'ready' && lyrics?.synced && lyrics.synced.map((line, i) => (
        <p key={i} ref={i === activeIndex ? activeRef : undefined} className={`lyrics-line${i === activeIndex ? ' is-active' : ''}`}>
          {line.text || ' '}
          {translatedLine(i)}
        </p>
      ))}
      {state === 'ready' && !lyrics?.synced && lyrics?.plain && lyrics.plain.split('\n').map((line, i) => (
        <p key={i} className="lyrics-line">
          {line || ' '}
          {translatedLine(i)}
        </p>
      ))}
    </div>
  );
}
