import { useEffect, useState } from 'react';
import { api, type NotificationChannel, type ServerSettings } from '../../lib/api';
import { desktopNotificationsEnabled, setDesktopNotifications } from '../../lib/desktop-notifications';

type Kind = NotificationChannel['kind'];
const KINDS: Array<{ kind: Kind; label: string; fields: Array<{ key: string; label: string; placeholder?: string; secret?: boolean }> }> = [
  { kind: 'discord', label: 'Discord', fields: [{ key: 'url', label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/...' }] },
  { kind: 'slack', label: 'Slack', fields: [{ key: 'url', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/...' }] },
  { kind: 'telegram', label: 'Telegram', fields: [{ key: 'token', label: 'Bot token', secret: true }, { key: 'chatId', label: 'Chat ID' }] },
  { kind: 'ntfy', label: 'ntfy', fields: [{ key: 'url', label: 'Topic URL', placeholder: 'https://ntfy.sh/your-topic' }, { key: 'token', label: 'Access token (optional)', secret: true }] },
  { kind: 'gotify', label: 'Gotify', fields: [{ key: 'url', label: 'Server URL' }, { key: 'token', label: 'App token', secret: true }] },
  { kind: 'webhook', label: 'Generic webhook', fields: [{ key: 'url', label: 'URL (receives JSON)' }] },
  { kind: 'email', label: 'Email (SMTP)', fields: [{ key: 'host', label: 'SMTP host' }, { key: 'port', label: 'Port', placeholder: '587' }, { key: 'secure', label: 'Use TLS from the start (true or false)', placeholder: 'false' }, { key: 'user', label: 'Username' }, { key: 'pass', label: 'Password', secret: true }, { key: 'from', label: 'From address' }, { key: 'to', label: 'Send to' }] }
];

/** Where notifications go: the bell in the top bar always, desktop pop-ups per device, and any channels below. */
export default function NotificationsPanel({ settings, onSaved }: { settings: ServerSettings | null; onSaved: (s: ServerSettings) => void }) {
  const [events, setEvents] = useState<Array<{ key: string; label: string }>>([]);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [desktop, setDesktop] = useState(desktopNotificationsEnabled());
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => { api.notifications().then(r => setEvents(r.events ?? [])).catch(() => {}); }, []);
  useEffect(() => { setChannels(settings?.notifications?.channels ?? []); }, [settings?.notifications?.channels]);

  const update = (id: string, patch: Partial<NotificationChannel>) => setChannels(list => list.map(c => (c.id === id ? { ...c, ...patch } : c)));
  const add = (kind: Kind) => setChannels(list => [...list, { id: Math.random().toString(36).slice(2, 10), name: KINDS.find(k => k.kind === kind)!.label, kind, enabled: true, events: events.map(e => e.key), config: {} }]);

  const save = async () => {
    setNote(null);
    try { onSaved(await api.saveServerSettings({ notifications: { channels } })); setNote({ tone: 'ok', text: 'Saved.' }); }
    catch (e) { setNote({ tone: 'err', text: (e as Error).message }); }
  };

  const test = async (c: NotificationChannel) => {
    setTesting(c.id); setNote(null);
    try { await api.testChannel(c); setNote({ tone: 'ok', text: `${c.name}: test message sent.` }); }
    catch (e) { setNote({ tone: 'err', text: `${c.name}: ${(e as Error).message}` }); }
    finally { setTesting(null); }
  };

  return (
    <>
      <section className="settings-section">
        <h3 className="section-title">Bell and desktop notifications</h3>
        <p className="model-suggest-meta">The bell in the top bar always shows what happened to your requests. Desktop notifications pop up while a tab is open, on this device only.</p>
        <label className="settings-row" style={{ gap: 8 }}>
          <input type="checkbox" checked={desktop} onChange={async e => { setDesktop(await setDesktopNotifications(e.target.checked)); }} aria-label="Desktop notifications" />
          <span>Show desktop notifications on this device</span>
        </label>
      </section>

      <section className="settings-section">
        <h3 className="section-title">Channels</h3>
        <p className="model-suggest-meta">Send events to chat apps, your phone or email. Each channel picks which events it wants.</p>
        {channels.map(c => {
          const def = KINDS.find(k => k.kind === c.kind)!;
          return (
            <div className="channel-card" key={c.id}>
              <div className="channel-head">
                <input className="settings-input" value={c.name} onChange={e => update(c.id, { name: e.target.value })} aria-label="Channel name" />
                <label className="settings-row" style={{ gap: 6 }}><input type="checkbox" checked={c.enabled} onChange={e => update(c.id, { enabled: e.target.checked })} /> On</label>
                <button className="btn btn-secondary btn-sm" type="button" disabled={testing === c.id} onClick={() => void test(c)}>{testing === c.id ? 'Sending...' : 'Send test'}</button>
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => setChannels(l => l.filter(x => x.id !== c.id))}>Remove</button>
              </div>
              <div className="channel-fields">
                {def.fields.map(f => (
                  <label className="login-field" key={f.key}>
                    <span>{f.label}</span>
                    <input className="settings-input" type={f.secret ? 'password' : 'text'} placeholder={f.placeholder} value={c.config[f.key] ?? ''} onChange={e => update(c.id, { config: { ...c.config, [f.key]: e.target.value } })} autoComplete="off" />
                  </label>
                ))}
              </div>
              <div className="channel-events">
                {events.map(ev => (
                  <label className="creator-check" key={ev.key}>
                    <input type="checkbox" checked={c.events.includes(ev.key)} onChange={e => update(c.id, { events: e.target.checked ? [...c.events, ev.key] : c.events.filter(k => k !== ev.key) })} /> {ev.label}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
        <div className="settings-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select className="settings-input" defaultValue="" onChange={e => { if (e.target.value) { add(e.target.value as Kind); e.target.value = ''; } }} aria-label="Add a channel">
            <option value="">Add a channel...</option>
            {KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => void save()}>Save channels</button>
        </div>
        {note && <div className={`notice notice--${note.tone}`} role="status">{note.text}</div>}
      </section>
    </>
  );
}
