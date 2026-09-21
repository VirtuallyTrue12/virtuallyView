import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';

/** Type the code a TV or phone is showing to sign that device in as you. */
export default function QuickConnectApprove() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      const result = await api.quickConnectApprove(code.replace(/\s/g, ''));
      setCode('');
      setNote({ tone: 'ok', text: `Signed in ${result.device}. It stays signed in for 30 days.` });
    } catch (err) {
      setNote({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section">
      <h3 className="section-title">Sign in another device</h3>
      <p className="settings-help">
        On the other device, choose Sign in with a code, then enter the six digits it shows here.
        Only do this for a device you are holding: it will be signed in as you.
      </p>
      <form className="users-add" onSubmit={submit}>
        <label className="login-field">
          <span>Code</span>
          <input
            className="settings-input"
            inputMode="numeric"
            autoComplete="off"
            maxLength={7}
            placeholder="123 456"
            value={code}
            onChange={e => setCode(e.target.value)}
            required
          />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy || code.replace(/\s/g, '').length !== 6}>
          {busy ? 'Checking...' : 'Sign it in'}
        </button>
      </form>
      {note && <div className={`notice notice--${note.tone}`} role="status">{note.text}</div>}
    </section>
  );
}
