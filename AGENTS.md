# OnlyHarness Agent Guide

## What This Repo Is

OnlyHarness is a registry, web app, API, and CLI for reusable AI-agent harnesses.
A harness is a directory with a manifest, prompts, examples, eval cases, permissions, and gates.

## Dev Commands

```bash
npm install
npm run dev
npm run check
npm run smoke
npm run build
```

Local ports:

| Service | URL |
| --- | --- |
| Web | http://127.0.0.1:5177 |
| API | http://127.0.0.1:8787 |
| Gitea smoke forge | http://127.0.0.1:3000 |

Useful targeted checks:

```bash
npm run typecheck -w @harnesshub/api
npm run typecheck -w @harnesshub/registry-web
npm run typecheck -w onlyharness
npm test -w onlyharness
node packages/harness-cli/dist/hh.mjs doctor
```

## Agent Use

Prefer the CLI for agent loops:

```bash
npx onlyharness search market research
npx onlyharness pull harnesses/deep-market-researcher
npx onlyharness run deep-market-researcher --json
npx onlyharness eval deep-market-researcher --json
npx onlyharness gate --dir deep-market-researcher --json
```

HTTP API base: `https://onlyharness.com/api`

Core endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | API health |
| GET | `/registry?q={terms}` | Search harnesses |
| GET | `/repos/{owner}/{name}/harness` | Manifest, trust, files, example |
| GET | `/repos/{owner}/{name}/archive?version={semver}` | Pull harness files; paid harnesses return 402 until entitled |
| POST | `/imports/markdown-to-harness` | Publish markdown as a harness; Bearer token required |
| POST | `/events` | Privacy-safe event write; whitelisted fields only |

MCP endpoint for compatible clients: `https://onlyharness.com/mcp`.
Tools: `search_harnesses`, `harness_detail`, `pull_instructions`, `search_docs`, `publish_markdown_to_harness`.
OpenAPI is available at `https://onlyharness.com/api/openapi.json`.
Claude Code plugin: `claude plugin marketplace add elvismusli/onlyharness`, then `claude plugin install onlyharness@onlyharness`.

## Conventions

- Run `npm run check` and `npm run smoke` before commits that change runtime behavior.
- Use `corepack` only if the repo switches package manager; this repo currently uses npm workspaces.
- Keep docs, `/llms.txt`, API behavior, and CLI behavior synchronized.
- Do not commit `infra/production.env`, tokens, cookies, Supabase service keys, or generated secrets.
- Money movement, auth, publishing, permissions, and entitlements are high-risk; prefer explicit failures over optimistic UI.
- Paid `hh pull` uses `HH_TOKEN`; 402 must exit with code 5 and include checkout/manual-entitlement next steps.
- CLI failures should use documented exit codes and, with `--json`, emit `{ "error", "code", "next" }` to stderr.
- Harness imports must not invent eval scores, licenses, permissions, or runtime proof.

## UI Rules

- The web app is OnlyHarness 98: Windows 98 style windows, taskbar, bevels, pixel borders, and playful copy.
- Avoid modern rounded cards, gradients, and generic SaaS hero layouts in the app surface.
- Auth, payments, permissions, and safety copy should be plain and honest, not playful.

## Where Things Live

| Path | Purpose |
| --- | --- |
| `apps/harness-api` | Fastify API, registry/search/import/MCP/OpenAPI |
| `apps/registry-web` | React + Vite OnlyHarness 98 UI |
| `packages/harness-cli` | Public `onlyharness` package and `hh` CLI |
| `packages/harness-schema` | Harness manifest validation and risk/security reports |
| `packages/semantic-diff` | Harness semantic diff and PR review text |
| `seed-harnesses` | Built-in public harness catalog |
| `supabase/migrations` | Auth/profile/social/thread database migrations |
| `infra` | Docker/Caddy production and local smoke infra |
| `scripts` | Smoke, seed, deploy, and Gitea proof scripts |
| `docs/plans` | Product and rollout plans |
