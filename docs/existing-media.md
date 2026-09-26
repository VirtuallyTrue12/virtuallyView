# Using the movies, shows and music you already have

By default the library lives in storage Docker manages for you, so there is no folder on your computer to drop files into. To use normal folders instead, set them once in a file called `.env` next to `docker-compose.yml`, then restart:

```
MOVIES_DIR=/home/you/Videos/Movies
TV_DIR=/home/you/Videos/TV Shows
MUSIC_DIR=/home/you/Music
```

```
docker compose up -d
```

You can set one, two or all three. Leave a line out and that part keeps using Docker's own storage. The apps see these folders as `/media/movies`, `/media/tv` and `/media/music`; that is what Settings, Library and quality shows, and you do not need to change it.

## Then tell the library about the files

Files in a folder do not appear by themselves. Add each title once:

1. Open **Search** (or Requests, Request a title) and find the show, movie or artist.
2. Request it. Because its folder already exists under the root folder, Sonarr, Radarr or Lidarr find the files that are there and import them, and only download what is missing.
3. For a whole folder of things at once, use **Scan library** on the Movies, TV or Music page after adding them.

Keep the layout the apps expect: one folder per title, for example `TV Shows/How I Met Your Mother/Season 1/...`, `Movies/Dune (2021)/Dune (2021).mkv`, `Music/Pink Floyd/The Wall/01 ....flac`. Rename messy files first; the apps match on the folder name.

## Permissions

The apps run as user 1000 (`PUID`/`PGID`). On Docker, make the folders yours with that id (`sudo chown -R 1000:1000 "/path"`), or set `PUID`/`PGID` in `.env` to your own ids (`id -u`, `id -g`).

On **rootless Podman** the containers' user 1000 is not your user. Give the folder to it once with:

```
podman unshare chown -R 1000:1000 "/home/you/Videos/TV Shows"
```

Your own account can then no longer edit those files directly; use `podman unshare` (for example `podman unshare cp -r "Some Show" "/home/you/Videos/TV Shows/"`) to add files.

## Moving a library that is already in Docker's storage

Copy it out first, then set the variable: `docker cp appletvopensourcce-sonarr-1:/media/tv/. "/home/you/Videos/TV Shows/"` (the same works for `-radarr-1` with `/media/movies` and `-lidarr-1` with `/media/music`). Check the copy opened fine before you delete the old volume.
