# Security

## Reporting a problem

Open a private security advisory on the repository, or email the maintainer if an address is listed on the project page. Please do not file public issues for vulnerabilities. Include what you found, how to reproduce it and what it lets someone do.

## What to know before you run it

- **Service keys are generated for each install.** New installs get random Radarr, Sonarr, Prowlarr, Lidarr and Bazarr keys; installs made before 0.2.0 keep their earlier, published default keys until replaced. qBittorrent still uses the shared default login `admin` / `adminadmin`, so it stays bound to this machine only; change it if others use the machine ([docker/seed/README.md](docker/seed/README.md)). Do not expose these ports to the internet.
- **The first account is the administrator.** Create it before anyone else can reach the server. Later sign-up is closed unless you turn it on under Settings > Server.
- **Passwords are short by design.** This is meant for a home network, so the minimum is four characters. They are stored with salted scrypt, not readable from the data folder. Use a longer one if the server is reachable from outside.
- **Sign-in attempts are rate limited** per address. The server has no TLS of its own: put it behind a reverse proxy with HTTPS before exposing it beyond your network ([docs/https.md](docs/https.md)). It only believes forwarded addresses from a proxy you name (`TRUST_PROXY`).
- **What is stored, and how.** `users.json` holds password hashes; `sessions.json` holds only hashes of session tokens; `integrations.json` and the notification settings hold service keys and webhook tokens. These are readable by the server only. If you set `VV_SECRET_KEY`, the keys and tokens are stored encrypted with a key that is not in the data folder or in backups. Without it they are plain text, so treat the data folder and every backup as sensitive.
- **Backups contain accounts and service keys.** They leave sessions out and are readable by the server only, but they are not encrypted as a whole.
- **Locked out?** `npm run admin -- reset-password <username>` works on the machine itself, so protect access to it.
- **Regular people cannot change server or service settings, see where services live, or delete titles.** Only administrators can, including through the assistant.
- **Start and stop buttons need a helper.** It is off by default because it holds the container socket; it can only start, stop or restart a fixed list of this stack's services ([docs/services-helper.md](docs/services-helper.md)).
- **Home-network services are off by default.** Connecting a service on another machine needs "Trust services on my home network" (Settings > Server). This machine itself and link-local addresses are never allowed.
- **Rights.** See [docs/acceptable-use.md](docs/acceptable-use.md).

## How it protects itself

- Service API keys are stored on the server and never sent back to the browser in full.
- Requests to services only go to the URLs an administrator configured.
- Media files are only served from the configured media folders, and an age limit applies to every playback route, episodes included.
- Theme files are declarative and strictly validated; no script from a theme is ever run.
- The optional assistant checks who is asking on the server, asks for confirmation before destructive actions, and each confirmation works once, for one person and one exact action.
- Signed playback and live-TV links expire; links, tokens and cookies are kept out of the logs.
- Video conversion is bounded, so a busy or hostile client cannot pin the CPU.

## Known limits

This is an early release and has not had an independent security audit. It is meant for a home network; putting it on the internet needs HTTPS, longer passwords and your own judgement. Report anything you find (see above).

## Supported versions

Only the latest release receives fixes.
