import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type AiActionRecord, type AiHealth, type AiModel } from '../../../lib/api';
import ModelBrowser from '../ModelBrowser';
import { Pill } from '../../ui/Page';

const PERMISSION_LABELS: Record<string, string> = {
  read: 'Read only (search and status)',
  request: 'Read and request media',
  manage: 'Read, request and manage downloads',
  destructive: 'Full access, including destructive actions'
};

export default function AiSection() {
  const [ai, setAi] = useState<AiHealth | null>(null);
  const [models, setModels] = useState<AiModel[]>([]);
  const [level, setLevel] = useState<string | null>(null);
  const [levels, setLevels] = useState<string[]>([]);
  const [history, setHistory] = useState<AiActionRecord[]>([]);
  const [pulling, setPulling] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    api.aiModels().then(r => setModels(r.models)).catch(() => setModels([]));
    api.aiHealth().then(setAi).catch(() => setAi(null));
    api.aiPermissions().then(r => { setLevel(r.level); setLevels(r.levels); }).catch(() => {});
    api.aiHistory().then(r => setHistory(r.history)).catch(() => setHistory([]));
  }, []);
  useEffect(() => { load(); return () => { if (poll.current) clearInterval(poll.current); }; }, [load]);

  const online = ai?.healthy ?? false;
  const active = ai?.model;

  const pull = async (tag: string) => {
    if (pulling) return;
    setPulling(tag); setPercent(null); setMsg(null);
    try {
      await api.aiPullModel(tag);
      setMsg({ tone: 'ok', text: `Downloading "${tag}" in the background. Bigger models take a while.` });
      if (poll.current) clearInterval(poll.current);
      poll.current = setInterval(async () => {
        const s = await api.aiPullStatus(tag);
        if (s.status === 'done') { if (poll.current) clearInterval(poll.current); setPulling(null); setPercent(null); load(); setMsg({ tone: 'ok', text: `"${tag}" is ready.` }); }
        else if (s.status === 'error') { if (poll.current) clearInterval(poll.current); setPulling(null); setPercent(null); setMsg({ tone: 'err', text: `Could not get "${tag}": ${s.message ?? 'the model service reported an error'}` }); }
        else setPercent(s.percent ?? null);
      }, 3000);
    } catch (err) { setPulling(null); setPercent(null); setMsg({ tone: 'err', text: (err as Error).message ?? 'Could not start.' }); }
  };

  return (
    <div className="st-block">
      <div className="st-status-line">
        <Pill tone={ai ? (online ? 'ok' : 'bad') : 'neutral'}>{ai ? (online ? `Online${active ? ` · ${active}` : ''}` : 'Offline') : 'Checking…'}</Pill>
        {!online && ai && <span className="ui-help">The model service (Ollama) is not running. Start it, then pick a model below.</span>}
      </div>
      {msg && <div className={`notice notice--${msg.tone}`} role="status">{msg.text}</div>}
      <div className="settings-section">
        <h3 className="section-title">What the assistant may do</h3>
        <p className="ui-help">Destructive actions always ask you first, whatever you choose here.</p>
        <select className="settings-input" style={{ maxWidth: 380 }} value={level ?? ''} onChange={async e => { setLevel(e.target.value); try { await api.setAiPermissions(e.target.value); } catch { load(); } }} aria-label="AI permission level">
          {levels.map(l => <option key={l} value={l}>{PERMISSION_LABELS[l] ?? l}</option>)}
        </select>
      </div>
      <h3 className="section-title">Models</h3>
      <ModelBrowser installedTags={new Set(models.map(m => m.id))} activeModel={active} pulling={pulling} pullPercent={percent} onPull={pull} />
      <div className="settings-section">
        <h3 className="section-title">Use another model</h3>
        <div className="chat-widget-models-pull">
          <input className="chat-input" value={custom} onChange={e => setCustom(e.target.value)} placeholder="model name, e.g. llama3.2:3b" aria-label="Custom model tag to pull" onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) { void pull(custom.trim()); setCustom(''); } }} />
          <button className="btn btn-primary btn-sm" type="button" onClick={() => { void pull(custom.trim()); setCustom(''); }} disabled={!custom.trim() || !!pulling}>Get model</button>
        </div>
      </div>
      <div className="settings-section">
        <h3 className="section-title">Installed</h3>
        {models.length === 0 && <p className="ui-help">No models installed yet. Choose one above.</p>}
        <div className="chat-widget-models-list">
          {models.map(m => <div className="model-row" key={m.id}><span className="model-name">{m.name}</span>{m.id === active ? <span className="model-active">active</span> : <span className="model-idle">installed</span>}</div>)}
        </div>
      </div>
      <div className="settings-section">
        <h3 className="section-title">Recent actions</h3>
        {history.length === 0 && <p className="ui-help">The assistant has not done anything yet.</p>}
        <div className="ai-history-list">
          {history.slice(0, 10).map((e, i) => <div className="ai-history-row" key={`${e.timestamp}-${i}`}><span className={`integration-dot${e.success ? ' integration-dot--online' : ''}`} /><span className="ai-history-tool">{e.tool}</span><span className="ai-history-time">{new Date(e.timestamp).toLocaleTimeString()}</span></div>)}
        </div>
      </div>
    </div>
  );
}
