# Changelog

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
