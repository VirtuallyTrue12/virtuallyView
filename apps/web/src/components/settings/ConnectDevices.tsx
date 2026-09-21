import { useEffect, useState } from 'react';
import { api, type ServerSettings } from '../../lib/api';

/** Everything an admin needs to get a phone, TV or laptop signed in. */
export default function ConnectDevices({ settings, onSaved }: { settings: ServerSettings | null; onSaved: (s: ServerSettings) => void }) {
  const here = window.location;
  const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(here.hostname);
  const detected = isLocal ? '' : `${here.protocol}//${here.host}`;
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setAddress(settings?.publicUrl || detected); }, [settings?.publicUrl, detected]);

  const save = async (patch: Partial<ServerSettings>, okText: string) => {
    setBusy(true);
    setNote(null);
    try {
      onSaved(await api.saveServerSettings(patch));
      setNote({ tone: 'ok', text: okText });
    } catch (err) {
      setNote({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const shown = address || `http://<this-computer's-ip>:${settings?.port ?? 3000}`;

  return (
    <div className="settings-section" style={{ marginTop: 'var(--spacing-md)' }}>
      <h3 className="section-title">Connect other devices</h3>
      <p className="model-suggest-meta">
        Phones, TVs and other computers on your network sign in with their own account at the address below.
        {isLocal && ' You opened this page as localhost, so enter this computer\'s network address (for example http://192.168.1.20:3000) once and it is remembered.'}
      </p>
      <div className="settings-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input
          className="settings-input"
          style={{ flex: 1, minWidth: 240 }}
          value={address}
          onChange={e => setAddress(e.target.value)}
          placeholder={`http://192.168.1.20:${settings?.port ?? 3000}`}
          aria-label="Address other devices use"
        />
        <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => void save({ publicUrl: address }, 'Address saved.')}>Save address</button>
        <button
          className="btn btn-primary btn-sm"
          type="button"
          disabled={!address}
          onClick={async () => {
            try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
          }}
        >{copied ? 'Copied' : 'Copy link'}</button>
      </div>
      <ol className="model-suggest-meta" style={{ margin: 'var(--spacing-sm) 0', paddingLeft: '1.2rem' }}>
        <li>On the other device, join the same Wi-Fi/network and open <strong>{shown}</strong> in a browser.</li>
        <li>Sign in with an account you created under <strong>Settings, then Users</strong>, or turn on sign-up below.</li>
        <li>Tick <em>Stay signed in</em> on personal devices so it remembers them for 30 days.</li>
        <li>Can't connect? Allow port {settings?.port ?? 3000} through this computer's firewall.</li>
      </ol>
      <label className="settings-row" style={{ gap: 8 }}>
        <input
          type="checkbox"
          checked={settings?.allowSignup === true}
          disabled={busy}
          onChange={e => void save({ allowSignup: e.target.checked }, e.target.checked ? 'Anyone who can reach this server can now create an account.' : 'Sign-up is closed. Only you can add accounts.')}
          aria-label="Let people create their own account"
        />
        <span>Let people create their own account from the sign-in screen (off = you add every account)</span>
      </label>
      {note && <div className={`notice notice--${note.tone}`}>{note.text}</div>}
    </div>
  );
}
