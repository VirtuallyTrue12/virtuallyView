import { useState } from 'react';
import { api } from '../../lib/api';
import { Dialog } from '../ui/Dialog';
import { SvgIcon } from '../ui/SvgIcon';

type Kind = 'movies' | 'tv' | 'music' | 'photos' | 'books';

function CopyRow({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="settings-row" style={{ gap: 8 }}>
      <code style={{ flex: 1, overflowWrap: 'anywhere' }}>{path}</code>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={async () => {
          try { await navigator.clipboard.writeText(path); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
        }}
      ><SvgIcon name="copy" size={14} /> {copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

/**
 * Shows the real folder on your computer for a library, with a copy button, so you can find it to drag
 * files in. A browser page cannot open a native file-manager window on your own desktop - that is a
 * security boundary every browser enforces, not something this app can work around - so this shows the
 * path instead of opening it for you.
 */
export function OpenMediaFolder({ kind }: { kind: Kind }) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<{ hostPath: string | null; extraFolders: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setOpen(true);
    setError(null);
    api.mediaFolder(kind).then(setInfo).catch(err => setError((err as Error).message));
  };

  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={load}><SvgIcon name="folder" size={15} /> Media folder</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Media folder">
        {error && <div className="notice notice--err" role="alert">{error}</div>}
        {!error && !info && <p className="dlg-help">Looking...</p>}
        {!error && info && (
          <>
            {info.hostPath ? (
              <>
                <p className="dlg-help">The real folder on your computer. Drag files into it directly; a rescan picks them up.</p>
                <CopyRow path={info.hostPath} />
              </>
            ) : (
              <p className="dlg-help">
                This library uses Docker-managed storage, which has no folder on your computer to open or drag files into.
                Set the matching line in <code>.env</code> (see <code>docs/existing-media.md</code>) to use a real folder instead.
              </p>
            )}
            {info.extraFolders.length > 0 && (
              <>
                <p className="dlg-help" style={{ marginTop: 'var(--spacing-md)' }}>
                  The media manager also has {info.extraFolders.length === 1 ? 'another root folder' : 'other root folders'} configured.
                  These are only meaningful read directly on the server machine itself, since this app has no computer path for them:
                </p>
                {info.extraFolders.map(p => <CopyRow key={p} path={p} />)}
              </>
            )}
          </>
        )}
      </Dialog>
    </>
  );
}
