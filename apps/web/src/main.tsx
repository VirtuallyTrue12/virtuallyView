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

initPerformanceMode();
initDpad();
startTvReports();

paintCachedTheme();
registerServiceWorker();
startInstallCapture();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
