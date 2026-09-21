# Seed configuration

These files are copied into each service's config volume the first time it starts, so `docker compose up -d` brings up a fully connected stack with zero manual setup: Radarr, Sonarr, Prowlarr, Lidarr, and qBittorrent all get a fixed, known API key or login, and the dashboard connects to all of them automatically using those same values.

They are only copied in if the target config file does not already exist (see the `*-init` services in `docker-compose.yml`), so editing credentials inside the running apps later is safe and persists normally.

**These are public, published default credentials, not secrets.** They exist so the stack can wire itself together on a private network. If you expose any of these services directly to the internet (not just the dashboard), change their API key or password first, in each app's own settings, then update the corresponding fields in `docker-compose.yml`.

| Service | Default | Where to change it |
| --- | --- | --- |
| Radarr | API key `a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4` | Settings > General |
| Sonarr | API key `b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5` | Settings > General |
| Prowlarr | API key `c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6` | Settings > General |
| Lidarr | API key `d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1` | Settings > General |
| qBittorrent | `admin` / `adminadmin` | WebUI > Tools > Options > Web UI |

Bazarr is not pre-seeded (its config format is less stable across versions). Open **Settings > Integrations** after the first boot:

1. Copy Bazarr's API key from its Settings > General page.
2. Save its URL and key in virtuallyView. The dashboard reports it as `setup_required` instead of silently treating an incomplete setup as a network outage.

For deployments beyond a private machine, replace every seeded Arr/qBittorrent credential before publishing any port and provide the corresponding values through a private `.env` file or secret manager. Do not commit that file.

## Why these containers run as root (PUID=0/PGID=0)

Docker/Podman volume permissions vary enough across host setups (and are outright unreliable under some rootless Podman configurations - `chown` can report success without persisting) that matching a non-root PUID/PGID reliably on first boot isn't realistic to guarantee for everyone. Running as root inside each container sidesteps that class of problem entirely - this is still normal container isolation (root inside the container is not root on your host), the same tradeoff most quick-start self-hosted Compose stacks make. If you'd rather run as an unprivileged user, set `PUID`/`PGID` on the relevant services in `docker-compose.yml` to your host user's ids (`id -u` / `id -g`) and make sure any bind-mounted directories you point them at are owned by that same user first.
