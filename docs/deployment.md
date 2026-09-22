# Deployment

## Docker (recommended)

```bash
docker compose up -d
```

This is the fully supported path. It builds one image (`Dockerfile`) that serves both the API and the built web app on port 3000, and brings up a complete bundled media stack alongside it: Radarr, Sonarr, Prowlarr, Lidarr, Bazarr, qBittorrent and NZBGet. The optional AI assistant (Ollama, about 5 GB) is left out unless you start it with `docker compose --profile ai up -d`.

Radarr, Sonarr, Prowlarr, Lidarr, and qBittorrent connect to the dashboard and to each other automatically on first boot - see `docker/seed/README.md` for exactly how and what the default credentials are. Bazarr needs one quick manual step (see the main [README](../README.md#docker-recommended)), and adding indexers to Prowlarr is always manual by design.

If you already run some of these services elsewhere, start only the dashboard:

```bash
docker compose up -d app
```

and connect your existing instances by hand in Settings > Services.

To re-run the one-time wiring step (root folders, download clients, Prowlarr applications) if it didn't fully complete on first boot:

```bash
docker compose run --rm provision
```

## Manual / bare metal

```bash
npm install
npm run build
npm start --workspace=apps/server
```

`npm start` runs the server via `tsx` directly from source (not a separate compiled artifact) and serves the built `apps/web/dist` if it exists, so this single command is enough for a non-Docker production deployment too. Configure Radarr/Sonarr/Prowlarr/Lidarr/qBittorrent/Bazarr by hand in Settings > Services, or by setting the same `RADARR_URL`/`RADARR_API_KEY`-style environment variables the Docker Compose file uses (see `apps/server/src/services/registry.ts`).

## Data and backups

Application state (integration credentials, theme selection, AI settings) lives in `apps/server/data/`, a single directory of small JSON files. In Docker this is the `app-data` named volume. Back up that directory (or volume) and you have everything; there is no separate database to worry about.

## Reverse proxy / HTTPS

Put the dashboard (port 3000) behind whatever reverse proxy you already use (Caddy, Nginx, Traefik) for TLS. The bundled *arr services and download client are meant to stay on your private network - do not expose them directly to the internet without changing their default credentials first (see `docker/seed/README.md`).

## Photos and books

The app mounts two extra folders read only: `/media/photos` and `/media/books` (volumes `media-photos` and `media-books`). To use your own folders, change those volumes in `docker-compose.yml` to bind mounts, for example `/home/you/Pictures:/media/photos:ro`.
