import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, type BookCard, type BookFormat, type BookJob, type BookResult } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';
import { ScrollRow } from '../ui/ScrollRow';
import { toast } from '../ui/Toast';

export const sizeText = (bytes?: number) => (!bytes ? '' : bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const hue = (text: string) => [...text].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 11);

/** The cover, or a coloured stand-in with the title and author when the book has none. */
export function Cover({ src, title, author, audio }: { src?: string | false; title: string; author?: string; audio?: boolean }) {
  const [broken, setBroken] = useState(false);
  const h = hue(title);
  return (
    <div className="bk-art">
      {src && !broken
        ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
        : <div className="bk-ph" style={{ background: `linear-gradient(155deg, hsl(${h} 45% 36%), hsl(${(h + 40) % 360} 50% 18%))` }}><strong>{title}</strong>{author && <span>{author}</span>}</div>}
      {audio && <span className="bk-flag" title="Audiobook"><SvgIcon name="music-note" size={12} /></span>}
    </div>
  );
}

/** A library book: cover, title, author and a progress bar along the bottom edge of the cover. */
export function BookTile({ book }: { book: BookCard }) {
  return (
    <Link className="media-card-link" to={`/books/${book.id}`} aria-label={`View ${book.title}`}>
      <article className="media-card" aria-label={book.title}>
        <div className="media-card-artwork">
          <Cover src={book.hasCover && `/api/books/library/${book.id}/cover`} title={book.title} author={book.authors[0]} audio={book.kind === 'audiobook'} />
          {book.percent > 0 && !book.finished && <div className="media-card-progress-track" role="progressbar" aria-label={`${book.title} ${Math.round(book.percent)}%`} aria-valuenow={Math.round(book.percent)} aria-valuemin={0} aria-valuemax={100}><div className="media-card-progress-fill" style={{ width: `${book.percent}%` }} /></div>}
        </div>
        <div className="media-card-info"><h3 className="media-card-title" title={book.title}>{book.title}</h3><p className="media-card-sub">{book.finished ? 'Finished' : book.authors.join(', ') || book.kind}</p></div>
      </article>
    </Link>
  );
}

export function BookRail({ title, children, label }: { title: string; children: ReactNode; label?: string }) {
  return (
    <section className="rail bk-rail" aria-label={title}>
      <div className="rail-head"><h2 className="rail-title">{title}</h2></div>
      <ScrollRow className="bk-row" label={label ?? title}>{children}</ScrollRow>
    </section>
  );
}

export const defaultFormat = (r: BookResult): BookFormat => r.formats.find(f => f.kind === (r.source === 'librivox' ? 'audio' : 'epub')) ?? r.formats[0]!;
export const formatText = (f: BookFormat) => [f.kind === 'audio' ? 'Audiobook' : f.kind === 'torrent' ? `Torrent${f.label ? ` (${f.label})` : ''}` : f.kind.toUpperCase(), sizeText(f.size)].filter(Boolean).join(' ');

/** Starts a pull. Says in plain words when it cannot, and offers Open when the book is already there. */
export function usePull(onStarted: (job: BookJob) => void) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const pull = useCallback(async (r: BookResult, format: BookFormat) => {
    setBusy(`${r.source}:${r.id}`);
    try {
      const { job } = await api.bookPull({ source: r.source, id: r.id, format: format.kind, title: r.title, authors: r.authors });
      toast(`Requested "${r.title}".`, { tone: 'info' });
      onStarted(job);
    } catch (err) {
      const bookId = err instanceof ApiError ? (err.body as { bookId?: string }).bookId : undefined;
      toast((err as Error).message, { tone: 'err', action: bookId ? { label: 'Open', run: () => navigate(`/books/${bookId}`) } : undefined });
    } finally { setBusy(null); }
  }, [navigate, onStarted]);
  return { pull, busy };
}

/** The pull jobs. Polls every 1.5 s while one is running, every 15 s otherwise; says so when one finishes. */
export function useBookJobs(enabled: boolean, onDone: () => void) {
  const [jobs, setJobs] = useState<BookJob[]>([]);
  const seen = useRef(new Map<string, string>());
  const navigate = useNavigate();
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const refresh = useCallback(async () => {
    try {
      const { jobs: list } = await api.bookJobs();
      let finished = false;
      for (const j of list) {
        const before = seen.current.get(j.id);
        if (before && before !== j.status && j.status === 'done' && j.bookId) {
          finished = true;
          toast(`"${j.title}" is in your library.`, { action: { label: 'Open', run: () => navigate(`/books/${j.bookId}`) } });
        } else if (before && before !== j.status && j.status === 'failed') toast(`"${j.title}": ${j.message}`, { tone: 'err' });
        seen.current.set(j.id, j.status);
      }
      setJobs(list);
      if (finished) doneRef.current();
    } catch { /* kept as it was; the next poll tries again */ }
  }, [navigate]);
  const active = jobs.some(j => ['queued', 'downloading', 'processing'].includes(j.status));
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const t = window.setInterval(() => void refresh(), active ? 1500 : 15000);
    return () => window.clearInterval(t);
  }, [enabled, active, refresh]);
  return { jobs, refresh, active };
}
