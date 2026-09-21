# AI Tool Schemas

Every tool is registered explicitly in `apps/server/src/services/ai.ts`. The assistant never invents new functions: tool names and argument normalization are enforced by the tool registry.

## Registration

| Tool | Purpose | Permission | Confirmation |
| --- | --- | --- | --- |
| `search_movies` | Find movies in the library by title | read | no |
| `library_status` | Library, download, and integration summary | read | no |
| `list_downloads` | Current download queue | read | no |
| `pause_download` | Pause a download | manage_downloads | no |
| `resume_download` | Resume a paused download | manage_downloads | no |
| `remove_download` | Remove a download | destructive | yes |
| `list_requests` | Show open requests | read | no |
| `list_series` | Show TV library | read | no |
| `request_movie` | Create a title request | request_media | yes |
| `cancel_request` | Cancel a request | destructive | yes |

## Argument model

Tool calls arrive from the model as JSON. The registry flattens alternate argument shapes, so a tool defined as `(downloadId: string)` also tolerates the model passing `{ id: "download-003" }` or `{ "downloadId": "003" }`. IDs are normalized the same way across tools and the REST API: `003` becomes `download-003`.

## Confirmation flow

Confirmation-gated tools return the `confirmation` reply kind with the tool name, resolved arguments, and a short description. Nothing executes until the client posts the same tool and arguments through `POST /api/ai/chat` with a `confirm` block. Cancelling or timing out leaves no side effects.

## Tool result summary

Raw results are not returned to the chat. Each tool has a summarizer that renders a concise human reply, e.g. "Current requests:" followed by a short list of titles and statuses.

## Registry layout

```
apps/server/src/services/ai.ts          Tool definitions, registry, permissions, summarizers
apps/server/src/routes/ai.ts            /api/ai/health, /api/ai/tools, /api/ai/chat
```

Tools can be inspected any time with `GET /api/ai/tools`, which powers the AI page tool chips.