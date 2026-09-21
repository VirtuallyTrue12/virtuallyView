# Integrations

The dashboard talks to media services through a normalized adapter layer in `packages/integrations`. Every adapter implements the same contract, so the app, its AI tools, and its UI see one consistent model regardless of the underlying service. Nothing here is mock data: every adapter makes real HTTP calls to a real service, and throws a clear error when it isn't connected rather than falling back to fake results.

## Current adapters

| Adapter | Service | API base | Notes |
| --- | --- | --- | --- |
| `RadarrAdapter` | Radarr | `/api/v3` | Movies: search, add, remove, queue, history |
| `SonarrAdapter` | Sonarr | `/api/v3` | Series: search, add, remove, queue, history |
| `ProwlarrAdapter` | Prowlarr | `/api/v1` | Indexer search and status |
| `LidarrAdapter` | Lidarr | `/api/v1` (not v3 - confirmed against a real instance) | Artists/albums: search, add, remove, queue, history |
| `BazarrAdapter` | Bazarr | plain `/api` (no version prefix) | Missing-subtitle status, search, download. Has no media of its own - it manages subtitles for existing Radarr/Sonarr items |
| `QBittorrentAdapter` | qBittorrent | `/api/v2` | Torrent download client. Authenticates via a session cookie from username/password, not an API key - the config's "API key" field holds `username:password` |
| `NZBGetAdapter` | NZBGet | `/jsonrpc` | Usenet download client. The config's "API key" field holds `username:password` |

`SABnzbd`, `Plex`, and `Emby` are listed in the integrations feed as "not yet supported". They appear so the UI shows what is missing, but have no adapter behind them.

## Docker auto-provisioning

The bundled `docker-compose.yml` provisions both qBittorrent and NZBGet as download clients for Radarr, Sonarr, and Lidarr. Both use priority 1, so Arr can select the first acceptable result returned by its configured indexers; quality profiles still determine whether a result is acceptable. Usenet indexers and provider credentials must be configured in Prowlarr/NZBGet by the operator.

## Live health feed

`GET /api/integrations` reports current health for every adapter plus the "not yet supported" placeholders. The Settings page renders this as status chips with a URL/API-key form for the real adapters, and the AI `library_status` tool reads the same underlying adapters.

## Adapter contract

Adapters live in `packages/integrations/src/adapters/<Service>Adapter.ts` and implement `IntegrationAdapter<Config>` from `packages/integrations/src/adapter-interface.ts`:

- `connect(config)` / `disconnect()`: store or clear connection config
- `healthCheck()`: verify connectivity and credentials fast, without throwing
- `getStatus()`: return a normalized `IntegrationStatus` (`healthStatus: "online" | "offline"`)
- `search(query)` / `getItems()` / `getItem(id)`: media reads - throw when not connected
- `add(input)` / `remove(mediaId)`: write operations - return `{ success, message }`, never a fabricated success
- `getQueue()` / `refreshMetadata()` / `getHistory()`: the rest of the interface

`MediaStatus` values are lowercase and shared across every adapter (`available`, `missing`, `requested`, `downloading`, `importing`, `paused`, `failed`, `offline`, `unknown`) - see `packages/types/src/index.ts`.

## Adding a new adapter

1. Create `packages/integrations/src/adapters/<Service>Adapter.ts`.
2. Implement the `IntegrationAdapter<Config>` contract against the service's real API - check its actual API version and base path first (Lidarr's v1-not-v3 is a good reminder not to assume).
3. Throw clear errors when unconnected or when a request fails; never return fabricated data.
4. Export it from `packages/integrations/src/index.ts`.
5. Register it in `apps/server/src/services/registry.ts` and give it a display name/default URL in `apps/server/src/routes/integrations.ts`.

## Security rules

- URLs are restricted to user-configured endpoints only
- Adapter code must never log API keys or request bodies containing credentials
- Failed connections return clear, user-readable explanations, never raw HTTP codes
- `apps/server/data/integrations.json` (real credentials) is gitignored and excluded from the Docker build context (`.dockerignore`)
