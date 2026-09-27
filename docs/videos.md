# Videos

Search and watch YouTube through **Invidious**, an open-source private front end: no ads, no account, and Google never sees your browser. Open **Videos** in the top bar.

- **Search** looks up videos through the video service and shows them as a grid.
- Press one to **play** it in an embedded player.
- **History** remembers what you played, kept only in this server's own database — nothing about your history is sent anywhere. History stays usable even while the video service itself is off.

## Turning it on

Videos needs a video service to talk to. Two ways:

### Bundled (self-hosted)

```
docker compose --profile invidious up -d
```

This starts Invidious itself, its database, and **Invidious companion** (handles YouTube's own anti-bot challenge; without it, search still works but nothing will actually play). Needs roughly 2 GB of RAM.

**Read this before relying on it.** Invidious works by having its own server ask YouTube for videos on your behalf, and YouTube actively tries to block that. A small, personally-run instance is the case most likely to get rate-limited or blocked outright — this is a known limitation of the project, not something this stack can fix. A busy public instance blends in better.

Two keys in `.env` are worth setting to real random values before relying on this for more than a try:

```
INVIDIOUS_HMAC_KEY=<any string>
INVIDIOUS_COMPANION_KEY=<exactly 16 letters/numbers, e.g. from: pwgen 16 1>
```

Defaults are provided so it works out of the box; they are not secret and are fine to leave as-is on a private home network.

### A public instance instead

Skip the `invidious` profile and set in `.env`:

```
INVIDIOUS_URL=https://<a-public-instance>
```

See [the list of public instances](https://docs.invidious.io/instances/) and pick one you trust. Playing a video then connects your browser to that instance directly (the same way it would for the bundled one, just on someone else's server instead of your own).

## Trailers

When Videos is turned on, movie and TV trailer lookups (on the Home hero and title pages) try it first — a real search API is sturdier than screen-scraping a YouTube results page — and fall back to the old method if it is off or unreachable. Nothing else changes.

## Privacy, precisely

- **Search** goes through your server (the browser never talks to the video service or YouTube for it).
- **Playing** a video connects your browser directly to the video service, so it can send you the stream. That is the bundled instance on your own network by default, or the public instance you chose.
- **History** never leaves this server; it is not sent to Invidious, YouTube, or anywhere else.
- The embedded player is sandboxed (`allow-scripts allow-same-origin allow-presentation allow-popups`, no referrer sent) so a compromised or malicious instance cannot reach outside its own frame.
