# API

The web app is a client of this API. Every route lives under `/api`, returns JSON unless noted, and needs a signed-in session cookie (`vv_session`) except health, metrics and the auth status/login/signup/backdrop routes.

Administrators only: server settings, integration and service configuration, download control, themes, library scan, quality changes, and deleting titles. Everything else works for any signed-in user. Watch progress, My List and watched marks are stored per user.

Errors use `{ "message": "..." }` with a matching HTTP status. Requests for an ambiguous title return `409` with a `candidates` list (see [requests](requests.md)).

The list below is generated from the route definitions in `apps/server/src`. Read the source for request and response shapes.

## Sign-in and accounts

- `GET /api/health`
- `GET /api/metrics`
- `GET /api/auth/status`
- `POST /api/auth/login`
- `POST /api/auth/signup`
- `POST /api/auth/logout`
- `GET /api/auth/backdrop`
- `GET /api/auth/users`
- `POST /api/auth/users`
- `POST /api/auth/users/:id/role`
- `DELETE /api/auth/users/:id`
- `POST /api/auth/users/:id/password`
- `POST /api/auth/password`
- `GET /api/auth/sessions`
- `POST /api/auth/sessions/revoke-others`
- `DELETE /api/auth/sessions/:id`

## Activity

- `GET /api/activity`

## Assistant

- `GET /api/ai/health`
- `GET /api/ai/models`
- `POST /api/ai/pull`
- `GET /api/ai/pull/:model/status`
- `GET /api/ai/tools`
- `GET /api/ai/permissions`
- `POST /api/ai/permissions`
- `GET /api/ai/history`
- `POST /api/ai/chat`

## Artist artwork

- `GET /api/artists/:id/covers`
- `POST /api/artists/:id/covers`
- `DELETE /api/artists/:id/covers`

## Backup and restore

- `GET /api/backup`
- `POST /api/backup`
- `GET /api/backup/:name`
- `DELETE /api/backup/:name`
- `POST /api/backup/:name/restore`
- `POST /api/backup/restore`

## Home

- `GET /api/dashboard`

## Diagnostics

- `GET /api/diagnostics`

## Downloads

- `GET /api/downloads`
- `POST /api/downloads/:id/{pause|resume|remove|delete-files}`

## Indexers and setup

- `GET /api/indexers`
- `GET /api/indexers/catalog`
- `POST /api/indexers`
- `POST /api/indexers/:id/test`
- `DELETE /api/indexers/:id`
- `GET /api/setup/status`

## Integrations

- `GET /api/integrations`
- `GET /api/integrations/detect`
- `POST /api/integrations/:adapter/toggle`
- `POST /api/integrations/:adapter/config`

## Library and search

- `GET /api/movies`
- `GET /api/movies/:id`
- `GET /api/series`
- `GET /api/artists`
- `GET /api/series/:id`
- `GET /api/series/:id/episodes`
- `GET /api/artists/:id`
- `DELETE /api/movies/:id`
- `DELETE /api/series/:id`
- `DELETE /api/artists/:id`
- `GET /api/media/:id/trailer`
- `GET /api/search`
- `GET /api/search/suggestions`
- `GET /api/media/:id/verify`
- `GET /api/media/:id/description`
- `GET /api/movies/:id/cast`

## Music streaming

- `GET /api/artists/:id/albums`
- `GET /api/artists/:id/tracks`
- `GET /api/albums/:id`
- `GET /api/music/stream/:id`

## Notifications

- `GET /api/notifications`
- `POST /api/notifications/read`
- `POST /api/notifications/test`

## Sign-in, profile and limits

- `POST /api/auth/quickconnect/start` and `GET /api/auth/quickconnect/poll?secret=` (public, used by the device being signed in)
- `POST /api/auth/quickconnect/approve` with `{ code }` (signed in)
- `POST /api/auth/profile/avatar` with `{ avatar }`, a PNG, JPEG or WebP data URL (empty clears it)
- `POST /api/auth/users/:id/limit` with `{ maxRating }` (administrator; `G`, `PG`, `PG-13`, `R` or empty)

## Music extras

- `GET /api/lyrics?artist=&title=&album=&duration=`
- `POST /api/albums/:id/search`

## Movie files

- `POST /api/movies/:id/replace-file` (administrator): blocklists the grabbed release, deletes the file and searches again. Movie details include `warnings` for a camera copy, a false label or a wrong length.
- `POST /api/requests` accepts `releaseChoice` (`wait` or `now`). For a film still in cinemas without it, the answer is `409` with `code: "unreleased"`.

## Search again, subtitles, watch together, people

- `POST /api/movies/:id/search`, `POST /api/series/:id/search` (optional `episodeId`), `POST /api/artists/:id/search`, `POST /api/downloads/:id/retry` (administrator)
- `GET /api/subtitles/languages`, `POST /api/movies/:id/subtitles/search`, `POST /api/movies/:id/subtitles/upload`, and the same under `/api/series/:id/episodes/:episodeId/subtitles/`
- `POST /api/watch-party`, `GET /api/watch-party/:code`, `POST /api/watch-party/:code/state`, `GET /api/watch-party/:code/events` (server-sent events)
- `GET /api/people/:name`

## Casting, live TV, photos, books

- `POST /api/stream-token` with `{ path }` returns a signed token for one playback path; append it as `?st=`
- `GET /api/cast/devices`, `POST /api/cast/play`, `POST /api/cast/stop`
- `GET/POST /api/live/playlists`, `DELETE /api/live/playlists/:id`, `GET /api/live/channels`, `GET /api/live/stream/:id`
- `GET /api/photos`, `/api/photos/file`, `/api/photos/thumb`; `GET /api/books`, `/api/books/file`

## Playlists

- `GET /api/playlists`
- `GET /api/playlists/:id`
- `POST /api/playlists`
- `DELETE /api/playlists/:id`
- `POST /api/playlists/:id/tracks`
- `DELETE /api/playlists/:id/tracks/:trackId`

## Watch progress

- `GET /api/progress/:mediaType/:mediaId`
- `POST /api/progress/:mediaType/:mediaId`
- `DELETE /api/progress/:mediaType/:mediaId`
- `GET /api/progress/library/:mediaType`

## Requests and quality

- `GET /api/requests`
- `GET /api/requests/candidates`
- `GET /api/requests/:id`
- `POST /api/requests`
- `POST /api/requests/:id/approve`
- `POST /api/requests/:id/cancel`
- `DELETE /api/requests/:id`
- `POST /api/requests/:id/stop`
- `GET /api/quality-profiles`
- `GET /api/quality/:mediaType/:id`
- `POST /api/quality/:mediaType/:id`

## Search

- `GET /api/search/detect`
- `GET /api/search/all`
- `GET /api/search/cover`

## Server settings

- `GET /api/server-settings`
- `POST /api/server-settings`
- `GET /api/server-settings/proxy-test`
- `GET /api/onboarding`
- `POST /api/onboarding`

## Bundled services

- `GET /api/services/status`
- `GET /api/services/config`
- `POST /api/services/launch`
- `GET /api/services/check-update`
- `POST /api/services/stop/:service`
- `POST /api/services/start/:service`

## Video streaming

- `GET /api/stream/episode/:id`
- `GET /api/stream/episode/:id/subtitles`
- `GET /api/stream/episode/:id/embedded/:index`
- `GET /api/stream/:id/embedded/:index`
- `GET /api/stream/episode/:id/subtitle/:file`
- `GET /api/stream/:id`
- `GET /api/stream/:id/subtitles`
- `GET /api/stream/:id/subtitle/:file`
- `GET /api/stream/episode/:id/info`
- `GET /api/stream/episode/:id/transcode`
- `GET /api/stream/:id/info`
- `GET /api/stream/:id/transcode`
  (add `&burn=N` to draw picture subtitle stream N onto the video; `audio`, `height` and `start` work as before)

## System

- `GET /api/system/storage`

## Themes

- `GET /api/themes`
- `GET /api/themes/active`
- `GET /api/themes/:id`
- `POST /api/themes/:id/activate`
- `POST /api/themes/import`
- `DELETE /api/themes/:id`

## My List and library scan

- `GET /api/me/flags/:mediaType/:mediaId`
- `POST /api/me/flags/:mediaType/:mediaId`
- `POST /api/library/scan`
