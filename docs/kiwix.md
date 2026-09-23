# Wiki (Kiwix)

[Kiwix](https://www.kiwix.org) (open source) reads ZIM files - full offline
copies of Wikipedia, Wiktionary, Project Gutenberg, StackExchange and
hundreds of other sites, with no internet connection needed once downloaded.
The Wiki page in the nav (under More) embeds Kiwix's own reader, which
already has search and browsing built in - nothing to rebuild there.

You have two options, and they aren't exclusive - use whichever fits.

## Option 1: connect to a Kiwix server you already run

If you already run `kiwix-serve` somewhere on your network (a NAS, another
machine, a Raspberry Pi), go to Wiki in the nav and enter its address, e.g.
`http://192.168.1.50:8080`. That's it - only an administrator can change this.

## Option 2: use the bundled one

```
docker compose --profile kiwix up -d
```

This starts `kiwix-serve` (the official image) with an empty data volume. It
does **not** download anything for you - Wikipedia ZIM files run from a few
hundred MB (a single-topic slice) to 100+ GB (the full multi-language
archive with images), so fetching one automatically would be a bad default.

1. Pick a ZIM file from [library.kiwix.org](https://library.kiwix.org).
2. Put it in the `kiwix-data` volume. On real Docker:
   `docker cp your-file.zim appletvopensourcce-kiwix-1:/data/`
   On Podman, the container name may differ - check with
   `docker compose ps kiwix`.
3. `docker compose restart kiwix`
4. In Wiki in the nav, connect to `http://kiwix:8080` (the container's name
   on the internal network) or `http://localhost:8888` if you're on the same
   machine.

Until you add a ZIM file, the container stays up but prints a reminder in
its logs instead of crash-looping - check with `docker compose logs kiwix`.

## Updating the library

Kiwix doesn't hot-reload new files. After adding or removing a ZIM file,
`docker compose restart kiwix` picks up the change.
