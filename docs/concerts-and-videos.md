# Concerts and music videos

Download a concert or a music video (for example "Foo Fighters - Live at Wembley 2008") and it files itself under the artist. Nothing to click.

## What happens

1. Every minute the dashboard looks at finished downloads in qBittorrent that Radarr, Sonarr and Lidarr do not manage.
2. If the name says concert ("live at", "in concert", "unplugged", "tour", "festival") or music video ("music videos", "video collection"), and it holds a video file, it is picked up. Episodes ("S01E02") and ordinary films are ignored.
3. The artist is worked out from the name and checked against your library and the music database. **If the artist is new, they are added to the library without downloading any albums.**
4. The files are moved to `<artist folder>/Concerts` (or `/Videos`) and keep seeding from there.
5. The artist page shows a **Concerts** and a **Videos** section, and they play in the normal player (seek preview, audio tracks, live conversion for formats a browser cannot play).

## When it cannot tell who the artist is

A name like "Rock Concert 2019 1080p" has no artist in it. The download waits, and administrators see **Which artist is this?** at the top of the Music page. Type the artist, press **File it**, and it is filed (and the artist created if new).

## Notes

- The filing runs only for downloads that finished. Half-finished ones are left alone.
- A wrong guess is never made silently: a name is used only when it closely matches a real artist.
- qBittorrent needs the music volume mounted; `docker-compose.yml` does this. On an existing install run `docker compose up -d` once after updating.
- Each artist folder must be one Lidarr knows about. Files placed by hand into `Concerts` or `Videos` inside an artist's folder show up too.
