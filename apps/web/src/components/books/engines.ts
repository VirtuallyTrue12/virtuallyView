/** The two page engines behind the reader. Each is loaded only when a book of that kind is opened. */
export type ReaderTheme = 'dark' | 'sepia' | 'light';
export const THEMES: Record<ReaderTheme, { bg: string; fg: string }> = {
  dark: { bg: '#121214', fg: '#e4e4e7' },
  sepia: { bg: '#f4ecd8', fg: '#5b4636' },
  light: { bg: '#ffffff', fg: '#1d1d1f' }
};

export interface TocEntry { label: string; go: () => void }
export interface Engine {
  next: () => void;
  prev: () => void;
  toc: Promise<TocEntry[]>;
  setFont: (percent: number) => void;
  setTheme: (t: ReaderTheme) => void;
  destroy: () => void;
}
export interface OpenOptions {
  position: string;
  font: number;
  theme: ReaderTheme;
  onMove: (position: string, percent: number) => void;
  /** Keys and swipes that happen inside the book's own frame, which the page cannot see. */
  onKey: (e: KeyboardEvent) => void;
  onSwipe: (dx: number) => void;
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('The book file could not be loaded.');
  return res.arrayBuffer();
}

export async function openEpub(el: HTMLElement, url: string, o: OpenOptions): Promise<Engine> {
  const { default: ePub } = await import('epubjs');
  const book = ePub(await fetchBytes(url));
  const rendition = book.renderTo(el, { width: '100%', height: '100%', flow: 'paginated', spread: 'none' });
  const paint = (t: ReaderTheme) => { rendition.themes.override('color', THEMES[t].fg); rendition.themes.override('background', THEMES[t].bg); };
  paint(o.theme);
  rendition.themes.fontSize(`${o.font}%`);
  let ready = false;
  rendition.on('relocated', (loc: { start: { cfi: string; percentage: number } }) => {
    if (ready) o.onMove(loc.start.cfi, loc.start.percentage * 100);
  });
  rendition.on('keydown', o.onKey);
  let x0 = 0;
  rendition.on('touchstart', (e: TouchEvent) => { x0 = e.changedTouches[0]!.screenX; });
  rendition.on('touchend', (e: TouchEvent) => o.onSwipe(e.changedTouches[0]!.screenX - x0));
  await rendition.display(o.position || undefined);
  ready = true;
  // Percentages need the book cut into locations first; that takes a moment, so do it after the first page shows.
  void book.ready.then(() => book.locations.generate(1200)).then(() => {
    const loc = rendition.currentLocation() as unknown as { start?: { cfi: string; percentage: number } };
    if (loc?.start) o.onMove(loc.start.cfi, loc.start.percentage * 100);
  }).catch(() => {});
  return {
    next: () => void rendition.next(),
    prev: () => void rendition.prev(),
    toc: book.loaded.navigation.then(nav => nav.toc.map(t => ({ label: t.label.trim(), go: () => void rendition.display(t.href) }))),
    setFont: p => rendition.themes.fontSize(`${p}%`),
    setTheme: paint,
    destroy: () => { rendition.destroy(); book.destroy(); }
  };
}

export async function openPdf(el: HTMLElement, url: string, o: OpenOptions): Promise<Engine> {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerSrc } = await import('pdfjs-dist/build/pdf.worker.min.js?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await fetchBytes(url)) }).promise;
  const canvas = document.createElement('canvas');
  canvas.className = 'rd-pdf';
  el.replaceChildren(canvas);
  let page = Math.min(pdf.numPages, Math.max(1, parseInt(o.position, 10) || 1));
  let font = o.font;
  let task = 0;
  const draw = async () => {
    const mine = ++task;
    const p = await pdf.getPage(page);
    const base = p.getViewport({ scale: 1 });
    // Fit the page to the screen, then let the text size setting zoom around that.
    const scale = Math.min(el.clientWidth / base.width, el.clientHeight / base.height) * (font / 100);
    const view = p.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
    if (mine !== task) return;
    canvas.width = view.width; canvas.height = view.height;
    canvas.style.width = `${view.width / (window.devicePixelRatio || 1)}px`;
    await p.render({ canvasContext: canvas.getContext('2d')!, viewport: view }).promise.catch(() => {});
  };
  const show = (n: number) => { page = Math.min(pdf.numPages, Math.max(1, n)); void draw(); o.onMove(String(page), (page / pdf.numPages) * 100); };
  const theme = (t: ReaderTheme) => { canvas.style.filter = t === 'dark' ? 'invert(0.9) hue-rotate(180deg)' : t === 'sepia' ? 'sepia(0.55)' : 'none'; };
  theme(o.theme);
  const resize = () => void draw();
  window.addEventListener('resize', resize);
  await draw();
  o.onMove(String(page), (page / pdf.numPages) * 100);
  return {
    next: () => show(page + 1),
    prev: () => show(page - 1),
    toc: pdf.getOutline().then(async outline => {
      const out: TocEntry[] = [];
      for (const item of outline ?? []) {
        try {
          const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
          const index = dest ? await pdf.getPageIndex(dest[0]) : -1;
          if (index >= 0) out.push({ label: item.title, go: () => show(index + 1) });
        } catch { /* a bookmark that points nowhere is left out */ }
      }
      return out;
    }).catch(() => []),
    setFont: p => { font = p; void draw(); },
    setTheme: theme,
    destroy: () => { window.removeEventListener('resize', resize); void pdf.destroy(); }
  };
}
