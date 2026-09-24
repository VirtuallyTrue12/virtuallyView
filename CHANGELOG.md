# Changelog

## 0.2.0

Security, install and reliability release. Read the notes marked **Upgrade** before updating.

- **Security.** Passwords are now stored with salted scrypt instead of a bare SHA-256, and session tokens are stored only as hashes. **Upgrade:** existing accounts keep working and are rehashed on their next sign-in; sessions saved by 0.1.0 are converted on first start.
- **Security.** The assistant now enforces who may act (regular people cannot pause, retry, remove or change themes through it), and its confirmations are one-time, server-issued records tied to one person and one exact action.
- **Security.** A person's age limit now applies to every playback route for an episode, not only the series page.
- **Fixed.** Downloads never imported when qBittorrent saved into its own config volume; it now saves to the shared downloads folder and existing installs are corrected on the next setup run.
- **Fixed.** The VPN overlay was rejected by Compose and hid qBittorrent from the other services; both fixed, and a no-account option (VPN Gate) was added with automatic relay replacement.
- **Install.** A version-pinned `docker-compose.release.yml` pulls the published image; release publishing now runs the same checks as CI plus a smoke test. Node.js 22.5 or newer is required (the README said 20).
- **Fixed.** Search sources behind Cloudflare (1337x, EZTV, DaMagNet, LimeTorrents and others) never worked: FlareSolverr was set up but no source was routed through it. Setup now routes every source through it (it only acts when a site shows a Cloudflare check) and clears the stale "proxy unavailable" mark.
- **Changed.** The optional auto-update profile now uses the maintained Watchtower fork, checks every 6 hours, and additionally updates the moment the internet is reachable (download and search apps first).
- **Fixed.** Music requests never downloaded: the stock "Standard" and "Lossless" profiles rejected the unlabelled and MP3 releases public sources have. Music now defaults to "Standard", which accepts any quality (unlabelled, MP3, FLAC when one turns up quickly) and upgrades toward high-quality lossy; movies and TV default to HD-1080p. A one-click **Upgrade quality** button on the artist page (administrators) moves an artist to "Best available" and searches for lossless copies, warning that it can take a while. Existing titles keep their profile.
- **Fixed.** qBittorrent ran only 3 downloads at once, so new requests waited behind whole seasons; it now runs up to 8 and slow torrents no longer count.
- **Added.** "Find a release myself" on a request that found nothing: search every source with your own words and start the download you want.
- **Added.** Concerts and music videos file themselves under the artist (the artist is created if new), with Concerts and Videos sections on the artist page. See docs/concerts-and-videos.md. **Upgrade:** run `docker compose up -d` once so qBittorrent gets the music volume.
- **Added.** Seek-bar preview thumbnails, live TV record-now, Kiwix offline libraries, an Apps page for Immich, Audiobookshelf and Kavita, opt-in automatic updates (Watchtower), paranoid mode (all searching over Tor), model browser and progressive replies in the assistant, and a background activity indicator.

## 0.1.0

First public release.

- Library views for movies, TV and music with sort, filters, A-Z jump, Continue Watching and My List.
- Player with direct play, live ffmpeg conversion, seeking, speed, subtitles (sidecar and embedded), audio track and quality choice, picture in picture and next episode.
- Requests with a combined search, exact-match picker, quality profiles, progress tracking and bulk management.
- Download queue for qBittorrent and NZBGet.
- Accounts with roles, per-user progress and lists, device management and closed sign-up by default.
- Fifteen themes, per-device appearance and a theme creator.
- Optional Ollama assistant and optional outbound proxy.
- Docker/Podman stack with first-boot wiring for Radarr, Sonarr, Lidarr, Prowlarr and qBittorrent.
- First-run setup checklist and one-click public indexers.
- Request approval and per-person limits.
- Notifications: in-app bell, desktop pop-ups, Discord, Slack, Telegram, ntfy, Gotify, webhook and email.
- Backup and restore (manual and daily), and an admin command line.
- Chapter marks with Skip intro, recap and credits.
- HTTPS overlay (Caddy) and a guide; Secure session cookie behind HTTPS.
- Published Docker image with a check that nothing private is inside it.
- Browser tests in CI.
- Quick Connect: sign in a TV or phone with a six-digit code.
- Profile pictures and per-person age limits.
- Next Up row, media info for episodes, studio and collection filters, age rating on title pages.
- Lyrics, instant mix and Shuffle library; albums list every track and can search for missing ones.
- Picture subtitles (PGS, VobSub) drawn onto the video while converting.
- Warning before requesting a film that is still in cinemas, with the option to wait for a proper release.
- Warning and one-click replace for a downloaded file whose length does not match the film.
- Lidarr provisioning switches track renaming on so albums no longer collide in one folder.
- Watch together, people pages, subtitle search and manual upload, and search-again buttons for missing movies, episodes, albums and failed downloads.
- Clean download names, file renaming on import, and plain-language reasons when a finished download cannot be imported.
- Best audio quality by default (lossless, no mono, no low bitrate) with the format shown on every track.
- The assistant answers common questions by rules and refuses off-topic ones, so a 500M model is enough.
- Bazarr is seeded and connected to Radarr and Sonarr on first start.
- Netflix style, Apple TV style and Prime Video style themes (unofficial look-alikes).
- Cast to a TV: Chromecast and AirPlay from the browser, DLNA TVs found by the server, signed one-video links.
- Live TV from M3U playlists, a photo browser with slideshow, and a book shelf.
