# AI Assistant Architecture

The AI layer is optional. The application works completely without it.

---

## Implemented runtime

The shipped assistant uses Ollama as the provider:

- Provider: `apps/server/src/services/ollama-provider.ts` (OllamaProvider implementing `packages/ai/src/index.ts`'s `AIProvider`)
- Model: any Ollama model. Tested with `qwen2.5:0.5b`, called with `format: json` plus an explicit system prompt of available tools
- Tools: a hardcoded registry in `apps/server/src/services/ai.ts`. Alternative JSON shapes are flattened on arrival and IDs are normalized across tools
- Confirmation: destructive tools return the `confirmation` reply kind; nothing executes until the client re-posts the tool and arguments with a `confirm` block
- Surfacing: `GET /api/ai/health`, `GET /api/ai/tools`, `POST /api/ai/chat`, and the AI page in the web app

The rest of this document is the design contract the feed was built against.

---

## Provider Abstraction

Every provider implements the interface exported from `packages/ai/src/index.ts` (backed by `packages/ai/src/provider-interface.ts`).

Supported providers:

- OllamaProvider
- OpenAICompatibleProvider (any local endpoint supporting OpenAI chat format)
- LlamaCppProvider (if exposed through compatible endpoint)

---

## System Prompt Design

The system prompt must emphasize:

- Use predefined tools instead of guessing.
- Never claim success without a confirmed successful tool result.
- Request confirmation for destructive or high-impact actions.
- Ask for clarification when ambiguous (e.g., multiple results for "The Office").
- Prefer concise answers.
- Explain failures accurately without inventing integration state.
- Respect user permission settings.

---

## Tool Schema Format

Every tool is defined with an explicit JSON schema:

```
{
  "name": "search_movies",
  "description": "Search for movies by title.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Movie title to search" }
    },
    "required": ["query"]
  },
  "permissions": ["read-only", "search"],
  "sideEffects": ["read"],
  "confirmationRequired": false,
  "category": "discovery"
}
```

---

## AI Pipeline (Mandatory)

Every request follows this exact sequence:

1. Receive user message.
2. Load system prompt and available tool schemas.
3. Call LLM with messages and tool definitions.
4. Parse structured tool call from response.
5. Validate arguments against JSON schema.
6. Check permissions (does user allow this tool?).
7. If destructive: show confirmation dialog.
8. Execute tool through application service (normalized business logic).
9. Call adapter or service layer (not directly to database).
10. Return normalized result.
11. Send result to LLM for response formatting.
12. Show structured action summary to user.

---

## Confirmation Policy Groups

- `read_only`: No destructive actions allowed.
- `read_search`: Search, inspection, status queries allowed.
- `request_media`: Request movies, series, albums allowed.
- `manage_downloads`: Pause, resume, remove downloads allowed.
- `destructive`: Remove media, change profiles, delete library data allowed (requires confirmation by default).

---

## Context Retrieval

When a user asks about a specific issue (e.g., "Why is Oppenheimer not downloading?"), retrieve only:

- The media object for Oppenheimer.
- The related request object.
- The download queue entry for that media.
- Recent activity events related to that request or download.
- Integration health for the relevant service.

Never send thousands of library records to the model.

---

## Performance Requirements

- Local inference should work on modern desktop CPUs and small home servers (e.g., Mac Mini class, NVIDIA consumer GPUs, AMD GPUs where supported, ARM systems where supported).
- No cloud dependency required for core features.
- Streaming responses preferred for faster perceived response.
- Short system prompts, structured outputs, targeted context.
- The UI remains responsive even during AI processing.
