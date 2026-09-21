# Requests

The request pipeline lets a title flow from a plain request all the way into your library, backed by the real service - Radarr for movies, Sonarr for TV, Lidarr for artists - not a simulation.

## Statuses

| Status | Meaning |
| --- | --- |
| `pending` | Created but not yet sent to the service (only reachable via a retried failure) |
| `searching` | Added to Radarr/Sonarr/Lidarr, which will search when an indexer is configured in Prowlarr |
| `downloading` | Found in the service's real download queue |
| `importing` | The service is moving the completed download into the library |
| `available` | The service reports the file is present. Now appears in Movies/TV/Music. |
| `failed` | The service rejected the add (see `message` on the request for why) |
| `cancelled` | Manually cancelled |

## Lifecycle

1. A request is created with `POST /api/requests`, with an optional `mediaType: 'movie' | 'series' | 'artist'` (defaults to `movie`). This determines which service handles it: `movie` > Radarr, `series` > Sonarr, `artist` > Lidarr.
2. `createRequest` checks the target service's real library first - a title already there is rejected with `400`, not duplicated.
3. The request is immediately added to the real service via its API (`adapter.add()`), which also triggers Radarr/Sonarr/Lidarr's own search if an indexer is configured in Prowlarr. A real failure (say, the service is offline, or its lookup found no match) marks the request `failed` with a human-readable `message` - it is never silently swallowed.
4. A background sync (`syncRequestsWithServices` in `apps/server/src/services/requests.ts`, every 15 seconds) reconciles every in-flight request against that service's real queue and library state - not a timer simulating progress. Requests are grouped by media type so each service is only polled once per tick.
5. When a request's title shows up in the service's library as available, the request itself flips to `available` and a corresponding entry appears in the unified download center via `syncDownload`.

## Where they surface

- `GET /api/requests` and the web Requests page, with approve and cancel actions
- The AI assistant: `list_requests`, `request_movie` / `request_series` / `request_artist` (all confirmation gated), and `cancel_request` (confirmation gated)
- The Search page: when a query has no local results, pick a media type (Movie/TV Show/Artist) and request it directly
- The Movies, TV Shows, and Music pages each have a "Request a title" button that sends you to Search rather than a blind title/year form - there's no way to request something without first confirming what you're actually requesting

## Backend layout

```
apps/server/src/services/requests.ts   Store, per-service adapter routing, real-queue sync
apps/server/src/routes/requests.ts     HTTP surface
apps/server/src/routes/integrations.ts Service health feed
```

## A note on timeouts

Radarr/Sonarr/Lidarr's lookup endpoints proxy live to TMDb/TVDb/MusicBrainz respectively, and a broad or popular title can take several seconds to resolve. The adapters use a 20-second timeout on lookup calls specifically (other calls stay at 4 seconds) - if you see request creation time out, that's the setting to revisit in `packages/integrations/src/adapters/{Radarr,Sonarr,Lidarr}Adapter.ts`.
