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

By default the media apps run as the container's root user. That is what makes this work with no setup on **rootless Podman** (Fedora, Arch, most Linux desktops): the container's root *is your own user*, so the folders stay yours, you can open and edit every file, and the apps can write too. Nothing to change.

On regular **Docker** (run by root) the same setting would leave root-owned files in your folders. Tell the apps to run as you instead, in `.env`, and make the folders yours:

```
PUID=1000
PGID=1000
```

Use your own ids (`id -u`, `id -g`) and run `sudo chown -R 1000:1000 "/path/to/folder"` once.

On systems with SELinux (Fedora and friends) a folder outside your home may also need a label: `chcon -Rt container_file_t "/path/to/folder"`.

## Moving a library that is already in Docker's storage

1. Stop the apps that use it: `docker compose stop sonarr radarr lidarr bazarr app` (add `ytdlp` if you use it).
2. Move the contents to your folder. On rootless Podman the storage is a normal folder you own, so a move on the same disk is instant: `mv ~/.local/share/containers/storage/volumes/<project>_media-tv/_data/* "/home/you/Videos/TV Shows/"`. On Docker use `docker cp <project>-sonarr-1:/media/tv/. "/path/"` before stopping.
3. Set `TV_DIR` (and the others) in `.env`, then `docker compose up -d`.
4. Files appear in the library only once the show is added; see the next section, or the one-click **Find my existing media** on the Movies, TV and Music pages.

To keep one show safe while you move things around, or to bring one back, see `scripts/title-backup.mjs` in [administration](administration.md); `restore <backup> --adopt` adds a show whose files are already in place.
