import { useState } from 'react';
import { api, type AuthUser, type ProfileAvatar } from '../../lib/api';
import { PROFILE_COLORS, PROFILE_EMOJIS, DEFAULT_PROFILE_AVATAR } from '../profiles/profile-choices';
import { ProfileBadge } from '../profiles/ProfileBadge';
import '../profiles/profiles.css';

/** Colour and emoji pickers for one profile. Choices come from a fixed list, so nothing free-form is stored. */
export function ProfileChoices({ value, onChange, disabled }: { value?: ProfileAvatar; onChange: (next: ProfileAvatar) => void; disabled?: boolean }) {
  const current = value ?? DEFAULT_PROFILE_AVATAR;
  return (
    <span className="profile-choices">
      <label>
        <span className="sr-only">Colour</span>
        <select className="settings-input" value={current.color} disabled={disabled} onChange={e => onChange({ ...current, color: e.target.value })}>
          {PROFILE_COLORS.map(color => <option key={color.value} value={color.value}>{color.label}</option>)}
        </select>
      </label>
      <label>
        <span className="sr-only">Icon</span>
        <select className="settings-input" value={current.emoji} disabled={disabled} onChange={e => onChange({ ...current, emoji: e.target.value })}>
          {PROFILE_EMOJIS.map(emoji => <option key={emoji.value || 'initials'} value={emoji.value}>{emoji.label}</option>)}
        </select>
      </label>
    </span>
  );
}

/**
 * Administrator: every account's picker avatar, whether it is shown in "Who's watching?", and whether it is a
 * Kids profile. Administrator accounts cannot be Kids profiles.
 */
export function ProfileAccounts({ users, onChanged }: { users: AuthUser[]; onChanged: (users: AuthUser[]) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (user: AuthUser, body: { shown?: boolean; isKid?: boolean; avatar?: ProfileAvatar }) => {
    setBusy(user.id);
    setError(null);
    try {
      onChanged((await api.setProfile(user.id, body)).users);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="settings-section">
      <h3>Profiles</h3>
      <p className="settings-help">
        What each person looks like in &quot;Who&apos;s watching?&quot;. A Kids profile sees family titles only, with no
        requests, downloads or settings. Hidden profiles cannot be switched to.
      </p>
      <ul className="users-list">
        {users.map(user => (
          <li key={user.id} className="users-row profile-row">
            <span className="profile-row-who">
              <ProfileBadge name={user.username} avatar={user.profileAvatar} />
              <span className="users-name">{user.username}</span>
            </span>
            <ProfileChoices value={user.profileAvatar} disabled={busy === user.id} onChange={avatar => void save(user, { avatar })} />
            <label className="profile-check">
              <input type="checkbox" checked={user.shown !== false} disabled={busy === user.id} onChange={e => void save(user, { shown: e.target.checked })} />
              Show in profile picker
            </label>
            <label className="profile-check" title={user.role === 'admin' ? 'Administrator accounts cannot be Kids profiles' : 'Limit this profile to family titles'}>
              <input
                type="checkbox"
                checked={user.isKid === true}
                disabled={busy === user.id || user.role === 'admin'}
                onChange={e => void save(user, { isKid: e.target.checked })}
              />
              Kids profile
            </label>
          </li>
        ))}
      </ul>
      {error && <div className="notice notice--err">{error}</div>}
    </section>
  );
}

/** Your own profile: colour and emoji, and your PIN. Any signed-in person can use this. */
export function MyProfile({ me, onChanged }: { me: AuthUser; onChanged: (user: AuthUser) => void }) {
  const [pin, setPin] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const saveAvatar = async (avatar: ProfileAvatar) => {
    setBusy(true);
    setNotice(null);
    try {
      onChanged((await api.setMyProfile({ avatar })).user);
    } catch (err) {
      setNotice({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const savePin = async (next: string | null) => {
    setBusy(true);
    setNotice(null);
    try {
      onChanged((await api.setMyProfile({ pin: next })).user);
      setEditing(false);
      setPin('');
      setNotice({ tone: 'ok', text: next ? 'PIN saved.' : 'PIN removed.' });
    } catch (err) {
      setNotice({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section">
      <h3>Your profile</h3>
      <p className="settings-help">A PIN is asked for when someone switches to your profile from another one.</p>
      <div className="profile-mine">
        <ProfileBadge name={me.username} avatar={me.profileAvatar} size="large" />
        <ProfileChoices value={me.profileAvatar} disabled={busy} onChange={avatar => void saveAvatar(avatar)} />
        <span className="profile-mine-pin">
          {me.hasPin ? (
            <>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setEditing(!editing)}>Change PIN</button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void savePin(null)}>Remove PIN</button>
            </>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setEditing(!editing)}>Set PIN</button>
          )}
        </span>
      </div>
      {editing && (
        <form className="profile-pin-form" onSubmit={e => { e.preventDefault(); if (pin.length === 4) void savePin(pin); }}>
          <label className="login-field">
            <span>New PIN (4 digits)</span>
            <input
              className="settings-input"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={4}
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          </label>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || pin.length !== 4}>Save PIN</button>
        </form>
      )}
      {notice && <div className={`notice notice--${notice.tone === 'ok' ? 'ok' : 'err'}`}>{notice.text}</div>}
    </section>
  );
}
