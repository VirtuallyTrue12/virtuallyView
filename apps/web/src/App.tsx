import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import ProfilePicker from './components/profiles/ProfilePicker';
import { MobileTabs } from './components/layout/MobileTabs';
import { UpdateBanner } from './components/layout/UpdateBanner';
import { Navigation } from './components/layout/Navigation';
import { PageErrorBoundary } from './components/layout/PageErrorBoundary';
import CommandPalette from './components/layout/CommandPalette';
import { Toaster, toast } from './components/ui/Toast';
import { accelerationTip } from './lib/perf';
import ChatWidget from './components/ai/ChatWidget';
import LoginScreen from './components/auth/LoginScreen';
import OnboardingWizard from './components/onboarding/OnboardingWizard';
import Home from './pages/Home';
const Movies = lazy(() => import('./pages/Movies'));
const MovieDetails = lazy(() => import('./pages/MovieDetails'));
const Player = lazy(() => import('./pages/Player'));
const Series = lazy(() => import('./pages/Series'));
const SeriesDetail = lazy(() => import('./pages/SeriesDetail'));
const EpisodePlayer = lazy(() => import('./pages/EpisodePlayer'));
const Music = lazy(() => import('./pages/Music'));
const ArtistDetails = lazy(() => import('./pages/ArtistDetails'));
const ConcertPlayer = lazy(() => import('./pages/ConcertPlayer'));
const AlbumDetails = lazy(() => import('./pages/AlbumDetails'));
const PlaylistDetail = lazy(() => import('./pages/PlaylistDetail'));
const Requests = lazy(() => import('./pages/Requests'));
const Search = lazy(() => import('./pages/Search'));
const Downloads = lazy(() => import('./pages/Downloads'));
const Settings = lazy(() => import('./pages/Settings'));
const Person = lazy(() => import('./pages/Person'));
const LiveTV = lazy(() => import('./pages/LiveTV'));
const Radio = lazy(() => import('./pages/Radio'));
const Videos = lazy(() => import('./pages/Videos'));
const VideoWatch = lazy(() => import('./pages/VideoWatch'));
const VideoChannel = lazy(() => import('./pages/VideoChannel'));
const Photos = lazy(() => import('./pages/Photos'));
const Books = lazy(() => import('./pages/Books'));
const Wiki = lazy(() => import('./pages/Wiki'));
const HomeLabApps = lazy(() => import('./pages/HomeLabApps'));
const PartyJoin = lazy(() => import('./pages/PartyJoin'));
const ListenJoin = lazy(() => import('./pages/ListenJoin'));
const Account = lazy(() => import('./pages/Account'));
const Themes = lazy(() => import('./pages/Themes'));
const ThemeCreator = lazy(() => import('./pages/ThemeCreator'));
const Statistics = lazy(() => import('./pages/Statistics'));
const YearInReview = lazy(() => import('./pages/YearInReview'));
const Diagnostics = lazy(() => import('./pages/Diagnostics'));
const Activity = lazy(() => import('./pages/Activity'));
const Offline = lazy(() => import('./pages/Offline'));
import { useOfflineMode } from './lib/offline-status';
import { OfflineBanner } from './components/offline/OfflineBanner';
import NotFound from './pages/NotFound';
import { api, type AuthUser } from './lib/api';

type AuthState = { enabled: boolean; setupRequired: boolean; authenticated: boolean; user?: AuthUser | null };
import { paintCachedTheme, syncTheme } from './lib/appearance';
import { MusicProvider } from './components/media/MusicProvider';
import { RadioProvider } from './components/radio/RadioProvider';

export default function App() {
  const authedRef = useRef(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Set after a fresh sign-in, so a household with two or more profiles is offered the picker once.
  const [pickerOnEntry, setPickerOnEntry] = useState(false);
  // Bumping this remounts the current page, so it loads its data again.
  const [refreshKey, setRefreshKey] = useState(0);
  const [auth, setAuth] = useState<{ enabled: boolean; setupRequired: boolean; authenticated: boolean; user?: AuthUser | null } | null>(null);
  const [error, setError] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  // No connection to the server: the home page goes to "On this device" and sign-in is skipped.
  const offline = useOfflineMode();
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
  useEffect(() => { const tip = accelerationTip(); if (tip) window.setTimeout(() => toast(tip, { tone: 'info', ms: 15000 }), 3000); }, []);
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

  // A Kids profile gets the bright top bar: a class on <html> that kids.css keys off.
  const kid = auth?.authenticated === true && auth.user?.isKid === true;
  useEffect(() => {
    document.documentElement.classList.toggle('kids', kid);
  }, [kid]);

  // After signing in (not on a page load), offer the picker when two or more profiles are shown.
  useEffect(() => {
    if (!pickerOnEntry || !auth?.authenticated || onboarding.loading || onboarding.required) return;
    setPickerOnEntry(false);
    api.profiles()
      .then(result => { if (result.profiles.length >= 2) navigate('/profiles', { replace: true }); })
      .catch(() => { /* no picker: the home page still works */ });
  }, [pickerOnEntry, auth?.authenticated, onboarding.loading, onboarding.required, navigate]);

  const signedIn = (next: AuthState) => {
    setAuth(next);
    setPickerOnEntry(true);
  };

  const signOut = async () => {
    try { await api.logout(); } catch { /* the cookie is cleared server-side either way */ }
    setAuth({ enabled: true, setupRequired: false, authenticated: false, user: null });
  };

  if (offline && !auth?.authenticated) return (
    <div className="app" data-theme="midnight">
      <OfflineBanner />
      <Suspense fallback={<div className="loading-state">Loading...</div>}>
        <Offline />
      </Suspense>
    </div>
  );
  if (!auth) return (
    <LoginScreen
      auth={{ enabled: true, setupRequired: false, authenticated: false, user: null }}
      onAuthenticated={signedIn}
      onRetry={() => void loadAuth()}
      loading={authLoading}
      retryError={authLoading ? undefined : error}
    />
  );
  if (auth.setupRequired || (auth.enabled && !auth.authenticated)) return (
    <LoginScreen
      auth={auth}
      onAuthenticated={signedIn}
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
  // "Who's watching?" is full-screen, outside the app's top bar.
  if (auth.authenticated && pathname === '/profiles') return <ProfilePicker />;

  // Pages a Kids profile cannot use go back to Home (the server refuses their data anyway).
  const forGrownUps = (page: ReactNode) => (kid ? <Navigate to="/" replace /> : page);

  return (
    <MusicProvider>
      <RadioProvider>
      <div className="app" data-theme="midnight">
      {offline && <OfflineBanner />}
      <UpdateBanner />
      <Navigation user={auth.user} onSignOut={() => void signOut()} onRefresh={() => setRefreshKey(key => key + 1)} />
      <PageErrorBoundary resetKey={pathname}>
      <Suspense fallback={<div className="loading-state">Loading...</div>}>
      <Routes key={refreshKey}>
        <Route path="/" element={offline ? <Navigate to="/offline" replace /> : <Home />} />
        <Route path="/offline" element={<Offline />} />
        <Route path="/movies" element={<Movies />} />
        <Route path="/movies/:id" element={<MovieDetails />} />
        <Route path="/movies/:id/play" element={<Player />} />
        <Route path="/series" element={<Series />} />
        <Route path="/series/:id" element={<SeriesDetail />} />
        <Route path="/series/:id/watch/:episodeId" element={<EpisodePlayer />} />
        <Route path="/music" element={<Music />} />
        <Route path="/requests" element={forGrownUps(<Requests />)} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/search" element={<Search />} />
        <Route path="/downloads" element={forGrownUps(<Downloads />)} />
        <Route path="/settings" element={forGrownUps(<Settings />)} />
        <Route path="/account" element={<Account />} />
        <Route path="/people/:name" element={<Person />} />
        <Route path="/live" element={<LiveTV />} />
        <Route path="/radio" element={<Radio />} />
        <Route path="/videos" element={<Videos />} />
        <Route path="/videos/watch/:id" element={<VideoWatch />} />
        <Route path="/videos/channel/:id" element={<VideoChannel />} />
        <Route path="/photos" element={<Photos />} />
        <Route path="/books" element={<Books />} />
        <Route path="/wiki" element={<Wiki />} />
        <Route path="/apps" element={forGrownUps(<HomeLabApps />)} />
        <Route path="/party/:code" element={<PartyJoin />} />
        <Route path="/music/year/:year" element={<YearInReview />} />
        <Route path="/music/together/:code" element={<ListenJoin />} />
        <Route path="/music/:id" element={<ArtistDetails />} />
        <Route path="/music/:id/watch/:videoId" element={<ConcertPlayer />} />
        <Route path="/albums/:id" element={<AlbumDetails />} />
        <Route path="/playlists/:id" element={<PlaylistDetail />} />
        <Route path="/themes" element={forGrownUps(<Themes />)} />
        <Route path="/themes/installed" element={<Navigate to="/themes" replace />} />
        <Route path="/themes/marketplace" element={<Navigate to="/themes" replace />} />
        <Route path="/themes/create" element={forGrownUps(<ThemeCreator />)} />
        <Route path="/statistics" element={forGrownUps(<Statistics />)} />
        <Route path="/diagnostics" element={forGrownUps(<Diagnostics />)} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
      </PageErrorBoundary>
      <footer className="app-footer">
        <span>virtuallyView</span>
        <span><Link to="/requests">Requests</Link> · <Link to="/downloads">Downloads</Link> · <Link to="/settings">Settings</Link></span>
      </footer>
      {auth.authenticated && <MobileTabs kid={kid} />}
      <ChatWidget />
      <CommandPalette />
      <Toaster />
      </div>
      </RadioProvider>
    </MusicProvider>
  );
}