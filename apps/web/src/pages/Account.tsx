import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { BackButton } from '../components/layout/BackButton';
import { api, type AuthSession, type AuthUser } from '../lib/api';
import { Avatar } from '../components/ui/Avatar';
import QuickConnectApprove from '../components/settings/QuickConnectApprove';
import { pictureToAvatar } from '../lib/avatar-image';

/** Your own account: who you are, your password, and the devices signed in as you. */
export default function Account() {
  const [me, setMe] = useState<AuthUser | null>(null);
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const load = async () => {
    try {
      const status = await api.authStatus();
      setMe(status.user);
      const all = (await api.sessions()).sessions;
      setSessions(status.user ? all.filter(s => s.userId === status.user!.id) : []);
    } catch { /* shown as empty */ }
  };
  useEffect(() => { void load(); }, []);

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('pw');
    setNote(null);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setNote({ tone: 'ok', text: 'Password changed. Your other devices were signed out.' });
      await load();
    } catch (err) {
      setNote({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const signOutDevice = async (s: AuthSession) => {
    setBusy(s.id);
    try {
      await api.revokeSession(s.id);
      if (s.current) window.location.reload();
      else await load();
    } catch (err) {
      setNote({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const signOutOthers = async () => {
    setBusy('others');
    try {
      const r = await api.revokeOtherSessions();
      setNote({ tone: 'ok', text: r.signedOut ? `Signed out ${r.signedOut} other device${r.signedOut === 1 ? '' : 's'}.` : 'No other devices were signed in.' });
      await load();
    } catch (err) {
      setNote({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const chooseAvatar = async (file: File | undefined) => {
    if (!file) return;
    setBusy('avatar');
    setNote(null);
    try {
      const result = await api.setAvatar(await pictureToAvatar(file));
      setMe(result.user);
    } catch (err) {
      setNote({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const removeAvatar = async () => {
    setBusy('avatar');
    try {
      const result = await api.setAvatar('');
      setMe(result.user);
    } catch (err) {
      setNote({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    setBusy('out');
    try { await api.logout(); } finally { window.location.assign('/'); }
  };

  if (!me) return <main className="page"><div className="loading-state">Loading account...</div></main>;

  return (
    <main className="page account-page">
      <BackButton to="/" label="Home" />
      <div className="page-head"><h1>Account</h1></div>

      <section className="settings-section account-card">
        <div className="account-id">
          <Avatar user={me} large />
          <div>
            <h2>{me.username}</h2>
            <p className="model-suggest-meta">
              {me.role === 'admin' ? 'Administrator' : 'User'}
              {me.createdAt && new Date(me.createdAt).getTime() > 0 ? `, joined ${new Date(me.createdAt).toLocaleDateString()}` : ''}
              {me.maxRating ? `, limited to ${me.maxRating} and below` : ''}
            </p>
          </div>
        </div>
        <div className="account-actions">
          <label className="btn btn-secondary">
            {busy === 'avatar' ? 'Saving...' : 'Change picture'}
            <input type="file" accept="image/*" hidden disabled={busy === 'avatar'} onChange={e => { void chooseAvatar(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {me.avatar && <button className="btn btn-secondary" type="button" onClick={() => void removeAvatar()} disabled={busy === 'avatar'}>Remove picture</button>}
          <button className="btn btn-secondary" type="button" onClick={() => void signOut()} disabled={busy === 'out'}>Sign out</button>
          {me.role === 'admin' && <Link className="btn btn-secondary" to="/settings?cat=users">Manage users</Link>}
          <Link className="btn btn-secondary" to="/themes">Appearance</Link>
        </div>
      </section>

      {note && <div className={`notice notice--${note.tone}`} role="status">{note.text}</div>}

      <section className="settings-section">
        <h3 className="section-title">Change password</h3>
        <form className="users-add" onSubmit={changePassword}>
          <label className="login-field">
            <span>Current password</span>
            <input className="settings-input" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required />
          </label>
          <label className="login-field">
            <span>New password</span>
            <input className="settings-input" type="password" autoComplete="new-password" placeholder="At least 4 characters" value={next} onChange={e => setNext(e.target.value)} required />
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy === 'pw'}>{busy === 'pw' ? 'Saving...' : 'Change password'}</button>
        </form>
      </section>

      <QuickConnectApprove />

      <section className="settings-section">
        <div className="account-devices-head">
          <h3 className="section-title">Signed-in devices</h3>
          {sessions.length > 1 && <button className="btn btn-secondary btn-sm" type="button" onClick={() => void signOutOthers()} disabled={busy === 'others'}>Sign out other devices</button>}
        </div>
        <ul className="users-list">
          {sessions.map(s => (
            <li key={s.id} className="users-row">
              <span className="users-name">
                {s.device}
                {s.current && <span className="users-you">this device</span>}
                <small style={{ display: 'block', opacity: 0.7 }}>{s.ip || 'unknown address'}, {s.createdAt ? `signed in ${new Date(s.createdAt).toLocaleString()}` : 'signed in earlier'}</small>
              </span>
              <span className="users-actions">
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy === s.id} onClick={() => void signOutDevice(s)}>Sign out</button>
              </span>
            </li>
          ))}
          {sessions.length === 0 && <li className="users-row"><span className="users-name">No active sessions listed.</span></li>}
        </ul>
      </section>
    </main>
  );
}
