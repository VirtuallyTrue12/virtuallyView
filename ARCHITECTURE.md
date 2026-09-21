# Architecture

virtuallyView is a web app and an API in one repository. The API talks to the media services you run; the web app talks only to the API.

```
browser  ->  Fastify API (apps/server)  ->  Radarr / Sonarr / Lidarr / Prowlarr / Bazarr
   |                |                   ->  qBittorrent / NZBGet
   |                |                   ->  Ollama (optional assistant)
   |                +-> SQLite + JSON files in the data folder
   +-> React app (apps/web), served by the API in production
```

## Pieces

- **apps/web.** React 18 with React Router and Vite. Plain `fetch` through `src/lib/api.ts`; no client-side cache library. Theme values come from CSS variables, never from hard-coded colours.
- **apps/server.** Fastify. Routes in `src/routes`, logic in `src/services`. It serves the built web app, so production is one process on one port.
- **packages/integrations.** One adapter per external service behind a common interface (`getItems`, `add`, `remove`, `getQueue`, ...). Routes and services never call a service directly. This is also where request identity is resolved: a title is only added when the metadata lookup gives an unambiguous match, otherwise the caller gets candidates to choose from.
- **packages/themes.** Theme token schema, validation and the flattening to CSS variables.
- **packages/ai.** Assistant provider contract and tool registry.
- **themes/.** Bundled theme packages (`theme.json` plus `tokens.json`).

## State

Everything the server owns lives in one data folder (`DATA_DIR`, `/app/apps/server/data` in the container):

| File | Contents |
| --- | --- |
| `app.sqlite` | Requests, per-user watch progress and favorites, server settings, cast cache, artist covers, playlists |
| `users.json` | Accounts (salted hashes only) |
| `sessions.json` | Signed-in sessions |
| `integrations.json` | Service URLs and API keys |
| `custom-themes/` | Themes you import or create |

Back up that folder. Do not publish it.

## Requests

`POST /api/requests` resolves the title against the service's metadata lookup, checks whether the library already has it, adds it to Radarr, Sonarr or Lidarr with the chosen quality profile, and stores a request row. A background loop compares each open request with the service's library and queue every 15 seconds and moves it through searching, downloading, importing and available. The Requests and Downloads pages read the same queue, so they agree.

## Playback

`/api/stream/:id` serves the file with range requests. `GET /api/stream/:id/info` probes it with ffprobe. If the browser cannot decode the container or codec, the player switches to `/api/stream/:id/transcode`, which runs ffmpeg to fragmented MP4 (video is remuxed instead of re-encoded when it is already 8-bit H.264). Seeking a converted stream restarts ffmpeg at the new position. Subtitles come from sidecar files and from text tracks inside the file, converted to WebVTT.

## Accounts

The first account is the administrator. Sessions are random tokens in an HttpOnly cookie. A per-request user context lets services read per-user data without passing the user around. Server settings, service configuration, downloads control, themes and deletes are administrator-only.

## Appearance

A theme is tokens: colours, radius, motion, type and an `effects` group (shadows, blur, backdrop gradient, button shape, card hover). The choice of mode and theme is stored per device; the server keeps only a default for new devices.
