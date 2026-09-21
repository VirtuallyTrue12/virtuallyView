import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AuthUser } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';
import { Avatar } from '../ui/Avatar';

/** Account button in the top bar: who is signed in, account and appearance links, sign out. */
export function UserMenu({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="user-menu-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Avatar user={user} />
        <span className="user-menu-name">{user.username}</span>
        <SvgIcon name="chevron-down" size={14} />
      </button>
      {open && (
        <div className="user-menu-panel" role="menu">
          <div className="user-menu-head">
            <strong>{user.username}</strong>
            <span>{user.role === 'admin' ? 'Administrator' : 'User'}</span>
          </div>
          <Link role="menuitem" to="/account" onClick={() => setOpen(false)}>Account</Link>
          <Link role="menuitem" to="/themes" onClick={() => setOpen(false)}>Appearance</Link>
          {user.role === 'admin' && <Link role="menuitem" to="/settings?cat=users" onClick={() => setOpen(false)}>Manage users</Link>}
          <button role="menuitem" type="button" className="user-menu-signout" onClick={() => { setOpen(false); onSignOut(); }}>Sign out</button>
        </div>
      )}
    </div>
  );
}
