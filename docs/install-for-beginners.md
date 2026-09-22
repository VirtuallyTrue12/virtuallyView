# Install for beginners

No Docker experience needed. About 15 minutes, most of it downloading.

## What you need

- A computer that can stay on: a spare PC, a mini PC, a NAS that runs Docker, or your main computer to try it.
- 8 GB of memory and about 10 GB free disk for the software. Your media needs its own space.
- Windows, macOS or Linux.

## 1. Install Docker

- **Windows or macOS:** install Docker Desktop from docker.com, start it, and wait until it says it is running.
- **Linux:** install Docker Engine and the Compose plugin from your distribution, or Podman with its Docker command. See [troubleshooting](troubleshooting.md) for Podman notes.

Check it works: open a terminal (PowerShell on Windows) and run `docker --version`.

## 2. Get virtuallyView

With Git:

```
git clone https://github.com/VirtuallyTrue12/virtuallyView.git
cd virtuallyView
```

Without Git: on the repository page choose Code > Download ZIP, unzip it, and open a terminal inside the unzipped folder.

## 3. Start it

```
docker compose up -d
```

The first start downloads several images (Radarr, Sonarr, Lidarr, Prowlarr, Bazarr, qBittorrent, NZBGet and the app) and can take 5 to 10 minutes. It wires the services together for you.

## 4. Open it

Go to http://localhost:3000. Create the first account: it becomes the administrator. Pick something you will remember, this server is yours.

## 5. Make requests find something

Settings > Indexers, then add public indexers in one click. Without an indexer, requests find nothing. Only add sources you are allowed to use.

## 6. Try it

Search for a title, request it, and watch it move from search to download to import on the Requests and Downloads pages. When it appears in your library, press Play.

## Other devices

On your phone or TV browser, open `http://<your server's address>:3000` (Settings > Server shows it) and sign in with an account you create under Settings > Users. For a TV, follow [watching on your TV](tv.md). To reach it away from home, see [remote access](remote-access.md).

## If something is wrong

- The page does not open: run `docker compose ps` and check every service is running, then read [troubleshooting](troubleshooting.md).
- Requests find nothing: add an indexer (step 5).
- Stop it with `docker compose down`. Your data stays in Docker volumes.

## Before you share it

The bundled services use public default keys and logins. Read [deployment](deployment.md) before you let anything outside your home reach them.
