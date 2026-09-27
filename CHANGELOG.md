# Changelog
- **Added.** "Find my existing media": on Movies, TV and Music, administrators get an "Import N found" button when the library folder holds titles the apps do not know yet. It matches each folder to the right title and adds it without downloading anything.
- **Added.** Each episode, album and track that is on its way shows its own state ("Downloading 42% · 10 min left", "Waiting to download", "Download stuck") on the TV, artist and album pages, and turns playable by itself when done.
- **Added.** With the VPN running, searches go through it too (SEARCH_VIA_VPN, automatic when the VPN is up, `false` to opt out); Tor keeps priority when SEARCH_VIA_TOR is on.
- **Changed.** New movie and TV requests use a "Standard" quality profile: take whatever is available (720p or 1080p, 1080p preferred), then keep upgrading until it is 1080p. Music was already "Standard". Existing titles keep their profile.
- **Added.** Radio by region: any country and region, genre or name, favorites and recents, a player bar that keeps playing as you browse, and what is playing now ([radio](docs/radio.md)).
- **Added.** "Fix everything" in Settings > Health and repair: one press starts what stopped, restarts what is stuck, reconnects the apps and replaces dead downloads, step by step, and `scripts/repair.sh` fixes what needs the machine itself (asks for a password only when needed). Stopped services are also started again by themselves.
- **Added.** Live TV highlights: the big matches and races on now and soon, with the channels from your playlists that show them.
- **Fixed.** `docker compose run --rm provision` tried to recreate qBittorrent outside the VPN and failed on port 6881; setup now runs without touching it (`--no-deps`), and the setup step no longer starts by itself with the stopped services.
- **Fixed.** Radio's player bar looked plain next to the music player; it now matches it (a colour badge per station, a live pill with a pulsing meter, a real play button), and stations without a picture get initials instead of a generic icon.
- **Fixed.** "Fix everything" restarting the VPN often left qBittorrent still unable to see peers, because the same dead relay came back. Restarting the VPN now also asks the free relay watcher for a fresh one (never repeating the last few), and the step waits up to two minutes for peers to show up before reporting. It also re-tests search sources, since Prowlarr rests a source that just failed for up to a day.
- **Fixed.** With the VPN search setting on, a site that blocks the VPN's address with a Cloudflare check was switched off instead of tried another way; it now falls back to FlareSolverr, from your own connection, for that one site. `SEARCH_VIA_VPN=strict` turns that fallback off.

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
- **Changed.** The music player is rebuilt: a compact bar with a smooth, draggable progress bar (hover to preview the time, arrow keys to nudge), and a full Now Playing view with large artwork, a glow taken from the cover, an editable queue, lyrics and the equalizer. Repeat now has off / all / one, media keys and lock-screen controls work, and the next track starts by itself.
- **Fixed.** Audio tracks in movies were all named after the release group ("KIN · AAC stereo"); they now read "English · Stereo · AAC", "Hindi · 5.1 · Dolby Digital", and the Audio menu is available for any file with several languages. The TV "Skip 90 s" button now says "Skip intro", shows only near the start, and only once.
- **Added.** "Find more artwork" in the artist artwork picker: artist photos and album covers from Deezer, Apple Music, Wikipedia and MusicBrainz. (Also fixes MusicBrainz covers, which were looked up with the wrong id and never appeared.)
- **Fixed.** The free VPN relay watcher only checked that a relay accepted a connection, so a relay that accepts and then drops the OpenVPN handshake kept the tunnel down for hours. It now does a real handshake probe and swaps such a relay within minutes.
- **Fixed.** Search, Requests and Downloads disagreed about the same item. They now describe a stalled download the same way ("Stalled" with the reason and a "Try another release" button), a request no longer says "available" while tracks or episodes are still arriving ("Partly available: 39 of 107 tracks"), a finished download that cannot be imported reads as an import problem with the reason, finished season packs and films link back to their title, and Search marks results that are already requested instead of offering the request again.
- **Fixed.** The free VPN could look dead when a relay blocks DNS-over-TLS (port 853); it now uses DNS-over-HTTPS.
- **Fixed.** Concerts saved from YouTube could not be played: the address for a video with a long file name exceeded the server's 100-character limit for URL parameters, so the player got a 404. Videos now have short ids.
- **Changed.** The artist page is decluttered: Play and My List up front, everything else (search missing albums, artwork, YouTube, upgrade and download quality, remove) in a "more" menu that opens each in its own dialog; the long biography folds; download-quality and source-check sections on film and TV pages are folded away at the bottom. The Music page opens with a header, a playlist row and "Add artist" in a dialog instead of a large form.
- **Added.** Cast everywhere: films use Radarr's own credits (falling back to TMDB), TV shows the full cast with the leads first then supporting cast, and artists show their band members (from MusicBrainz, with portraits) or nothing extra when solo.
- **Changed.** The artwork picker offers pictures of the artist (logo, portraits, band and live photos from Lidarr, Deezer, Wikipedia, Wikidata and Wikimedia Commons), not album covers, and looks for them automatically the first time it opens.
- **Changed.** A concert of a band that is added as a film (for example "Linkin Park - Live at Rock am Ring") moves to the band's Concerts and out of the Movies lists.
- **Fixed.** The music bar, the assistant button and the requests badge no longer sit on top of each other; the floating buttons move above the player.
- **Fixed.** The dashboard no longer refuses to start because the free VPN is momentarily unhealthy, and image builds retry a failed optional package download.
- **Added.** Concerts that only exist on YouTube: an optional service (`docker compose --profile youtube up -d`) searches YouTube and saves a video under the artist's Concerts or Videos folder (artist created if new), from the artist page or the request's release picker. Off by default; see docs/concerts-and-videos.md.
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
- **Added.** Band members can be edited: show Everyone, Current or Former, hide people for yourself, and (administrators) mark members as former or current, remove wrong entries or add missing ones for everyone.
- **Changed.** Cast on film and TV pages sits in the page's own column instead of hanging off to one side.
- **Added.** Pasting a YouTube link into "Find on YouTube" recognises it and shows the video's details with a Download button.
- **Added.** A **Troubleshooting** panel at the top of the Apps page checks the internet, search sources, downloader, VPN, media apps and extras, explains problems in plain words with what to try, and can restart a stopped service (administrators).
- **Fixed.** The dashboard did not load on older TV browsers: it now ships a legacy build and non-blocking fonts, and shows a plain message if the browser is too old.
- **Changed.** Phones get their own layout: a bottom tab bar (Home, Movies, TV, Music, More), a compact top bar, filters that scroll sideways instead of filling the screen, two-column grids and tidy detail pages and download rows.
- **Changed.** The assistant button is small and fades when you scroll down, and the active-requests pill is merged into the transfers menu in the top bar, so neither covers page content.
- **Changed.** The Music page is calmer: the big empty "New playlist" tile is gone (playlists show only when you have some), and Add artist, Shuffle, New playlist and Scan sit in a compact header.
- **Changed.** One design across the dashboard. Every page now opens with the same calm header, and secondary actions sit behind a "more" menu or in a dialog, like the Music page. Movie and TV pages have a big Play or Request button, My List and a menu instead of a row of buttons; library filters are one search box, a sort and a Filters dialog.
- **Fixed.** The top bar no longer scrolls away and back; it stays put. It also fits on normal laptop screens (nine pages in the bar, the rest under More, Search as an icon).
- **Fixed.** The cast row on film and TV pages lines up with the rest of the page.
- **Changed.** Requests, Search and Downloads are one place with shared tabs. Each request shows its poster, a five-step tracker (requested, finding, downloading, filing, ready), a plain sentence about what is happening, and the one action that makes sense (Approve, Retry, Open); the rest is in a menu. Downloads open on what matters (in progress, or what needs attention), show total speed, and can pause or resume everything at once.
- **Changed.** Settings is rebuilt: a guided overview ("What do you want to do?" with live status and suggested next steps), a sidebar of eleven sections, a search box that finds a setting by what you would type, clearer names (Services, Search sources, People and requests, Network and devices, Health and repair), and an administrator-only trail of who changed what (never any secret). Old links keep working.
- **Added.** Photos: a timeline by month, folders, search, your own albums and favorites, and a full-screen viewer with swipe or arrow keys, zoom, slideshow with speed, details, and download of the original. The photo folder stays read only.
- **Added.** Live TV: favorites and recently watched per person, categories, a programme guide from XMLTV (now and next on every row, and a timeline grid), channel numbers with keyboard and digit zapping, a small picture-in-picture window, several sources, a check that hides channels that do not answer, and a sticky player on phones.
- **Changed.** Books (search the whole shelf, format filters, sort, favorites), Wiki (a two-step start, reader with a toolbar), Apps (a tile per app with status and one Open button), Statistics (what needs a look, a stacked storage bar), Themes and Account (profile card, quick links, devices) use the same design.
- **Fixed.** Downloads that nobody shares ("stalled with no connections") or that finish but cannot be matched to their title ("Couldn't find similar album") sat in the queue for ever, because Radarr, Sonarr and Lidarr never give up on them. A new download doctor checks the queue every five minutes and, after a wait (about 45 minutes for a dead release, 20 for unmatched files), rejects the release so it is never picked again and searches for another. It never acts while the downloader or VPN is down, leaves problems a new release cannot fix (full disk, permissions) to a person, replaces a title at most three times a day, and tells administrators in the bell. The Downloads page now explains each stuck download in plain words, says when it will be replaced, and has a **Fix stuck now** button. It can be turned off under Settings.
- **Changed.** Scrollbars are slim and quiet everywhere; sideways rows (cast, categories, formats) get an arrow at each end on a computer, so Live TV categories can be reached without a touchpad. The three-dots buttons are round, matched in size, and their menu is a sheet above the tab bar on phones. Buttons in Settings keep the size of their words. "TV" is now "TV shows" and "Live" is "Live TV".
- **Added.** The theme creator shows a live copy of the app that updates as you change anything, and can paint the whole app with the theme while you edit (yours comes back when you leave).
- **Fixed.** The three-dots menu was cut off inside a hero or card, and its dots sat off-centre. The menu is now drawn above the page, opens upward when there is no room below, and the dots are centred in a round button everywhere.
- **Changed.** Live TV's player pane is larger (and has a Bigger player button); the theme creator's preview stays in view while you scroll the settings; the Restart buttons' "helper is off" message now says plainly what it is and how to turn it on, and docs/services-helper.md explains the Podman sleep case.
- **Added.** A tab that stays open across an update now says "A new version of virtuallyView is ready" with a Reload button, instead of quietly running the old page.
- **Changed.** Live TV shows a LIVE badge when the picture is at the live edge, "N s behind · Go live" when it is not, and "Recording" when a stream is not live at all. Sport channels say that free public sport channels usually replay classic events, and that a race weekend happening right now is normally on a paid broadcaster.
- **Fixed.** A movie, show or artist that was still being requested or downloaded could not be removed: the page sometimes carried the request's id ("request-110") instead of the library id, so the media manager refused the delete. The library list no longer shows a second placeholder row for a title that is already in the media manager (it now matches by the linked id, and ignores "The" in titles), and removing a title now handles either id, stops and removes its running downloads first (so they do not keep going with nothing to import into), and drops the requests that pointed at it.
- **Fixed.** Removing a show that was downloading left its torrents running in qBittorrent: Sonarr's own queue view lists only a page of rows, so most were missed. Removing a title now also finds its torrents in the download client by the title they belong to, and stops them (deleting their partial files when "delete files" is chosen).
- **Added.** `scripts/title-backup.mjs` backs up and restores one TV show: its files, checksums, how Sonarr tracks it, monitored episodes and watch progress, and proves the restore by checking every file. See docs/administration.md.
- **Added.** Use folders on your computer for the library: set `MOVIES_DIR`, `TV_DIR` and `MUSIC_DIR` in `.env` and the apps use them (default unchanged: Docker-managed storage). Before this there was no folder to put existing files in. See docs/existing-media.md; Settings, Library and quality now explains it too.

