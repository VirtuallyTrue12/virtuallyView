import { useEffect, useState } from 'react';
import { SvgIcon } from './SvgIcon';
import { toast } from './Toast';

/**
 * A feature that needs one more service on the server: says so in plain words, gives the one command with a
 * Copy button, and keeps checking, so the page carries on by itself the moment the service is up (no reload).
 */
export function FeatureOff({ name, command, check, onReady, note }: {
  name: string;
  command: string;
  check: () => Promise<boolean>;
  onReady: () => void;
  note?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      void check().then(ok => { if (ok && alive) { alive = false; window.clearInterval(id); toast(`${name} is on`); onReady(); } }).catch(() => undefined);
    }, 5000);
    return () => { alive = false; window.clearInterval(id); };
  }, [check, onReady, name]);
  return (
    <div className="feature-off">
      <p className="feature-off-title">{name} is not turned on yet</p>
      <p className="feature-off-text">Run this once on the server computer. This page notices when it is on and carries on by itself.</p>
      <div className="feature-off-cmd">
        <code>{command}</code>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void navigator.clipboard?.writeText(command); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }}>
          <SvgIcon name={copied ? 'check' : 'copy'} size={15} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="feature-off-wait"><span className="feature-off-dot" aria-hidden="true" /> Waiting for it to start…</p>
      {note && <p className="feature-off-note">{note}</p>}
    </div>
  );
}
