import { useEffect, useState } from 'react';
import { api, type HostAddresses, type ServerSettings } from '../../lib/api';

/** Everything an admin needs to get a phone, TV or laptop signed in. */
export default function ConnectDevices({ settings, onSaved }: { settings: ServerSettings | null; onSaved: (s: ServerSettings) => void }) {
  const here = window.location;
  const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(here.hostname);
  const detected = isLocal ? '' : `${here.protocol}//${here.host}`;
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [host, setHost] = useState<HostAddresses | null>(null);
  const port = here.port || String(settings?.port ?? 3000);
  const urlFor = (ip: string) => `${here.protocol}//${ip}${port === '80' || port === '443' ? '' : `:${port}`}`;
  const lan = host?.addresses.filter(a => a.kind === 'lan') ?? [];
  const tailnet = host?.addresses.filter(a => a.kind === 'tailscale') ?? [];
  // Opened as localhost with nothing saved: offer this computer's home-network address instead of a blank box.
  const suggested = detected || (lan[0] ? urlFor(lan[0].address) : '');

  useEffect(() => { api.hostAddresses().then(setHost).catch(() => setHost(null)); }, []);
  useEffect(() => { setAddress(settings?.publicUrl || suggested); }, [settings?.publicUrl, suggested]);

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(null), 1800); } catch { /* clipboard blocked */ }
  };

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
        {isLocal && !lan.length && ' You opened this page as localhost, so enter this computer\'s network address (for example http://192.168.1.20:3000) once and it is remembered.'}
      </p>
      {(lan.length > 0 || tailnet.length > 0) && (
        <ul className="connect-addresses" aria-label="Addresses of this computer">
          {lan.map(a => (
            <li key={a.address}>
              <span><strong>{urlFor(a.address)}</strong> <span className="model-suggest-meta">on your home network ({a.interface})</span></span>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => void copy(urlFor(a.address))}>{copied === urlFor(a.address) ? 'Copied' : 'Copy'}</button>
            </li>
          ))}
          {tailnet.map(a => (
            <li key={a.address}>
              <span><strong>{urlFor(a.address)}</strong> <span className="model-suggest-meta">over Tailscale, from your own devices anywhere</span></span>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => void copy(urlFor(a.address))}>{copied === urlFor(a.address) ? 'Copied' : 'Copy'}</button>
            </li>
          ))}
        </ul>
      )}
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
          onClick={() => void copy(address)}
        >{copied === address ? 'Copied' : 'Copy link'}</button>
      </div>
      <ol className="model-suggest-meta" style={{ margin: 'var(--spacing-sm) 0', paddingLeft: '1.2rem' }}>
        <li>On the other device, join the same Wi-Fi/network and open <strong>{shown}</strong> in a browser.</li>
        <li>Sign in with an account you created under <strong>Settings, then People and requests</strong>, or turn on sign-up below.</li>
        <li>Tick <em>Stay signed in</em> on personal devices so it remembers them for 30 days.</li>
        <li>Can't connect? Allow port {settings?.port ?? 3000} through this computer's firewall.</li>
      </ol>
      <label className="settings-row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={settings?.allowSignup === true}
          disabled={busy}
          onChange={e => void save({ allowSignup: e.target.checked }, e.target.checked ? 'Anyone who can reach this server can now create an account.' : 'Sign-up is closed. Only you can add accounts.')}
          aria-label="Let people create their own account"
        />
        <span>Let people create their own account from the sign-in screen (off = you add every account)</span>
      </label>
      <label className="settings-row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={settings?.trustLocalNetwork === true}
          disabled={busy}
          onChange={e => void save({ trustLocalNetwork: e.target.checked }, e.target.checked ? 'Services on your home network (192.168.x.x, 10.x.x.x) can now be connected under Settings > Services.' : 'Only services on this server\'s own stack can be connected.')}
          aria-label="Trust services on my home network"
        />
        <span>Trust services on my home network, so Radarr, Sonarr and others running on another machine can be connected (off = only this stack's own services)</span>
      </label>
      {note && <div className={`notice notice--${note.tone}`}>{note.text}</div>}
    </div>
  );
}
