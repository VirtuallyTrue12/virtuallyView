import { useEffect, useState } from 'react';

interface Device { id: string; name: string }

/**
 * Cast the video to a TV. Two open routes, no accounts:
 * this browser's own casting (Chromecast in Chrome and Edge, AirPlay in Safari),
 * and DLNA devices the server finds on the network (most smart TVs and boxes).
 */
export default function CastMenu({ browserCast, onBrowserCast, onDevice, onClose }: {
  browserCast: boolean;
  onBrowserCast: () => void;
  onDevice: (device: Device) => Promise<string>;
  onClose: () => void;
}) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');

  const load = (refresh: boolean) => {
    setDevices(null);
    fetch(`/api/cast/devices${refresh ? '?refresh=1' : ''}`).then(r => r.json()).then((d: { devices: Device[] }) => setDevices(d.devices)).catch(() => setDevices([]));
  };
  useEffect(() => load(false), []);

  const pick = async (device: Device) => {
    setBusy(device.id);
    setNote('');
    try { setNote(await onDevice(device)); } catch (err) { setNote((err as Error).message); } finally { setBusy(''); }
  };

  return (
    <div className="vp-menu" role="menu">
      <div className="vp-menu-head">Cast to a screen</div>
      {browserCast && (
        <button type="button" role="menuitem" className="vp-menu-item" onClick={() => { onClose(); onBrowserCast(); }}>
          This browser's devices (Chromecast, AirPlay)
        </button>
      )}
      <div className="vp-menu-head">TVs on your network</div>
      {devices === null && <div className="vp-menu-empty">Looking for TVs...</div>}
      {devices?.map(d => (
        <button key={d.id} type="button" role="menuitem" className="vp-menu-item" disabled={busy !== ''} onClick={() => void pick(d)}>
          {busy === d.id ? 'Sending...' : d.name}
        </button>
      ))}
      {devices?.length === 0 && (
        <div className="vp-menu-empty">No TV found. Check that the TV is switched on and on the same Wi-Fi as this server. TVs with Chromecast built-in (Google TV, Android TV) show up by themselves; others need DLNA / Renderer switched on in the TV's network settings.</div>
      )}
      <button type="button" role="menuitem" className="vp-menu-item" onClick={() => load(true)}>Search again</button>
      {note && <div className="vp-menu-empty">{note}</div>}
    </div>
  );
}
