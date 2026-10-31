import { useEffect, useRef, useState } from 'react';
import { useMusicPlayer } from '../media/MusicProvider';
import { toast } from '../ui/Toast';
import './Together.css';

/** The "Devices" button: pick another device of this account to play on, or take playback back. */
export default function DevicesMenu() {
  const { devices, refreshDevices, deviceName, renameDevice, remote, playOn, endRemote, listen } = useMusicPlayer();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(deviceName);
  const wrap = useRef<HTMLDivElement>(null);

  // While the list is open, keep it fresh so a device that appears or leaves shows up.
  useEffect(() => {
    if (!open) return;
    void refreshDevices();
    const id = window.setInterval(() => void refreshDevices(), 5000);
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => { window.clearInterval(id); document.removeEventListener('mousedown', onDown); };
  }, [open, refreshDevices]);

  const pick = async (id: string, label: string) => {
    const err = await playOn(id, label);
    if (err) toast(err, { tone: 'err' });
    else setOpen(false);
  };

  return (
    <div className="devices" ref={wrap}>
      <button type="button" className={`devices-chip${remote ? ' is-on' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {remote ? `Playing on ${remote.name}` : 'Devices'}
      </button>
      {open && (
        <div className="devices-pop" role="menu" aria-label="Devices">
          {remote && (
            <div className="devices-now">
              <p>Playing on <strong>{remote.name}</strong></p>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => { void endRemote(true); setOpen(false); }}>Bring back to this device</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void endRemote(false); setOpen(false); }}>Stop on {remote.name}</button>
            </div>
          )}

          <div className="devices-section">
            <span className="devices-label">This device</span>
            <form className="devices-rename" onSubmit={e => { e.preventDefault(); renameDevice(name); }}>
              <input value={name} onChange={e => setName(e.target.value)} maxLength={40} aria-label="Name of this device" />
              <button type="submit" className="btn btn-secondary btn-sm">Rename</button>
            </form>
          </div>

          <div className="devices-section">
            <span className="devices-label">Your other devices</span>
            {devices.length === 0 && <p className="devices-empty">No other device is open right now. Open virtuallyView on your phone, TV or another browser, signed in as you.</p>}
            {devices.map(d => (
              <button key={d.id} type="button" role="menuitem" className="devices-item" onClick={() => void pick(d.id, d.name)}>
                <span>{d.name}</span>
                <span className="devices-item-sub">{d.state?.playing ? 'Playing' : 'Idle'}</span>
              </button>
            ))}
          </div>

          {listen && <p className="devices-note">Listening together: code {listen.code}</p>}
        </div>
      )}
    </div>
  );
}
