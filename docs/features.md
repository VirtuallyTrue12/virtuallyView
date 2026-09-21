# Features

What virtuallyView does today and what it does not. "Built" means it works and was tried in a browser.
virtuallyView is an interface over Radarr, Sonarr, Lidarr and friends, so it does not scan folders itself.

## Users and devices

| Feature | Status |
|---|---|
| Several accounts, administrator or regular user | Built (Settings > Users) |
| Per-person watch progress, My List and watched marks | Built |
| Sign in from other devices on the network | Built (Settings > Server > Connect other devices) |
| Sign in a TV or phone with a six-digit code (Quick Connect) | Built (sign-in screen, then Account > Sign in another device) |
| Profile pictures | Built (Account > Change picture; the first letter is used otherwise) |
| Age limits per person (G, PG, PG-13, R) | Built (Settings > Users). Titles above the limit, and unrated ones, are hidden and cannot be opened or streamed |
| Sign-up policy | Closed by default; an administrator can allow it |
| Password change (self) and reset (administrator) | Built; a reset signs the account out everywhere |
| Signed-in devices list with remote sign-out | Built |
| Regular users blocked from server settings and deletes | Built (HTTP 403) |
| Sign-in rate limit | Built (30 attempts a minute per address) |

## Browsing

| Feature | Status |
|---|---|
| Continue Watching, Next Up, My List, Recently Added, Trending | Built |
| Sort, filter, genre, studio or network, collection, A-Z jump | Built (Movies, TV, Music) |
| Surprise me | Built |
| Age rating, studio and collection shown on title pages, linking to the filtered library | Built |
| Favorites and watched badges | Built |
| Scan library and refresh metadata | Built (administrator) |
| Choose download quality per request | Built |
| Search again for one movie, episode, album or a failed download | Built (buttons on the title, season, album and Downloads pages) |
| Clean names for downloads instead of scene tags | Built (and files are renamed on import) |
| Warning when a film is still in cinemas, with the choice to wait for a proper copy | Built |
| Warning when a downloaded file does not match the film, with one-click replace | Built (administrator) |
| People pages: picture, biography and your titles they appear in | Built (a title appears once its own page has loaded its cast) |

## Playback

| Feature | Status |
|---|---|
| Direct play, live conversion, remux without re-encoding when possible | Built |
| Resume, seek bar, skip 10 seconds, speed, fullscreen, keyboard shortcuts, picture in picture | Built |
| Subtitles from sidecar files and text tracks in the file | Built |
| Subtitle search in a chosen language and manual upload | Built (Get subtitles under the player; needs Bazarr, which the bundled stack connects itself) |
| Picture subtitles (PGS, VobSub) | Built, drawn onto the video, so they need conversion |
| Audio track and quality choice while converting | Built |
| Chapters, Skip intro, Skip credits | Built |
| TV: next and previous episode, episode picker, auto-advance | Built |
| Media info panel for movies and episodes | Built |
| Watching together in sync | Built (Watch together under the player, then share the invite link; play, pause and seeking are shared) |
| Casting to a TV | Built: Chromecast and AirPlay from the browser, and DLNA TVs found by the server ([casting](casting.md)) |

## Music

| Feature | Status |
|---|---|
| Artists, albums, tracks, playlists, background playback, queue, shuffle, repeat | Built |
| Every track of an album is listed, with missing ones marked and a search button | Built |
| Best audio quality by default: lossless profile, mono and low-bitrate releases refused, format shown per track, mono flagged | Built |
| Equalizer | Built |
| Choose artist artwork from several candidates | Built |
| Lyrics, following along when timed lyrics exist | Built (looked up on LRCLIB, a free public database) |
| Instant mix for an artist and Shuffle library | Built |

## Administration

| Feature | Status |
|---|---|
| Server settings, media folders, outbound proxy or Tor | Built |
| Activity log, diagnostics, statistics | Built |
| Assistant that answers everyday questions by rules (downloads, problems, retries, requests) and stays on topic, so it works with very small local models | Built |
| Notifications: bell, desktop pop-ups, Discord, Slack, Telegram, ntfy, Gotify, webhook, email | Built |
| Backups: daily automatic, download, restore, command line recovery | Built |
| One-click public indexers | Built |
| Themes | Built (15, plus a creator; three unofficial look-alikes of popular streaming apps) |
| Live TV from M3U playlists (TV tuner boxes, providers, free public lists), played through the server | Built. Recording (DVR) and a programme guide are phase 2 ([roadmap](roadmap.md)) |
| Photos from a mounted folder: grid, viewer, slideshow | Built |
| Books and comics from a mounted folder | Built: PDFs open in the browser, EPUB and comic files download; an EPUB reader is phase 2 |
| Plugins | Phase 2, after a sandbox exists: a plugin runs someone else's code with access to your server |
