import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { api, type AiHealth, type AgentReply } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  meta?: string;
}

interface PendingConfirmation {
  tool: string;
  arguments: Record<string, unknown>;
  description: string;
}

const SUGGESTIONS = [
  'Which movies are missing?',
  'What is downloading right now?',
  'Pause download-003',
  'List current downloads',
];

export default function ChatWidget() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<AiHealth | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const isPlayerRoute = location.pathname.includes('/play');

  useEffect(() => {
    if (isPlayerRoute) {
      setOpen(false);
      return;
    }
    api.aiHealth().then(setHealth).catch(() => setHealth(null));
  }, [isPlayerRoute]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const history = messages.map(m => ({ role: m.role, content: m.content })).slice(-12);
  const push = (message: ChatMessage) => setMessages(prev => [...prev, message]);

  const handleReply = (reply: AgentReply) => {
    switch (reply.kind) {
      case 'message':
        push({ role: 'assistant', content: reply.text });
        break;
      case 'tool-result':
        push({ role: 'assistant', content: reply.text, meta: `Ran ${reply.tool}` });
        break;
      case 'confirmation':
        setPending({ tool: reply.tool, arguments: reply.arguments, description: reply.description });
        push({ role: 'assistant', content: `I can ${reply.tool.replace(/_/g, ' ')}. This is a moderate action, so nothing changes until you confirm.`, meta: 'Needs confirmation' });
        break;
      case 'error':
        push({ role: 'assistant', content: `Could not run that: ${reply.message}`, meta: 'Error' });
        break;
    }
  };

  const send = async (text?: string, confirm?: PendingConfirmation) => {
    const content = text ?? input.trim();
    if ((!content && !confirm) || busy) return;
    setBusy(true);
    if (confirm) {
      setPending(null);
      try {
        const reply = await api.aiChat({ message: '', history, confirm: { tool: confirm.tool, arguments: confirm.arguments } });
        handleReply(reply);
      } catch (err) {
        push({ role: 'assistant', content: `Could not reach the assistant: ${(err as Error).message}`, meta: 'Error' });
      } finally {
        setBusy(false);
      }
      return;
    }
    setInput('');
    push({ role: 'user', content });
    try {
      const reply = await api.aiChat({ message: content, history });
      handleReply(reply);
    } catch (err) {
      push({ role: 'assistant', content: `Could not reach the assistant: ${(err as Error).message}`, meta: 'Error' });
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };

  if (isPlayerRoute) return null;

  const online = health?.healthy ?? false;

  if (!open) {
    return (
      <button
        className="chat-fab"
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open AI assistant"
      >
        <span className={`chat-fab-dot${online ? ' chat-fab-dot--online' : ''}`} />
        <span className="chat-fab-icon">AI</span>
      </button>
    );
  }

  return (
    <div className="chat-widget">
      <div className="chat-widget-header">
        <div className="chat-widget-title">
          <span>AI Assistant</span>
          <span className={`ai-status${online ? ' is-online' : ' is-offline'}`}>
            {health ? `${online ? 'Online' : 'Offline'}${health.model ? ' · ' + health.model : ''}` : 'Checking...'}
          </span>
        </div>
        <button className="chat-widget-close" type="button" onClick={() => setOpen(false)} aria-label="Close"><SvgIcon name="close" size={16} /></button>
      </div>

      <div className="chat-widget-list" ref={listRef}>
        {messages.length === 0 && !busy && (
          <div className="chat-empty">
            <p>Command the library with plain language. Model management moved to Settings.</p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map(s => (
                <button key={s} type="button" className="chip" onClick={() => send(s)} disabled={busy}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-msg--${m.role}`}>
            <p>{m.content}</p>
            {m.meta && <span className="chat-meta">{m.meta}</span>}
            {pending && m === messages[messages.length - 1] && (
              <div className="chat-confirm">
                <span className="chat-confirm-desc">{pending.description}</span>
                <div className="chat-confirm-actions">
                  <button className="btn btn-primary btn-sm" type="button" onClick={() => send('', pending)} disabled={busy}>Confirm</button>
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setPending(null); push({ role: 'assistant', content: 'Cancelled. Nothing was changed.' }); }} disabled={busy}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {busy && <div className="chat-msg chat-msg--assistant"><p className="chat-typing">Thinking...</p></div>}
      </div>
      <form className="chat-composer" onSubmit={onSubmit}>
        <input className="chat-input" value={input} onChange={e => setInput(e.target.value)} placeholder="Ask about your library..." aria-label="Ask the AI assistant" />
        <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !input.trim()}>Send</button>
      </form>
    </div>
  );
}