# Security

## Reporting a problem

Open a private security advisory on the repository, or email the maintainer if an address is listed on the project page. Please do not file public issues for vulnerabilities. Include what you found, how to reproduce it and what it lets someone do.

## What to know before you run it

- **The bundled stack ships public default keys.** The Radarr, Sonarr, Prowlarr and Lidarr API keys and the qBittorrent login in `docker/seed/README.md` are known to everyone. Change them, and do not expose those ports to the internet.
- **The first account is the administrator.** Create it before anyone else can reach the server. Later sign-up is closed unless you turn it on under Settings > Server.
- **Passwords are short by design.** This is meant for a home network, so the minimum is four characters. Use a longer one if the server is reachable from outside.
- **Sign-in attempts are rate limited** per address, but the server has no TLS of its own. Put it behind a reverse proxy with HTTPS before exposing it beyond your network ([docs/https.md](docs/https.md)); the session cookie is then marked `Secure` automatically.
- **Backups contain accounts and service keys.** Treat a backup file like the data folder itself.
- **Locked out?** `npm run admin -- reset-password <username>` works on the machine itself, so protect access to it.
- **The data folder holds secrets.** `users.json`, `sessions.json` and `integrations.json` contain password hashes, session tokens and service API keys. Keep the folder out of backups you share and out of version control.
- **Regular users cannot change server or service settings or delete titles.** Only administrators can.

## How it protects itself

- Service API keys are stored on the server and never sent back to the browser in full.
- Requests to services only go to the URLs an administrator configured.
- Media files are only served from the configured media folders.
- Theme files are declarative values; no script from a theme is ever run.
- The optional assistant asks for confirmation before destructive actions, and its permission level is set by an administrator.

## Supported versions

Only the latest release receives fixes.
