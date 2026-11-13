import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type BookCard, type BooksConfig, type BookState } from '../lib/api';
import { EmptyState } from '../components/ui/Page';
import { SvgIcon } from '../components/ui/SvgIcon';
import { AudioPlayer } from '../components/books/AudioPlayer';
import { BookRail, BookTile, Cover, sizeText } from '../components/books/parts';
import { BackButton } from '../components/layout/BackButton';

/** Inside Docker the Kavita address is internal, so point at the same machine this page came from. */
const kavitaLink = (k: BooksConfig['kavita']) => {
  if (!k.connected) return null;
  try { if (k.url && new URL(k.url).hostname.includes('.')) return k.url; } catch { /* use the host this page came from */ }
  return `${location.protocol}//${location.hostname}:${k.port}`;
};

export default function BookDetails() {
  const { id = '' } = useParams();
  const [data, setData] = useState<{ book: BookCard; state: BookState | null; moreByAuthor: BookCard[]; similar: BookCard[] } | null>(null);
  const [error, setError] = useState('');
  const [config, setConfig] = useState<BooksConfig | null>(null);
  const [fav, setFav] = useState(false);

  useEffect(() => {
    setData(null); setError('');
    api.book(id).then(d => { setData(d); setFav(d.book.favorite); }).catch(err => setError((err as Error).message));
    api.booksConfig().then(setConfig).catch(() => {});
  }, [id]);

  if (error) return <main className="page"><EmptyState icon="book" title="Book not found" text={error} action={<Link className="btn btn-secondary" to="/books">Back to Books</Link>} /></main>;
  if (!data) return <main className="page" aria-busy="true"><div className="bk-loading">Loading…</div></main>;

  const { book, state } = data;
  const audio = book.kind === 'audiobook';
  const readable = book.files.find(f => f.format === 'epub') ?? book.files.find(f => f.format === 'pdf');
  const kavita = config ? kavitaLink(config.kavita) : null;
  const percent = Math.round(state?.percent ?? book.percent);
  const started = !!state?.position || percent > 0;
  const toggleFav = () => { const on = !fav; setFav(on); api.bookFavorite(book.id, on).catch(() => setFav(!on)); };

  return (
    <main className="page bk-detail books-page">
      <BackButton to="/books" />
      <div className="bk-hero">
        <div className="bk-hero-cover"><Cover src={book.hasCover && `/api/books/library/${book.id}/cover`} title={book.title} author={book.authors[0]} audio={audio} /></div>
        <div className="bk-hero-text">
          <h1 className="page-title">{book.title}</h1>
          <p className="bk-by">{book.authors.join(', ') || 'Unknown author'}</p>
          <p className="bk-meta-line">{[book.year, book.language?.toUpperCase(), audio ? `${book.files.length} chapters` : readable?.format.toUpperCase()].filter(Boolean).join(' · ')}</p>
          {started && <div className="bk-prog"><div className="media-card-progress"><div className="media-card-progress-fill" style={{ width: `${percent}%` }} /></div><span>{state?.finished || book.finished ? 'Finished' : percent > 0 ? `${percent}% done` : 'Just started'}</span></div>}
          <div className="bk-actions">
            {!audio && readable && <Link className="btn btn-primary" to={`/books/${book.id}/read?f=${readable.index}`}><SvgIcon name="book" size={17} /> {started ? 'Continue reading' : 'Read'}</Link>}
            {audio && <a className="btn btn-primary" href="#bk-player"><SvgIcon name="play" size={17} /> {started ? 'Continue listening' : 'Listen'}</a>}
            {!audio && book.files.length === 1 && <a className="btn btn-secondary" href={`/api/books/library/${book.id}/file/${book.files[0]!.index}?download=1`}><SvgIcon name="download" size={17} /> Download</a>}
            <button type="button" className={`btn btn-secondary${fav ? ' is-on' : ''}`} onClick={toggleFav} aria-pressed={fav}><SvgIcon name={fav ? 'heart' : 'heart-outline'} size={17} /> {fav ? 'Favourited' : 'Favourite'}</button>
            {kavita && <a className="btn btn-secondary" href={kavita} target="_blank" rel="noreferrer noopener"><SvgIcon name="external" size={16} /> Open in Kavita</a>}
          </div>
          {book.subjects.length > 0 && <div className="bk-subjects">{book.subjects.slice(0, 8).map(s => <span key={s} className="ui-pill">{s}</span>)}</div>}
          {book.description && <p className="bk-desc">{book.description}</p>}
          {!audio && book.files.length > 1 && (
            <ul className="bk-files" aria-label="Files">
              {book.files.map(f => <li key={f.index}><span>{f.name}</span><span>{f.format.toUpperCase()} · {sizeText(f.size)}</span><a href={`/api/books/library/${book.id}/file/${f.index}?download=1`} aria-label={`Download ${f.name}`}><SvgIcon name="download" size={14} /></a></li>)}
            </ul>
          )}
        </div>
      </div>
      {audio && <div id="bk-player"><AudioPlayer key={book.id} book={book} position={state?.position} /></div>}
      {data.moreByAuthor.length > 0 && <BookRail title={`More by ${book.authors[0] ?? 'this author'}`}>{data.moreByAuthor.map(b => <BookTile key={b.id} book={b} />)}</BookRail>}
      {data.similar.length > 0 && <BookRail title="Similar">{data.similar.map(b => <BookTile key={b.id} book={b} />)}</BookRail>}
    </main>
  );
}
