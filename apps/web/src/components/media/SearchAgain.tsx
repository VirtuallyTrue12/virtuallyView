import { useState } from 'react';

/** One button that asks the media manager to look again, and says what happened. */
export function SearchAgain({ run, label = 'Search again', small = true, className = '' }: {
  run: () => Promise<{ success: boolean; message: string }>;
  label?: string;
  small?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const click = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await run();
      setNote({ tone: result.success ? 'ok' : 'err', text: result.message });
    } catch (err) {
      setNote({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={`search-again ${className}`}>
      <button type="button" className={`btn btn-secondary${small ? ' btn-sm' : ''}`} onClick={() => void click()} disabled={busy}>
        {busy ? 'Searching...' : label}
      </button>
      {note && <span className={`search-again-note search-again-note--${note.tone}`} role="status">{note.text}</span>}
    </span>
  );
}
