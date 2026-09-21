import { useEffect, useState } from 'react';
import { loadAppearance, saveAppearance, type Mode } from '../../lib/appearance';

const OPTIONS: Array<{ key: Mode; label: string; hint: string }> = [
  { key: 'system', label: 'System', hint: 'Follow this device' },
  { key: 'light', label: 'Light', hint: 'Always light' },
  { key: 'dark', label: 'Dark', hint: 'Always dark' }
];

/** Per-device Light / Dark / System choice; each mode uses the theme picked for it. */
export function ModeSwitch() {
  const [mode, setMode] = useState<Mode>(() => loadAppearance().mode);
  useEffect(() => {
    const sync = () => setMode(loadAppearance().mode);
    window.addEventListener('vv-appearance', sync);
    return () => window.removeEventListener('vv-appearance', sync);
  }, []);
  return (
    <div className="mode-switch" role="radiogroup" aria-label="Appearance mode">
      {OPTIONS.map(o => (
        <button
          key={o.key} type="button" role="radio" aria-checked={mode === o.key}
          className={`mode-option${mode === o.key ? ' is-active' : ''}`}
          onClick={() => { saveAppearance({ ...loadAppearance(), mode: o.key }); setMode(o.key); }}
        >
          <strong>{o.label}</strong><span>{o.hint}</span>
        </button>
      ))}
    </div>
  );
}
