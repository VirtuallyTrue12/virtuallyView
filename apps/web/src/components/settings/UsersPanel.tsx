import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type AuthSession, type AuthUser } from '../../lib/api';

/**
 * Administrator-only account management. The server enforces the role on every
 * endpoint; this panel additionally hides itself from regular users so they are
 * not shown controls that would only fail.
 */
export default function UsersPanel() {
  const [me, setMe] = useState<AuthUser | null>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [sessions, setSessions] = useState<AuthSession[]>([]);

  const loadSessions = useCallback(async () => {
    try { setSessions((await api.sessions()).sessions); } catch { setSessions([]); }
  }, []);

  const resetPassword = async (user: AuthUser) => {
    setBusy(user.id);
    setNotice(null);
    try {
      await api.resetUserPassword(user.id, resetPw);
      setNotice({ tone: 'ok', text: `Password for ${user.username} was reset and they were signed out everywhere.` });
      setResetFor(null);
      setResetPw('');
      void loadSessions();
    } catch (err) {
      setNotice({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const signOutDevice = async (session: AuthSession) => {
    setBusy(session.id);
    try {
      await api.revokeSession(session.id);
      if (session.current) window.location.reload();
      else await loadSessions();
    } catch (err) {
      setNotice({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const load = useCallback(async () => {
    try {
      const status = await api.authStatus();
      setMe(status.user);
      void loadSessions();
      if (status.user?.role !== 'admin') {
        setDenied(true);
        setLoading(false);
        return;
      }
      const result = await api.users();
      setUsers(result.users);
      setDenied(false);
    } catch {
      setDenied(true);
    } finally {
      setLoading(false);
    }
  }, [loadSessions]);

  useEffect(() => { void load(); }, [load]);

  const addUser = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setNotice(null);
    setBusy('add');
    try {
      const result = await api.createUser(username.trim(), password, role);
      setUsers(result.users);
      setUsername('');
      setPassword('');
      setRole('user');
      setNotice({ tone: 'ok', text: 'Account created.' });
    } catch (err) {
      setNotice({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const changeRole = async (user: AuthUser, next: 'admin' | 'user') => {
    setBusy(user.id);
    setNotice(null);
    try {
      const result = await api.setUserRole(user.id, next);
      setUsers(result.users);
    } catch (err) {
      setNotice({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const changeLimit = async (user: AuthUser, maxRating: string) => {
    setBusy(user.id);
    setNotice(null);
    try {
      setUsers((await api.setUserLimit(user.id, maxRating)).users);
    } catch (err) {
      setNotice({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const removeUser = async (user: AuthUser) => {
    setBusy(user.id);
    setNotice(null);
    try {
      const result = await api.deleteUserAccount(user.id);
      setUsers(result.users);
      setNotice({ tone: 'ok', text: `${user.username} was removed.` });
    } catch (err) {
      setNotice({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="page-head" style={{ marginTop: '0.5rem' }}>
        <h2 className="rail-title">Users</h2>
        <span className="page-count">
          {me ? `Signed in as ${me.username} (${me.role})` : 'Account management'}
        </span>
      </div>

      {loading ? (
        <div className="empty-state">Loading accounts...</div>
      ) : (
        <>
          {denied && <div className="empty-state">Only an administrator manages accounts. <Link to="/account">Open your own account</Link> to change your password or sign out devices.</div>}

          {!denied && (
          <section className="settings-section">
            <h3>Accounts</h3>
            <ul className="users-list">
              {users.map(user => (
                <li key={user.id} className="users-row">
                  <span className="users-name">
                    {user.username}
                    {me?.id === user.id && <span className="users-you">you</span>}
                  </span>
                  <span className={`users-role users-role--${user.role}`}>{user.role}</span>
                  {user.role === 'user' && (
                    <label className="users-limit" title="Hides movies and shows rated above this. Unrated titles are hidden too.">
                      <span className="sr-only">Age limit for {user.username}</span>
                      <select className="settings-input" value={user.maxRating ?? ''} disabled={busy === user.id} onChange={e => void changeLimit(user, e.target.value)}>
                        <option value="">No age limit</option>
                        <option value="G">G and TV-G</option>
                        <option value="PG">PG and TV-PG</option>
                        <option value="PG-13">PG-13 and TV-14</option>
                        <option value="R">R and TV-MA</option>
                      </select>
                    </label>
                  )}
                  <span className="users-actions">
                    {user.role === 'admin' ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy === user.id || me?.id === user.id}
                        title={me?.id === user.id ? 'You cannot demote yourself' : 'Make this a regular user'}
                        onClick={() => void changeRole(user, 'user')}
                      >
                        Make user
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy === user.id}
                        onClick={() => void changeRole(user, 'admin')}
                      >
                        Make admin
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy === user.id}
                      onClick={() => { setResetFor(resetFor === user.id ? null : user.id); setResetPw(''); }}
                    >
                      Reset password
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy === user.id || me?.id === user.id}
                      title={me?.id === user.id ? 'You cannot remove yourself' : 'Remove this account'}
                      onClick={() => void removeUser(user)}
                    >
                      Remove
                    </button>
                  </span>
                  {resetFor === user.id && (
                    <span className="users-reset">
                      <input className="settings-input" type="password" autoComplete="new-password" placeholder="New password (4+ characters)" value={resetPw} onChange={e => setResetPw(e.target.value)} />
                      <button type="button" className="btn btn-primary btn-sm" disabled={busy === user.id || resetPw.length < 4} onClick={() => void resetPassword(user)}>Set password</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="settings-section">
            <h3>Add an account</h3>
            <p className="settings-help">
              New accounts can sign in from the same sign-in screen. Give administrator access only
              when the person needs to manage services, folders, and other accounts.
            </p>
            <form className="users-add" onSubmit={addUser}>
              <label className="login-field">
                <span>Username</span>
                <input
                  className="settings-input"
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  placeholder="Username"
                  required
                />
              </label>
              <label className="login-field">
                <span>Password</span>
                <input
                  className="settings-input"
                  type="password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  placeholder="At least 4 characters"
                  autoComplete="new-password"
                  required
                />
              </label>
              <label className="login-field">
                <span>Role</span>
                <select
                  className="settings-input"
                  value={role}
                  onChange={event => setRole(event.target.value === 'admin' ? 'admin' : 'user')}
                >
                  <option value="user">User</option>
                  <option value="admin">Administrator</option>
                </select>
              </label>
              <button className="btn btn-primary" type="submit" disabled={busy === 'add'}>
                {busy === 'add' ? 'Creating...' : 'Create account'}
              </button>
            </form>
          </section>

          </>)}

          <details className="settings-section st-details">
            <summary><span>Signed-in devices</span><span className="ui-badge">{sessions.length}</span></summary>
            <p className="settings-help">Every device signed in to this server. Sign one out if you do not recognise it.</p>
            <ul className="users-list">
              {sessions.map(session => (
                <li key={session.id} className="users-row">
                  <span className="users-name">
                    {session.device}
                    {session.current && <span className="users-you">this device</span>}
                    <small style={{ display: 'block', opacity: 0.7 }}>
                      {`${session.username} · `}{session.ip || 'unknown address'} · {session.createdAt ? `signed in ${new Date(session.createdAt).toLocaleString()}` : 'signed in earlier'}
                    </small>
                  </span>
                  <span className="users-actions">
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy === session.id} onClick={() => void signOutDevice(session)}>
                      Sign out
                    </button>
                  </span>
                </li>
              ))}
              {sessions.length === 0 && <li className="users-row"><span className="users-name">No active sessions listed.</span></li>}
            </ul>
          </details>
          )}

          {denied ? null : (<>
          {notice && <div className={`notice notice--${notice.tone === 'ok' ? 'ok' : 'err'}`}>{notice.text}</div>}
        </>
      )}
    </>
  );
}
