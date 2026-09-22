# Development

Requires Node.js 20 or newer and npm.

```bash
npm install
npm run dev --workspace=apps/server   # API on :3000
npm run dev --workspace=apps/web      # web app on :3001, proxies /api to :3000
```

The server needs Radarr, Sonarr and friends to show anything. The quickest way is to run the bundled stack (`docker compose up -d`) and stop the `app` container, then run the API from source; it finds the other services on their published localhost ports once you enter their URLs and keys under Settings > Services.

## Tests

```bash
npm run typecheck
npm run lint
npm test                 # unit and integration tests (Vitest)
npm run build
npm run test:browser     # real browser tests, needs the build and Chromium
```

`npm test` starts real servers against throwaway data folders and needs no other software. `npm run test:browser` starts a server with an empty data folder and drives it with Playwright: first-run setup, sign-in and sign-out, password change, themes, the notification bell and backups. Install the browser once with `npx playwright install chromium`.

## Workspaces

- `apps/web`: React and Vite frontend.
- `apps/server`: Fastify API and services.
- `packages/integrations`: one adapter per external service.
- `packages/themes`: theme token schema and validation.
- `packages/ai`: assistant provider contract and tools.

## Data folder

The server keeps its state in `apps/server/data` when run from source (`app.sqlite`, `users.json`, `sessions.json`, `integrations.json`). Set `VV_DATA_DIR` to use another folder. Delete the folder to start from a clean install; you will be asked to create the first account again.

## Manual scripts

`tests/e2e-*.mjs` are older Playwright scripts written against a full stack with real media. They are not part of CI. Read one before running it, since some sign in and change state.
