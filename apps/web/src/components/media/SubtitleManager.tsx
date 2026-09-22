import { useEffect, useRef, useState } from 'react';

type Target = { kind: 'movie'; id: string } | { kind: 'episode'; seriesId: string; episodeId: string };
type Note = { tone: 'ok' | 'err'; text: string } | null;

async function post(path: string, body: unknown): Promise<{ success: boolean; message: string }> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string };
  return { success: res.ok && data.success !== false, message: data.message ?? (res.ok ? 'Done.' : `Request failed (${res.status}).`) };
}

const toBase64 = (buffer: ArrayBuffer): string => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

/**
 * Get subtitles for what is playing: search the subtitle sources in a chosen
 * language, or upload a file of your own. It is the manual route for the
 * titles that automatic search misses.
 */
export default function SubtitleManager({ target, onChanged }: { target: Target; onChanged: () => void }) {
  const [languages, setLanguages] = useState<Array<{ code: string; name: string }>>([]);
  const [connected, setConnected] = useState(true);
  const [language, setLanguage] = useState('en');
  const [busy, setBusy] = useState<'search' | 'upload' | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [open, setOpen] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || languages.length) return;
    fetch('/api/subtitles/languages').then(r => r.json()).then((d: { connected: boolean; languages: Array<{ code: string; name: string }> }) => {
      setConnected(d.connected);
      setLanguages(d.languages);
      if (d.languages.length && !d.languages.some(l => l.code === language)) setLanguage(d.languages[0]!.code);
    }).catch(() => setConnected(false));
  }, [open, languages.length, language]);

  const base = target.kind === 'movie'
    ? `/api/movies/${encodeURIComponent(target.id)}/subtitles`
    : `/api/series/${encodeURIComponent(target.seriesId)}/episodes/${encodeURIComponent(target.episodeId)}/subtitles`;

  const finish = (result: { success: boolean; message: string }) => {
    setNote({ tone: result.success ? 'ok' : 'err', text: result.message });
    if (result.success) onChanged();
  };

  const search = async () => {
    setBusy('search');
    setNote(null);
    try { finish(await post(`${base}/search`, { language })); } catch (err) { setNote({ tone: 'err', text: (err as Error).message }); } finally { setBusy(null); }
  };

  const upload = async (chosen: File | undefined) => {
    if (!chosen) return;
    setBusy('upload');
    setNote(null);
    try {
      finish(await post(`${base}/upload`, { language, filename: chosen.name, content: toBase64(await chosen.arrayBuffer()) }));
    } catch (err) {
      setNote({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(null);
      if (file.current) file.current.value = '';
    }
  };

  return (
    <div className="subtitle-manager">
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        {open ? 'Hide subtitle options' : 'Get subtitles'}
      </button>
      {open && (
        <div className="subtitle-manager-body">
          {!connected ? (
            <p className="settings-help">Subtitles are handled by Bazarr and it is not connected. An administrator can connect it under Settings &gt; Services. You can still switch on subtitles that are inside the file from the player.</p>
          ) : (
            <>
              <label className="subtitle-manager-field">
                <span>Language</span>
                <select className="settings-input" value={language} onChange={e => setLanguage(e.target.value)}>
                  {(languages.length ? languages : [{ code: 'en', name: 'English' }]).map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                </select>
              </label>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void search()} disabled={busy !== null}>
                {busy === 'search' ? 'Searching...' : 'Search subtitle sources'}
              </button>
              <label className="btn btn-secondary btn-sm">
                {busy === 'upload' ? 'Uploading...' : 'Upload a file'}
                <input ref={file} type="file" accept=".srt,.ass,.ssa,.vtt,.sub" hidden disabled={busy !== null} onChange={e => void upload(e.target.files?.[0])} />
              </label>
            </>
          )}
          {note && <div className={`notice notice--${note.tone}`} role="status">{note.text}</div>}
        </div>
      )}
    </div>
  );
}
