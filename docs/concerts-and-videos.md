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

## When the automatic search finds nothing

Concerts and unusual titles are often named differently from how Radarr searches for them, so a request can sit on "searching" forever. Administrators can open the request on the Requests page and press **Find a release myself**: search with your own words ("Linkin Park Rock am Ring 2004"), see everything the sources have (best-seeded first), and press Download. Choose what happens when it finishes: file it under the artist as a concert or a music video, let the name decide, or just download it. Searching every source can take up to a minute.

Downloads started this way are not managed by Radarr, Sonarr or Lidarr. Concerts and videos file themselves under the artist; anything else stays in the downloads folder for you to import.

## Concerts that only exist on YouTube

Many concerts are only on YouTube. An optional service can search it and save a video under the artist:

```
docker compose --profile youtube up -d
```

Then, as an administrator, either open an artist and press **Find concerts and videos on YouTube**, or open a request and use the **YouTube** tab of **Find a release myself**. Pick a result and press Download. It is saved as a normal video file under `<artist>/Concerts` (or `/Videos`) in up to 1080p, in a format any browser plays, and the artist is created if the library has never had them. Progress shows right there, and you can cancel.

- It uses [yt-dlp](https://github.com/yt-dlp/yt-dlp), kept up to date automatically. It only ever saves into an artist's Concerts or Videos folder and answers only to the dashboard.
- Its traffic leaves from your home connection. To send it through Tor or a proxy instead, set `YTDLP_PROXY` (for example `socks5://tor:9050`) in `.env`.
- **Only save what you have the right to keep.** Many concert uploads are unofficial, and YouTube's terms restrict downloading. This is off by default for that reason, and it is yours to decide (see [rights and acceptable use](acceptable-use.md)).
