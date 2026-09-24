# Compatibility

What is known to work, what is expected to, and what is not there. "Tested" means run by the project (automated tests or by hand on the maintainer's machine); "expected" means it should work from how it is built, with nobody having confirmed it. Reports of either kind are welcome.

## Running it

| Setup | Status |
| --- | --- |
| Podman (rootless) on Linux x86-64, Compose 2.x provider | Tested (the maintainer's machine, the whole stack) |
| Docker Engine with Compose 2.24 or newer, Linux x86-64 | Expected. CI builds the image and checks its contents; the full stack is not run in CI |
| Linux ARM64 (Raspberry Pi 4/5, ARM NAS) | Expected. The release image is built for `linux/arm64`; the *arr images are published for it too. Not run by the project |
| Docker Desktop (macOS, Windows) | Expected, not tested. Volume performance for large libraries is up to Docker Desktop |
| NAS platforms (Unraid, TrueNAS, Synology) | Not packaged. The Compose files should work where Compose does; catalog entries do not exist yet |
| From source (no Docker) | Tested. Node.js 22.5 or newer |

The stack needs about 2 GB of images, 4 GB of RAM (more with the optional assistant, Immich or the full Wikipedia library) and free disk for your media.

## Playing video

The server checks each file. If the browser can play it as it is, it is sent as it is; otherwise ffmpeg converts it on the fly (software only: no hardware acceleration yet, so a 4K conversion needs a strong CPU).

| Browser | Direct play | Notes |
| --- | --- | --- |
| Chromium-based (Chrome, Edge, Brave) | H.264 / AAC in MP4 and WebM. Tested with Chromium | MKV and HEVC are converted unless the browser reports support |
| Firefox | Expected: H.264 / AAC in MP4, VP9 / Opus in WebM | MKV is converted |
| Safari (macOS, iOS, iPadOS) | Expected: H.264 / HEVC in MP4 | Some picture-subtitle and audio-track choices need conversion |
| TV browsers (Samsung Tizen, LG webOS, Android TV) | Expected, not tested | Prefer casting if the TV browser struggles ([TV guide](tv.md)) |

Picture subtitles (PGS, VobSub) are drawn onto the video, so they only work while the file is being converted.

## Casting

| Target | Status |
| --- | --- |
| Chromecast | Implemented, not verified against hardware by the project |
| AirPlay | Implemented, not verified against hardware |
| DLNA / UPnP TVs | Implemented, not verified against hardware |

## Services it manages

Radarr, Sonarr, Lidarr, Prowlarr, Bazarr, qBittorrent and NZBGet, using the versions the bundled images ship at the time of release. Existing installs of these are supported in [existing-services mode](existing-services.md). SABnzbd, Plex and Emby are not supported. Immich, Audiobookshelf, Kavita and Kiwix are linked and health-checked, not integrated deeply.

## Known gaps

No native mobile or TV apps, no hardware transcoding, no scheduled recording or programme guide, no in-app EPUB reader, and no plugin system. See the [roadmap](roadmap.md).
