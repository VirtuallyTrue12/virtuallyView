import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, type YearReview } from '../lib/api';
import { fmtHours, saveRecapImage } from '../lib/recap-image';
import { toast } from '../components/ui/Toast';
import './YearInReview.css';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const fmtDay = (iso: string) => new Date(/^\d{4}-\d\d-\d\d$/.test(iso) ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
const KIND: Record<string, string> = { song: 'song', film: 'film', episode: 'episode', video: 'video' };

function Thumb({ src, name, round }: { src: string | null; name: string; round?: boolean }) {
  const [bad, setBad] = useState(false);
  return src && !bad
    ? <img className={`yr-thumb${round ? ' yr-thumb--round' : ''}`} src={src} alt="" loading="lazy" onError={() => setBad(true)} />
    : <span className={`yr-thumb yr-thumb--empty${round ? ' yr-thumb--round' : ''}`} aria-hidden="true">{name.charAt(0).toUpperCase()}</span>;
}

function Bars({ rows }: { rows: Array<{ name: string; n: number }> }) {
  const max = Math.max(...rows.map(r => r.n), 1);
  return (
    <ul className="yr-bars">
      {rows.map(r => (
        <li key={r.name}><span className="yr-bar-name">{r.name}</span><span className="yr-bar"><i style={{ width: `${Math.max(4, (r.n / max) * 100)}%` }} /></span><span className="yr-count">{r.n}</span></li>
      ))}
    </ul>
  );
}

interface CardDef { id: string; label: string; tone?: 'accent'; body: ReactNode }

function buildCards(r: YearReview, onSave: () => void): CardDef[] {
  const cards: CardDef[] = [];
  const { totals, hours } = r;
  if (hours.total > 0) {
    const parts = [
      hours.listened > 0 && `${fmtHours(hours.listened)} of music`,
      hours.watched > 0 && `${fmtHours(hours.watched)} of films and shows`,
      hours.videos > 0 && `${fmtHours(hours.videos)} of videos`
    ].filter(Boolean) as string[];
    cards.push({ id: 'hours', label: 'Time well spent', tone: 'accent', body: (
      <>
        <p className="yr-big">{fmtHours(hours.total)}</p>
        <p className="yr-lead">watched and listened in {r.year}.</p>
        {parts.length > 1 && <p className="yr-sub">{parts.join(', ')}.</p>}
      </>
    ) });
  }
  if (r.previous && hours.total > 0) {
    const diff = Math.round((hours.total - r.previous.hours) * 10) / 10;
    cards.push({ id: 'compare', label: `Versus ${r.previous.year}`, body: (
      <>
        <p className="yr-big yr-big--word">{diff === 0 ? 'Same' : `${diff > 0 ? '+' : '-'}${fmtHours(Math.abs(diff))}`}</p>
        <p className="yr-lead">{diff === 0 ? `Exactly as much as ${r.previous.year}.` : `${diff > 0 ? 'More' : 'Less'} than the ${fmtHours(r.previous.hours)} of ${r.previous.year}.`}</p>
      </>
    ) });
  }
  if (r.topArtists.length) cards.push({ id: 'artists', label: 'Top artists', body: (
    <ol className="yr-list">{r.topArtists.map((a, i) => (
      <li key={a.name}><span className="yr-rank">{i + 1}</span><Thumb src={a.image} name={a.name} round /><span className="yr-item">{a.name}</span><span className="yr-count">{a.plays} {a.plays === 1 ? 'play' : 'plays'}</span></li>
    ))}</ol>
  ) });
  if (r.topSongs.length) cards.push({ id: 'songs', label: 'Top songs', body: (
    <ol className="yr-list">{r.topSongs.map((s, i) => (
      <li key={`${s.title}-${s.artist}`}><span className="yr-rank">{i + 1}</span><span className="yr-item">{s.title}<span className="yr-by">{s.artist}</span></span><span className="yr-count">{s.plays} {s.plays === 1 ? 'play' : 'plays'}</span></li>
    ))}</ol>
  ) });
  if (r.topFilms.length) cards.push({ id: 'films', label: `Films (${totals.films})`, body: (
    <ol className="yr-list">{r.topFilms.map((f, i) => (
      <li key={`${f.title}-${i}`}><span className="yr-rank">{i + 1}</span><Thumb src={f.poster} name={f.title} /><span className="yr-item">{f.title}</span><span className="yr-count">{fmtDay(f.finishedAt)}</span></li>
    ))}</ol>
  ) });
  if (r.topShows.length) cards.push({ id: 'shows', label: `Series (${totals.episodes} ${totals.episodes === 1 ? 'episode' : 'episodes'})`, body: (
    <ol className="yr-list">{r.topShows.map((s, i) => (
      <li key={s.title}><span className="yr-rank">{i + 1}</span><Thumb src={s.poster} name={s.title} /><span className="yr-item">{s.title}</span><span className="yr-count">{s.episodes} ep</span></li>
    ))}</ol>
  ) });
  if (r.topChannels.length) cards.push({ id: 'channels', label: `Video channels (${totals.videos})`, body: (
    <ol className="yr-list">{r.topChannels.map((c, i) => (
      <li key={c.name}><span className="yr-rank">{i + 1}</span><Thumb src={c.image} name={c.name} round /><span className="yr-item">{c.name}</span><span className="yr-count">{c.videos} {c.videos === 1 ? 'video' : 'videos'}</span></li>
    ))}</ol>
  ) });
  if (r.musicGenres.length || r.watchGenres.length) cards.push({ id: 'genres', label: 'Genres', tone: 'accent', body: (
    <>
      {r.watchGenres.length > 0 && <><p className="yr-sub">Watching</p><Bars rows={r.watchGenres.slice(0, 4).map(g => ({ name: g.name, n: g.count }))} /></>}
      {r.musicGenres.length > 0 && <><p className="yr-sub">Listening</p><Bars rows={r.musicGenres.slice(0, 4).map(g => ({ name: g.name, n: g.plays }))} /></>}
    </>
  ) });
  if (r.busiest) {
    const b = r.busiest;
    const max = Math.max(...b.weekdays, 1);
    cards.push({ id: 'busiest', label: 'Your rhythm', body: (
      <>
        <p className="yr-big yr-big--word">{DAYS[b.weekday]}s</p>
        <p className="yr-lead">were your day, around {hourLabel(b.hour)}.</p>
        <div className="yr-week" aria-hidden="true">{b.weekdays.map((n, i) => (
          <span key={i} className={i === b.weekday ? 'is-peak' : ''}><i style={{ height: `${Math.max(6, (n / max) * 100)}%` }} />{DAYS[i]!.charAt(0)}</span>
        ))}</div>
      </>
    ) });
  }
  if (r.binge && r.binge.episodes >= 2) cards.push({ id: 'binge', label: 'Longest binge', body: (
    <>
      <p className="yr-big">{r.binge.episodes}</p>
      <p className="yr-lead">episodes of {r.binge.title} on {fmtDay(r.binge.day)}.</p>
    </>
  ) });
  if (r.first) cards.push({ id: 'firstlast', label: 'First and last', body: (
    <>
      <p className="yr-sub">The first thing of {r.year} was a {KIND[r.first.kind]}</p>
      <p className="yr-lead yr-first"><strong>{r.first.title}</strong>{fmtDay(r.first.at)}</p>
      {r.last && <>
        <p className="yr-sub">and the last, a {KIND[r.last.kind]}</p>
        <p className="yr-lead yr-first"><strong>{r.last.title}</strong>{fmtDay(r.last.at)}</p>
      </>}
    </>
  ) });
  cards.push({ id: 'summary', label: 'Your year, in short', tone: 'accent', body: (
    <>
      <p className="yr-big yr-big--word">{fmtHours(hours.total)}</p>
      <ul className="yr-sum">
        {r.topArtists[0] && <li><span>Top artist</span>{r.topArtists[0].name}</li>}
        {r.topFilms[0] && <li><span>Top film</span>{r.topFilms[0].title}</li>}
        {r.topShows[0] && <li><span>Top series</span>{r.topShows[0].title}</li>}
        {r.topChannels[0] && <li><span>Top channel</span>{r.topChannels[0].name}</li>}
        {r.busiest && <li><span>Busiest day</span>{DAYS[r.busiest.weekday]}</li>}
      </ul>
      <button type="button" className="btn btn-primary yr-share" onClick={onSave}>Save as image</button>
      <p className="yr-sub">Saved to your device. Nothing is uploaded.</p>
    </>
  ) });
  return cards;
}

/** Your year as a full-screen story: one card at a time, by tap, swipe, arrow keys or remote. */
export default function YearInReview() {
  const { year: yearParam = '' } = useParams<{ year: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const year = Number(yearParam);
  const valid = /^\d{4}$/.test(yearParam) && year >= 2000 && year <= 2100;
  const [review, setReview] = useState<YearReview | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    setReview(null);
    setError(null);
    setIndex(0);
    api.yearReview(year)
      .then(res => { if (!cancelled) { setReview(res.review); setYears(res.years); } })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Your year could not be loaded.'); });
    return () => { cancelled = true; };
  }, [year, valid]);

  const close = useCallback(() => { if (location.key === 'default') navigate('/'); else navigate(-1); }, [navigate, location.key]);
  const save = useCallback(() => {
    if (!review) return;
    void saveRecapImage(review).then(() => toast('Saved to your downloads.')).catch(() => toast('Could not save the image.', { tone: 'err' }));
  }, [review]);

  const cards = useMemo<CardDef[]>(() => {
    if (!review) return [];
    const hero: CardDef = { id: 'hero', label: 'Your year', body: (
      <>
        <p className="yr-kicker">Your {review.year}</p>
        <h1 className="yr-title">in review</h1>
        {!review.empty && <p className="yr-sub">Tap, swipe or press the right arrow to begin.</p>}
      </>
    ) };
    if (review.empty) return [{ id: 'empty', label: `Your ${review.year}`, body: (
      <>
        <p className="yr-lead">Nothing to look back on for {review.year} yet.</p>
        <p className="yr-sub">Play some music, finish a film or watch a video, and this page fills in. Try another year above.</p>
      </>
    ) }];
    return [hero, ...buildCards(review, save)];
  }, [review, save]);

  const last = cards.length - 1;
  const go = useCallback((delta: number) => setIndex(i => Math.min(Math.max(i + delta, 0), Math.max(cards.length - 1, 0))), [cards.length]);
  useEffect(() => { stage.current?.focus(); }, [review]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); document.querySelector<HTMLElement>('.yr-close')?.focus(); }
    else if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); if (cards[index]?.id === 'summary') save(); else go(1); }
    else if (e.key === 'Escape') close();
  };

  const interactive = (el: EventTarget | null) => !!(el as HTMLElement | null)?.closest?.('button, a, select');
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const from = start.current;
    start.current = null;
    if (!from || interactive(e.target)) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const box = e.currentTarget.getBoundingClientRect();
      go(e.clientX - box.left < box.width / 3 ? -1 : 1);
    }
  };

  if (!valid) return <div className="yr-screen"><div className="yr-msg"><p className="yr-lead">Pick a year from 2000 to 2100.</p><button type="button" className="btn btn-secondary" onClick={close}>Close</button></div></div>;

  const shown = Array.from(new Set([...years, year])).sort((a, b) => b - a);
  const card = cards[index];
  return (
    <div className="yr-screen" role="region" aria-label={`Your ${year} in review`}>
      <header className="yr-top">
        <ol className="yr-progress" aria-hidden="true">{cards.map((c, i) => <li key={c.id} className={i <= index ? 'is-done' : ''} />)}</ol>
        <div className="yr-bar-row">
          <label className="yr-year">
            <span className="sr-only">Year</span>
            <select value={year} aria-label="Year" onChange={e => navigate(`/music/year/${e.target.value}`, { replace: true })} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); stage.current?.focus(); } }}>
              {shown.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <button type="button" className="yr-close" aria-label="Close" onClick={close} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); stage.current?.focus(); } }}>&times;</button>
        </div>
      </header>

      {error && <div className="yr-msg"><p className="yr-lead">{error}</p></div>}
      {!error && !review && <div className="yr-msg" aria-busy="true"><p className="yr-lead">Gathering your {year}...</p></div>}
      {review && card && (
        <div
          className="yr-stage" ref={stage} tabIndex={0} data-dpad="own" aria-live="polite"
          onKeyDown={onKey}
          onPointerDown={e => { start.current = { x: e.clientX, y: e.clientY }; }}
          onPointerUp={onUp}
          onPointerCancel={() => { start.current = null; }}
        >
          <section key={card.id} className={`yr-card${card.tone ? ` yr-card--${card.tone}` : ''}`} aria-label={card.label}>
            {card.id !== 'hero' && <p className="yr-kicker">{card.label}</p>}
            {card.body}
          </section>
          <p className="yr-step" aria-hidden="true">{index + 1} / {cards.length}</p>
          <div className="yr-nav">
            <button type="button" className="yr-arrow" aria-label="Previous card" disabled={index === 0} onClick={() => go(-1)}>&lsaquo;</button>
            <button type="button" className="yr-arrow" aria-label="Next card" disabled={index === last} onClick={() => go(1)}>&rsaquo;</button>
          </div>
        </div>
      )}
    </div>
  );
}
