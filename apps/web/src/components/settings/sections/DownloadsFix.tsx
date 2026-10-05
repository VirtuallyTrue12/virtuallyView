import { useState } from 'react';
import { api, type ServerSettings } from '../../../lib/api';
import { Field, Switch } from '../../ui/Page';

/** The download doctor's on/off switch, with what it does in plain words. */
export default function DownloadsFix({ settings, onSaved }: { settings: ServerSettings | null; onSaved: (s: ServerSettings) => void }) {
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const on = settings?.autoFixDownloads !== false;
  const save = async (value: boolean) => {
    setMsg(null);
    try { onSaved(await api.saveServerSettings({ autoFixDownloads: value })); setMsg({ tone: 'ok', text: value ? 'Stuck downloads will be replaced automatically.' : 'Stuck downloads are left alone. You can still fix them from Downloads.' }); }
    catch (err) { setMsg({ tone: 'err', text: (err as Error).message }); }
  };
  const searchNow = async () => {
    setSearching(true);
    setSearchMsg(null);
    try { setSearchMsg({ tone: 'ok', text: (await api.searchAllMissing()).message }); }
    catch (err) { setSearchMsg({ tone: 'err', text: (err as Error).message }); }
    finally { setSearching(false); }
  };
  return (
    <div className="settings-section">
      <h3 className="section-title">Stuck downloads</h3>
      <Field label="Replace dead downloads automatically" help="A release nobody shares any more, or a finished download that cannot be matched to its title, is rejected after a wait (about 45 minutes, or 20 for unmatched files) and a new one is searched for. It never acts while the downloader or its VPN is down, and tries at most three replacements per title a day.">
        <Switch checked={on} onChange={v => void save(v)} label="Replace dead downloads automatically" disabled={!settings} />
      </Field>
      {msg && <div className={`notice notice--${msg.tone}`} role="status">{msg.text}</div>}

      <Field label="Missing content" help="A movie, episode or track that is still missing after being added - a search that found nothing, an indexer that was briefly down - is not retried by Radarr, Sonarr or Lidarr on their own. While the switch above is on, this app asks each of them to search everything they still have missing every 12 hours, the same as pressing Search all missing by hand. Use the button for a one-off search right now instead of waiting.">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void searchNow()} disabled={searching}>
          {searching ? 'Searching…' : 'Search everything missing now'}
        </button>
      </Field>
      {searchMsg && <div className={`notice notice--${searchMsg.tone}`} role="status">{searchMsg.text}</div>}
    </div>
  );
}
