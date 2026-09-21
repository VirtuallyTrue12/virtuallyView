import type { AuthUser } from '../../lib/api';

/** Profile picture, or the first letter of the name on the accent colour when none is set. */
export function Avatar({ user, large }: { user: Pick<AuthUser, 'username' | 'avatar'>; large?: boolean }) {
  return (
    <span
      className={`user-avatar${large ? ' user-avatar--large' : ''}${user.avatar ? ' user-avatar--image' : ''}`}
      style={user.avatar ? { backgroundImage: `url(${user.avatar})` } : undefined}
      aria-hidden="true"
    >
      {user.avatar ? '' : user.username.charAt(0).toUpperCase()}
    </span>
  );
}
