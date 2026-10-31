import { useEffect, useState, type FormEvent } from 'react';
import { Dialog } from '../ui/Dialog';
import { SvgIcon } from '../ui/SvgIcon';

interface PinPadProps {
  name: string;
  /** What the profile asks for first: its PIN, or the password for an administrator without a PIN. */
  needs: 'pin' | 'password';
  /** An administrator's PIN prompt also accepts the password. */
  passwordAllowed: boolean;
  /** Resolves with an error message to show, or null when the switch worked (the page then reloads). */
  onSubmit: (secret: { pin?: string; password?: string }) => Promise<string | null>;
  onCancel: () => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'] as const;

/** Enter a 4-digit PIN with the keyboard or the on-screen digits, or type a password instead. */
export function PinPad({ name, needs, passwordAllowed, onSubmit, onCancel }: PinPadProps) {
  const [mode, setMode] = useState<'pin' | 'password'>(needs);
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (secret: { pin?: string; password?: string }) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const message = await onSubmit(secret);
    setBusy(false);
    if (message) {
      setError(message);
      setPin('');
    }
  };

  const press = (key: string) => {
    if (busy) return;
    setError(null);
    if (key === 'back') setPin(value => value.slice(0, -1));
    else if (/^\d$/.test(key)) setPin(value => (value.length < 4 ? value + key : value));
  };

  // Typing works without clicking first: digits and Backspace.
  useEffect(() => {
    if (mode !== 'pin') return;
    const onKey = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) { event.preventDefault(); press(event.key); }
      else if (event.key === 'Backspace') { event.preventDefault(); press('back'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // press reads only the busy flag, which is listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, busy]);

  // Submit as soon as the fourth digit is in, like a phone's lock screen.
  useEffect(() => {
    if (pin.length === 4 && mode === 'pin' && !busy) void submit({ pin });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const sendPassword = (event: FormEvent) => {
    event.preventDefault();
    if (password) void submit({ password });
  };

  return (
    <Dialog open onClose={onCancel} title={`Unlock ${name}`}>
      {mode === 'pin' ? (
        <div className="pin-pad">
          <p className="pin-pad-help">Enter the PIN for {name}.</p>
          <div className="pin-dots" aria-label={`${pin.length} of 4 digits entered`}>
            {[0, 1, 2, 3].map(i => <span key={i} className={`pin-dot${i < pin.length ? ' is-filled' : ''}`} />)}
          </div>
          <div className="pin-keys" role="group" aria-label="PIN keypad">
            {KEYS.map((key, i) => key === '' ? <span key={i} /> : (
              <button
                key={key}
                type="button"
                className="pin-key"
                disabled={busy}
                aria-label={key === 'back' ? 'Delete last digit' : `Digit ${key}`}
                onClick={() => press(key)}
              >
                {key === 'back' ? <SvgIcon name="close" size={20} /> : key}
              </button>
            ))}
          </div>
          {error && <p className="pin-error" role="alert">{error}</p>}
          {passwordAllowed && (
            <button type="button" className="pin-alt" onClick={() => { setMode('password'); setError(null); }}>Use the password instead</button>
          )}
        </div>
      ) : (
        <form className="pin-pad pin-pad--password" onSubmit={sendPassword}>
          <p className="pin-pad-help">Enter the password for {name}.</p>
          <label className="login-field">
            <span>Password</span>
            <input className="settings-input" type="password" autoComplete="current-password" autoFocus value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          {error && <p className="pin-error" role="alert">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy || !password}>{busy ? 'Checking...' : 'Unlock'}</button>
          {needs === 'pin' && (
            <button type="button" className="pin-alt" onClick={() => { setMode('pin'); setError(null); }}>Use the PIN instead</button>
          )}
        </form>
      )}
    </Dialog>
  );
}
