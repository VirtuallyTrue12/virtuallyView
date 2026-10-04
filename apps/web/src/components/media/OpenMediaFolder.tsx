import { useState } from 'react';
import { api } from '../../lib/api';
import { Dialog } from '../ui/Dialog';
import { SvgIcon } from '../ui/SvgIcon';

type Kind = 'movies' | 'tv' | 'music' | 'photos' | 'books';

// Matches the fixed port in scripts/open-folder-helper.mjs - a tiny opt-in helper you run on your own
// computer (not in a container) so this button can pop the folder open in your normal file manager.
// Only reachable when your browser and that helper are on the same computer, which is the common case
// for a self-hosted server you also browse from; otherwise the fetch just fails and Copy still works.
const OPEN_HELPER_PORT = 3998;

function CopyRow({ path, canOpen }: { path: string; canOpen?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [openErr, setOpenErr] = useState<string | null>(null);
  return (
    <div>
      <div className="settings-row" style={{ gap: 8 }}>
        <code style={{ flex: 1, overflowWrap: 'anywhere' }}>{path}</code>
        {canOpen && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={async () => {
              setOpenErr(null);
              try {
                const res = await fetch(`http://localhost:${OPEN_HELPER_PORT}/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) });
                if (!res.ok) throw new Error('refused');
              } catch {
                setOpenErr('Could not reach the open-folder helper on this computer - see docs/existing-media.md to set it up, or use Copy instead.');
              }
            }}
          ><SvgIcon name="folder" size={14} /> Open</button>
        )}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={async () => {
            try { await navigator.clipboard.writeText(path); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
          }}
        ><SvgIcon name="copy" size={14} /> {copied ? 'Copied' : 'Copy'}</button>
      </div>
      {openErr && <p className="dlg-help" role="alert">{openErr}</p>}
    </div>
  );
}

/**
 * Shows the real folder on your computer for a library. A browser page cannot open a native
 * file-manager window on your own desktop by itself - that is a security boundary every browser
 * enforces - so Open calls a small opt-in helper that runs on your own computer instead (only
 * reachable when you browse from that same computer); Copy always works as a fallback.
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
                <p className="dlg-help">The real folder on your computer. Open shows it in your file manager (needs the open-folder helper running - see docs/existing-media.md); Copy lets you find and drag into it yourself.</p>
                <CopyRow path={info.hostPath} canOpen />
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
