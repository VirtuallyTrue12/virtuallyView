import type { ProfileAvatar } from '../../lib/api';

// The fixed colour and emoji choices for a profile. Must match PROFILE_COLORS and PROFILE_EMOJIS on the server.
export const PROFILE_COLORS = [
  { value: '#e50914', label: 'Red' },
  { value: '#1e88e5', label: 'Blue' },
  { value: '#43a047', label: 'Green' },
  { value: '#fb8c00', label: 'Orange' },
  { value: '#8e24aa', label: 'Purple' },
  { value: '#00acc1', label: 'Teal' },
  { value: '#d81b60', label: 'Pink' },
  { value: '#6d4c41', label: 'Brown' }
] as const;

/** An empty emoji means the profile shows its initials. */
export const PROFILE_EMOJIS = [
  { value: '', label: 'Initials' },
  { value: '🦊', label: '🦊' }, { value: '🐻', label: '🐻' }, { value: '🐼', label: '🐼' }, { value: '🦁', label: '🦁' },
  { value: '🐸', label: '🐸' }, { value: '🐙', label: '🐙' }, { value: '🚀', label: '🚀' }, { value: '⭐', label: '⭐' },
  { value: '🎸', label: '🎸' }, { value: '🌈', label: '🌈' }, { value: '🍕', label: '🍕' }, { value: '🎮', label: '🎮' },
  { value: '🦖', label: '🦖' }
] as const;

export const DEFAULT_PROFILE_AVATAR: ProfileAvatar = { color: PROFILE_COLORS[0].value, emoji: '' };

/** One or two letters for a name, used when a profile has no emoji. */
export function initialsOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}
