import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Dialog } from '../ui/Dialog';
import { SvgIcon, type IconName } from '../ui/SvgIcon';

const TABS: Array<{ to: string; label: string; icon: IconName; end?: boolean }> = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/movies', label: 'Movies', icon: 'film-tab' },
  { to: '/series', label: 'TV', icon: 'tv-tab' },
  { to: '/music', label: 'Music', icon: 'note-tab' }
];

const MORE: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/requests', label: 'Requests', icon: 'plus' }, { to: '/downloads', label: 'Downloads', icon: 'queue' }, { to: '/search', label: 'Search', icon: 'search' },
  { to: '/live', label: 'Live TV', icon: 'tv' }, { to: '/photos', label: 'Photos', icon: 'image' }, { to: '/books', label: 'Books', icon: 'grid' },
  { to: '/wiki', label: 'Wiki', icon: 'grid' }, { to: '/apps', label: 'Apps', icon: 'grid' }, { to: '/settings', label: 'Settings', icon: 'sliders-h' },
  { to: '/statistics', label: 'Stats', icon: 'grid' }, { to: '/diagnostics', label: 'Diagnostics', icon: 'sparkle' }, { to: '/themes', label: 'Themes', icon: 'sparkle' }
];

/**
 * The phone's main navigation: four places you go all the time and a "More" sheet for the rest.
 * Hidden on larger screens (the top bar has the links there). Tells the page how tall it is, so
 * the music bar and floating buttons sit above it.
 */
export function MobileTabs() {
  const [more, setMore] = useState(false);
  const bar = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  useEffect(() => { setMore(false); }, [pathname]);

  useEffect(() => {
    const root = document.documentElement;
    const el = bar.current;
    if (!el) return;
    const update = () => root.style.setProperty('--tabbar-h', `${el.offsetHeight}px`);
    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(el);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); root.style.removeProperty('--tabbar-h'); };
  }, []);

  const inMore = MORE.some(m => pathname.startsWith(m.to));
  // Full-screen players and watch parties have their own controls.
  if (/\/play$|\/watch\/|^\/party\//.test(pathname)) return null;
  return (
    <>
      <nav className="tabs" ref={bar} aria-label="Main">
        {TABS.map(t => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}>
            <SvgIcon name={t.icon} size={22} /><span>{t.label}</span>
          </NavLink>
        ))}
        <button type="button" className={`tab${inMore || more ? ' is-active' : ''}`} onClick={() => setMore(true)} aria-haspopup="dialog" aria-expanded={more}>
          <SvgIcon name="grid" size={22} /><span>More</span>
        </button>
      </nav>
      <Dialog open={more} onClose={() => setMore(false)} title="More">
        <div className="more-grid">
          {MORE.map(m => (
            <NavLink key={m.to} to={m.to} className={({ isActive }) => `more-tile${isActive ? ' is-active' : ''}`}>
              <SvgIcon name={m.icon} size={22} /><span>{m.label}</span>
            </NavLink>
          ))}
        </div>
      </Dialog>
    </>
  );
}
