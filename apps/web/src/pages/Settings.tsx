import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type AiHealth, type AiModel, type IntegrationStatus, type AiActionRecord, type ServerSettings, type ThemeSummary } from '../lib/api';
import { Link } from 'react-router-dom';
import { BackButton } from '../components/layout/BackButton';
import UsersPanel from '../components/settings/UsersPanel';
import { ModeSwitch } from '../components/settings/ModeSwitch';
import { loadAppearance } from '../lib/appearance';
import ConnectDevices from '../components/settings/ConnectDevices';
import DefaultQuality from '../components/settings/DefaultQuality';
import RequestRules from '../components/settings/RequestRules';
import IndexersPanel from '../components/settings/IndexersPanel';
import BackupPanel from '../components/settings/BackupPanel';
import NotificationsPanel from '../components/settings/NotificationsPanel';
import { humanName, secretHint, secretLabel, secretPlaceholder } from '../lib/integration-names';
import { SvgIcon } from '../components/ui/SvgIcon';

const PERMISSION_LABELS: Record<string, string> = {
  read: 'Read only (search and status)',
  request: 'Read + request media',
  manage: 'Read + request + manage downloads',
  destructive: 'Full access, including destructive actions'
};

const SUGGESTED_MODELS = [
  { tag: 'qwen2.5:0.5b', title: 'Qwen 2.5', size: '~0.5 GB', use: 'Fast, tiny. Good enough for demo commands.' },
  { tag: 'llama3.2:3b', title: 'Llama 3.2', size: '~2.0 GB', use: 'Small general-purpose assistant.' },
  { tag: 'phi3.5:3.8b', title: 'Phi-3.5', size: '~2.2 GB', use: 'Compact and strong at reasoning.' },
  { tag: 'mistral:7b', title: 'Mistral', size: '~4.1 GB', use: 'Solid all-rounder for tool use.' },
  { tag: 'gemma2:9b', title: 'Gemma 2', size: '~5.5 GB', use: 'Google open model, great quality.' },
  { tag: 'deepseek-r1:8b', title: 'DeepSeek R1', size: '~4.7 GB', use: 'Reasoning-focused, thinks step by step.' }
];

type CategoryId = 'indexers' | 'backup' | 'integrations' | 'users' | 'ai' | 'appearance' | 'notifications' | 'folders' | 'themes' | 'server' | 'about' | 'lightmode';

export default function Settings() {
  const [cat, setCat] = useState<CategoryId | null>(() => {
    const wanted = new URLSearchParams(window.location.search).get('cat');
    return wanted === 'users' || wanted === 'server' || wanted === 'indexers' || wanted === 'notifications' || wanted === 'backup' ? wanted : null;
  });
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [ai, setAi] = useState<AiHealth | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [models, setModels] = useState<AiModel[]>([]);
  const [pulling, setPulling] = useState<string | null>(null);
  const [pullCustom, setPullCustom] = useState('');
  const [pullMsg, setPullMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const CONNECTABLE = new Set(['radarr', 'sonarr', 'prowlarr', 'lidarr', 'bazarr', 'qbittorrent', 'nzbget']);
  const [savedCredentials, setSavedCredentials] = useState<Record<string, boolean>>({});
  const [configDrafts, setConfigDrafts] = useState<Record<string, { url: string; apiKey: string }>>({});
  const [savingAdapter, setSavingAdapter] = useState<string | null>(null);
  const [configMsg, setConfigMsg] = useState<Record<string, { tone: 'ok' | 'err'; text: string }>>({});
  const [detecting, setDetecting] = useState(false);

  const [serverSettings, setServerSettings] = useState<ServerSettings | null>(null);
  const [folderDraft, setFolderDraft] = useState<{ movies: string; tv: string; music: string; staging: string } | null>(null);
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [folderMsg, setFolderMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [savingFolders, setSavingFolders] = useState(false);
  const [backendCheck, setBackendCheck] = useState<{ tone: 'ok' | 'err' | 'muted'; text: string } | null>(null);
  const [proxyDraft, setProxyDraft] = useState<{ enabled: boolean; kind: 'tor' | 'socks5' | 'http'; host: string; port: string } | null>(null);
  const [proxyMsg, setProxyMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [proxyTesting, setProxyTesting] = useState(false);

  const FOLDER_LABELS: Record<keyof ServerSettings['mediaRoots'], string> = {
    movies: 'change movie folder',
    tv: 'change tv folder',
    music: 'change music folder',
    staging: 'change staging folder'
  };

  const loadIntegrations = useCallback(() => {
    api.integrations().then(list => {
      setIntegrations(list);
      api.serviceConfig().then(config => {
        setSavedCredentials(Object.fromEntries(Object.entries(config).map(([key, value]) => [key, Boolean(value.hasCredentials)])));
        const drafts: Record<string, { url: string; apiKey: string }> = {};
        for (const i of list) {
          const cfg = config[i.adapter] ?? { url: i.url ?? '', apiKey: '' };
          drafts[i.adapter] = { url: cfg.url || i.url || '', apiKey: cfg.apiKey || '' };
        }
        setConfigDrafts(prev => ({ ...prev, ...drafts }));
      }).catch(() => {
        const drafts: Record<string, { url: string; apiKey: string }> = {};
        for (const i of list) {
          drafts[i.adapter] = { url: i.url || '', apiKey: '' };
        }
        setConfigDrafts(prev => ({ ...prev, ...drafts }));
      });
    }).catch(() => setIntegrations([]));
  }, []);

  const [permissionLevel, setPermissionLevelState] = useState<string | null>(null);
  const [permissionLevels, setPermissionLevels] = useState<string[]>([]);
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [history, setHistory] = useState<AiActionRecord[]>([]);

  const loadThemes = useCallback(() => {
    api.themes().then(setThemes).catch(() => setThemes([]));
  }, []);

  const [activeThemeName, setActiveThemeName] = useState<string | null>(null);
  const loadActiveThemeName = useCallback(() => {
    api.activeTheme().then(t => setActiveThemeName(t.manifest?.name ?? t.id ?? null)).catch(() => setActiveThemeName(null));
  }, []);

  const appearanceStatus = activeThemeName ? `${activeThemeName} active` : 'Checking theme...';



  const loadModels = useCallback(() => {
    api.aiModels().then(res => setModels(res.models)).catch(() => setModels([]));
    api.aiHealth().then(setAi).catch(() => setAi(null));
    api.aiPermissions().then(res => { setPermissionLevelState(res.level); setPermissionLevels(res.levels); }).catch(() => {});
    api.aiHistory().then(res => setHistory(res.history)).catch(() => setHistory([]));
  }, []);

  const changePermissionLevel = async (level: string) => {
    setPermissionLevelState(level);
    try {
      await api.setAiPermissions(level);
    } catch {
      loadModels();
    }
  };

  useEffect(() => {
    loadIntegrations();
    loadThemes();
    loadActiveThemeName();
    loadModels();
    api.serverSettings().then(setServerSettings).catch(() => {});
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadIntegrations, loadThemes, loadActiveThemeName, loadModels]);

  // Auto-run the backend self-test the first time the Server screen opens.
  useEffect(() => {
    if (cat === 'server' && !backendCheck) void runBackendCheck();
  }, [cat]); // eslint-disable-line react-hooks/exhaustive-deps

  // Seed the outbound proxy form from the server's current settings.
  useEffect(() => {
    if (cat === 'server' && serverSettings && !proxyDraft) {
      setProxyDraft({
        enabled: serverSettings.outboundProxy.enabled,
        kind: serverSettings.outboundProxy.kind,
        host: serverSettings.outboundProxy.host,
        port: String(serverSettings.outboundProxy.port)
      });
    }
  }, [cat, serverSettings, proxyDraft]);

  const saveProxy = async () => {
    if (!proxyDraft) return;
    if (!proxyDraft.host.trim()) {
      setProxyMsg({ tone: 'err', text: 'Enter the proxy host address.' });
      return;
    }
    const port = Number(proxyDraft.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setProxyMsg({ tone: 'err', text: 'Proxy port must be an integer between 1 and 65535.' });
      return;
    }
    setProxyMsg(null);
    try {
      const updated = await api.saveServerSettings({
        outboundProxy: { enabled: proxyDraft.enabled, kind: proxyDraft.kind, host: proxyDraft.host.trim(), port }
      });
      setServerSettings(updated);
      setProxyMsg({ tone: 'ok', text: `Outbound proxy ${proxyDraft.enabled ? 'enabled' : 'disabled'}. Public internet calls (Wikipedia, MusicBrainz, web covers) now route ${proxyDraft.enabled ? 'through it' : 'directly'}.` });
    } catch (err) {
      setProxyMsg({ tone: 'err', text: (err as Error).message ?? 'Could not save the proxy settings.' });
    }
  };

  const testProxy = async () => {
    setProxyTesting(true);
    setProxyMsg(null);
    try {
      const result = await api.testOutboundProxy();
      setProxyMsg({ tone: result.ok ? 'ok' : 'err', text: result.ok
        ? `${result.detail} (${result.latencyMs} ms)`
        : result.detail });
    } catch (err) {
      setProxyMsg({ tone: 'err', text: `Proxy test failed: ${(err as Error).message}` });
    } finally {
      setProxyTesting(false);
    }
  };
  useEffect(() => {
    if (cat === 'folders' && serverSettings && !folderDraft) {
      setFolderDraft({ ...serverSettings.mediaRoots });
    }
  }, [cat, serverSettings, folderDraft]);

  const changedFolders = folderDraft && serverSettings
    ? (Object.keys(folderDraft) as Array<keyof ServerSettings['mediaRoots']>)
        .filter(key => (folderDraft[key] ?? '').trim() !== (serverSettings.mediaRoots[key] ?? '').trim())
    : [];

  const saveFolders = async () => {
    if (!folderDraft || !serverSettings) return;
    if (changedFolders.length !== 1) {
      setFolderMsg({ tone: 'err', text: changedFolders.length === 0
        ? 'Nothing changed - save only when a folder path differs.'
        : 'Save one folder at a time; each change needs its own confirmation phrase.' });
      return;
    }
    const key = changedFolders[0];
    const phrase = FOLDER_LABELS[key];
    if (confirmPhrase.trim().toLowerCase() !== phrase) {
      setFolderMsg({ tone: 'err', text: `Type the exact phrase "${phrase}" to confirm the change.` });
      return;
    }
    setSavingFolders(true);
    setFolderMsg(null);
    try {
      const updated = await api.saveServerSettings({ mediaRoots: { [key]: folderDraft[key].trim() } as ServerSettings['mediaRoots'], confirm: confirmPhrase });
      setServerSettings(updated);
      setFolderDraft({ ...updated.mediaRoots });
      setConfirmPhrase('');
      setFolderMsg({ tone: 'ok', text: 'Media folder updated. New files will be served from the new root.' });
    } catch (err) {
      const message = (err as Error).message ?? 'Could not save the folder.';
      setFolderMsg({ tone: 'err', text: /confirmation_required|phrase/i.test(message) ? `Type the exact phrase "${FOLDER_LABELS[key]}" to confirm the change.` : message });
    } finally {
      setSavingFolders(false);
    }
  };

  const runBackendCheck = async () => {
    setBackendCheck({ tone: 'muted', text: 'Checking backend and integrations...' });
    try {
      const h = await api.health();
      const onlineCount = integrations.filter(i => i.healthStatus === 'online').length;
      if (h.status === 'ok') {
        setBackendCheck({ tone: 'ok', text: onlineCount === integrations.length && integrations.length > 0
          ? `Backend answering (v${h.version}), all ${integrations.length} services online.`
          : `Backend answering (v${h.version}). ${onlineCount} of ${integrations.length} services report online.` });
      } else {
        setBackendCheck({ tone: 'err', text: `Backend answered with status "${h.status}".` });
      }
    } catch (err) {
      setBackendCheck({ tone: 'err', text: `Backend not reachable: ${(err as Error).message}. If this screen loads but nothing else does, restart the server from apps/server with "npm run dev".` });
    }
  };

  const flash = (tone: 'ok' | 'err', text: string) => {
    setPullMsg({ tone, text });
  };

  const startPull = async (tag: string) => {
    if (pulling) return;
    setPulling(tag);
    setPullMsg(null);
    try {
      await api.aiPullModel(tag);
      flash('ok', `Pulling "${tag}" in the background. This can take a while for larger models.`);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        const status = await api.aiPullStatus(tag);
        if (status.status === 'done') {
          if (pollRef.current) clearInterval(pollRef.current);
          setPulling(null);
          loadModels();
          flash('ok', `"${tag}" is ready.`);
        } else if (status.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          setPulling(null);
          flash('err', `Pull for "${tag}" failed: ${status.message ?? 'Ollama error'}`);
        }
      }, 3000);
    } catch (err) {
      setPulling(null);
      flash('err', (err as Error).message ?? 'Pull could not start.');
    }
  };

  const pullCustomModel = async () => {
    const tag = pullCustom.trim();
    if (!tag) return;
    setPullCustom('');
    await startPull(tag);
  };

  const toggleIntegration = async (adapter: string) => {
    setToggling(adapter);
    try {
      const updated = await api.toggleIntegration(adapter);
      setIntegrations(prev => prev.map(i => i.adapter === adapter ? updated : i));
    } catch {
      loadIntegrations();
    } finally {
      setToggling(null);
    }
  };

  const findServices = async () => {
    setDetecting(true);
    try {
      const found = await api.integrationsDetect();
      const reachable = found.filter(r => r.reachable);
      for (const r of reachable) {
        setDraft(r.adapter, r.url, { url: r.url });
      }
      flash('ok', reachable.length > 0
        ? `Found ${reachable.length} service${reachable.length === 1 ? '' : 's'} on this computer and filled in the addresses.`
        : 'No services were found on the usual addresses. Enter the address of each service you run.');
    } catch {
      flash('err', 'Could not search for services. Try again in a moment.');
    } finally {
      setDetecting(false);
    }
  };

  const draftFor = (adapter: string, fallbackUrl: string) =>
    configDrafts[adapter] ?? { url: fallbackUrl, apiKey: '' };

  const setDraft = (adapter: string, fallbackUrl: string, patch: Partial<{ url: string; apiKey: string }>) => {
    setConfigDrafts(prev => ({ ...prev, [adapter]: { ...draftFor(adapter, fallbackUrl), ...patch } }));
  };

  const saveConfig = async (adapter: string, fallbackUrl: string) => {
    const draft = draftFor(adapter, fallbackUrl);
    if (!draft.url.trim() || (!draft.apiKey.trim() && !savedCredentials[adapter])) {
      setConfigMsg(prev => ({ ...prev, [adapter]: { tone: 'err', text: 'Enter the service address and its key to connect.' } }));
      return;
    }
    setSavingAdapter(adapter);
    setConfigMsg(prev => ({ ...prev, [adapter]: undefined as never }));
    try {
      const updated = await api.saveIntegrationConfig(adapter, { url: draft.url.trim(), apiKey: draft.apiKey.trim() });
      setIntegrations(prev => prev.map(i => (i.adapter === adapter ? { ...updated } : i)));
      setConfigMsg(prev => ({ ...prev, [adapter]: { tone: 'ok', text: `Connected. Your ${humanName(adapter)} service is now live.` } }));
    } catch (err) {
      setConfigMsg(prev => ({ ...prev, [adapter]: { tone: 'err', text: (err as Error).message } }));
    } finally {
      setSavingAdapter(null);
    }
  };

  const online = integrations.filter(i => i.healthStatus === 'online').length;
  const statusText = (i: IntegrationStatus) => {
    if (!i.enabled) return 'Turned off';
    if (i.setupRequired) return 'Needs connection details';
    if (i.healthStatus === 'online') return 'Online and connected';
    return 'Set up but not answering';
  };
  const activeModel = ai?.model;
  const installedTags = new Set(models.map(m => m.id));
  const aiOnline = ai?.healthy ?? false;

  const categories: Array<{ id: CategoryId; title: string; desc: string; status: string; tone: 'ok' | 'muted' }> = [
    { id: 'integrations', title: 'Services', desc: 'Connect the services that power your library: Movies, TV Shows, Music, Search, Subtitles and Downloads.', status: `${online} of ${integrations.length} online`, tone: online > 0 ? 'ok' : 'muted' },
    { id: 'users', title: 'Users', desc: 'Manage the accounts that can sign in to this server. Administrators can create, promote, or remove accounts.', status: 'Account management', tone: 'muted' },
    { id: 'ai', title: 'AI Assistant', desc: 'A local model controls your library with plain language. Powered by Ollama.', status: ai ? (aiOnline ? `Online · ${activeModel ?? ai.provider}` : 'Offline') : 'Checking...', tone: aiOnline ? 'ok' : 'muted' },
    { id: 'appearance', title: 'Appearance', desc: 'Theme tokens, applied instantly. Keyboard and remote friendly.', status: appearanceStatus, tone: 'ok' },
    { id: 'indexers', title: 'Indexers', desc: 'Where downloads come from. Add public indexers in one click, or test and remove the ones you have.', status: 'Needed for downloads', tone: 'ok' },
    { id: 'notifications', title: 'Notifications', desc: 'The bell, desktop pop-ups, and channels such as Discord, Telegram, ntfy and email.', status: `${serverSettings?.notifications?.channels?.length ?? 0} channel${(serverSettings?.notifications?.channels?.length ?? 0) === 1 ? '' : 's'}`, tone: 'muted' },
    { id: 'backup', title: 'Backup and restore', desc: 'Download a backup of accounts, history and settings, or restore one.', status: serverSettings?.autoBackup === false ? 'Manual' : 'Daily', tone: 'ok' },
    { id: 'folders', title: 'Media folders', desc: 'Downloads land in a configurable root folder before import into your library. Changes require a confirmation phrase.', status: serverSettings ? serverSettings.mediaRoots.movies : 'Loading...', tone: 'muted' },
    { id: 'themes', title: 'Themes', desc: 'Browse, preview, and activate installed themes. Import new theme packages.', status: themes.some(t => t.active) ? `Active: ${themes.find(t => t.active)?.name ?? 'custom'}` : 'Theme store', tone: 'ok' },
    { id: 'lightmode', title: 'Light / Dark mode', desc: 'Quick theme mode toggle that applies immediately. Stores preference in browser storage.', status: `Mode: ${loadAppearance().mode}`, tone: 'ok' },
    { id: 'server', title: 'Server', desc: 'Server configuration, port, logging, cache, and developer tools.', status: 'Port 3000', tone: 'ok' },
    { id: 'about', title: 'About & support', desc: 'Open source and self-hosted. Read the docs or check the GitHub repo.', status: 'MIT license', tone: 'muted' }
  ];

  return (
    <main className="page">

      <BackButton to="/" label="Home" />
      <div className="page-head">
        <h1>Settings</h1>
        <span className="page-count">
          {cat ? categories.find(c => c.id === cat)?.title ?? 'Settings' : 'Select a category to manage it'}
        </span>
      </div>

      {!cat && (
      <div className="settings-grid">
        {categories.map(c => (
          <button
            key={c.id}
            type="button"
            className={`settings-card${cat === c.id ? ' settings-card--active' : ''}`}
            onClick={() => setCat(c.id)}
          >
            <h2>{c.title}</h2>
            <p>{c.desc}</p>
            <span className={`settings-status settings-status--${c.tone}`}>{c.status}</span>
          </button>
        ))}
      </div>
      )}

      {cat && (
        <div className="settings-back">
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => setCat(null)}>
            <SvgIcon name="arrow-left" size={14} /> All settings
          </button>
        </div>
      )}

      {!cat && <p className="search-hint">Pick a category above to view and change its settings.</p>}

      {cat === 'users' && <UsersPanel />}

      {cat === 'ai' && (
        <>
          <div className="page-head" style={{ marginTop: '0.5rem' }}>
            <h2 className="rail-title">AI models</h2>
            {!aiOnline && <span className="ai-status is-offline">Ollama offline · run `ollama serve`</span>}
          </div>
          {!aiOnline && (
            <div className="notice notice--err">
              Ollama is not running, so pulls are paused. Start it with <code>ollama serve</code> on this machine, then pull models below.
            </div>
          )}
          {pullMsg && <div className={`notice notice--${pullMsg.tone}`}>{pullMsg.text}</div>}
          <div className="settings-section">
            <h3 className="section-title">Suggested models</h3>
            <div className="model-suggest-grid">
              {SUGGESTED_MODELS.map(m => {
                const installed = installedTags.has(m.tag);
                const isPulling = pulling === m.tag;
                return (
                  <div className={`model-suggest-card${installed ? ' model-suggest-card--installed' : ''}`} key={m.tag}>
                    <div className="model-suggest-head">
                      <span className="model-suggest-title">{m.title}</span>
                      <span className="model-suggest-tag">{m.tag}</span>
                    </div>
                    <p className="model-suggest-meta">{m.size} · {m.use}</p>
                    <div className="model-suggest-actions">
                      {installed ? (
                        <span className="model-suggest-installed">
                          {activeModel === m.tag && <span className="model-active">active</span>}
                          Installed
                        </span>
                      ) : (
                        <button className="btn btn-primary btn-sm" type="button" onClick={() => startPull(m.tag)} disabled={!!pulling}>
                          {isPulling ? 'Pulling...' : 'Pull'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="settings-section">
            <h3 className="section-title">Pull a custom model</h3>
            <div className="chat-widget-models-pull">
              <input
                className="chat-input"
                value={pullCustom}
                onChange={e => setPullCustom(e.target.value)}
                placeholder="model name, e.g. llama3.2:3b"
                aria-label="Custom model tag to pull"
                onKeyDown={e => e.key === 'Enter' && pullCustomModel()}
              />
              <button className="btn btn-primary btn-sm" type="button" onClick={pullCustomModel} disabled={!pullCustom.trim() || !!pulling}>
                Pull model
              </button>
            </div>
          </div>
          <div className="settings-section">
            <h3 className="section-title">Installed models</h3>
            {models.length === 0 && <div className="empty-state"><span>No models installed yet. Pull one above.</span></div>}
            <div className="chat-widget-models-list">
              {models.map(m => (
                <div className="model-row" key={m.id}>
                  <span className="model-name">{m.name}</span>
                  {m.id === activeModel ? <span className="model-active">active</span> : <span className="model-idle">installed</span>}
                </div>
              ))}
            </div>
          </div>
          <div className="settings-section">
            <h3 className="section-title">Permissions</h3>
            <p className="model-suggest-meta">
              Controls what the assistant is allowed to do. Destructive actions always ask for confirmation regardless of this setting.
            </p>
            <select
              className="settings-input"
              style={{ maxWidth: 360 }}
              value={permissionLevel ?? ''}
              onChange={e => changePermissionLevel(e.target.value)}
              aria-label="AI permission level"
            >
              {permissionLevels.map(level => (
                <option key={level} value={level}>{PERMISSION_LABELS[level] ?? level}</option>
              ))}
            </select>
          </div>
          <div className="settings-section">
            <h3 className="section-title">Recent AI actions</h3>
            {history.length === 0 && <div className="empty-state"><span>No actions taken yet.</span></div>}
            <div className="ai-history-list">
              {history.slice(0, 10).map((entry, i) => (
                <div className="ai-history-row" key={`${entry.timestamp}-${i}`}>
                  <span className={`integration-dot${entry.success ? ' integration-dot--online' : ''}`} />
                  <span className="ai-history-tool">{entry.tool}</span>
                  <span className="ai-history-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {cat === 'integrations' && (
        <>
          <div className="page-head">
            <h2 className="rail-title">Integration services</h2>
            <div className="page-head-actions">
              <button className="btn btn-secondary btn-sm" type="button" onClick={findServices} disabled={detecting}>
                {detecting ? 'Searching…' : 'Find services on this computer'}
              </button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={async () => {
                try {
                  const res = await api.checkUpdate();
                  if (res.available) {
                    flash('ok', `Update available: ${res.latestVersion} (current: ${res.currentVersion}). Visit ${res.url}`);
                  } else {
                    flash('ok', res.message ?? 'You are running the latest version.');
                  }
                } catch (err) {
                  flash('err', (err as Error).message ?? 'Could not check for updates.');
                }
              }}>
                Check for updates
              </button>
              <button className="btn btn-primary btn-sm" type="button" onClick={async () => {
                try {
                  const res = await api.launchServices();
                  flash(res.launched ? 'ok' : 'err', res.message);
                } catch (err) {
                  flash('err', (err as Error).message ?? 'Failed to launch services');
                }
              }}>
                Launch all services
              </button>
            </div>
          </div>
          <p className="search-hint">
            A green light means a service is running on this machine. Connect each service once with its address and key, then use the switch to turn it on or off.
          </p>
          <div className="integrations-list">
            {integrations.length === 0 && <span className="page-count">No services reported yet.</span>}
            {integrations.map(i => {
              const canConfigure = CONNECTABLE.has(i.adapter);
              const draft = draftFor(i.adapter, i.url);
              const msg = configMsg[i.adapter];
              const isOnline = i.healthStatus === 'online';
              return (
                <div className="integration-row-card" key={i.adapter}>
                  <div className="integration-row-info">
                    <span className={`integration-dot${isOnline ? ' integration-dot--online' : ''}`} />
                    <div>
                      <span className="integration-name">{humanName(i.adapter)}</span>
                      <span className="integration-url integration-url--tech">{i.name}</span>
                      <span className="integration-url">{statusText(i)}</span>
                      <span className="integration-url">{i.url ? i.url : 'Not connected yet'}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center', flexWrap: 'wrap' }}>
                    {canConfigure && (
                      <button
                        className="btn btn-secondary btn-sm"
                        type="button"
                        onClick={async () => {
                          try {
                            if (isOnline) {
                              flash('ok', `Stopping ${i.name}...`);
                              await api.stopService(i.adapter);
                            } else {
                              flash('ok', `Starting ${i.name}...`);
                              await api.startService(i.adapter);
                            }
                            setTimeout(loadIntegrations, 2000);
                          } catch (err) {
                            flash('err', (err as Error).message ?? 'Failed');
                          }
                        }}
                      >
                        {isOnline ? 'Stop' : 'Start'}
                      </button>
                    )}
                    {canConfigure && (
                      <button
                        className={`toggle-switch${i.enabled ? ' toggle-switch--on' : ''}`}
                        type="button"
                        onClick={() => toggleIntegration(i.adapter)}
                        disabled={toggling === i.adapter}
                        aria-label={`Toggle ${i.name}`}
                      >
                        <span className="toggle-switch-thumb" />
                      </button>
                    )}
                  </div>
                  {canConfigure && (
                    <form
                      className="integration-config-form"
                      onSubmit={e => {
                        e.preventDefault();
                        void saveConfig(i.adapter, i.url);
                      }}
                    >
                      <input
                        className="settings-input"
                        type="text"
                        placeholder={i.url || 'http://localhost:7878'}
                        value={draft.url}
                        onChange={e => setDraft(i.adapter, i.url, { url: e.target.value })}
                        aria-label={`${i.name} URL`}
                      />
                      <input
                        className="settings-input"
                        type="password"
                        placeholder={secretPlaceholder(i.adapter, Boolean(savedCredentials[i.adapter]))}
                        value={draft.apiKey}
                        onChange={e => setDraft(i.adapter, i.url, { apiKey: e.target.value })}
                        aria-label={`${humanName(i.adapter)} ${secretLabel(i.adapter).toLowerCase()}`}
                      />
                      <span className="integration-url">{secretHint(i.adapter)}</span>
                      <button type="submit" className="settings-button" disabled={savingAdapter === i.adapter}>
                        {savingAdapter === i.adapter ? 'Connecting…' : 'Connect'}
                      </button>
                      {msg && (
                        <span className={`settings-status settings-status--${msg.tone === 'ok' ? 'ok' : 'muted'}`}>
                          {msg.text}
                        </span>
                      )}
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {cat === 'themes' && (
        <section className="settings-section">
          <h3 className="section-title">Themes</h3>
          <p className="model-suggest-meta">Browse every theme with a live preview, choose one per device, create your own, or import a file.</p>
          <Link className="btn btn-primary btn-sm" to="/themes" style={{ display: 'inline-flex' }}>Open Appearance</Link>
        </section>
      )}

      {cat === 'appearance' && (
        <section className="settings-section">
          <h3 className="section-title">Appearance</h3>
          <p className="model-suggest-meta">Server default theme (used by devices that have not chosen their own): {activeThemeName ?? 'loading…'}. Each device picks its own look on the Appearance page.</p>
          <Link className="btn btn-primary btn-sm" to="/themes" style={{ display: 'inline-flex' }}>Open Appearance</Link>
        </section>
      )}

      {cat === 'notifications' && <NotificationsPanel settings={serverSettings} onSaved={setServerSettings} />}

      {cat === 'indexers' && <IndexersPanel />}

      {cat === 'backup' && <BackupPanel settings={serverSettings} onSaved={setServerSettings} />}

      {cat === 'lightmode' && (
        <section className="settings-section">
          <h3 className="section-title">Light / Dark mode</h3>
          <p className="model-suggest-meta">Applies to this device only. Each mode uses the theme you pick for it on the Appearance page.</p>
          <ModeSwitch />
          <Link className="btn btn-secondary btn-sm" to="/themes" style={{ marginTop: 'var(--spacing-md)', display: 'inline-flex' }}>Choose themes</Link>
        </section>
      )}

      {cat === 'folders' && (
        <section className="settings-section">
          <h3 className="section-title">Media folders</h3>
          <p className="model-suggest-meta">
            Where media files live on this machine. Streams are only ever served from these roots, so changing them redirects the whole library.
          </p>
          {!serverSettings && <div className="empty-state">Loading current folders...</div>}
          {serverSettings && (
            <>
              <div className="settings-section" style={{ marginTop: 'var(--spacing-md)' }}>
                <h3 className="section-title">Download roots</h3>
                {folderDraft && ((['movies', 'tv', 'music', 'staging'] as Array<keyof ServerSettings['mediaRoots']>)).map(key => (
                  <div className="settings-row" key={key}>
                    <input
                      className="settings-input"
                      type="text"
                      value={folderDraft[key]}
                      onChange={e => { setFolderDraft(prev => prev ? { ...prev, [key]: e.target.value } : prev); setConfirmPhrase(''); }}
                      aria-label={`${key} folder`}
                    />
                    <span className="settings-status settings-status--muted" style={{ textTransform: 'capitalize' }}>{key}</span>
                  </div>
                ))}
              </div>
              {changedFolders.length > 0 && (
                <div className="notice notice--err" role="alert">
                  Changing a media folder is a breaking change to where the library is stored.
                  {changedFolders.length === 1 ? (
                    <> Type the exact phrase <strong>{FOLDER_LABELS[changedFolders[0]]}</strong> to confirm.</>
                  ) : (
                    <> Save one folder at a time - each change needs its own confirmation phrase.</>
                  )}
                </div>
              )}
              {changedFolders.length === 1 && (
                <div className="settings-row" style={{ marginTop: 'var(--spacing-md)' }}>
                  <input
                    className="settings-input"
                    type="text"
                    value={confirmPhrase}
                    onChange={e => setConfirmPhrase(e.target.value)}
                    placeholder={`type: ${FOLDER_LABELS[changedFolders[0]]}`}
                    aria-label="Confirmation phrase"
                  />
                  <span className="settings-status settings-status--muted">Confirmation</span>
                </div>
              )}
              {folderMsg && (
                <div className={`notice notice--${folderMsg.tone === 'ok' ? 'ok' : 'err'}`}>{folderMsg.text}</div>
              )}
              <button className="btn btn-primary btn-sm" type="button" style={{ marginTop: 'var(--spacing-md)' }} onClick={() => void saveFolders()} disabled={savingFolders || changedFolders.length === 0}>
                {savingFolders ? 'Saving...' : 'Save folders'}
              </button>
            </>
          )}
        </section>
      )}

      {cat === 'server' && (
        <section className="settings-section">
          <h3 className="section-title">Server Configuration</h3>
          <div className="settings-section" style={{ marginTop: 'var(--spacing-md)' }}>
            <h3 className="section-title">Backend connectivity</h3>
            <p className="model-suggest-meta">
              A quick self-test the web app runs against this server. If the backend stopped, this is where you will see it.
            </p>
            {backendCheck && (
              <div className={`notice notice--${backendCheck.tone === 'ok' ? 'ok' : backendCheck.tone === 'err' ? 'err' : 'muted'}`}>{backendCheck.text}</div>
            )}
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => void runBackendCheck()}>
              Re-run check
            </button>
          </div>
          <div className="settings-section" style={{ marginTop: 'var(--spacing-md)' }}>
            <h3 className="section-title">Network</h3>
            <div className="settings-row">
              <span className="settings-status settings-status--muted">Port {serverSettings?.port ?? '3000'} (applied at startup from the PORT environment variable)</span>
            </div>
            <div className="settings-row">
              <span className="settings-status settings-status--muted">Bind {serverSettings?.bindAddress ?? '0.0.0.0'} (applied at startup)</span>
            </div>
            <p className="model-suggest-meta" style={{ marginTop: 'var(--spacing-sm)', marginBottom: 0 }}>
              The app listens on all interfaces, so other devices on your local
              network can open it at http://&lt;this-computer's-ip&gt;:3000. When
              running the included Docker Compose stack, the app port is mapped to
              0.0.0.0 in docker-compose.yml. When running from source, the server
              already binds 0.0.0.0 by default. The companion services (Radarr,
              Sonarr, Lidarr and the download clients) stay host-only for security.
            </p>
            <ConnectDevices settings={serverSettings} onSaved={setServerSettings} />
            <DefaultQuality settings={serverSettings} onSaved={setServerSettings} />
            <RequestRules settings={serverSettings} onSaved={setServerSettings} />
            <div className="settings-section" style={{ marginTop: 'var(--spacing-md)' }}>
              <h3 className="section-title">Outbound proxy</h3>
              <p className="model-suggest-meta">
                Routes the server's public internet calls - Wikipedia, MusicBrainz, web covers - through a Tor, SOCKS5 or HTTP proxy. Your local media services (Radarr, Sonarr, Lidarr) never go through it.
              </p>
              {proxyDraft && (
                <>
                  <label className="settings-row" style={{ marginBottom: 'var(--spacing-sm)' }}>
                    <input
                      type="checkbox"
                      checked={proxyDraft.enabled}
                      onChange={e => setProxyDraft(prev => prev ? { ...prev, enabled: e.target.checked } : prev)}
                      aria-label="Enable outbound proxy"
                    />
                    <span>Enable outbound proxy</span>
                  </label>
                  <div className="settings-row">
                    <select
                      className="settings-input"
                      value={proxyDraft.kind}
                      onChange={e => setProxyDraft(prev => prev ? { ...prev, kind: e.target.value as 'tor' | 'socks5' | 'http' } : prev)}
                      aria-label="Proxy kind"
                    >
                      <option value="tor">Tor (SOCKS5 on 127.0.0.1:9050)</option>
                      <option value="socks5">SOCKS5</option>
                      <option value="http">HTTP</option>
                    </select>
                    <span className="settings-status settings-status--muted">Kind</span>
                  </div>
                  <div className="settings-row">
                    <input className="settings-input" type="text" value={proxyDraft.host} onChange={e => setProxyDraft(prev => prev ? { ...prev, host: e.target.value } : prev)} aria-label="Proxy host" />
                    <span className="settings-status settings-status--muted">Host</span>
                  </div>
                  <div className="settings-row">
                    <input className="settings-input" type="number" value={proxyDraft.port} onChange={e => setProxyDraft(prev => prev ? { ...prev, port: e.target.value } : prev)} aria-label="Proxy port" />
                    <span className="settings-status settings-status--muted">Port</span>
                  </div>
                  <div className="settings-row" style={{ marginTop: 'var(--spacing-md)' }}>
                    <button className="btn btn-primary btn-sm" type="button" onClick={() => void saveProxy()}>Save proxy</button>
                    <button className="btn btn-secondary btn-sm" type="button" onClick={() => void testProxy()} disabled={proxyTesting}>
                      {proxyTesting ? 'Testing...' : 'Test connection'}
                    </button>
                  </div>
                </>
              )}
              {proxyMsg && (
                <div className={`notice notice--${proxyMsg.tone === 'ok' ? 'ok' : 'err'}`}>{proxyMsg.text}</div>
              )}
            </div>
          </div>
          <div className="settings-section" style={{ marginTop: 'var(--spacing-md)' }}>
            <h3 className="section-title">Logging</h3>
            <div className="settings-row">
              <select className="settings-input" defaultValue="info" aria-label="Log level">
                <option value="error">Error only</option>
                <option value="warn">Warnings</option>
                <option value="info" selected>Info</option>
                <option value="debug">Debug</option>
              </select>
              <span className="settings-status settings-status--ok">Level</span>
            </div>
          </div>
          <div className="settings-section" style={{ marginTop: 'var(--spacing-md)' }}>
            <h3 className="section-title">Cache</h3>
            <div className="settings-row">
              <span className="settings-status settings-status--ok">Integrations cached in integrations.json</span>
            </div>
            <div className="settings-row">
              <span className="settings-status settings-status--ok">Themes cached on filesystem</span>
            </div>
            <div className="settings-row">
              <span className="settings-status settings-status--ok">AI settings in ai-settings.json</span>
            </div>
            <button className="btn btn-danger btn-sm" type="button" style={{ marginTop: 'var(--spacing-md)' }}>
              Clear all cache
            </button>
          </div>
          <div className="settings-section" style={{ marginTop: 'var(--spacing-md)' }}>
            <h3 className="section-title">Developer tools</h3>
            <div className="settings-row">
              <span className="settings-status settings-status--ok">API docs at /api/health</span>
            </div>
            <div className="settings-row">
              <span className="settings-status settings-status--ok">Theme engine: tokens mapped to CSS vars</span>
            </div>
          </div>
        </section>
      )}

      {cat === 'about' && (
        <section className="settings-section">
          <h3 className="section-title">About & support</h3>
          <p className="model-suggest-meta">
            VirtuallyView v2.0.0. Open source and self-hosted, MIT licensed. Connects to the open source media services you already run, Radarr, Sonarr, Lidarr and friends, for real library data. Movies and TV previews use open, freely licensed footage and open-source sample streams.
          </p>
          <p className="model-suggest-meta">See the README for docs, API refs, and donation options. No tracking, no cloud, no middlemen.</p>
        </section>
      )}
    </main>
  );
}