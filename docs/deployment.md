# Deployment

Read [SECURITY.md](../SECURITY.md) first: this is built for a home network, and putting it on the internet needs HTTPS and your own judgement.

## Docker or Podman (recommended)

Pull the published, versioned image:

```bash
docker compose -f docker-compose.yml -f docker-compose.release.yml up -d
```

or build it from this folder (a few minutes longer the first time):

```bash
docker compose up -d
```

Either way one image (`Dockerfile`) serves the API and the built web app on port 3000 (`DASHBOARD_PORT` in `.env` changes it), together with a bundled media stack: Radarr, Sonarr, Prowlarr, Lidarr, Bazarr, qBittorrent, NZBGet and FlareSolverr. Optional pieces are separate profiles: the assistant (`--profile ai`, about 5 GB), Kiwix, Tor, the service-control helper, automatic updates and the extra apps.

On first boot the services get their own generated API keys and are connected to each other and to the dashboard automatically; see [docker/seed/README.md](../docker/seed/README.md). Bazarr is wired the same way. A short starting set of search sources is added; adding more is an explicit choice (Settings > Indexers, [acceptable use](acceptable-use.md)).

The app has a readiness check (`/api/ready`) and a Compose healthcheck; `docker compose ps` shows `healthy` when it is up.

To re-run the one-time wiring if it did not finish on first boot:

```bash
docker compose run --rm provision
```

## Services you already run

Start only the dashboard and connect your existing services: see [using services you already run](existing-services.md).

```bash
docker compose up -d --no-deps app
```

## From source

```bash
npm install
npm run build
npm start --workspace=apps/server
```

Requires Node.js 22.5 or newer. `npm start` runs the server via `tsx` directly from source and serves the built `apps/web/dist`. Connect the services under Settings > Services, or set the same `RADARR_URL`/`RADARR_API_KEY`-style environment variables the Compose file uses (a `..._API_KEY_FILE` variable reads the key from a file).

## Data and backups

Application state lives in `apps/server/data/` (the `app-data` volume in Docker): account, session and integration files plus an SQLite database (`app.sqlite`) for settings, requests and progress. Settings > Backup makes a consistent archive of everything worth keeping (sessions are left out on purpose); backups contain accounts and service keys, so keep them private. The media stack's own settings live in their own volumes. `VV_SECRET_KEY` optionally encrypts stored service keys and notification tokens (see [SECURITY.md](../SECURITY.md)).

## Reverse proxy and HTTPS

Put the dashboard (port 3000) behind a reverse proxy for TLS: [HTTPS](https.md) has a ready Caddy overlay. The app believes forwarded addresses only from a proxy you name, through `TRUST_PROXY` (the Caddy overlay sets it). The bundled services and download client are meant to stay on your private network and are published on this machine only; do not expose them to the internet.

## Photos and books

The app mounts two extra folders read only: `/media/photos` and `/media/books` (volumes `media-photos` and `media-books`). To use your own folders, change those volumes in `docker-compose.yml` to bind mounts, for example `/home/you/Pictures:/media/photos:ro`.

## Updating

Pull the new version and run the same command again. Optional automatic updates are described in [updates](updates.md).
