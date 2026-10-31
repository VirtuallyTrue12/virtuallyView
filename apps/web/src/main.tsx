import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import { paintCachedTheme } from './lib/appearance';
import { initPerformanceMode } from './lib/perf';
import { registerServiceWorker, startInstallCapture } from './lib/pwa';

initPerformanceMode();

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
