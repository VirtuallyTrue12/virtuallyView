import { Link } from 'react-router-dom';
import type { MediaItem, Rail } from '../../lib/api';
import './kids.css';

const detailPath = (item: MediaItem) => (item.type === 'series' ? `/series/${item.id}` : `/movies/${item.id}`);

/**
 * Home for a Kids profile: big poster tiles of family titles, what they were watching, and their My List.
 * The server already sends only G and PG titles and these three rails.
 */
export default function KidsHome({ rails }: { rails: Rail[] }) {
  return (
    <main className="kids-home">
      <h1 className="kids-title">What do you want to watch?</h1>
      {rails.length === 0 && (
        <p className="kids-empty">Nothing to watch yet. Ask a grown-up to add some films and shows.</p>
      )}
      {rails.map(rail => (
        <section key={rail.id} className="kids-rail" aria-label={rail.title}>
          <h2 className="kids-rail-title">{rail.title}</h2>
          <ul className="kids-tiles">
            {rail.items.map(raw => {
              const item = raw as MediaItem & { href?: string; watchProgress?: number };
              return (
                <li key={`${rail.id}-${item.id}`}>
                  <Link to={item.href ?? detailPath(item)} className="kids-tile">
                    <span className="kids-poster">
                      {item.artwork?.poster
                        ? <img src={item.artwork.poster} alt="" loading="lazy" />
                        : <span className="kids-poster-fallback" aria-hidden="true">{item.title.charAt(0)}</span>}
                      {item.watchProgress !== undefined && (
                        <span className="kids-progress" aria-hidden="true"><span style={{ width: `${Math.min(100, item.watchProgress)}%` }} /></span>
                      )}
                    </span>
                    <span className="kids-tile-name">{item.title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
