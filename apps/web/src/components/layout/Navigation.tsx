import { NavLink } from 'react-router-dom';
import { VvLogo } from './VvLogo';
import { UserMenu } from './UserMenu';
import { NotificationBell } from './NotificationBell';
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
  { to: '/statistics', label: 'Stats' },
  { to: '/diagnostics', label: 'Diagnostics' },
  { to: '/themes', label: 'Themes' }
];

export function Navigation({ user, onSignOut }: { user?: AuthUser | null; onSignOut?: () => void }) {
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
        <details className="nav-more">
          <summary className="nav-link">More</summary>
          <div className="nav-more-panel">
            {MORE.map(link => <NavLink key={link.to} to={link.to} className="nav-link">{link.label}</NavLink>)}
          </div>
        </details>
      </div>
      {user && <NotificationBell />}
      {user && onSignOut && <UserMenu user={user} onSignOut={onSignOut} />}
    </nav>
  );
}