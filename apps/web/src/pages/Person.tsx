import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BackButton } from '../components/layout/BackButton';
import { MediaCard } from '../components/media/MediaCard';
import { api, type ApiError, type MediaItem } from '../lib/api';

type Person = { name: string; photo?: string; bio?: string; url?: string; titles: Array<MediaItem & { role: string }> };

/** Who someone is, and which of your titles they are in. */
export default function PersonPage() {
  const { name } = useParams<{ name: string }>();
  const [person, setPerson] = useState<Person | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!name) return;
    setPerson(null);
    setError('');
    api.person(name).then(setPerson).catch(err => setError((err as ApiError).status === 404 ? `Nothing is known about ${name} yet.` : (err as Error).message));
  }, [name]);

  return (
    <main className="page">
      <BackButton to="/movies" label="Movies" />
      {error && <div className="empty-state">{error}</div>}
      {!person && !error && <div className="loading-state">Loading...</div>}
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
          {person.titles.length === 0 ? (
            <p className="settings-help">No title in your library lists them yet. Open a film's page to load its cast and it will show up here.</p>
          ) : (
            <div className="media-grid">
              {person.titles.map(t => <MediaCard key={t.id} item={t} showStatus to={`/movies/${t.id}`} />)}
            </div>
          )}
        </>
      )}
    </main>
  );
}
