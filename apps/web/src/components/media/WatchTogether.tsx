import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ProfileBadge } from '../profiles/ProfileBadge';
import { unescapeChat } from '../../lib/partySync';
import type { Party } from '../../lib/useWatchParty';

const EMOJI = [['👍', 'Thumbs up'], ['😂', 'Laughing'], ['😮', 'Surprised'], ['❤️', 'Heart'], ['👏', 'Clap']] as const;

/** Start a watch party for what is playing, or show the invite, the people in it, reactions and chat. */
export default function WatchTogether({ title, code, party }: { title: string; code: string | null; party: Party }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [seen, setSeen] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/watch-party', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, link: location.pathname })
      });
      const data = (await res.json()) as { code?: string; message?: string };
      if (!res.ok || !data.code) throw new Error(data.message ?? 'Could not start a watch party.');
      navigate(`${location.pathname}?party=${data.code}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const leave = () => navigate(location.pathname, { replace: true });
  const link = code ? `${window.location.origin}/party/${code}` : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked: the link is shown */ }
  };

  const { chat } = party;
  useEffect(() => { if (open) { setSeen(chat.length); listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); } }, [open, chat.length]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    if (!(await party.say({ text: body }))) setError('That message did not send. Wait a moment and try again.');
    else setError('');
  };

  if (!code) {
    return (
      <div className="watch-together">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void start()} disabled={busy}>{busy ? 'Starting...' : 'Watch together'}</button>
        {error && <span className="notice notice--err">{error}</span>}
      </div>
    );
  }

  return (
    <div className="watch-together watch-together--live">
      <div className="wt-row">
        <span>Watching together, code <strong className="wt-code">{code}</strong></span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy invite link'}</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={leave}>Leave</button>
        <span className="watch-together-link">{link}</span>
      </div>
      {party.ended && <p className="notice notice--err" role="alert">This watch party has ended.</p>}
      <ul className="wt-members" aria-label="People in this party">
        {party.members.map(m => (
          <li key={m.id} className="wt-member">
            <ProfileBadge name={m.name} {...(m.avatar ? { avatar: m.avatar } : {})} />
            <span>{m.name}{m.host && <small className="wt-host"> Host</small>}</span>
            {party.host && !m.host && <button type="button" className="btn btn-secondary btn-sm" onClick={() => void party.giveHost(m.id)}>Make host</button>}
          </li>
        ))}
      </ul>
      <div className="wt-row">
        <span className="wt-reactions" role="group" aria-label="Quick reactions">
          {EMOJI.map(([emoji, label]) => <button key={emoji} type="button" className="icon-btn" aria-label={label} onClick={() => void party.say({ reaction: emoji })}>{emoji}</button>)}
        </span>
        <button type="button" className="btn btn-secondary btn-sm" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          {open ? 'Hide chat' : 'Chat'}{!open && chat.length > seen ? ` (${chat.length - seen} new)` : ''}
        </button>
      </div>
      {open && (
        <aside className="wt-chat" aria-label="Party chat">
          <ul ref={listRef} className="wt-chat-list">
            {chat.length === 0 && <li className="wt-chat-empty">No messages yet.</li>}
            {chat.map(m => <li key={m.id}><strong>{m.name}</strong> {unescapeChat(m.text)}</li>)}
          </ul>
          <form className="wt-chat-form" onSubmit={e => void send(e)}>
            <input className="input" value={text} maxLength={300} onChange={e => setText(e.target.value)} placeholder="Say something" aria-label="Message" />
            <button type="submit" className="btn btn-primary btn-sm" disabled={!text.trim()}>Send</button>
          </form>
        </aside>
      )}
      {error && <span className="notice notice--err">{error}</span>}
    </div>
  );
}
