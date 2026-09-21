# Troubleshooting

## The server will not start

- Port 3000 is already in use. Stop whatever holds it, or set `PORT`.
- Run `npm run typecheck` to catch a broken build.
- In Docker or Podman, `docker compose logs app` shows the startup error.

## The web app shows no data

The Vite dev server proxies `/api` to http://localhost:3000. Check the API is up:

```bash
curl http://localhost:3000/api/health
```

Libraries are empty until Radarr, Sonarr or Lidarr are connected. Settings > Integrations shows which services answer, and Diagnostics explains why one does not.

## Requests fail

- **"answered with a web page instead of data"**: the service is down, still starting, or its URL or API key is wrong. Check Settings > Integrations.
- **"Multiple metadata results match"**: pick the exact title from the list that opens; the request is not sent until you do.
- **Nothing downloads**: Prowlarr has no indexers, or qBittorrent is not reachable from Radarr and Sonarr. The Downloads page shows what the download client reports.

## A file will not play

The player converts most formats with ffmpeg. If it says conversion is unavailable, ffmpeg is missing on the server (the Docker image includes it; for a source install, install ffmpeg and ffprobe). Image-based subtitles (PGS, VobSub) cannot be shown.

## Trailers, cast photos or covers are missing

The server could not reach TMDB, YouTube or MusicBrainz. Check its DNS and internet access, and the outbound proxy setting under Settings > Server.

## The assistant shows Offline

It needs Ollama:

```bash
ollama serve
ollama pull qwen2.5:0.5b
curl http://127.0.0.1:11434/api/tags
```

## I forgot the administrator password

Stop the server, delete `users.json` and `sessions.json` from the data folder, start it and create the first account again. Requests, progress and settings are kept.

## Podman (rootless)

- **The site does not open after a reboot** while `docker compose ps` shows the app running: containers that start at boot can come up before podman's rootless network is ready and never get their port forwarder. Run `docker compose up -d` once. Nothing is lost.
- **Lookups fail while everything else works**: the container has no working DNS. The compose file sets `dns: [1.1.1.1, 8.8.8.8]` on every service; keep it if you edit the file.
- **A container stays unhealthy and recreate fails with "conmon exited prematurely"**: remove it with `podman rm -f <name>` and run `docker compose up -d <service>`. Configuration lives in named volumes, so it survives.
- **Two copies of a service**: `podman ps -a` should list each service once. A leftover container from an older setup keeps the host port and answers with the wrong API key (HTTP 401). Remove it.

## A friend cannot open my address (timeout)

The server answers on your own network but not from outside. See [reaching your server from outside your home](remote-access.md): usually a missing port forward, a firewall, or your provider's carrier-grade NAT.

## Albums or episodes downloaded but nothing shows

Open Downloads. An item that finished but could not be imported says why, in plain words, and has a Retry button. The usual causes are file renaming being off (fixed in new installs; on an old one, turn on Rename Tracks in Lidarr under Settings > Media Management) and a release that does not match the wanted album closely enough.
