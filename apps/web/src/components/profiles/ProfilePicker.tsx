import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type ProfileSummary } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';
import { ProfileBadge } from './ProfileBadge';
import { PinPad } from './PinPad';
import './profiles.css';

interface Prompt { profile: ProfileSummary; needs: 'pin' | 'password'; passwordAllowed: boolean }

/**
 * "Who's watching?": a full-screen picker of the household's profiles. Tapping one switches the device to it;
 * a profile with a PIN (or an administrator's profile) asks for its secret first. A successful switch reloads
 * the app, so no data from the previous profile is left on screen.
 */
export default function ProfilePicker() {
  const [profiles, setProfiles] = useState<ProfileSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.profiles()
      .then(result => { if (!cancelled) setProfiles(result.profiles); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const choose = async (profile: ProfileSummary) => {
    if (busy) return;
    setBusy(profile.id);
    setNotice(null);
    try {
      await api.switchProfile(profile.id);
      window.location.assign('/');
    } catch (err) {
      const body = (err as ApiError).body as { needs?: 'pin' | 'password'; passwordAllowed?: boolean } | undefined;
      if (err instanceof ApiError && err.status === 403 && body?.needs) {
        setPrompt({ profile, needs: body.needs, passwordAllowed: body.passwordAllowed === true });
      } else {
        setNotice((err as Error).message);
      }
    } finally {
      setBusy(null);
    }
  };

  // Returns an error to show in the PIN pad, or null once the switch has worked.
  const trySecret = async (secret: { pin?: string; password?: string }): Promise<string | null> => {
    if (!prompt) return null;
    try {
      await api.switchProfile(prompt.profile.id, secret);
      window.location.assign('/');
      return null;
    } catch (err) {
      const body = (err as ApiError).body as { attemptsLeft?: number; retryAfterSeconds?: number } | undefined;
      if (err instanceof ApiError && err.status === 429) {
        return `Too many wrong PINs. Try again in ${body?.retryAfterSeconds ?? 60} seconds.`;
      }
      if (body?.attemptsLeft !== undefined) {
        return `${(err as Error).message} ${body.attemptsLeft} ${body.attemptsLeft === 1 ? 'try' : 'tries'} left.`;
      }
      return (err as Error).message;
    }
  };

  return (
    <main className="picker-screen">
      <h1 className="picker-title">Who&apos;s watching?</h1>
      {!profiles && !failed && <p className="picker-state">Loading profiles...</p>}
      {failed && <p className="picker-state">Profiles could not be loaded. <Link to="/">Back to the home page</Link></p>}
      {profiles && profiles.length === 0 && (
        <p className="picker-state">No profiles are shown yet. Ask an administrator to show them in Settings, People.</p>
      )}
      {profiles && profiles.length > 0 && (
        <ul className="picker-grid" aria-label="Profiles">
          {profiles.map(profile => (
            <li key={profile.id}>
              <button
                type="button"
                className="picker-profile"
                disabled={busy !== null}
                onClick={() => void choose(profile)}
                aria-label={`${profile.name}${profile.isKid ? ', Kids profile' : ''}${profile.hasPin ? ', PIN needed' : ''}`}
              >
                <span className="picker-avatar">
                  <ProfileBadge name={profile.name} avatar={profile.avatar} size="large" />
                  {profile.hasPin && (
                    <span className="picker-lock" aria-hidden="true"><SvgIcon name="lock" size={16} /></span>
                  )}
                </span>
                <span className="picker-name">{profile.name}</span>
                {profile.isKid && <span className="picker-kids">Kids</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {notice && <p className="picker-notice" role="alert">{notice}</p>}
      <div className="picker-foot">
        <Link to="/" className="picker-back">Back</Link>
        <Link to="/account" className="picker-back">Edit profile</Link>
      </div>
      {prompt && (
        <PinPad
          name={prompt.profile.name}
          needs={prompt.needs}
          passwordAllowed={prompt.passwordAllowed}
          onSubmit={trySecret}
          onCancel={() => setPrompt(null)}
        />
      )}
    </main>
  );
}
