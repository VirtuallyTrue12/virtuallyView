# Start and stop buttons (the helper)

Settings can start and stop the stack's services, but the dashboard itself has no Docker access on purpose. The buttons work through a small optional container, the helper.

```
docker compose --profile helper up -d
```

On rootless Podman, first enable the user socket and point the helper at it (see [updates](updates.md)):

```
systemctl --user enable --now podman.socket
DOCKER_SOCK=/run/user/$(id -u)/podman/podman.sock docker compose --profile helper up -d
```

## What it can and cannot do

- It can **start, stop and restart** a fixed list of this stack's own services (Radarr, Sonarr, Prowlarr, Lidarr, Bazarr, qBittorrent, NZBGet, FlareSolverr, Ollama, Tor, Kiwix, Audiobookshelf, Kavita, Immich), only within this Compose project.
- It cannot create containers, run commands, mount anything, or touch the dashboard, the VPN container, or anything outside the list.
- Only the dashboard can call it: it writes a random token into a volume shared with the app, and refuses every request without it. The port is not published on your machine.
- Only administrators can use the buttons.

The helper still holds the container socket, which is powerful on its own, so it is off by default. If you do not turn it on, the buttons explain how and nothing else changes; you can always use `docker compose` yourself.

It cannot pull images or apply updates; for that see [automatic updates](updates.md).
