import { useEffect, useRef, useState } from 'react';
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
  { to: '/series', label: 'TV' },
  { to: '/music', label: 'Music' },
  { to: '/live', label: 'Live' },
  { to: '/photos', label: 'Photos' },
  { to: '/requests', label: 'Requests' },
  { to: '/downloads', label: 'Downloads' },
  { to: '/search', label: 'Search' },
  { to: '/settings', label: 'Settings' }
];

// Less used pages live under one menu so the bar stays readable.
const MORE = [
  { to: '/books', label: 'Books' },
  { to: '/wiki', label: 'Wiki' },
  { to: '/apps', label: 'Apps' },
  { to: '/statistics', label: 'Stats' },
  { to: '/diagnostics', label: 'Diagnostics' },
  { to: '/themes', label: 'Themes' }
];

/** "More" pages: opens on hover or click, closes on a choice, outside click, Escape or page change. */
function MoreMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);
  const { pathname } = useLocation();
  const current = MORE.some(link => pathname.startsWith(link.to));

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
          {MORE.map(link => (
            <NavLink key={link.to} to={link.to} role="menuitem" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} onClick={() => setOpen(false)}>
              {link.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export function Navigation({ user, onSignOut, onRefresh }: { user?: AuthUser | null; onSignOut?: () => void; onRefresh?: () => void }) {
  return (
    <nav className="nav" aria-label="Primary">
      <NavLink to="/" className="nav-brand">
        <VvLogo variant="tile" size={32} />
        <span>virtuallyView</span>
      </NavLink>
      <div className="nav-links">
        {LINKS.map(link => (
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
        <MoreMenu />
      </div>
      {user && <NavLink to="/search" className="nav-search" aria-label="Search"><SvgIcon name="search" size={19} /></NavLink>}
      {user && onRefresh && <RefreshButton onRefresh={onRefresh} />}
      {user && <SystemActivity />}
      {user && <NotificationBell />}
      {user && onSignOut && <UserMenu user={user} onSignOut={onSignOut} />}
    </nav>
  );
}