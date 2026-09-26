import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { SvgIcon } from './SvgIcon';

/**
 * A row that scrolls sideways. On a computer there is no swipe, so it shows an arrow at each end that
 * has more to reveal; on a touch screen it simply swipes. Keyboard users can scroll it with the arrow keys.
 */
export function ScrollRow({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setEdge({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    measure();
    const el = track.current;
    if (!el) return;
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [measure, children]);

  const by = (dir: 1 | -1) => track.current?.scrollBy({ left: dir * Math.max(200, (track.current?.clientWidth ?? 600) * 0.8), behavior: 'smooth' });

  return (
    <div className={`sr${edge.left ? ' has-left' : ''}${edge.right ? ' has-right' : ''}`}>
      {edge.left && <button type="button" className="sr-arrow sr-arrow--left" onClick={() => by(-1)} aria-label={`Scroll ${label ?? 'the list'} left`}><SvgIcon name="chevron-left" size={18} /></button>}
      <div ref={track} className={`sr-track ${className}`} onScroll={measure} tabIndex={0} role="group" aria-label={label}>{children}</div>
      {edge.right && <button type="button" className="sr-arrow sr-arrow--right" onClick={() => by(1)} aria-label={`Scroll ${label ?? 'the list'} right`}><SvgIcon name="chevron-right" size={18} /></button>}
    </div>
  );
}
