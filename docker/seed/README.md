# Seed configuration

These files are copied into each service's config volume the first time it starts, so `docker compose up -d` brings up a fully connected stack with no manual setup: Radarr, Sonarr, Prowlarr, Lidarr and qBittorrent are pre-configured, and the dashboard connects to all of them automatically.

They are only copied in if the target config file does not already exist (see the `*-init` services in `docker-compose.yml`), so editing settings inside the running apps later is safe and persists normally.

## API keys are generated for each install

The seed files carry **no keys**. On first boot a one-shot service (`secrets-init`, see `docker/secrets-init.sh`) writes one key per service into a `secrets` volume, and the services read theirs from it (`FILE__RADARR__AUTH__APIKEY` and so on); the dashboard, the health checks and the setup script read the same files. For each service it uses, in order:

1. a key already in the `secrets` volume (so nothing changes on a rerun);
2. a key you set in `.env` (`RADARR_API_KEY`, `SONARR_API_KEY`, `PROWLARR_API_KEY`, `LIDARR_API_KEY`, `BAZARR_API_KEY`);
3. the key an existing install already has in its config, so upgrading never locks the dashboard out of a running stack;
4. a new random key.

So a new install has keys nobody else has. An install that was created before this keeps its earlier keys, which were the published defaults `a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4` (Radarr) and so on: if you have one, treat them as public until you replace them. To replace them, back up (Settings > Backup), remove the stack and its volumes, and start again.

To read a key: `docker compose exec app cat /secrets/radarr` (or `sonarr`, `prowlarr`, `lidarr`, `bazarr`).

## qBittorrent

qBittorrent is seeded with the login `admin` / `adminadmin` and only accepts connections from this machine and the stack's private network (its port is published on `127.0.0.1` only). Change the password in its own WebUI (Tools > Options > Web UI) if other people use this machine, then update the same password in Settings > Services. It is the one credential that is still a shared default.

## Why these containers run as root (PUID=0/PGID=0)

Docker/Podman volume permissions vary enough across host setups (and are outright unreliable under some rootless Podman configurations - `chown` can report success without persisting) that matching a non-root PUID/PGID reliably on first boot isn't realistic to guarantee for everyone. Running as root inside each container sidesteps that class of problem entirely - this is still normal container isolation (root inside the container is not root on your host), the same tradeoff most quick-start self-hosted Compose stacks make. If you'd rather run as an unprivileged user, set `PUID`/`PGID` on the relevant services in `docker-compose.yml` to your host user's ids (`id -u` / `id -g`) and make sure any bind-mounted directories you point them at are owned by that same user first.
