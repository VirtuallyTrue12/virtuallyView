# Using services you already run

If you already run Radarr, Sonarr, Lidarr, Prowlarr, Bazarr and a download client, you can run only the virtuallyView app and point it at them.

## 1. Start only the app

```
docker compose up -d --no-deps app
```

(Without `--no-deps` Compose also starts the bundled services.) The app opens on http://localhost:3000; create the first account, which becomes the administrator.

## 2. Allow your network

Services on another machine have addresses like `http://192.168.1.20:7878`. They are refused until you turn on **Settings > Server > Trust services on my home network**; this machine itself and link-local addresses are never accepted.

## 3. Connect each service

Settings > Services: enter the address and API key of each service (find keys in each app under Settings > General). The dashboard checks the connection before saving anything.

## 4. Give the app the same paths your services use

virtuallyView plays files by the path Radarr, Sonarr and Lidarr report, so the app must see the same folders. If Radarr says a movie is at `/movies/Dune (2021)/Dune.mkv`, the app container needs that folder at `/movies`, read-only:

```yaml
# docker-compose.override.yml
services:
  app:
    volumes:
      - /srv/media/movies:/movies:ro
      - /srv/media/tv:/tv:ro
      - /srv/media/music:/music:ro
```

Then set the same roots under Settings > Server > Media folders. If a title shows "no playable file", a path mismatch is almost always the reason.

## 5. Optional extras

Everything else (Kiwix, Tor for search, the VPN, the assistant, the helper) is separate and opt-in: see the [README](../README.md).

## Moving from the bundled stack

Take a backup first (Settings > Backup). The dashboard's own state (accounts, watch history, requests) lives in its data volume; the services keep their own settings in theirs. Point the app at the new services, then use the checklist on Home.
