import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type BookCard, type BookFormat, type BookJob, type BookResult, type BookShelf, type BooksConfig, type BookSourceId } from '../lib/api';
import { EmptyState, PageHeader, Seg } from '../components/ui/Page';
import { SvgIcon } from '../components/ui/SvgIcon';
import { OpenMediaFolder } from '../components/media/OpenMediaFolder';
import { BookRail, BookTile, Cover, defaultFormat, formatText, useBookJobs, usePull } from '../components/books/parts';

type Tab = 'home' | 'library' | 'request';
type Kind = 'all' | 'ebook' | 'audiobook' | 'pdf';
type Sort = 'new' | 'title' | 'author' | 'year';

const isPdf = (b: BookCard) => b.kind === 'ebook' && b.files[0]?.format === 'pdf';
const ACTIVE = ['queued', 'downloading', 'processing'];

function JobCard({ job, onCancel }: { job: BookJob; onCancel: () => void }) {
  return (
    <article className="media-card bk-job" aria-label={job.title}>
      <div className="media-card-artwork">
        <Cover title={job.title} author={job.authors[0]} audio={job.format === 'audio'} />
        <div className="media-card-progress-track" role="progressbar" aria-label={`${job.title} ${Math.round(job.percent)}%`} aria-valuenow={Math.round(job.percent)} aria-valuemin={0} aria-valuemax={100}><div className="media-card-progress-fill" style={{ width: `${Math.max(3, job.percent)}%` }} /></div>
      </div>
      <div className="media-card-info">
        <h3 className="media-card-title" title={job.title}>{job.title}</h3>
        <p className="media-card-sub">{Math.round(job.percent)}% · {job.message || job.status}</p>
        <button type="button" className="btn btn-secondary btn-sm bk-cancel" onClick={onCancel} aria-label={`Cancel ${job.title}`}>Cancel</button>
      </div>
    </article>
  );
}

function ResultCard({ r, onPull, busy, canPull }: { r: BookResult; onPull: (f: BookFormat) => void; busy: boolean; canPull: boolean }) {
  return (
    <article className="media-card bk-found" aria-label={r.title}>
      <div className="media-card-artwork"><Cover src={r.cover} title={r.title} author={r.authors[0]} audio={r.media === 'audiobook'} /></div>
      <div className="media-card-info">
        <h3 className="media-card-title" title={r.title}>{r.title}</h3>
        <p className="media-card-sub">{r.authors.join(', ')}</p>
        {canPull && <button type="button" className="btn btn-primary btn-sm bk-cancel" disabled={busy} onClick={() => onPull(defaultFormat(r))} aria-label={`Pull ${r.title}`}>{busy ? 'Pulling…' : 'Pull'}</button>}
      </div>
    </article>
  );
}

function Home({ shelves, jobs, cancel, discover, config, kid, onPulled, onEmpty }: { shelves: BookShelf[] | null; jobs: BookJob[]; cancel: (id: string) => void; discover: { id: string; title: string; results: BookResult[] }[] | null; config: BooksConfig | null; kid: boolean; onPulled: (j: BookJob) => void; onEmpty: () => void }) {
  const { pull, busy } = usePull(onPulled);
  const active = jobs.filter(j => ACTIVE.includes(j.status));
  if (!shelves) return <div className="bk-loading" aria-busy="true">Loading…</div>;
  return (
    <>
      {active.length > 0 && <BookRail title="Requested / Downloading">{active.map(j => <JobCard key={j.id} job={j} onCancel={() => cancel(j.id)} />)}</BookRail>}
      {shelves.length === 0 && active.length === 0 && <EmptyState icon="book" title="No books yet" text={kid ? 'Ask a grown-up to add some books.' : 'Request a book and it is pulled into your library, ready to read or listen to.'} action={!kid && <button className="btn btn-primary" type="button" onClick={onEmpty}>Find a book</button>} />}
      {shelves.map(s => <BookRail key={s.id} title={s.title}>{s.items.map(b => <BookTile key={b.id} book={b} />)}</BookRail>)}
      {!kid && discover === null && <div className="bk-loading" aria-busy="true">Finding books you might like…</div>}
      {!kid && discover?.filter(r => r.results.length).map(row => (
        <BookRail key={row.id} title={`Discover: ${row.title}`} label={`Discover ${row.title}`}>
          {row.results.map(r => <ResultCard key={`${r.source}:${r.id}`} r={r} canPull={!!config?.writable} busy={busy === `${r.source}:${r.id}`} onPull={f => void pull(r, f)} />)}
        </BookRail>
      ))}
    </>
  );
}

function Library({ items }: { items: BookCard[] }) {
  const [kind, setKind] = useState<Kind>('all');
  const [author, setAuthor] = useState('');
  const [subject, setSubject] = useState('');
  const [sort, setSort] = useState<Sort>('new');
  const [q, setQ] = useState('');
  const authors = useMemo(() => [...new Set(items.flatMap(b => b.authors))].sort(), [items]);
  const subjects = useMemo(() => [...new Set(items.flatMap(b => b.subjects))].sort(), [items]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const out = items.filter(b => (kind === 'all' || (kind === 'pdf' ? isPdf(b) : b.kind === kind)) && (!author || b.authors.includes(author)) && (!subject || b.subjects.includes(subject)) && (!t || `${b.title} ${b.authors.join(' ')}`.toLowerCase().includes(t)));
    const by: Record<Sort, (a: BookCard, b: BookCard) => number> = {
      new: (a, b) => b.addedAt - a.addedAt, title: (a, b) => a.title.localeCompare(b.title), author: (a, b) => (a.authors[0] ?? '').localeCompare(b.authors[0] ?? ''), year: (a, b) => (b.year ?? 0) - (a.year ?? 0)
    };
    return [...out].sort(by[sort]);
  }, [items, kind, author, subject, sort, q]);
  return (
    <>
      <div className="ph-toolbar">
        <Seg<Kind> label="Kind" value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'ebook', label: 'Ebooks' }, { value: 'audiobook', label: 'Audiobooks' }, { value: 'pdf', label: 'PDFs' }]} />
        <div className="bk-tools">
          <input className="settings-input ph-search" type="search" placeholder="Search your books" value={q} onChange={e => setQ(e.target.value)} aria-label="Search your books" />
          <select className="settings-input" value={author} onChange={e => setAuthor(e.target.value)} aria-label="Author"><option value="">All authors</option>{authors.map(a => <option key={a}>{a}</option>)}</select>
          <select className="settings-input" value={subject} onChange={e => setSubject(e.target.value)} aria-label="Subject"><option value="">All subjects</option>{subjects.map(a => <option key={a}>{a}</option>)}</select>
          <select className="settings-input" value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="Sort by"><option value="new">Newest</option><option value="title">Title</option><option value="author">Author</option><option value="year">Year</option></select>
        </div>
      </div>
      {list.length === 0 ? <EmptyState icon="search" title="Nothing matches" text="Try another word or filter." />
        : <div className="media-grid browse-grid bk-grid">{list.map(b => <BookTile key={b.id} book={b} />)}</div>}
    </>
  );
}

interface SourceState { status: 'loading' | 'done' | 'error'; results: BookResult[]; message?: string }

function Request({ config, onPulled }: { config: BooksConfig | null; onPulled: (j: BookJob) => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [state, setState] = useState<Partial<Record<BookSourceId, SourceState>>>({});
  const [only, setOnly] = useState<BookSourceId | null>(null);
  const [chosen, setChosen] = useState<Record<string, BookFormat['kind']>>({});
  const run = useRef(0);
  const { pull, busy } = usePull(onPulled);
  const sources = config?.sources ?? [];

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const text = q.trim();
    if (text.length < 2) return;
    const mine = ++run.current;
    setOnly(null);
    setState(Object.fromEntries(sources.map(s => [s.id, s.available ? { status: 'loading', results: [] } : { status: 'error', results: [], message: 'Not connected' }])));
    for (const s of sources.filter(x => x.available)) {
      api.bookSearch(s.id, text)
        .then(r => { if (run.current === mine) setState(p => ({ ...p, [s.id]: { status: 'done', results: r.results } })); })
        .catch(err => { if (run.current === mine) setState(p => ({ ...p, [s.id]: { status: 'error', results: [], message: (err as Error).message } })); });
    }
  };

  const shown = sources.filter(s => state[s.id] && (!only || only === s.id));
  return (
    <>
      {config && !config.writable && <div className="notice" role="status">Pulling is off: the books folder is read-only for this app. You can still search to see what exists.</div>}
      <form className="bk-search" onSubmit={search} role="search">
        <input className="settings-input" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Title or author, e.g. The Art of War" aria-label="Search for a book" />
        <button className="btn btn-primary" type="submit" disabled={q.trim().length < 2}><SvgIcon name="search" size={16} /> Search</button>
      </form>
      {Object.keys(state).length > 0 && (
        <div className="bk-chips" role="group" aria-label="Sources">
          {sources.map(s => {
            const st = state[s.id];
            return (
              <button key={s.id} type="button" className={`season-tab${only === s.id ? ' is-active' : ''}`} aria-pressed={only === s.id} title={st?.message ?? s.what} onClick={() => setOnly(only === s.id ? null : s.id)}>
                {s.label} {st?.status === 'loading' ? <span className="bk-spin" aria-label="Searching" /> : st?.status === 'error' ? <em className="bk-err">{st.message}</em> : <span className="seg-count">{st?.results.length ?? 0}</span>}
              </button>
            );
          })}
        </div>
      )}
      {shown.map(s => {
        const st = state[s.id]!;
        if (!st.results.length) return null;
        return (
          <section key={s.id} className="bk-group" aria-label={s.label}>
            <h2 className="rail-title">{s.label}</h2>
            <ul className="bk-results">
              {st.results.map(r => {
                const key = `${r.source}:${r.id}`;
                const kind = chosen[key] ?? defaultFormat(r).kind;
                const format = r.formats.find(f => f.kind === kind) ?? defaultFormat(r);
                return (
                  <li key={key} className="bk-result">
                    <div className="bk-result-cover"><Cover src={r.cover} title={r.title} author={r.authors[0]} audio={r.media === 'audiobook'} /></div>
                    <div className="bk-result-text">
                      <strong>{r.title}</strong>
                      <span>{[r.authors.filter(a => a !== r.title).join(', '), r.year].filter(Boolean).join(' · ')}</span>
                      <span className="bk-formats">{r.formats.map(f => formatText(f)).join(' · ')}{r.seeders !== undefined && ` · ${r.seeders} seeders`}</span>
                    </div>
                    <div className="bk-result-act">
                      {r.inLibrary ? <><span className="ui-pill ui-pill--ok">In library</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(`/books/${r.inLibrary}`)} aria-label={`Open ${r.title}`}>Open</button></>
                        : config?.writable && <>
                          {r.formats.length > 1 && <select className="settings-input" value={kind} onChange={e => setChosen(c => ({ ...c, [key]: e.target.value as BookFormat['kind'] }))} aria-label={`Format for ${r.title}`}>{r.formats.map(f => <option key={f.kind + (f.label ?? '')} value={f.kind}>{formatText(f)}</option>)}</select>}
                          <button type="button" className="btn btn-primary btn-sm" disabled={busy === key} onClick={() => void pull(r, format)} aria-label={`Pull ${r.title}`}>{busy === key ? 'Pulling…' : 'Pull'}</button>
                        </>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {Object.keys(state).length > 0 && shown.every(s => state[s.id]!.status === 'done' && !state[s.id]!.results.length) && <EmptyState icon="search" title="Nothing found" text="Try the author's name, or fewer words." />}
    </>
  );
}

/** Books and audiobooks: shelves, the whole library, and a way to request more. */
export default function Books() {
  const [params, setParams] = useSearchParams();
  const [kid, setKid] = useState(false);
  const tab = (['library', 'request'].includes(params.get('tab') ?? '') ? params.get('tab') : 'home') as Tab;
  const [config, setConfig] = useState<BooksConfig | null>(null);
  const [shelves, setShelves] = useState<BookShelf[] | null>(null);
  const [items, setItems] = useState<BookCard[]>([]);
  const [discover, setDiscover] = useState<{ id: string; title: string; results: BookResult[] }[] | null>(null);
  const [error, setError] = useState('');

  const loadLibrary = useCallback(() => {
    api.booksShelves().then(r => setShelves(r.shelves)).catch(err => { setShelves([]); setError((err as Error).message); });
    api.booksLibrary().then(r => setItems(r.items)).catch(() => {});
  }, []);
  const { jobs, refresh, active } = useBookJobs(!kid, loadLibrary);

  useEffect(() => {
    loadLibrary();
    api.booksConfig().then(setConfig).catch(() => {});
    api.authStatus().then(a => {
      const isKid = a.authenticated && a.user?.isKid === true;
      setKid(isKid);
      // Slow the first time, so it fills in after the page is up.
      if (!isKid) api.booksDiscover().then(r => setDiscover(r.rows)).catch(() => setDiscover([]));
    }).catch(() => {});
  }, [loadLibrary]);

  const setTab = (t: Tab) => setParams(t === 'home' ? {} : { tab: t });
  const cancel = (id: string) => { api.cancelBookJob(id).catch(() => {}).finally(() => void refresh()); };
  const tabs: { value: Tab; label: string; count?: number }[] = [{ value: 'home', label: 'Home' }, { value: 'library', label: 'Library', count: items.length }, ...(kid ? [] : [{ value: 'request' as Tab, label: 'Request' }])];
  const current = kid && tab === 'request' ? 'home' : tab;

  return (
    <main className="page browse-library books-page">
      <PageHeader title="Books" sub={shelves === null ? 'Loading…' : `${items.length.toLocaleString()} in your library${active ? ' · downloading' : ''}`} actions={<OpenMediaFolder kind="books" />} />
      <div className="ph-toolbar"><Seg<Tab> label="Books sections" value={current} onChange={setTab} options={tabs} /></div>
      {error && <div className="notice notice--err" role="alert">{error}</div>}
      {current === 'home' && <Home shelves={shelves} jobs={jobs} cancel={cancel} discover={discover} config={config} kid={kid} onPulled={() => void refresh()} onEmpty={() => setTab('request')} />}
      {current === 'library' && <Library items={items} />}
      {current === 'request' && <Request config={config} onPulled={() => void refresh()} />}
      {current === 'request' && jobs.some(j => ACTIVE.includes(j.status)) && (
        <BookRail title="Requested / Downloading">{jobs.filter(j => ACTIVE.includes(j.status)).map(j => <JobCard key={j.id} job={j} onCancel={() => cancel(j.id)} />)}</BookRail>
      )}
    </main>
  );
}
