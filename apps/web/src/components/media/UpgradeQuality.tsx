import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

/**
 * One-click "get this artist in the best quality available". Music is fetched
 * in whatever quality turns up first so it is usable quickly; this moves the
 * artist to the Best available profile (lossless where it exists) and searches
 * again. The person is told up front that it can take a while.
 */
export function UpgradeQuality({ artistId }: { artistId: string }) {
  // Shown inside its own dialog, so it opens straight on the explanation.
  const [step, setStep] = useState<'idle' | 'confirm' | 'working' | 'done'>('confirm');
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // Changing quality is an administrator's job, so only they see the button.
  useEffect(() => { api.authStatus().then(st => setIsAdmin(st.user?.role === 'admin')).catch(() => {}); }, []);

  const start = async () => {
    setStep('working'); setNote(null);
    try {
      const { profiles } = await api.titleQuality('artist', artistId);
      const target = profiles.find(p => /best available/i.test(p.name)) ?? profiles.find(p => /lossless/i.test(p.name));
      if (!target) throw new Error('This music service has no lossless quality profile to upgrade to.');
      const res = await api.setTitleQuality('artist', artistId, target.id);
      setNote({ tone: 'ok', text: `${res.message} This can take a while: it searches every source for better copies and downloads them. Nothing is replaced unless a better copy is found, and you can keep listening meanwhile.` });
      setStep('done');
    } catch (err) {
      setNote({ tone: 'err', text: err instanceof Error ? err.message : 'Could not start the upgrade.' });
      setStep('idle');
    }
  };

  if (!isAdmin) return null;
  return (
    <div className="upgrade-quality">
      {step === 'idle' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStep('confirm')}>Upgrade quality</button>}
      {step === 'confirm' && (
        <div className="upgrade-quality-confirm" role="group" aria-label="Upgrade quality">
          <p>Look for better copies of this artist's music (lossless, such as FLAC, where it exists). <strong>This can take some time</strong> to search for and download. Nothing is replaced unless a better copy is found.</p>
          <div className="upgrade-quality-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void start()}>Start upgrade</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStep('idle')}>Not now</button>
          </div>
        </div>
      )}
      {step === 'working' && <span className="notice">Starting the search...</span>}
      {note && <div className={`notice notice--${note.tone}`} role="status">{note.text}</div>}
    </div>
  );
}
