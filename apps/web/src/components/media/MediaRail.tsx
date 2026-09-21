import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MediaCard } from './MediaCard';
import { StatusPill } from './StatusPill';
import type { Rail, DownloadItem, MediaItem } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';

export function MediaRail({ rail }: { rail: Rail }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      setCanScrollLeft(el.scrollLeft > 10);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 10);
    };
    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', check); ro.disconnect(); };
  }, [rail.items?.length]);

  const scrollBy = (dir: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  // Apple-TV style keyboard rail control: arrow keys move the focused rail
  // horizontally (events bubble up from focused cards inside the rail).
  const handleRailKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      scrollBy(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      scrollBy(1);
    }
  };

  if (!rail.items || rail.items.length === 0) return null;

  const detailPath = (item: MediaItem) =>
    item.type === 'series' ? `/series/${item.id}`
      : item.type === 'artist' ? `/music/${item.id}`
        : `/movies/${item.id}`;

  return (
    <section className="rail" aria-label={rail.title}>
      <div className="rail-head">
        {rail.href ? (
          <Link to={rail.href} className="rail-title rail-title--link">{rail.title}</Link>
        ) : (
          <h2 className="rail-title">{rail.title}</h2>
        )}
        <div className="rail-arrows">
          {canScrollLeft && <button className="rail-arrow" onClick={() => scrollBy(-1)} aria-label="Scroll left"><SvgIcon name="chevron-left" size={16} /></button>}
          {canScrollRight && <button className="rail-arrow" onClick={() => scrollBy(1)} aria-label="Scroll right"><SvgIcon name="chevron-right" size={16} /></button>}
        </div>
      </div>
      <div className="rail-scroll" ref={scrollRef} tabIndex={0} onKeyDown={handleRailKeyDown} aria-label={`${rail.title} (use arrow keys to scroll)`}>
        {rail.items.map(item =>
          rail.kind === 'download' ? (
            <DownloadCard key={item.id} item={item as DownloadItem} />
          ) : (
            <MediaCard
              key={item.id}
              item={item as MediaItem}
              showStatus
              progress={(item as MediaItem).watchProgress}
              to={(item as MediaItem & { href?: string }).href ?? detailPath(item as MediaItem)}
            />
          )
        )}
      </div>
    </section>
  );
}

function DownloadCard({ item }: { item: DownloadItem }) {
  return (
    <article className="media-card" tabIndex={0} aria-label={item.title}>
      <div className="media-card-artwork media-card-download">
        {item.artwork?.poster ? (
          <img src={item.artwork!.poster} alt="" className="media-card-art-img" />
        ) : (
          <StatusPill status={item.status} />
        )}
      </div>
      <div className="media-card-info">
        <h3 className="media-card-title">{item.title}</h3>
        <p className="media-card-sub">
          {[item.year, item.size].filter(Boolean).join(' · ')}
        </p>
        {typeof item.progress === 'number' && (
          <div
            className="media-card-progress"
            role="progressbar"
            aria-valuenow={item.progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div style={{ width: `${item.progress}%` }} />
          </div>
        )}
      </div>
    </article>
  );
}