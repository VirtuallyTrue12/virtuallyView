import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import { paintCachedTheme } from './lib/appearance';
import { initPerformanceMode } from './lib/perf';
import { registerServiceWorker, startInstallCapture } from './lib/pwa';
import { initDpad } from './lib/dpad';
import { startTvReports } from './lib/tv-report';
import './lib/tv-focus.css';
import './styles/foundation.css';
import './styles/themes.css';
// Page styles load after the shared ones so their page-scoped variants win.
import './styles/settings.css';
import './styles/browse.css';
import './styles/watch.css';
import './styles/music.css';
import './styles/tools.css';
import './styles/videos.css';
import './styles/media.css';
import './styles/storage.css';
import './styles/foryou.css';
import './styles/search-everything.css';
import './styles/details.css';
import './styles/recordings.css';
import './styles/party.css';

initPerformanceMode();
initDpad();
startTvReports();

paintCachedTheme();
registerServiceWorker();
// A tab still on an old release asks for a page file the server no longer has: load the new release instead of
// breaking (at most once a minute, so a server that is really down does not cause a reload loop).
window.addEventListener('vite:preloadError', event => {
  try {
    const last = Number(sessionStorage.getItem('vv-chunk-reload') ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem('vv-chunk-reload', String(Date.now()));
  } catch { /* storage blocked: still reload once */ }
  event.preventDefault();
  window.location.reload();
});
startInstallCapture();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
