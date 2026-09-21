import { useEffect, useRef, useState } from 'react';
import { api, type AuthUser } from '../../lib/api';

interface Props {
  onSignedIn: (user: AuthUser | null) => void;
}

/**
 * Sign in without typing a password: this device shows a short code, and a
 * person who is already signed in enters it on Account > Sign in another device.
 */
export default function QuickConnectSignIn({ onSignedIn }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  const start = async () => {
    setError('');
    try {
      const started = await api.quickConnectStart();
      setCode(started.code);
      stop();
      timer.current = setInterval(async () => {
        try {
          const polled = await api.quickConnectPoll(started.secret);
          if (polled.status === 'approved') {
            stop();
            onSignedIn(polled.user ?? null);
          } else if (polled.status === 'expired') {
            stop();
            setCode(null);
            setError('That code expired. Start again for a new one.');
          }
        } catch {
          // Transient network error: keep polling until the code expires.
        }
      }, 2500);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const cancel = () => { stop(); setCode(null); };

  return (
    <div className="quick-connect">
      {code ? (
        <>
          <p className="quick-connect-hint">On a device that is already signed in, open Account and enter this code under Sign in another device.</p>
          <div className="quick-connect-code" aria-live="polite" aria-label={`Code ${code.split('').join(' ')}`}>{code.slice(0, 3)} {code.slice(3)}</div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={cancel}>Cancel</button>
        </>
      ) : (
        <button type="button" className="btn btn-secondary btn-sm" onClick={start}>Sign in with a code</button>
      )}
      {error && <div className="notice notice--err" role="alert">{error}</div>}
    </div>
  );
}
