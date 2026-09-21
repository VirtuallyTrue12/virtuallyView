// Plain-language names for the technical services behind the dashboard.
// Users should think "Movies", "TV Shows" and "Music", never the arr-stack.
export const HUMAN_NAMES: Record<string, string> = {
  radarr: 'Movies',
  sonarr: 'TV Shows',
  prowlarr: 'Search',
  lidarr: 'Music',
  bazarr: 'Subtitles',
  qbittorrent: 'Downloads',
  nzbget: 'Downloads',
  sabnzbd: 'Downloads',
  plex: 'Media library',
  emby: 'Media library',
  ollama: 'AI assistant'
};

// These services take a login (username:password) instead of an API key.
export const ACCOUNT_SERVICES = new Set(['qbittorrent', 'nzbget', 'sabnzbd']);

export function humanName(adapter: string): string {
  return HUMAN_NAMES[adapter] ?? adapter;
}

export function secretLabel(adapter: string): string {
  return ACCOUNT_SERVICES.has(adapter) ? 'Account' : 'Key';
}

export function secretPlaceholder(adapter: string, hasSaved: boolean): string {
  if (hasSaved) return `${secretLabel(adapter)} saved`;
  return ACCOUNT_SERVICES.has(adapter) ? 'username:password' : 'Key';
}

export function secretHint(adapter: string): string {
  if (ACCOUNT_SERVICES.has(adapter)) {
    return `Use the login details of your ${humanName(adapter)} service.`;
  }
  return `Copy the key from the settings page of your ${humanName(adapter)} service.`;
}

// The core services shown in the first-run wizard, human-first.
export const ONBOARDING_SERVICES = [
  { adapter: 'radarr', blurb: 'Brings your movie collection to the library.' },
  { adapter: 'sonarr', blurb: 'Brings your TV shows to the library.' },
  { adapter: 'lidarr', blurb: 'Brings your music to the library.' },
  { adapter: 'prowlarr', blurb: 'Finds where to get titles you request.' },
  { adapter: 'qbittorrent', blurb: 'Handles the actual downloading.' },
  { adapter: 'bazarr', blurb: 'Finds subtitles for your library.' }
] as const;