import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { SvgIcon } from '../components/ui/SvgIcon';
import { THEMES, type Engine, type ReaderTheme, type TocEntry } from '../components/books/engines';

const PREFS = 'vv-reader';
const prefs = (): { font: number; theme: ReaderTheme } => {
  try { const p = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as { font?: number; theme?: ReaderTheme }; return { font: p.font ?? 100, theme: p.theme && p.theme in THEMES ? p.theme : 'dark' }; } catch { return { font: 100, theme: 'dark' }; }
};

/** Full-screen reader for EPUB and PDF. It owns the arrow keys (data-dpad="own"): Left and Right turn pages, Up reaches the bar. */
export default function BookReader() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const stage = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const latest = useRef({ position: '', percent: 0, dirty: false });
  const timer = useRef(0);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [percent, setPercent] = useState(0);
  const [panel, setPanel] = useState<'' | 'toc' | 'text'>('');
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [look, setLook] = useState(prefs);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const l = latest.current;
    if (!l.dirty) return;
    l.dirty = false;
    api.saveBookState(id, { position: l.position, percent: l.percent }).catch(() => {});
  }, [id]);

  const close = useCallback(() => {
    flush();
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1); else navigate(`/books/${id}`, { replace: true });
  }, [flush, id, navigate]);

  const turn = useCallback((dir: 1 | -1) => { if (dir > 0) engine.current?.next(); else engine.current?.prev(); }, []);
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const swipeRef = useRef<(dx: number) => void>(() => {});

  useEffect(() => {
    let dead = false;
    const el = stage.current!;
    (async () => {
      try {
        const { book, state } = await api.book(id);
        const file = book.files.find(f => String(f.index) === params.get('f')) ?? book.files.find(f => f.format === 'epub') ?? book.files.find(f => f.format === 'pdf');
        if (!file || (file.format !== 'epub' && file.format !== 'pdf')) throw new Error('This book has no EPUB or PDF to read here. You can download it from its page.');
        setTitle(book.title);
        api.saveBookState(id, { opened: true }).catch(() => {});
        const { openEpub, openPdf } = await import('../components/books/engines');
        const open = file.format === 'epub' ? openEpub : openPdf;
        const eng = await open(el, `/api/books/library/${id}/file/${file.index}`, {
          position: state?.position ?? '', font: look.font, theme: look.theme,
          onMove: (position, pct) => {
            latest.current = { position, percent: pct, dirty: true };
            setPercent(pct);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(flush, 2500);
          },
          onKey: e => keyRef.current(e), onSwipe: dx => swipeRef.current(dx)
        });
        if (dead) { eng.destroy(); return; }
        engine.current = eng;
        void eng.toc.then(t => { if (!dead) setToc(t); });
        setLoading(false);
        root.current?.focus();
      } catch (err) { if (!dead) { setError((err as Error).message || 'This book could not be opened.'); setLoading(false); } }
    })();
    const leave = () => { const l = latest.current; if (l.dirty) void fetch(`/api/books/library/${id}/state`, { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position: l.position, percent: l.percent }) }); };
    window.addEventListener('pagehide', leave);
    return () => { dead = true; window.removeEventListener('pagehide', leave); flush(); engine.current?.destroy(); engine.current = null; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { try { localStorage.setItem(PREFS, JSON.stringify(look)); } catch { /* not kept */ } engine.current?.setFont(look.font); engine.current?.setTheme(look.theme); }, [look]);

  // On a remote, arrows walk the buttons when focus is on the bar or a list, and turn pages otherwise.
  const move = (e: KeyboardEvent): boolean => {
    const active = document.activeElement as HTMLElement | null;
    const group = active?.closest<HTMLElement>('.rd-bar, .rd-panel');
    if (!group) return false;
    const items = [...root.current!.querySelectorAll<HTMLElement>('.rd-bar button, .rd-panel button')];
    const i = items.indexOf(active!);
    const next = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? items[i - 1] : items[i + 1];
    if (e.key === 'ArrowDown' && group.classList.contains('rd-bar') && !panel) root.current?.focus();
    else (next ?? (e.key === 'ArrowDown' ? root.current : active))?.focus();
    return true;
  };
  keyRef.current = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'BrowserBack') { e.preventDefault(); if (panel) { setPanel(''); root.current?.focus(); } else close(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ' '].includes(e.key)) return;
    if (e.key === ' ' && document.activeElement?.closest('.rd-bar, .rd-panel')) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && move(e)) { e.preventDefault(); return; }
    e.preventDefault();
    if (e.key === 'ArrowUp') { (root.current?.querySelector('.rd-bar button') as HTMLElement | null)?.focus(); return; }
    turn(e.key === 'ArrowLeft' || e.key === 'PageUp' ? -1 : 1);
  };
  swipeRef.current = dx => { if (Math.abs(dx) > 50) turn(dx < 0 ? 1 : -1); };

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (!(e.target as HTMLElement).closest?.('select, input')) keyRef.current(e); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const t = THEMES[look.theme];
  const pct = Math.round(percent);
  return (
    <div ref={root} className={`rd rd--${look.theme}`} data-dpad="own" tabIndex={-1} role="dialog" aria-modal="true" aria-label={title ? `Reading ${title}` : 'Reader'} style={{ background: t.bg, color: t.fg }}>
      <header className="rd-bar">
        <button type="button" onClick={close} aria-label="Close the book"><SvgIcon name="arrow-left" size={20} /></button>
        <strong className="rd-title">{title}</strong>
        <button type="button" onClick={() => setPanel(p => (p === 'toc' ? '' : 'toc'))} aria-label="Contents" aria-expanded={panel === 'toc'} disabled={toc.length === 0}><SvgIcon name="list" size={20} /></button>
        <button type="button" onClick={() => setPanel(p => (p === 'text' ? '' : 'text'))} aria-label="Text size and theme" aria-expanded={panel === 'text'}><span className="rd-aa" aria-hidden="true">Aa</span></button>
      </header>
      <div className="rd-stage-wrap">
        <button type="button" className="rd-edge rd-edge--l" onClick={() => turn(-1)} aria-label="Previous page" tabIndex={-1}><SvgIcon name="chevron-left" size={26} /></button>
        <div
          ref={stage}
          className="rd-stage"
          onPointerDown={e => { (e.currentTarget as HTMLElement).dataset.x = String(e.clientX); }}
          onPointerUp={e => { const x0 = Number((e.currentTarget as HTMLElement).dataset.x); if (!Number.isNaN(x0)) swipeRef.current(e.clientX - x0); }}
        />
        <button type="button" className="rd-edge rd-edge--r" onClick={() => turn(1)} aria-label="Next page" tabIndex={-1}><SvgIcon name="chevron-right" size={26} /></button>
        {loading && <div className="rd-msg" role="status">Opening…</div>}
        {error && <div className="rd-msg" role="alert">{error}</div>}
      </div>
      {panel === 'toc' && (
        <nav className="rd-panel rd-toc" aria-label="Contents">
          {toc.map((e, i) => <button key={i} type="button" onClick={() => { e.go(); setPanel(''); root.current?.focus(); }}>{e.label}</button>)}
        </nav>
      )}
      {panel === 'text' && (
        <div className="rd-panel rd-text" role="group" aria-label="Text size and theme">
          <div className="rd-row">
            <button type="button" onClick={() => setLook(l => ({ ...l, font: Math.max(70, l.font - 10) }))} aria-label="Smaller text">A-</button>
            <span>{look.font}%</span>
            <button type="button" onClick={() => setLook(l => ({ ...l, font: Math.min(220, l.font + 10) }))} aria-label="Larger text">A+</button>
          </div>
          <div className="rd-row">
            {(['dark', 'sepia', 'light'] as const).map(n => <button key={n} type="button" className={look.theme === n ? 'is-on' : ''} aria-pressed={look.theme === n} onClick={() => setLook(l => ({ ...l, theme: n }))}>{n[0]!.toUpperCase() + n.slice(1)}</button>)}
          </div>
        </div>
      )}
      <footer className="rd-foot">
        <div className="rd-progress" role="progressbar" aria-label="Progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${percent}%` }} /></div>
        <span>{pct}%</span>
      </footer>
    </div>
  );
}
