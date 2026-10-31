import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { BackButton } from '../components/layout/BackButton';
import { api, type YearReview } from '../lib/api';
import { toast } from '../components/ui/Toast';
import './YearInReview.css';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

function Card({ label, children, tone }: { label: string; children: ReactNode; tone?: 'accent' }) {
  return (
    <section className={`yr-card${tone ? ` yr-card--${tone}` : ''}`} aria-label={label}>
      <p className="yr-kicker">{label}</p>
      {children}
    </section>
  );
}

/** Your year in music and film, as one scrolling story: a card per stat. */
export default function YearInReview() {
  const { year: yearParam = '' } = useParams<{ year: string }>();
  const year = Number(yearParam);
  const valid = /^\d{4}$/.test(yearParam) && year >= 2000 && year <= 2100;
  const [review, setReview] = useState<YearReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    setReview(null);
    setError(null);
    api.yearReview(year)
      .then(res => { if (!cancelled) setReview(res.review); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Your year could not be loaded.'); });
    return () => { cancelled = true; };
  }, [year, valid]);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast('Link copied. Paste it anywhere.');
    } catch {
      toast('Could not copy the link. Copy it from the address bar.', { tone: 'err' });
    }
  };

  if (!valid) {
    return (
      <main className="page yr-page">
        <BackButton to="/music" label="Music" />
        <div className="empty-state">Pick a year from 2000 to 2100.</div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="page yr-page">
        <BackButton to="/music" label="Music" />
        <div className="empty-state">{error}</div>
      </main>
    );
  }

  if (!review) {
    return (
      <main className="page yr-page">
        <BackButton to="/music" label="Music" />
        <div className="loading-state">Gathering your {year}...</div>
      </main>
    );
  }

  const { totals } = review;
  const empty = totals.plays === 0 && totals.films === 0 && totals.episodes === 0;
  const hours = Math.round((review.minutesListened / 60) * 10) / 10;

  return (
    <main className="page yr-page">
      <BackButton to="/music" label="Music" />
      <div className="yr-story">
        <section className="yr-card yr-card--hero" aria-label="Your year">
          <p className="yr-kicker">Your {review.year}</p>
          <h1 className="yr-title">In music and film</h1>
          {empty && <p className="yr-lead">Nothing has been logged for {review.year} yet. Play a few songs or finish a film, and this page fills in.</p>}
        </section>

        {!empty && (
          <>
            <Card label="Minutes listened" tone="accent">
              <p className="yr-big">{review.minutesListened.toLocaleString()}</p>
              <p className="yr-lead">{review.minutesListened === 1 ? 'minute' : 'minutes'} of music{hours >= 1 ? `, about ${hours} hours` : ''}.</p>
              <p className="yr-sub">{totals.plays} {totals.plays === 1 ? 'song' : 'songs'} played in full or in part.</p>
            </Card>

            {review.topArtists.length > 0 && (
              <Card label="Top artists">
                <ol className="yr-list">
                  {review.topArtists.map((a, i) => (
                    <li key={a.name}><span className="yr-rank">{i + 1}</span><span className="yr-item">{a.name}</span><span className="yr-count">{a.plays}</span></li>
                  ))}
                </ol>
              </Card>
            )}

            {review.topSongs.length > 0 && (
              <Card label="Top songs">
                <ol className="yr-list">
                  {review.topSongs.map((s, i) => (
                    <li key={`${s.title}-${s.artist}`}><span className="yr-rank">{i + 1}</span><span className="yr-item">{s.title}<span className="yr-by">{s.artist}</span></span><span className="yr-count">{s.plays}</span></li>
                  ))}
                </ol>
              </Card>
            )}

            {review.topGenre && (
              <Card label="Top genre" tone="accent">
                <p className="yr-big yr-big--word">{review.topGenre.name}</p>
                <p className="yr-lead">Your most played kind of music.</p>
              </Card>
            )}

            {review.topFilms.length > 0 && (
              <Card label={`Films watched (${totals.films})`}>
                <ol className="yr-list">
                  {review.topFilms.map((f, i) => (
                    <li key={`${f.title}-${i}`}><span className="yr-rank">{i + 1}</span><span className="yr-item">{f.title}</span><span className="yr-count">{fmtDate(f.finishedAt)}</span></li>
                  ))}
                </ol>
              </Card>
            )}

            {review.topShows.length > 0 && (
              <Card label={`Shows watched (${totals.episodes} ${totals.episodes === 1 ? 'episode' : 'episodes'})`}>
                <ol className="yr-list">
                  {review.topShows.map((s, i) => (
                    <li key={s.title}><span className="yr-rank">{i + 1}</span><span className="yr-item">{s.title}</span><span className="yr-count">{s.episodes} ep</span></li>
                  ))}
                </ol>
              </Card>
            )}

            {review.firstPlay && (
              <Card label="First play of the year">
                <p className="yr-lead yr-first"><strong>{review.firstPlay.title}</strong> by {review.firstPlay.artist}</p>
                <p className="yr-sub">On {fmtDate(review.firstPlay.playedAt)}, the first song of {review.year}.</p>
              </Card>
            )}
          </>
        )}

        <section className="yr-card yr-card--end" aria-label="Share">
          <button type="button" className="btn btn-primary yr-share" onClick={() => void share()}>Share this page</button>
          <p className="yr-sub">Copies the link to this page.</p>
        </section>
      </div>
    </main>
  );
}
