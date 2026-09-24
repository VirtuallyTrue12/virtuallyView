# Automatic updates

By default, virtuallyView never updates itself or its services in the
background. You update by pulling new images and running
`docker compose up -d` yourself, whenever you choose.

If you'd rather not think about it, there's an optional profile that checks
for new images and applies them automatically, using
[Watchtower](https://github.com/nickfedor/watchtower) (open source, the
maintained fork of the original).

## Turning it on

```
docker compose --profile auto-update up -d
```

That's it. If a newer image is available for any of virtuallyView's own
containers, Watchtower pulls it, stops the old container, and starts the new
one in its place.

**When it runs:**

- **As soon as the internet is reachable.** The dashboard notices when the
  connection comes back (or when it starts up online) and asks Watchtower to
  update right then, instead of waiting for the next timer. Radarr, Sonarr,
  Lidarr, Prowlarr, Bazarr, FlareSolverr and qBittorrent go first; everything
  else follows. Admins get a notification when something was updated.
- **On a timer as a fallback**, every 6 hours by default (see below), in case
  the dashboard itself is down.

Nothing is contacted unless this profile is running: without it the
dashboard never checks for updates on its own.

The apps themselves need frequent updates less than you might think:
Prowlarr refreshes its search-source definitions on its own, and Radarr,
Sonarr and Lidarr release every few weeks to a few months.

## What this does and doesn't do

- **Fully automatic, no confirmation, no rollback.** If a new image has a
  bug, Watchtower will not know or care - it applies the update and moves
  on. If that happens to you, roll back yourself:
  `docker compose pull <service> && docker compose up -d --force-recreate <service>`
  with an older tag, or restore from Settings > Backups if the update broke
  something stateful.
- **Only touches virtuallyView's own containers.** Watchtower is scoped with
  `WATCHTOWER_LABEL_ENABLE=true`, and only the containers in this project's
  `docker-compose.yml` carry the label it looks for
  (`com.centurylinklabs.watchtower.enable=true`). It will not see or touch
  any other container running on the same machine, including ones from
  unrelated projects.
- **Your data is untouched.** Updates replace the container, not its
  volumes - config, library metadata, and downloads all persist the same way
  a manual `docker compose up -d` after a `git pull` already works today.
- **The dashboard app itself is also covered.** If you update this repo
  (`git pull`) and rebuild the image yourself, Watchtower will pick up that
  new local image the same way. It does not pull the app's own image from
  a registry, since there isn't a published one - only the *arr stack,
  qBittorrent, nzbget, Ollama and Tor come from public registries.

## Changing the check interval

Set `WATCHTOWER_INTERVAL_SECONDS` in `.env` (seconds). Default is 21600 (every
6 hours). This is only the fallback; the moment the internet is reachable an
update is triggered regardless.

## Rootless Podman

Watchtower needs access to the container engine's API socket to pull images
and replace containers. On real Docker, the default in `.env.example`
(`/var/run/docker.sock`) just works. On rootless Podman it doesn't, because
your containers run under your user's own socket, not the system one.

1. Enable it once: `systemctl --user enable --now podman.socket`
2. It prints (or you can check with
   `systemctl --user status podman.socket`) a path like
   `/run/user/1000/podman/podman.sock`.
3. Set `DOCKER_SOCK` to that path in `.env`.

## Turning it off

```
docker compose stop watchtower
docker compose rm -f watchtower
```

Nothing else changes - your containers stay exactly as they are, you just
go back to updating manually.
