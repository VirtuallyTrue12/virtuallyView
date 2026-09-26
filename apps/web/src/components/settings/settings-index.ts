import type { IconName } from '../ui/SvgIcon';

export type SectionId = 'home' | 'library' | 'sources' | 'services' | 'people' | 'notifications' | 'appearance' | 'network' | 'backup' | 'ai' | 'health' | 'server';

export interface SectionInfo { id: SectionId; label: string; icon: IconName; blurb: string; group: string; adminOnly: boolean }

export const SECTIONS: SectionInfo[] = [
  { id: 'home', label: 'Overview', icon: 'home', blurb: 'What is working, and what to do next.', group: 'Start', adminOnly: true },
  { id: 'library', label: 'Library and quality', icon: 'folder', blurb: 'Where files live and the quality requests ask for.', group: 'Your library', adminOnly: true },
  { id: 'sources', label: 'Search sources', icon: 'search', blurb: 'Where downloads are found.', group: 'Your library', adminOnly: true },
  { id: 'services', label: 'Services', icon: 'server', blurb: 'The apps that run your movies, shows and music.', group: 'Your library', adminOnly: true },
  { id: 'people', label: 'People and requests', icon: 'users', blurb: 'Accounts, who may request what, and sign-in.', group: 'People', adminOnly: true },
  { id: 'notifications', label: 'Notifications', icon: 'bell', blurb: 'Alerts to your phone, Discord, email and more.', group: 'People', adminOnly: true },
  { id: 'appearance', label: 'Appearance', icon: 'palette', blurb: 'Light or dark, and themes.', group: 'This server', adminOnly: false },
  { id: 'network', label: 'Network and devices', icon: 'wifi', blurb: 'Connect TVs and phones; proxy for lookups.', group: 'This server', adminOnly: true },
  { id: 'backup', label: 'Backup and restore', icon: 'hdd', blurb: 'Save and restore accounts, history and settings.', group: 'This server', adminOnly: true },
  { id: 'ai', label: 'AI assistant', icon: 'sparkle', blurb: 'The built-in assistant and its model.', group: 'This server', adminOnly: true },
  { id: 'health', label: 'Health and repair', icon: 'wrench', blurb: 'Find out what is not working and fix it.', group: 'This server', adminOnly: true },
  { id: 'server', label: 'Server and about', icon: 'info', blurb: 'Name, version, and what has been changed.', group: 'This server', adminOnly: true }
];

/** Older links used other names for the same places. */
export const LEGACY: Record<string, SectionId> = {
  integrations: 'services', users: 'people', indexers: 'sources', folders: 'library', themes: 'appearance', lightmode: 'appearance', server: 'network', about: 'server'
};

/** What people type when they are looking for a setting, mapped to where it is. */
export const SEARCH_INDEX: Array<{ section: SectionId; label: string; words: string }> = [
  { section: 'library', label: 'Movie, TV and music folders', words: 'folder path media root staging download location disk' },
  { section: 'library', label: 'Default download quality', words: 'quality 1080p 4k hd flac lossless profile standard' },
  { section: 'sources', label: 'Add search sources (indexers)', words: 'indexer torrent usenet prowlarr public private tracker source' },
  { section: 'services', label: 'Connect Radarr, Sonarr, Lidarr, qBittorrent', words: 'radarr sonarr lidarr prowlarr bazarr qbittorrent nzbget api key connect start stop' },
  { section: 'people', label: 'Add or remove people', words: 'user account invite family admin password role remove age limit rating' },
  { section: 'people', label: 'Approval and request limits', words: 'request approve approval limit quota week day' },
  { section: 'people', label: 'Let people sign themselves up', words: 'signup register self create account open' },
  { section: 'notifications', label: 'Alerts to phone, Discord, Telegram, email', words: 'notify notification alert discord telegram ntfy gotify slack webhook email bell' },
  { section: 'appearance', label: 'Light and dark mode', words: 'dark light mode night theme' },
  { section: 'appearance', label: 'Themes', words: 'theme colour color style look skin' },
  { section: 'network', label: 'Address other devices use', words: 'address url ip tv phone connect device link lan wifi' },
  { section: 'network', label: 'Trust services on my home network', words: 'trust local network lan private 192.168' },
  { section: 'network', label: 'Outbound proxy (Tor, SOCKS5, HTTP)', words: 'proxy tor socks vpn privacy outbound' },
  { section: 'backup', label: 'Back up or restore', words: 'backup restore export import save automatic' },
  { section: 'ai', label: 'AI assistant and models', words: 'ai assistant model ollama llm chat permission' },
  { section: 'health', label: 'Something is not working', words: 'troubleshoot problem broken fix restart not working error vpn stuck' },
  { section: 'server', label: 'Server name', words: 'name title rename server' },
  { section: 'server', label: 'Log detail', words: 'log debug level verbose' },
  { section: 'server', label: 'Cover art source', words: 'cover poster artwork tmdb wikipedia duckduckgo' },
  { section: 'server', label: 'What has been changed', words: 'history changes audit who changed log' },
  { section: 'server', label: 'Version and about', words: 'version about license github docs update' }
];
