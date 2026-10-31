import { useEffect, useState } from 'react';
import { getInstallPrompt, isIosSafari, isInstalledApp, promptInstall, subscribeInstall } from '../../lib/pwa';

/** Settings hint: install virtuallyView as an app. Hidden when it already runs as one. */
export default function InstallApp() {
  const [installed, setInstalled] = useState(() => isInstalledApp());
  const [canInstall, setCanInstall] = useState(() => getInstallPrompt() !== null);
  const [ios] = useState(() => isIosSafari());

  useEffect(() => {
    const unsubscribe = subscribeInstall(() => {
      setCanInstall(getInstallPrompt() !== null);
      setInstalled(isInstalledApp());
    });
    // Switching to the installed window while Settings is open also hides the hint.
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(display-mode: standalone)') : null;
    const onMode = () => setInstalled(isInstalledApp());
    mq?.addEventListener('change', onMode);
    return () => { unsubscribe(); mq?.removeEventListener('change', onMode); };
  }, []);

  if (installed || (!canInstall && !ios)) return null;

  return (
    <div className="settings-section">
      <h3 className="section-title">Install the app</h3>
      {canInstall ? (
        <>
          <p className="ui-help">Open virtuallyView in its own full-screen window, from your desktop or home screen.</p>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => { void promptInstall(); }}>Install virtuallyView</button>
        </>
      ) : (
        <p className="ui-help">Tap Share, then Add to Home Screen.</p>
      )}
    </div>
  );
}
