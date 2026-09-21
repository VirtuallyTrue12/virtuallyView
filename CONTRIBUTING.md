# Contributing

Thanks for looking. Small, focused changes are the easiest to review.

## Set up

```bash
npm install
npm run dev --workspace=apps/server
npm run dev --workspace=apps/web
```

The web app runs on http://localhost:3001 and proxies `/api` to the server on port 3000. The first account you create is the administrator. See [docs/development.md](docs/development.md).

## Before you open a pull request

```bash
npm run typecheck
npm run lint
npm test
```

- Add a test for behaviour you change or fix. Unit and integration tests live in `tests/unit`.
- Keep UI colours, radii and fonts in CSS variables so themes keep working. Do not hard-code them.
- Talk to Radarr, Sonarr and the other services only through `packages/integrations`.
- Do not commit anything from a data folder, `.env` files, keys or real library details.

## Bug reports

Say what you did, what you expected and what happened. Include your browser, whether you run Docker or Podman, and the relevant lines from `docker compose logs app`. Remove keys and private titles first.

## Ideas

Open an issue before starting anything large so we can agree on the shape of it.

## Licence of contributions

virtuallyView is MIT licensed. By opening a pull request you confirm that you wrote the change (or have the right to submit it) and that it may be distributed under the MIT licence. There is no separate agreement to sign. If you add code or assets from somewhere else, say where they came from and check their licence allows it.

## Where to start

- Look for issues labelled `good first issue`.
- Documentation fixes, translations of setup notes, tested integration reports and new themes are welcome and easy to review.
- Run the [browser tests](docs/development.md#tests) before changing anything in the web app.

## Releases

Maintainers tag a version (`v0.2.0`); the release workflow builds the Docker image, checks it for stray files and publishes it. Please do not edit `CHANGELOG.md` in a pull request unless asked; describe the change in the pull request instead.

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
