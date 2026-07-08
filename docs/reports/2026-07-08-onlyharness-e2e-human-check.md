# OnlyHarness E2E Human/Agent Check - 2026-07-08

## Verdict

OnlyHarness is usable end-to-end for the core free native harness path and the mixed resource catalog path:

- Web: pass. First screen communicates catalog/trust/install layer, not a GitHub redirect.
- API: pass. Health, OpenAPI, registry/resources, hosted archives and not-hosted guards work on prod.
- MCP: pass after fix. Prod JSON-RPC exposes harness and resource tools, and now reports version `0.2.1`.
- CLI/npm: pass after npm publish. Published npm `onlyharness@0.2.1` works for native harness workflows and mixed `hh resources` commands.
- Claude plugin: pass with restart note. Local plugin validates, GitHub marketplace source was pushed, and installed `onlyharness@onlyharness` was updated to `1.0.2`; Claude Code says restart is required to apply it.
- Paid/auth: anonymous guards pass; no QA credentials and no live paid harness fixture were available, so no real signup/payment mutation was performed.
- Storage safety: pass. No local catalog archive download. Only two tiny sample archives were downloaded to `/tmp` and removed.

## Storage

Before:

- Local `df -h`: `/System/Volumes/Data` `460Gi`, `318Gi` used, `113Gi` available, `74%`.
- Repo `du -sh`: `3.4G`.
- Local `data/resources/archives/*.tar.gz`: `0`.
- Server `/var/lib/onlyharness/resource-archives`: `251` archives, `3.1G`.

During:

- Downloaded only 2 sample archives to `/tmp/onlyharness-e2e-archives`: `superpowers-marketplace.tar.gz` `3.1K`, `agents-md.tar.gz` `7.6K`.
- Clean npm/CLI test home under `~/onlyharness-e2e`: `1.9M`.

After cleanup:

- Local `df -h`: `/System/Volumes/Data` `460Gi`, `318Gi` used, `111Gi` available, `75%`.
- Repo `du -sh`: `3.4G`.
- Local `data/resources/archives/*.tar.gz`: `0`.
- Removed `/tmp/onlyharness-e2e-archives` and `~/onlyharness-e2e`.
- Kept screenshots only: `/tmp/onlyharness-e2e-screens` `160K`.
- Server archive storage still `251` archives, `3.1G`.

Screenshots:

- `/tmp/onlyharness-e2e-screens/desktop-home.png`
- `/tmp/onlyharness-e2e-screens/mobile-goose.png`

## Path Results

### 1. Preflight

Pass.

- `https://onlyharness.com/api/healthz`: `200 {"ok":true}`.
- `https://onlyharness.com/server.json`: `200`, version `0.2.1`, MCP remote `https://onlyharness.com/mcp`.
- `https://onlyharness.com/api/openapi.json`: `200`, OpenAPI version `0.2.1`.
- `GET https://onlyharness.com/mcp`: `405`, expected for JSON-RPC endpoint.
- Local archives directory remains empty.

### 2. Human Web UX

Pass with small P2 UX notes.

Checked as a new user:

- First screen says OnlyHarness is for browsing agent resources: skills, plugins, workflows, MCP servers and harnesses.
- Search worked for `superpowers`, `spec-kit`, `mcp`, `workflow`, `plugin`.
- `Use` for `superpowers` stayed inside OnlyHarness and showed:
  - OnlyHarness page URL.
  - OnlyHarness hosted archive URL.
  - CLI/detail guidance.
  - upstream attribution to GitHub.
- Resource tabs work for MCP servers, workflows, plugins and runtimes.
- Oversized/not-hosted resources `goose` and `AionUi` show `not hosted yet`; no false download was exposed.
- Mobile viewport was readable; no blocking layout failure found.

P2 notes:

- If a user searches while a narrow tab is active, the empty state can feel like a dead end until switching tabs.
- Footer count can read like filtered state confusion, e.g. `253 upstream resources · 0 native harnesses` while a filter/search is active.

### 3. Archive/Resource E2E

Pass.

- Hosted archive headers return `200`, `content-type: application/gzip`, and `content-disposition` filenames.
- Sample archives validate as gzip/tar and list expected files.
- `github:aaif-goose/goose` and `github:iofficeai/aionui` return `409 RESOURCE_ARCHIVE_NOT_HOSTED`.
- Upstream attribution is present, but the primary use path remains OnlyHarness-first.

### 4. Clean User CLI/NPM

Pass after npm `0.2.1` publish.

Initial clean npm install of `onlyharness@0.2.0` passed for native harness flows:

- `hh doctor`: pass.
- `hh search market research`: pass.
- `hh suggest market research --json`: pass.
- `hh suggest market research --apply --target claude-code`: pass.
- `hh install harnesses/deep-market-researcher --target codex`: pass.
- `hh install harnesses/deep-market-researcher --target claude-code`: pass in a fresh workdir.

After `onlyharness@0.2.1` was published to npm, clean temp verification passed:

- `npm view onlyharness version`: `0.2.1`.
- `hh --version`: `0.2.1`.
- `hh resources search superpowers --json`: pass, returned `github:obra/superpowers` with `Use in OnlyHarness`.
- `hh resources detail github:obra/superpowers --json`: pass.
- `hh resources open github:obra/superpowers --json`: pass, returned `https://onlyharness.com/#/resources/github%3Aobra%2Fsuperpowers`.
- Temp npm footprint: `1.7M` in `/tmp/onlyharness-npm-021`, removed after verification.

Found and fixed:

- `hh install --target ...` could pull/write harness files before failing on an adapter collision. It now preflights adapter output collisions before archive pull/write, with a regression test.

Resolved:

- Initial blocker was stale npm `0.2.0` without `hh resources`.
- Publishing `onlyharness@0.2.1` resolved the clean-user resource CLI path.

### 5. Plugin / Master Skill

Partial.

- `claude` exists: version `2.1.112`.
- `claude plugin validate plugins/onlyharness`: pass.
- `claude plugin validate .`: pass.
- `claude plugin marketplace add elvismusli/onlyharness`: pass.
- `claude plugin install onlyharness@onlyharness`: pass.
- `claude plugin marketplace update onlyharness`: pass.
- `claude plugin update onlyharness@onlyharness`: pass, updated `1.0.1 -> 1.0.2`; restart required to apply.
- `claude plugin list`: pass, installed `onlyharness@onlyharness` version `1.0.2`.

Found and fixed in source:

- Plugin skill claimed the npm package was unpublished.
- Plugin skill did not mention resource MCP tools.
- Plugin skill could have implied clean-user npm resource commands before npm `0.2.1` is published.

Current source now says:

- npm package is published for native harness workflows.
- resource catalog commands are available through MCP/HTTP and local `0.2.1` until npm `0.2.1` is published.
- MCP tools include `search_resources`, `resource_detail`, `resource_use_instructions`.

Remaining operational blocker:

- Other already installed Claude plugin copies can remain stale until users refresh/reinstall and restart Claude Code.

### 6. MCP Agent Path

Pass after fix.

Prod JSON-RPC verified:

- `initialize`: server `{ name: "onlyharness", version: "0.2.1" }`.
- `tools/list`: includes `search_harnesses`, `harness_detail`, `pull_instructions`, `pull_harness`, `search_docs`, `publish_markdown_to_harness`, `search_resources`, `resource_detail`, `resource_use_instructions`.
- `pull_instructions`: returns `npx onlyharness install ...`, `localCommand`, and `npmStatus: "published"` for native harness install path.
- `resource_use_instructions`: OnlyHarness-first and includes hosted resource archive guidance for `github:obra/superpowers`.

Fixed:

- MCP `pull_instructions` no longer reports `pending_publish` or local-only native harness install guidance.
- MCP server version and OpenAPI version are now synced to `0.2.1`.
- `smoke:mcp` now checks MCP `initialize.serverInfo.version`.

P2 note:

- `pull_harness` with `?version=0.1.0` still returned `snapshot:false` in live manual inspection. Local smoke covers archive versions, but live docs say versioned archive should be immutable/snapshot-like. Needs a focused doc/runtime check.

### 7. Auth / Storefront / Paid Guards

Pass for anonymous guards; QA auth untested.

- No QA email/password was present in env.
- Anonymous `/api/me/storefront`: `401 Sign in required`.
- Anonymous `/api/billing/receipt?provider_ref=manual_e2e_fake`: `401 Sign in required`.
- Checkout page loads anonymously but does not grant entitlement.
- Login/signup/resend copy is plain and honest.
- No real payment or entitlement mutation was attempted.

Blocked:

- No live paid harness fixture found in prod catalog, so live anonymous `402` paid archive path could not be reproduced against prod. Local smoke covers paid `402`, checkout, receipt, webhook, entitlement, and escrow paths.

### 8. Production Truth

Pass.

Ran locally:

- `npm run check`: pass.
- `npm run smoke`: pass.
- `npm run smoke:mcp`: pass.
- `npm pack -w onlyharness --dry-run`: pass for local `0.2.1`.

Deployed:

- `SSH_TARGET=hetzner-root ./scripts/deploy-production.sh`: pass.
- Deploy public smoke: pass at `https://onlyharness.com`.

Prod after deploy:

- Health: pass.
- Server metadata: `0.2.1`.
- OpenAPI: `0.2.1`.
- MCP initialize: `0.2.1`.
- `/llms.txt` now states resource catalog commands are live through npm, MCP and HTTP.

## Bugs / Risks

### P1

- Other already installed Claude plugin copies can still show stale skill guidance until refreshed/reinstalled and Claude Code is restarted.

### P2

- Web search with a narrow active tab can look like a dead end.
- Footer count can confuse filtered native harness count with global catalog state.
- Live `pull_harness?version=0.1.0` returned `snapshot:false`; verify whether this is a doc issue or runtime immutability issue.
- No live paid fixture means prod paid `402` can only be trusted from smoke, not a real public catalog item.

## Fixed

- Native harness MCP instructions now use the real published npm install path.
- Docs/plugin copy now document npm `0.2.1` resource commands as the clean-user path.
- Plugin skill now includes resource MCP tools and honest resource use paths.
- CLI install/apply now preflights adapter collisions before writing harness files.
- MCP/OpenAPI/server metadata are synced to `0.2.1`.
- Smoke coverage added for MCP version.
- npm `onlyharness@0.2.1` publish verified clean-user `hh resources` commands.

## Remaining Blockers

- Refresh/reinstall other already installed Claude plugin copies after the GitHub source update; Claude Code restart is required to apply.
- Add or expose a safe paid prod fixture if live paid `402` needs continuous public smoke coverage.
