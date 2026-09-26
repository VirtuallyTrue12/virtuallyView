import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { SvgIcon } from '../ui/SvgIcon';
import { VvLogo } from './VvLogo';
import { UserMenu } from './UserMenu';
import { NotificationBell } from './NotificationBell';
import { SystemActivity } from './SystemActivity';
import { RefreshButton } from './RefreshButton';
import type { AuthUser } from '../../lib/api';

const LINKS = [
  { to: '/', label: 'Home' },
  { to: '/movies', label: 'Movies' },
  { to: '/series', label: 'TV shows' },
  { to: '/music', label: 'Music' },
  { to: '/live', label: 'Live TV' },
  { to: '/photos', label: 'Photos' },
  { to: '/requests', label: 'Requests' },
  { to: '/downloads', label: 'Downloads' }
];

// Less used pages live under one menu so the bar stays readable.
const MORE = [
  { to: '/books', label: 'Books' },
  { to: '/wiki', label: 'Wiki' },
  { to: '/apps', label: 'Apps' },
  { to: '/statistics', label: 'Stats' },
  { to: '/diagnostics', label: 'Diagnostics' },
  { to: '/themes', label: 'Themes' },
  { to: '/settings', label: 'Settings' }
];

/** "More" pages: opens on hover or click, closes on a choice, outside click, Escape or page change. */
function MoreMenu({ extra = [] }: { extra?: Array<{ to: string; label: string }> }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);
  const { pathname } = useLocation();
  const all = [...extra, ...MORE];
  const current = all.some(link => link.to === '/' ? pathname === '/' : pathname.startsWith(link.to));

  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  useEffect(() => () => { if (closeTimer.current) window.clearTimeout(closeTimer.current); }, []);

  // Hover opens it on a mouse; a short delay stops it snapping shut while the pointer crosses the gap.
  const hover = (pointerType: string, entering: boolean) => {
    if (pointerType !== 'mouse') return;
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    if (entering) setOpen(true);
    else closeTimer.current = window.setTimeout(() => setOpen(false), 180);
  };

  return (
    <div className="nav-more" ref={wrap} onPointerEnter={e => hover(e.pointerType, true)} onPointerLeave={e => hover(e.pointerType, false)}>
      <button
        ref={button}
        type="button"
        className={`nav-link nav-more-button${current ? ' active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        More <SvgIcon name="chevron-down" size={12} />
      </button>
      {open && (
        <div className="nav-more-panel" role="menu">
          {all.map(link => (
            <NavLink key={link.to} to={link.to} end={link.to === '/'} role="menuitem" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} onClick={() => setOpen(false)}>
              {link.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

/** How many of the main links fit next to the logo and the buttons; the rest move under More. Recomputed whenever the bar changes size. */
function useFittingLinks(nav: React.RefObject<HTMLElement | null>, brand: React.RefObject<HTMLElement | null>, tools: React.RefObject<HTMLElement | null>, measure: React.RefObject<HTMLElement | null>) {
  const [fit, setFit] = useState(LINKS.length);
  useLayoutEffect(() => {
    const bar = nav.current;
    if (!bar) return;
    const compute = () => {
      const m = measure.current;
      // Phones use the tab bar instead of these links.
      if (window.innerWidth <= 860 || !m) { setFit(LINKS.length); return; }
      const widths = [...m.children].map(c => c.getBoundingClientRect().width);
      const cs = getComputedStyle(bar);
      const gap = parseFloat(cs.columnGap) || 16;
      const room = bar.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - (brand.current?.offsetWidth ?? 0) - (tools.current?.offsetWidth ?? 0) - gap * 2;
      const between = 18;
      const moreWidth = 78;
      let used = moreWidth, n = 0;
      for (const w of widths) { if (used + between + w > room) break; used += between + w; n++; }
      setFit(Math.max(0, n));
    };
    compute();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(compute) : null;
    observer?.observe(bar);
    window.addEventListener('resize', compute);
    void document.fonts?.ready.then(compute);
    return () => { observer?.disconnect(); window.removeEventListener('resize', compute); };
  }, [nav, brand, tools, measure]);
  return fit;
}

export function Navigation({ user, onSignOut, onRefresh }: { user?: AuthUser | null; onSignOut?: () => void; onRefresh?: () => void }) {
  const nav = useRef<HTMLElement>(null);
  const brand = useRef<HTMLAnchorElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const fit = useFittingLinks(nav, brand, tools, measure);
  return (
    <nav className="nav" aria-label="Primary" ref={nav}>
      <NavLink to="/" className="nav-brand" ref={brand}>
        <VvLogo variant="tile" size={32} />
        <span>virtuallyView</span>
      </NavLink>
      <div className="nav-links">
        {LINKS.slice(0, fit).map(link => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === '/'}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            {link.label}
          </NavLink>
        ))}
        {/* On phones the links scroll sideways in one row, so the extra pages sit inline instead of in a menu. */}
        {MORE.map(link => <NavLink key={`m-${link.to}`} to={link.to} className={({ isActive }) => `nav-link nav-link--extra${isActive ? ' active' : ''}`}>{link.label}</NavLink>)}
        <MoreMenu extra={LINKS.slice(fit)} />
        <div className="nav-measure" ref={measure} aria-hidden="true">{LINKS.map(l => <span key={l.to} className="nav-link">{l.label}</span>)}</div>
      </div>
      <div className="nav-tools" ref={tools}>
        {user && <NavLink to="/search" className="nav-search" aria-label="Search"><SvgIcon name="search" size={19} /></NavLink>}
        {user && onRefresh && <RefreshButton onRefresh={onRefresh} />}
        {user && <SystemActivity />}
        {user && <NotificationBell />}
        {user && onSignOut && <UserMenu user={user} onSignOut={onSignOut} />}
      </div>
    </nav>
  );
}
