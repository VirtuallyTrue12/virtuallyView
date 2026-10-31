import { useState } from 'react';
import { useMusicPlayer } from '../media/MusicProvider';
import './Together.css';

/** Start a listening session from the queue now playing, or show the code and the people in the one already open. */
export default function ListenTogether() {
  const { listen, startListen, leaveListen, setEveryoneControl } = useMusicPlayer();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const start = async () => {
    setBusy(true);
    setError('');
    const err = await startListen();
    setBusy(false);
    if (err) setError(err);
  };

  if (!listen) {
    return (
      <div className="together">
        <h3 className="together-title">Listen together</h3>
        <p className="together-help">Start a session and share the code. Everyone who opens the link hears the same song at the same moment. Anyone in it can add songs. Only you can skip, unless you turn on "Everyone can control".</p>
        <button type="button" className="btn btn-primary" onClick={() => void start()} disabled={busy}>{busy ? 'Starting...' : 'Start listening together'}</button>
        {error && <p className="notice notice--err" role="alert">{error}</p>}
      </div>
    );
  }

  const link = `${window.location.origin}/music/together/${listen.code}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked: the link is on screen */ }
  };

  return (
    <div className="together">
      <h3 className="together-title">Listening together</h3>
      <p className="together-code">Code <strong>{listen.code}</strong></p>
      <div className="together-link">
        <span className="together-link-text">{link}</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</button>
      </div>

      <h4 className="together-sub">Listening now ({listen.members.length})</h4>
      <ul className="together-members">
        {listen.members.map(m => (
          <li key={m.userId} className="together-member">
            <span className="together-avatar" aria-hidden="true">{m.name.slice(0, 1).toUpperCase()}</span>
            <span className="together-name">{m.name}{m.userId === listen.you ? ' (you)' : ''}</span>
            {m.host && <span className="together-tag">Host</span>}
          </li>
        ))}
      </ul>

      {listen.youAreHost ? (
        <button type="button" role="switch" aria-checked={listen.everyoneControl} className={`toggle${listen.everyoneControl ? ' is-on' : ''}`} onClick={() => setEveryoneControl(!listen.everyoneControl)}>
          <span className="toggle-knob" aria-hidden="true" />
          <span>Everyone can control <small>skip, pause and reorder, not just you</small></span>
        </button>
      ) : (
        <p className="together-help">{listen.everyoneControl ? 'Everyone here can skip, pause and reorder.' : 'The host controls playback. You can add songs from any album with its + button.'}</p>
      )}

      <button type="button" className="btn btn-secondary btn-sm together-leave" onClick={leaveListen}>Leave session</button>
    </div>
  );
}
