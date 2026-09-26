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

## If the Restart buttons say the helper is off

The **Troubleshooting** panel (Apps, or Settings, Health and repair) has Restart buttons for stopped services. They work only while the helper is running. If the panel says it is not, run the command above once; it keeps running after that (`restart: unless-stopped`). Add `helper` to your `COMPOSE_PROFILES` if you start the stack with a list of profiles, or the next `docker compose up` will not include it.

## After the computer sleeps or restarts

On rootless Podman, containers stop with the machine and are not started again by `restart: unless-stopped`. Turn that on once with `systemctl --user enable --now podman-restart.service`. Until then the Troubleshooting panel shows which services stopped, and (with the helper on) restarts them from the page.

The helper still holds the container socket, which is powerful on its own, so it is off by default. If you do not turn it on, the buttons explain how and nothing else changes; you can always use `docker compose` yourself.

It cannot pull images or apply updates; for that see [automatic updates](updates.md).
