import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BackButton } from '../components/layout/BackButton';
import { MediaCard } from '../components/media/MediaCard';
import { api, type ApiError, type MediaItem } from '../lib/api';
import { SkeletonGrid } from '../components/home/Skeletons';
import { useRequester } from '../lib/useRequester';

type Person = { name: string; photo?: string; bio?: string; url?: string; titles: Array<MediaItem & { role: string }> };

/** Who someone is, and which of your titles they are in. */
export default function PersonPage() {
  const { name } = useParams<{ name: string }>();
  const [person, setPerson] = useState<Person | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [asked, setAsked] = useState<string[]>([]);
  const requester = useRequester(outcome => setNote(outcome.message));

  useEffect(() => {
    if (!name) return;
    setPerson(null);
    setError('');
    api.person(name).then(setPerson).catch(err => setError((err as ApiError).status === 404 ? `Nothing is known about ${name} yet.` : (err as Error).message));
  }, [name]);

  const have = person?.titles.filter(t => t.status === 'available' || t.status === 'downloading') ?? [];
  const missing = person?.titles.filter(t => !have.includes(t)) ?? [];

  return (
    <main className="page">
      <BackButton to="/movies" label="Movies" />
      {error && <div className="empty-state">{error}</div>}
      {!person && !error && (
        <div aria-busy="true">
          <div className="person-head"><div className="person-photo skeleton" /><div className="browse-skel-person"><div className="skeleton browse-skel-heading" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line skeleton-line--short" /></div></div>
          <SkeletonGrid count={6} />
        </div>
      )}
      {person && (
        <>
          <div className="person-head">
            {person.photo ? <img className="person-photo" src={person.photo} alt={person.name} /> : <div className="person-photo person-photo--empty">{person.name.charAt(0)}</div>}
            <div>
              <h1 className="detail-title">{person.name}</h1>
              {person.bio && <p className="detail-overview">{person.bio}</p>}
              {person.url && <a className="settings-help" href={person.url} target="_blank" rel="noreferrer noopener">Read more on Wikipedia</a>}
            </div>
          </div>
          <h2 className="rail-title">In your library</h2>
          {have.length === 0 ? (
            <p className="settings-help">No title in your library lists them yet. Open a film's page to load its cast and it will show up here.</p>
          ) : (
            <div className="media-grid browse-grid">
              {have.map(t => (
                <div key={t.id}>
                  <MediaCard item={t} showStatus to={`/movies/${t.id}`} />
                  <Link className="btn btn-secondary btn-sm person-open" to={t.status === 'available' ? `/movies/${t.id}/play` : `/movies/${t.id}`}>{t.status === 'available' ? 'Play' : 'Open'}</Link>
                </div>
              ))}
            </div>
          )}
          {missing.length > 0 && (
            <>
              <h2 className="rail-title">Not in your library</h2>
              <ul className="person-missing">
                {missing.map(t => {
                  const done = t.status === 'requested' || asked.includes(t.id);
                  return (
                    <li key={t.id}>
                      <Link to={`/movies/${t.id}`}>{t.title}{t.year ? ` (${t.year})` : ''}</Link>
                      <button type="button" className="btn btn-primary btn-sm" disabled={done || requester.busy} onClick={() => {
                        const tmdb = (t as { tmdbId?: number | string }).tmdbId;
                        void requester.submit({ title: t.title, mediaType: 'movie', ...(t.year ? { year: t.year } : {}), ...(tmdb ? { selectedProviderId: String(tmdb) } : {}) })
                          .then(o => { if (o.kind === 'ok') setAsked(a => [...a, t.id]); });
                      }}>{done ? 'Requested' : 'Request'}</button>
                    </li>
                  );
                })}
              </ul>
              {note && <div className="notice notice--ok" role="status">{note}</div>}
              {requester.picker}
            </>
          )}
        </>
      )}
    </main>
  );
}
