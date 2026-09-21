# Normalized Data Models

These models are used throughout the application. External service data is mapped to these before reaching the UI.

---

## MediaStatus Enum

```
Available | Missing | Requested | Downloading | Importing | Paused | Failed | Offline | Unknown
```

Every adapter maps its internal status to one of these.

---

## RequestStatus Enum

```
Pending | Approved | Searching | Downloading | Importing | Available | Failed | Cancelled
```

This represents the unified request flow across all services.

---

## DownloadStatus Enum

```
Queued | Active | Completed | Failed | Paused | Removed
```

---

## IntegrationHealth Enum

```
Healthy | Degraded | Offline | Unknown
```

---

## MediaType Enum

```
Movie | Series | Season | Episode | Album | Track | Artist
```

---

## Key Model Fields

### Media (base)

- `id`: string (application-level identifier, can map to external ID)
- `title`: string
- `originalTitle`: string (optional)
- `type`: MediaType
- `year`: number (optional)
- `status`: MediaStatus
- `quality`: string (optional, e.g., "1080p", "4K")
- `provider`: ProviderReference
- `artwork`: ArtworkSet (poster, backdrop, logo, banner URLs or paths)
- `genres`: string[]
- `rating`: number (optional)
- `overview`: string
- `createdAt`: Date
- `updatedAt`: Date

### ProviderReference

- `name`: string (radarr, sonarr, lidarr, etc.)
- `id`: number or string (external service identifier)
- `url`: string (optional, link back to original service)

---

## Relationships

```
Movie (extends Media)
  - runtime?: number
  - director?: Person[]
  - cast?: Person[]
  - studio?: string
  - releaseInfo?: string
  - fileInfo?: FileInfo
  - subtitleInfo?: SubtitleInfo

Series (extends Media)
  - seasons?: Season[]
  - nextAirDate?: Date

Season
  - number: number
  - episodes: Episode[]
  - overview?: string

Episode
  - number: number
  - title: string
  - airDate?: Date
  - progress?: PlaybackProgress
  - fileInfo?: FileInfo

Artist (extends Media)
  - albums?: Album[]

Album (extends Media)
  - artist: ArtistReference
  - tracks?: Track[]
  - releaseDate?: Date
  - audioQuality?: string

Track
  - title: string
  - number: number
  - duration?: number
  - fileInfo?: FileInfo

Person
  - id: string
  - name: string
  - role?: "director" | "actor" | "musician" | "other"
```
