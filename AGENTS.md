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
npm run check:mcp-registry
npm test -w onlyharness
node packages/harness-cli/dist/hh.mjs doctor
```

## Agent Use

Prefer the CLI for agent loops:

```bash
npx onlyharness search market research
npx onlyharness suggest market research --json
npx onlyharness suggest market research --apply --out deep-market-researcher --json
npx onlyharness pull harnesses/deep-market-researcher
npx onlyharness adapt deep-market-researcher --target claude-code --json
npx onlyharness mcp-config deep-market-researcher --target claude-desktop --json
npx onlyharness run deep-market-researcher --json
npx onlyharness eval deep-market-researcher --json
npx onlyharness gate --dir deep-market-researcher --json
npx onlyharness audit-setup --json
npx onlyharness benchmark benchmarks/research-discovery.yaml --json
npx onlyharness extract ~/.claude/skills/my-skill --out my-skill-harness --json
npx onlyharness setup @acme --json
npx onlyharness publish workflow.md --org acme --name team-workflow --json
npx onlyharness sync git@github.com:acme/skills.git --org acme --json
npx onlyharness pin deep-market-researcher --json
npx onlyharness outdated deep-market-researcher --json
npx onlyharness update deep-market-researcher --diff --json
```

HTTP API base: `https://onlyharness.com/api`

Core endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | API health |
| GET | `/registry?q={terms}` | Search harnesses |
| GET | `/repos/{owner}/{name}/harness` | Manifest, trust, files, example |
| GET | `/repos/{owner}/{name}/archive?version={semver}` | Pull harness files; paid harnesses return 402 until entitled; directory shelf entries return 409 `DIRECTORY_LINK_ONLY`; may include x402 `PAYMENT-REQUIRED` |
| GET | `/entitlements/check?subject={type:id}&harness={owner/name}` | Bot-facing entitlement check; requires org token with `entitlements:read` scope |
| POST | `/community/invite-code` | Authenticated buyer gets a short-lived signed community gate code after entitlement is verified |
| POST | `/community/verify-code` | Bot verifies a community gate code with a scoped org token before granting Discord/Telegram access |
| GET | `/orgs/{slug}/bundle` | Team setup bundle; requires `ORGS_ENABLED=true` and Bearer org token |
| GET | `/orgs/{slug}/workspace` | Network Neighborhood payload: org-private cards, sanitized audit rows, permission/risk summary |
| POST | `/orgs/{slug}/imports/markdown-to-harness` | Publish org-private markdown harness; requires org token with publish scope |
| POST | `/imports/markdown-to-harness` | Publish markdown as a harness; Bearer token required |
| POST | `/events` | Privacy-safe event write; whitelisted fields only |

MCP endpoint for compatible clients: `https://onlyharness.com/mcp`.
Tools: `search_harnesses`, `harness_detail`, `pull_instructions`, `pull_harness`, `search_docs`, `publish_markdown_to_harness`.
OpenAPI is available at `https://onlyharness.com/api/openapi.json`.
MCP Registry metadata is available at `https://onlyharness.com/server.json` as `com.onlyharness/registry`; publishing requires domain ownership proof for `onlyharness.com`.
Claude Code plugin: `claude plugin marketplace add elvismusli/onlyharness`, then `claude plugin install onlyharness@onlyharness`.

## Conventions

- Run `npm run check` and `npm run smoke` before commits that change runtime behavior.
- Use `corepack` only if the repo switches package manager; this repo currently uses npm workspaces.
- Keep docs, `/llms.txt`, API behavior, and CLI behavior synchronized.
- Do not commit `infra/production.env`, tokens, cookies, Supabase service keys, or generated secrets.
- Money movement, auth, publishing, permissions, and entitlements are high-risk; prefer explicit failures over optimistic UI.
- Paid `hh pull` uses `HH_TOKEN`; 402 must exit with code 5 and include checkout/manual-entitlement next steps. `hh pull --pay` may sign x402 with `HH_WALLET_KEY`/`EVM_PRIVATE_KEY`, but must enforce `HH_MAX_PAY_USD` before signing; API archive delivery requires facilitator verify/settle via `X402_FACILITATOR_URL` before wallet entitlement is written.
- Payout tooling may create only draft/manual payout ledgers (`payout_runs`, `payout_items`); it must not call payout providers or mark ledger items paid.
- `hh suggest` is the agent-first autopilot path: search, detail trust summary, optional `--apply --out <dir>`. `--apply` must use the same archive semantics as `hh pull`, including paid 402 and directory 409.
- Directory shelf entries use manifest `content.type: directory` and `source.vendor_policy: link-only`; they must stay free, expose `open <url>`, and must not return archive files.
- Category benchmarks are local declared-score comparisons until Owner-authored suites add external measurements; never present `hh benchmark` as an independent LLM quality proof.
- Team `hh setup @org`, `hh pull @org/name`, `hh publish --org`, and `hh sync <git-url> --org` use `HH_ORG_TOKEN`; org bundles/publishing/sync are feature-flagged by `ORGS_ENABLED` and must not log raw tokens.
- Network Neighborhood uses the same org token path through `/orgs/{slug}/workspace`; audit rows must stay sanitized and permission summaries reuse schema risk reports.
- `hh suggest`, `hh eval`, and `hh gate` may record `suggested`, `applied`, `eval`, or `gate` events; event payloads must stay owner/repo/version/target/client only, never local paths or prompts.
- `/entitlements/check` is read-only for bots: require a scoped org token, check the explicit `subject`, and never treat the org token itself as a buyer entitlement.
- `/community/invite-code` must only mint codes for the authenticated buyer after a live entitlement check. `/community/verify-code` must HMAC/TTL-check the code, re-check entitlement live, and never trust a subject typed into Telegram chat.
- Verified-install confirms come only from privacy-safe `events` rows with `kind=install`, `client=claude-code`, and a non-anonymous subject.
- CLI failures should use documented exit codes and, with `--json`, emit `{ "error", "code", "next" }` to stderr.
- Pulled harnesses include `.harnesshub/source.json`; pinned versions live in `.harnesshub/pin.json`.
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
