import { useEffect, useRef, useState } from 'react';
import { Routes, Route, Link, Navigate } from 'react-router-dom';
import { Navigation } from './components/layout/Navigation';
import CommandPalette from './components/layout/CommandPalette';
import ChatWidget from './components/ai/ChatWidget';
import RequestActivityPill from './components/requests/RequestActivityPill';
import LoginScreen from './components/auth/LoginScreen';
import OnboardingWizard from './components/onboarding/OnboardingWizard';
import Home from './pages/Home';
import Movies from './pages/Movies';
import MovieDetails from './pages/MovieDetails';
import Player from './pages/Player';
import Series from './pages/Series';
import SeriesDetail from './pages/SeriesDetail';
import EpisodePlayer from './pages/EpisodePlayer';
import Music from './pages/Music';
import ArtistDetails from './pages/ArtistDetails';
import AlbumDetails from './pages/AlbumDetails';
import PlaylistDetail from './pages/PlaylistDetail';
import Requests from './pages/Requests';
import Search from './pages/Search';
import Downloads from './pages/Downloads';
import Settings from './pages/Settings';
import Person from './pages/Person';
import LiveTV from './pages/LiveTV';
import Photos from './pages/Photos';
import Books from './pages/Books';
import PartyJoin from './pages/PartyJoin';
import Account from './pages/Account';
import Themes from './pages/Themes';
import ThemeCreator from './pages/ThemeCreator';
import Statistics from './pages/Statistics';
import Diagnostics from './pages/Diagnostics';
import Activity from './pages/Activity';
import NotFound from './pages/NotFound';
import { api, type AuthUser } from './lib/api';
import { paintCachedTheme, syncTheme } from './lib/appearance';
import { MusicProvider } from './components/media/MusicProvider';

export default function App() {
  const authedRef = useRef(false);
  const [auth, setAuth] = useState<{ enabled: boolean; setupRequired: boolean; authenticated: boolean; user?: AuthUser | null } | null>(null);
  const [error, setError] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [onboarding, setOnboarding] = useState<{ loading: boolean; required: boolean }>({ loading: true, required: false });
  const loadAuth = async () => {
    setAuthLoading(true);
    setError('');
    try {
      setAuth(await api.authStatus());
    } catch {
      setError('Cannot reach the dashboard server. Check that it is running and try again.');
    } finally {
      setAuthLoading(false);
    }
  };
  useEffect(() => {
    void loadAuth();
    const handleAuthRequired = () => {
      setAuth({ enabled: true, setupRequired: false, authenticated: false, user: null });
      setError('Your session expired. Please sign in again.');
    };
    window.addEventListener('virtuallyview:auth-required', handleAuthRequired);
    return () => window.removeEventListener('virtuallyview:auth-required', handleAuthRequired);
  }, []);

  // Keep the painted theme in step with this device's appearance choice and
  // with the operating system's light/dark setting.
  useEffect(() => {
    const refresh = () => { if (authedRef.current) void syncTheme().catch(() => {}); else paintCachedTheme(); };
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', refresh);
    window.addEventListener('vv-appearance', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      mq.removeEventListener('change', refresh);
      window.removeEventListener('vv-appearance', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  useEffect(() => {
    if (!auth?.authenticated) {
      setOnboarding({ loading: true, required: false });
      return;
    }
    let cancelled = false;
    api.onboardingStatus()
      .then(status => {
        if (!cancelled) setOnboarding({ loading: false, required: status.required });
      })
      .catch(() => {
        if (!cancelled) setOnboarding({ loading: false, required: false });
      });
    return () => { cancelled = true; };
  }, [auth?.authenticated]);

  useEffect(() => {
    authedRef.current = auth?.authenticated === true;
    if (auth?.authenticated) void syncTheme().catch(() => {});
  }, [auth?.authenticated]);

  const signOut = async () => {
    try { await api.logout(); } catch { /* the cookie is cleared server-side either way */ }
    setAuth({ enabled: true, setupRequired: false, authenticated: false, user: null });
  };

  if (!auth) return (
    <LoginScreen
      auth={{ enabled: true, setupRequired: false, authenticated: false, user: null }}
      onAuthenticated={setAuth}
      onRetry={() => void loadAuth()}
      loading={authLoading}
      retryError={authLoading ? undefined : error}
    />
  );
  if (auth.setupRequired || (auth.enabled && !auth.authenticated)) return (
    <LoginScreen
      auth={auth}
      onAuthenticated={setAuth}
      onRetry={() => void loadAuth()}
      loading={authLoading}
      retryError={authLoading ? undefined : error}
    />
  );
  if (auth.authenticated && onboarding.loading) {
    return (
      <div className="boot-screen">
        <div className="boot-brand">virtuallyView</div>
        <div className="boot-spinner" aria-label="Loading" />
      </div>
    );
  }
  if (auth.authenticated && onboarding.required) {
    return (
      <OnboardingWizard onDone={() => setOnboarding({ loading: false, required: false })} />
    );
  }

  return (
    <MusicProvider>
      <div className="app" data-theme="midnight">
      <Navigation user={auth.user} onSignOut={() => void signOut()} />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/movies" element={<Movies />} />
        <Route path="/movies/:id" element={<MovieDetails />} />
        <Route path="/movies/:id/play" element={<Player />} />
        <Route path="/series" element={<Series />} />
        <Route path="/series/:id" element={<SeriesDetail />} />
        <Route path="/series/:id/watch/:episodeId" element={<EpisodePlayer />} />
        <Route path="/music" element={<Music />} />
        <Route path="/requests" element={<Requests />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/search" element={<Search />} />
        <Route path="/downloads" element={<Downloads />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/account" element={<Account />} />
        <Route path="/people/:name" element={<Person />} />
        <Route path="/live" element={<LiveTV />} />
        <Route path="/photos" element={<Photos />} />
        <Route path="/books" element={<Books />} />
        <Route path="/party/:code" element={<PartyJoin />} />
        <Route path="/music" element={<Music />} />
        <Route path="/music/:id" element={<ArtistDetails />} />
        <Route path="/albums/:id" element={<AlbumDetails />} />
        <Route path="/playlists/:id" element={<PlaylistDetail />} />
        <Route path="/themes" element={<Themes />} />
        <Route path="/themes/installed" element={<Navigate to="/themes" replace />} />
        <Route path="/themes/marketplace" element={<Navigate to="/themes" replace />} />
        <Route path="/themes/create" element={<ThemeCreator />} />
        <Route path="/statistics" element={<Statistics />} />
        <Route path="/diagnostics" element={<Diagnostics />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <footer className="app-footer">
        <span>virtuallyView</span>
        <span><Link to="/requests">Requests</Link> · <Link to="/downloads">Downloads</Link> · <Link to="/settings">Settings</Link></span>
      </footer>
      <ChatWidget />
      <CommandPalette />
      <RequestActivityPill />
      </div>
    </MusicProvider>
  );
}