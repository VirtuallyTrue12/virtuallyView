import type { ProfileAvatar } from '../../lib/api';
import { DEFAULT_PROFILE_AVATAR, initialsOf } from './profile-choices';

/** A round coloured badge with the profile's emoji, or its initials when it has none. */
export function ProfileBadge({ name, avatar, size = 'small' }: { name: string; avatar?: ProfileAvatar; size?: 'small' | 'large' }) {
  const shown = avatar ?? DEFAULT_PROFILE_AVATAR;
  return (
    <span className={`profile-badge profile-badge--${size}`} style={{ background: shown.color }} aria-hidden="true">
      {shown.emoji || initialsOf(name)}
    </span>
  );
}
