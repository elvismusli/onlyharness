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

Prefer the CLI for agent loops. The `onlyharness` npm package is not published yet; `npx onlyharness` is the post-publish path, not the current local path.

```bash
npm run build -w onlyharness
node packages/harness-cli/dist/hh.mjs search market research
node packages/harness-cli/dist/hh.mjs suggest market research --json
node packages/harness-cli/dist/hh.mjs suggest market research --apply --out suggested-deep-market-researcher --json
node packages/harness-cli/dist/hh.mjs suggest market research --apply --target claude-code --out suggested-deep-market-researcher --adapter-out .claude/skills/deep-market-researcher --json
node packages/harness-cli/dist/hh.mjs install harnesses/deep-market-researcher --target claude-code --json
node packages/harness-cli/dist/hh.mjs pull harnesses/deep-market-researcher --version 0.1.0 --out deep-market-researcher-0.1.0 --json
node packages/harness-cli/dist/hh.mjs mcp-config deep-market-researcher --target claude-desktop --json
node packages/harness-cli/dist/hh.mjs run deep-market-researcher --json
node packages/harness-cli/dist/hh.mjs eval deep-market-researcher --json
node packages/harness-cli/dist/hh.mjs gate --dir deep-market-researcher --json
node packages/harness-cli/dist/hh.mjs gate --dir deep-market-researcher --receipt --json
node packages/harness-cli/dist/hh.mjs audit-setup --json
node packages/harness-cli/dist/hh.mjs benchmark benchmarks/research-discovery.yaml --json
node packages/harness-cli/dist/hh.mjs extract ~/.claude/skills/my-skill --out my-skill-harness --json
node packages/harness-cli/dist/hh.mjs setup @acme --json
node packages/harness-cli/dist/hh.mjs publish workflow.md --org acme --name team-workflow --json
node packages/harness-cli/dist/hh.mjs sync git@github.com:acme/skills.git --org acme --json
node packages/harness-cli/dist/hh.mjs pin deep-market-researcher --json
node packages/harness-cli/dist/hh.mjs outdated deep-market-researcher --json
node packages/harness-cli/dist/hh.mjs update deep-market-researcher --diff --json
```

HTTP API base: `https://onlyharness.com/api`

Core endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | API health |
| GET | `/registry?q={terms}` | Search harnesses |
| GET | `/repos/{owner}/{name}/harness` | Manifest, trust, files, example |
| GET | `/repos/{owner}/{name}/security-report` | Static security report for install/apply gating |
| GET | `/repos/{owner}/{name}/archive?version={semver}` | Pull harness files; paid harnesses return 402 until entitled; directory shelf entries return 409 `DIRECTORY_LINK_ONLY`; may include x402 `PAYMENT-REQUIRED` |
| POST | `/billing/checkout` | Authenticated manual checkout session for paid harnesses; manual provider only |
| GET | `/billing/receipt?provider_ref={ref}` | Authenticated buyer receipt; read-only, never grants entitlement by itself |
| POST | `/billing/escrow/receipt` | Authenticated buyer settles a reserved `gate_escrow` purchase with a signed gate receipt |
| POST | `/billing/escrow/timeout` | Authenticated buyer refunds an expired reserved `gate_escrow` purchase |
| POST | `/webhooks/payments` | Internal manual payment settlement; requires `HARNESS_WEBHOOK_TOKEN`; idempotent entitlement grant |
| POST | `/receipts` | Verify a signed `hh gate --receipt` payload; side-effect-free, no payment or entitlement mutation |
| GET | `/bounties` | List local bounty work-state; payment truth stays in linked purchases |
| POST | `/bounties` | Authenticated customer creates an `open` bounty |
| POST | `/bounties/{id}/claim` | Authenticated builder claims an open bounty |
| POST | `/bounties/{id}/deliver` | Claimant delivers with a signed passing `hh gate --receipt` |
| POST | `/bounties/{id}/accept` | Customer accepts by matching receipt + `gate_escrow` purchase; marks paid only after escrow capture |
| GET | `/entitlements/check?subject={type:id}&harness={owner/name}` | Bot-facing entitlement check; requires org token with `entitlements:read` scope |
| POST | `/community/invite-code` | Authenticated buyer gets a short-lived signed community gate code after entitlement is verified |
| POST | `/community/verify-code` | Bot verifies a community gate code with a scoped org token before granting Discord/Telegram access |
| GET | `/orgs/{slug}/bundle` | Team setup bundle; requires `ORGS_ENABLED=true` and Bearer org token |
| GET | `/orgs/{slug}/workspace` | Network Neighborhood payload: org-private cards, sanitized audit rows, permission/risk summary |
| POST | `/orgs/{slug}/imports/markdown-to-harness` | Publish org-private markdown harness; requires org token with publish scope |
| POST | `/orgs/{slug}/imports/harness-dir` | Publish verified org-private harness directory after eval/gate; requires org token with publish scope |
| GET/PUT | `/me/storefront` | Authenticated creator storefront profile and referral code management |
| GET | `/storefront/{handle}` | Public creator storefront with referral attribution code |
| POST | `/imports/markdown-to-harness` | Publish markdown as a harness; Bearer token required |
| POST | `/imports/harness-dir` | Publish a verified public harness directory after eval/gate; Bearer token required |
| POST | `/events` | Privacy-safe event write; whitelisted fields only |

MCP endpoint for compatible clients: `https://onlyharness.com/mcp`.
Tools: `search_harnesses`, `harness_detail`, `pull_instructions`, `pull_harness`, `search_docs`, `publish_markdown_to_harness`.
`harness_detail` and `pull_instructions` include read-only access/payment state; they must not grant entitlement or return archive files. `pull_harness` and HTTP archive delivery are the file-returning entitlement gates.
OpenAPI is available at `https://onlyharness.com/api/openapi.json`.
MCP Registry metadata is available at `https://onlyharness.com/server.json` as `com.onlyharness/registry`; publishing requires domain ownership proof for `onlyharness.com`.
Claude Code plugin: `claude plugin marketplace add elvismusli/onlyharness`, then `claude plugin install onlyharness@onlyharness`.

## Conventions

- Run `npm run check` and `npm run smoke` before commits that change runtime behavior.
- Use `corepack` only if the repo switches package manager; this repo currently uses npm workspaces.
- Keep docs, `/llms.txt`, API behavior, and CLI behavior synchronized.
- Do not commit `infra/production.env`, tokens, cookies, Supabase service keys, or generated secrets.
- Money movement, auth, publishing, permissions, and entitlements are high-risk; prefer explicit failures over optimistic UI.
- Paid `hh install`/`hh pull` uses `HH_TOKEN`; 402 must exit with code 5 and include checkout/manual-entitlement next steps. `hh install --pay` and `hh pull --pay` may sign x402 with `HH_WALLET_KEY`/`EVM_PRIVATE_KEY`, but must enforce `HH_MAX_PAY_USD` before signing; API archive delivery requires facilitator verify/settle via `X402_FACILITATOR_URL` before wallet entitlement is written.
- Manual checkout is the only enabled checkout provider (`PAYMENT_PROVIDER` unset or `manual`). Unsupported provider config must fail closed before a purchase row is created; x402 is not a checkout provider.
- `/billing/receipt` is read-only buyer evidence keyed by `provider_ref`; it must never create purchases, settle providers, or grant entitlements.
- `hh gate --receipt` signs `{harness, version, resultsHash, verdict, at}` with the local install key at `~/.onlyharness/key` by default. `/receipts` only verifies that signature and must not store prompts, local paths, payments, or entitlements.
- `pricing.model: gate_escrow` must reserve first, not mark paid: provider confirmation creates `reserved` + expiring `escrow_reserved`; `/billing/escrow/receipt` captures only a valid passing receipt and refunds a valid failing receipt; `/billing/escrow/timeout` refunds after expiry.
- Bounties are work-state only: `open -> claimed -> delivered -> paid`. `/bounties/{id}/accept` must verify the delivered receipt, match escrow target/amount/currency, block escrow reuse, and set `paid` only after the linked `gate_escrow` purchase is captured.
- Hosted execution endpoints are not live. `hh run` stays local-only, MCP/HTTP archive routes deliver files, and `pricing.model=per_call` returns `409 HOSTED_EXECUTION_NOT_AVAILABLE` until a partner-backed or first-party runner has passed runtime smoke.
- Payout tooling may create only draft/manual payout ledgers (`payout_runs`, `payout_items`); it must not call payout providers or mark ledger items paid.
- `hh suggest` is the agent-first autopilot path: search, ranked candidate shortlist with trust fields, selected detail trust summary, optional `--pick <rank>`, optional `--apply --out <dir>`. `--apply` must use the same archive semantics as `hh pull`, including paid 402 and directory 409. With `--target cli|claude-code|codex|cursor`, it must run the same adapter/install path as `hh install --target` before recording `applied`.
- `hh install` is the primary user-facing install path: it pulls the harness, may generate adapter files with `--target claude-code|codex|cursor`, and records a privacy-safe `install` event only after local writes succeed. `hh install owner/name --version <semver>` and `hh pull owner/name --version <semver>` request the same immutable `/archive?version=` path.
- Community stats and Harness Heat are not safety guarantees. Agent/plugin flows must inspect detail/security/risk/permissions before applying a harness and must surface blocking risk instead of installing.
- Directory shelf entries use manifest `content.type: directory` and `source.vendor_policy: link-only`; they must stay free, expose `open <url>`, and must not return archive files.
- Category benchmarks are local declared-score comparisons until Owner-authored suites add external measurements; never present `hh benchmark` as an independent LLM quality proof. Add suites under `benchmarks/`; smoke requires at least 3 YAML suites and runs all of them.
- Team `hh setup @org`, `hh install @org/name`, `hh pull @org/name`, `hh publish --org`, and `hh sync <git-url> --org` use `HH_ORG_TOKEN`; org bundles/publishing/sync are feature-flagged by `ORGS_ENABLED` and must not log raw tokens.
- Network Neighborhood uses the same org token path through `/orgs/{slug}/workspace`; audit rows must stay sanitized and permission summaries reuse schema risk reports.
- `hh suggest`, `hh install`, `hh eval`, and `hh gate` may record `suggested`, `accepted`, `applied`, `install`, `eval`, or `gate` events; event payloads must stay owner/repo/version/target/client only, never local paths or prompts. `accepted` means the user chose `--apply`; `applied` is recorded only after local files are written.
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
