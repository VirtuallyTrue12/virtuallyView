import { useEffect, useMemo, useState } from 'react';
import { api, type IntegrationStatus, type ServerSettings } from '../../lib/api';
import { humanName, ONBOARDING_SERVICES, secretLabel, secretPlaceholder } from '../../lib/integration-names';

type Step = 'welcome' | 'services' | 'folders' | 'done';

interface ServiceState {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  message?: string;
}

const STEP_LABELS: Record<Step, string> = {
  welcome: 'Welcome',
  services: 'Connect your services',
  folders: 'Media folders',
  done: 'You are all set'
};

export default function OnboardingWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('welcome');
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [serverSettings, setServerSettings] = useState<ServerSettings | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { url: string; key: string }>>({});
  const [states, setStates] = useState<Record<string, ServiceState>>({});
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([api.integrations(), api.integrationsDetect(), api.serverSettings()])
      .then(([list, detected, settings]) => {
        setIntegrations(list);
        setServerSettings(settings);
        const next: Record<string, { url: string; key: string }> = {};
        for (const service of list) {
          const hit = detected.find(d => d.adapter === service.adapter && d.reachable);
          next[service.adapter] = { url: hit?.url ?? service.url ?? '', key: '' };
        }
        setDrafts(next);
        const found = detected.filter(d => d.reachable).length;
        if (found > 0) {
          setDetectMsg(`We found ${found} service${found === 1 ? '' : 's'} on this computer and filled in the addresses.`);
        }
      })
      .catch(() => { /* the wizard still works without live detection */ });
  }, []);

  const alreadyConnected = useMemo(
    () => new Set(integrations.filter(i => i.enabled).map(i => i.adapter)),
    [integrations]
  );

  const runDetect = async () => {
    setDetecting(true);
    setDetectMsg(null);
    try {
      const detected = await api.integrationsDetect();
      const reachable = detected.filter(d => d.reachable);
      setDrafts(prev => {
        const next = { ...prev };
        for (const hit of reachable) {
          next[hit.adapter] = { ...(next[hit.adapter] ?? { url: '', key: '' }), url: hit.url };
        }
        return next;
      });
      setDetectMsg(reachable.length > 0
        ? `We found ${reachable.length} service${reachable.length === 1 ? '' : 's'} on this computer and filled in the addresses.`
        : 'No services were found on the usual addresses. You can enter one by hand or skip this step.');
    } catch {
      setDetectMsg('Could not search right now. You can still enter addresses by hand or skip.');
    } finally {
      setDetecting(false);
    }
  };

  const connect = async (adapter: string) => {
    const draft = drafts[adapter] ?? { url: '', key: '' };
    if (!draft.url.trim() || !draft.key.trim()) {
      setStates(prev => ({ ...prev, [adapter]: { status: 'error', message: 'Enter the address and the key your service shows.' } }));
      return;
    }
    setStates(prev => ({ ...prev, [adapter]: { status: 'connecting' } }));
    try {
      await api.saveIntegrationConfig(adapter, { url: draft.url.trim(), apiKey: draft.key.trim() });
      setStates(prev => ({ ...prev, [adapter]: { status: 'connected', message: `${humanName(adapter)} is connected.` } }));
      setIntegrations(prev => prev.map(i => i.adapter === adapter ? { ...i, enabled: true } : i));
    } catch (err) {
      setStates(prev => ({ ...prev, [adapter]: { status: 'error', message: (err as Error).message } }));
    }
  };

  const finish = async () => {
    try {
      await api.completeOnboarding();
    } catch {
      /* entering the app does not depend on this */
    }
    onDone();
  };

  const folderRows: Array<{ key: keyof ServerSettings['mediaRoots']; label: string }> = [
    { key: 'movies', label: 'Movies' },
    { key: 'tv', label: 'TV Shows' },
    { key: 'music', label: 'Music' },
    { key: 'staging', label: 'Downloads' }
  ];

  return (
    <div className="onboarding-shell">
      <div className="onboarding-card">
        <span className="onboarding-step">
          Step {step === 'welcome' ? 1 : step === 'services' ? 2 : step === 'folders' ? 3 : 4} of 4 · {STEP_LABELS[step]}
        </span>

        {step === 'welcome' && (
          <>
            <h1>Welcome to VirtuallyView</h1>
            <p className="onboarding-copy">
              One dashboard for your movies, TV shows and music. Connect the media services you already run and VirtuallyView brings the whole library together in one place, with nothing to configure by hand.
            </p>
            <p className="onboarding-copy">
              This short setup finds your services for you, then you are done.
            </p>
            <div className="onboarding-actions">
              <button className="btn btn-primary" type="button" onClick={() => setStep('services')}>Get started</button>
              <button className="btn btn-secondary" type="button" onClick={() => void finish()}>Skip for now</button>
            </div>
          </>
        )}

        {step === 'services' && (
          <>
            <h1>Connect your services</h1>
            <p className="onboarding-copy">
              These services power your library. We look for them on this computer first. For each one, enter the key (or login) it shows in its own settings and press Connect. You can skip any you do not use.
            </p>
            <div className="onboarding-actions">
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => void runDetect()} disabled={detecting}>
                {detecting ? 'Searching…' : 'Find services on this computer'}
              </button>
            </div>
            {detectMsg && <p className="onboarding-detect-msg">{detectMsg}</p>}
            <div className="onboarding-services">
              {ONBOARDING_SERVICES.map(service => {
                const state = states[service.adapter];
                const connected = state?.status === 'connected' || alreadyConnected.has(service.adapter);
                const draft = drafts[service.adapter] ?? { url: '', key: '' };
                return (
                  <div className="onboarding-service-row" key={service.adapter}>
                    <div className="onboarding-service-head">
                      <span className="integration-name">{humanName(service.adapter)}</span>
                      <span className="integration-url">{service.blurb}</span>
                    </div>
                    {connected && <span className="onboarding-service-status onboarding-service-status--ok">Connected</span>}
                    {!connected && state?.status === 'error' && (
                      <span className="onboarding-service-status onboarding-service-status--err">{state.message}</span>
                    )}
                    {!connected && state?.status === 'connecting' && (
                      <span className="onboarding-service-status">Connecting…</span>
                    )}
                    <div className="onboarding-service-form">
                      <input
                        className="settings-input"
                        type="text"
                        placeholder="Service address, e.g. http://192.168.1.10:7878"
                        value={draft.url}
                        onChange={e => setDrafts(prev => ({ ...prev, [service.adapter]: { ...draft, url: e.target.value } }))}
                        aria-label={`${humanName(service.adapter)} address`}
                      />
                      <input
                        className="settings-input"
                        type="password"
                        placeholder={secretPlaceholder(service.adapter, false)}
                        value={draft.key}
                        onChange={e => setDrafts(prev => ({ ...prev, [service.adapter]: { ...draft, key: e.target.value } }))}
                        aria-label={`${humanName(service.adapter)} ${secretLabel(service.adapter).toLowerCase()}`}
                      />
                      <button className="settings-button" type="button" onClick={() => void connect(service.adapter)} disabled={state?.status === 'connecting'}>
                        {connected ? 'Connected' : state?.status === 'connecting' ? 'Connecting…' : 'Connect'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="onboarding-actions">
              <button className="btn btn-primary" type="button" onClick={() => setStep('folders')}>Continue</button>
            </div>
          </>
        )}

        {step === 'folders' && (
          <>
            <h1>Where your media lives</h1>
            <p className="onboarding-copy">
              Downloads land in these folders before they appear in your library. We picked sensible defaults. You can change them any time in Settings.
            </p>
            <div className="onboarding-folders">
              {folderRows.map(row => (
                <div className="onboarding-folder-row" key={row.key}>
                  <span className="onboarding-folder-label">{row.label}</span>
                  <span className="integration-url">{serverSettings?.mediaRoots[row.key] ?? '…'}</span>
                </div>
              ))}
            </div>
            <p className="onboarding-copy">
              Anything already in those folders shows up in your library right away. Nothing is deleted or moved during setup.
            </p>
            <div className="onboarding-actions">
              <button className="btn btn-primary" type="button" onClick={() => setStep('done')}>Looks good</button>
              <button className="btn btn-secondary" type="button" onClick={() => void finish()}>Change later</button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <h1>You are all set</h1>
            <p className="onboarding-copy">
              Your dashboard is ready. Search for something to watch, or head to Settings any time to connect more services.
            </p>
            <div className="onboarding-actions">
              <button className="btn btn-primary" type="button" onClick={() => void finish()}>Start watching</button>
            </div>
          </>
        )}

        {step !== 'done' && (
          <button className="onboarding-skip" type="button" onClick={() => void finish()}>
            Skip setup for now
          </button>
        )}
      </div>
    </div>
  );
}