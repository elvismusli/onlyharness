# SuperSkill CLI

The compatibility package coordinate `onlyharness` installs the `hh` command for SuperSkill resource discovery, local sample runs, evals and quality gates.

```bash
npm run build -w onlyharness
node packages/harness-cli/dist/hh.mjs search market research
node packages/harness-cli/dist/hh.mjs suggest market research --json
node packages/harness-cli/dist/hh.mjs suggest market research --apply --out suggested-deep-market-researcher --json
node packages/harness-cli/dist/hh.mjs suggest market research --apply --target codex --out suggested-deep-market-researcher --adapter-out .agents/skills/deep-market-researcher --json
node packages/harness-cli/dist/hh.mjs install harnesses/deep-market-researcher --target claude-code --json
node packages/harness-cli/dist/hh.mjs pull harnesses/deep-market-researcher --version 0.1.0 --out deep-market-researcher-0.1.0 --json
node packages/harness-cli/dist/hh.mjs mcp-config deep-market-researcher --target claude-desktop --json
node packages/harness-cli/dist/hh.mjs run deep-market-researcher
node packages/harness-cli/dist/hh.mjs eval deep-market-researcher
node packages/harness-cli/dist/hh.mjs gate --dir deep-market-researcher
node packages/harness-cli/dist/hh.mjs update deep-market-researcher --diff
node packages/harness-cli/dist/hh.mjs audit-setup
node packages/harness-cli/dist/hh.mjs benchmark benchmarks/research-discovery.yaml --json
node packages/harness-cli/dist/hh.mjs extract ~/.claude/skills/my-skill --out my-skill-harness
HH_WORKSPACE_TOKEN=<workspace-token> node packages/harness-cli/dist/hh.mjs publish-resource ./agent-tool --workspace acme --name agent-tool --type command_pack --json
HH_WORKSPACE_TOKEN=<workspace-token> node packages/harness-cli/dist/hh.mjs resources search agent-tool --workspace acme --json
HH_WORKSPACE_TOKEN=<workspace-token> node packages/harness-cli/dist/hh.mjs resources detail @acme/agent-tool --json
HH_ORG_TOKEN=<org-token> node packages/harness-cli/dist/hh.mjs setup @acme
HH_ORG_TOKEN=<org-token> node packages/harness-cli/dist/hh.mjs publish workflow.md --org acme --name team-workflow
HH_ORG_TOKEN=<org-token> node packages/harness-cli/dist/hh.mjs sync git@github.com:acme/skills.git --org acme
```

## SuperSkill internal alpha

Managed SuperSkill routing is separate from the legacy `hh suggest` catalog path. Network recommendation, activation start/keep and live doctor use the local browser-auth broker. Access tokens stay in process memory; renewable credentials are stored in the OS keychain and never in project state or telemetry. `HH_TOKEN` remains an explicit non-interactive compatibility path for paid and automation commands.

```bash
hh auth login --client codex
hh auth status --client codex
hh auth logout --client codex
# Recovery diagnostics only; managed lifecycle uses superskill_local MCP tools.
hh activation doctor --target codex --live --json
```

Login opens the SuperSkill confirmation page and resumes in the same process. Use `--no-browser` only on a trusted headless terminal. The CLI never prints a bearer token or shell export. If the OS keychain is unavailable, authorization is explicitly marked `session_only` and is not written to a plaintext fallback.

Both clients share the same lifecycle. Claude pins under `.claude/skills`; Codex pins under `.agents/skills`. Temporary activation writes only project-local `.onlyharness`. Copy/detection/pin never implies loaded or invoked. Pinned reuse always rechecks the exact remote release and revocation state; offline reuse is blocked. Remove is marker/digest-owned and works offline.

Universal bootstrap (available only after the exact CLI release and official npm integrity are published):

```bash
npx --yes onlyharness@0.3.0 superskill install https://superskill.sh/api/superskill/install --auto
```

Approved capability pages bind the same command to one immutable URL containing capability id, version and sha256. Exactly one detected client transactionally writes its project-native shared skill and merges both the public `superskill` browse MCP and exact-version `superskill_local` lifecycle MCP into `.codex/config.toml` or `.mcp.json`; an exact link also records a private pending handoff. Existing unrelated config is preserved, conflicting entries fail before writes, rollback restores byte-exact originals, and no token is stored. Both/none fail with `CLIENT_AMBIGUOUS`/`CLIENT_NOT_DETECTED`. Use `--target codex|claude-code`, explicit `--all`, or `--dry-run`. Nothing is activated and routing/activation consent remain separate.

The public catalog is a separate explicit-consent path. Hosted resources with `resourceType: skill` can be installed into the native project skill root after reviewing provenance and scan state:

```bash
npx --yes onlyharness@0.3.0 resources install onlyharness:packages/example-skill --version 0.1.0 --target codex --allow-unreviewed --json
```

Codex writes `.agents/skills/<name>` and Claude Code writes `.claude/skills/<name>`. The CLI downloads one exact release, verifies the server-pinned SHA-256 digest, validates safe package paths and root `SKILL.md`, writes an ownership marker atomically, and records the install event only after files exist. `--allow-unreviewed` is required for hosted skills without a passing scan; it is explicit acceptance of the shown risk, never a Verified or managed-approval claim. Open-only resources, failed scans, non-skill packages, symlinks, cross-origin archives and destination collisions fail closed.

After the one required post-install client restart, use `superskill_local`. On the first protected action it calls `auth_start`, waits through `auth_wait`, then retries the original tool once with the same idempotency key. `recommend` first discloses or explicitly dismisses a pending exact handoff; `activation_start` acknowledges it only after `ready`. Protected publishing and workspace tools use the same account broker. The CLI `superskill handoff` command is diagnostic compatibility only.

Internal plugin install commands (after the prepared CLI version is published and verified):

```bash
claude plugin marketplace add elvismusli/onlyharness
claude plugin install superskill@superskill
codex plugin marketplace add elvismusli/onlyharness --ref main
codex plugin add superskill@superskill
```

Plugin install/refresh may require a new task or session. It does not prove a copied command, temporary capability, or pinned skill is loaded.

The npm package is published for clean-user installs:

```bash
npx onlyharness@latest doctor
npx onlyharness@latest resources search superpowers --json
npm i -g onlyharness
hh doctor
hh resources detail github:obra/superpowers --json
```

## Registry

By default `hh` talks to `https://superskill.sh/api`. `https://onlyharness.com/api` remains a machine-compatibility alias for already installed clients.

```bash
HH_REGISTRY_URL=http://127.0.0.1:8799 hh doctor
```

Paid harness installs/pulls send `HH_TOKEN` as a bearer token. Without entitlement the registry returns 402 and `hh install --json` / `hh pull --json` exits 5 with `{ "error", "code", "next" }`. If the registry includes x402 requirements, `HH_WALLET_KEY=<evm-key> HH_MAX_PAY_USD=20 hh install owner/name --pay` signs one x402 payment and retries; the default cap is 20 USD. The registry must verify/settle via its facilitator before archive files are returned.

Team setup, org-private install/pull, org publishing, repo sync, and legacy Network Neighborhood use a separate org token. `HH_ORG_TOKEN=<org-token> hh setup @acme` installs the org bundle into `.harnesshub/orgs/acme` by default. `hh install @acme/name`, `hh pull @acme/name`, `hh publish workflow.md --org acme`, and `hh sync <git-url-or-local-path> --org acme` use the same org token path; the legacy web/API workspace is `GET /orgs/{slug}/workspace`.

Workspace resource catalogs use `HH_WORKSPACE_TOKEN`, with `HH_ORG_TOKEN` as a compatibility fallback during migration. Use `hh publish-resource --workspace acme` to publish a full private package with scripts/docs/commands into `/workspaces/{slug}/resources`; use `hh resources search --workspace acme` and `hh resources detail @acme/name` to inspect it.

## Publishing

Interactive publishing uses the `superskill_local` MCP installed by the universal link. The first protected tool call opens browser consent and resumes with the original idempotency key. The `onlyharness` package name remains a compatibility coordinate.

```bash
HH_WORKSPACE_TOKEN=<workspace-token> hh publish-resource ./agent-tool --workspace acme --name agent-tool --type command_pack
```

Existing non-interactive paid and automation commands may still receive `HH_TOKEN` explicitly. Interactive agent configuration never inherits it and no browser-auth credential is printed.

Use `hh publish` for markdown scaffolds or eval/gate-verified native packages. Use
`hh publish-resource` for universal hosted agent resource packages: skills,
plugins, workflows, MCP servers, command packs, scripts, docs and source bundles.
Resource packages are hosted archives in the mixed catalog, but they do not get a
Verified harness badge.

## Agent Contract

- `hh search <terms> --json` prints machine-readable registry results.
- `hh resources search <terms> --json` searches the mixed source-aware catalog: skills, plugins, workflows, MCP servers, configs, guides, runtimes, directories and native harness-format packages.
- `hh resources detail github:obra/superpowers --json` prints provenance, sourceCheckedAt, GitHub popularity, availability, license status and actions. Source checked is not Verified install.
- `hh resources open github:obra/superpowers` opens the SuperSkill resource page. Hosted resources use the SuperSkill archive endpoint; legacy OnlyHarness URLs remain machine-only compatibility aliases. Upstream GitHub remains attribution/source, not the primary use path.
- `hh resources import https://github.com/acme/agent-skills --json` classifies a GitHub repo through the guarded read-only server path before adding/listing it.
- `hh resources search <terms> --workspace acme --json` searches a token-gated workspace catalog.
- `hh resources detail @acme/name --json` reads a workspace-private resource detail payload with `HH_WORKSPACE_TOKEN` or legacy `HH_ORG_TOKEN`.
- `hh suggest <terms> --json` searches, returns a ranked candidate shortlist with trust fields, fetches detail, and prints a full trust summary for the selected harness. Use `--pick <rank>` to inspect or apply another candidate.
- `hh suggest <terms> --apply --out <dir>` installs through the same archive path as `hh pull`, preserves paid 402/directory 409 behavior, records `accepted` when `--apply` is chosen, and records `applied` only after files are written.
- `hh suggest <terms> --apply --target cli|claude-code|codex|cursor` runs the full `hh install --target` adapter path before recording `applied`.
- Registry and local inspect payloads include `contextCost: { approxTokens, files, bytes, status: "estimated" }` from markdown instruction files.
- `hh install owner/name --target cli|claude-code|codex|cursor` pulls a runnable harness and records a privacy-safe `install` event after optional adapter generation succeeds.
- `hh pull owner/name` writes a runnable harness directory and sends `HH_TOKEN` when set.
- `hh pull owner/name --version <semver>` and `hh install owner/name --version <semver>` request that registry version and write the resolved version to `.harnesshub/source.json`; require `snapshot:true` in the archive response when immutability matters.
- `hh install owner/name --pay` and `hh pull owner/name --pay` use `HH_WALLET_KEY` or `EVM_PRIVATE_KEY` for x402-enabled 402 responses and refuse to sign above `HH_MAX_PAY_USD`.
- `hh install @org/name` and `hh pull @org/name` send `HH_ORG_TOKEN` when set.
- `hh adapt [dir] --target claude-code|codex|cursor` writes local adapter instruction files and refuses to overwrite without `--force`; new Codex adapters use `.agents/skills/<name>/SKILL.md`, while legacy `.codex/harnesses` remains unmanaged and is never auto-deleted.
- `hh mcp-config [dir] --target claude-desktop|claude-code|cursor` generates package-backed MCP client JSON from `tools.mcp_servers`.
- `hh run` is sample mode only: no LLM calls, no credentials, and no verified gate claim.
- `hh eval` writes `.harnesshub/results.json`.
- `hh gate` enforces `quality_gates` from `harness.yaml`.
- `hh gate --receipt` writes a signed gate receipt to `.harnesshub/gate-receipt.json` by default. The receipt includes harness ref, version, `resultsHash`, verdict and timestamp, signed with the local ed25519 install key at `~/.onlyharness/key`.
- Gate escrow buyers submit that receipt to `POST /billing/escrow/receipt`; plain `POST /receipts` only verifies the signature and never mutates payment state.
- `hh doctor --harness [dir]` checks a local harness plus registry connectivity.
- `hh audit-setup` scans local `~/.claude` and `./.claude` skills for trigger conflicts, stale skills and estimated markdown context cost. It stays local and emits a sanitized share card.
- `hh benchmark <suite.yaml>` runs a local category benchmark suite across candidate and analog harness paths. It compares declared eval case scores and exits 3 for invalid, unverified, or below-threshold candidate suites.
- `hh extract <skill-dir|SKILL.md>` creates a private `harness.v0.2` scaffold from local skill markdown, infers candidate `depends_on`, and redacts obvious token-shaped secrets.
- `hh publish-resource <dir-or-git-url> --name <slug> --type <type>` publishes a bounded hosted resource package. It accepts safe text files under `scripts/`, `commands/`, `tools/`, `workflows/`, `mcp/`, `plugins/`, `docs/`, `src/`, `lib/`, `skills/`, `prompts/`, `examples/` and related agent directories; it rejects secrets, generated folders, binaries and archives.
- `hh publish-resource <dir-or-git-url> --workspace <slug> --name <slug> --type <type>` publishes the same bounded hosted package into a private workspace catalog instead of the public resource catalog.
- `hh setup @org` installs a token-gated team bundle with pinned harnesses and config snippets; repeated runs of the same bundle are idempotent.
- `hh publish --org <slug>` uses `HH_ORG_TOKEN` and publishes a private org harness.
- `hh sync <git-url-or-local-path> --org <slug>` clones or scans a repo, imports markdown skills/runbooks/prompts into the org namespace, and prints an import report. The first version has no webhooks.
- `hh pin`, `hh outdated`, and `hh update --diff` use `.harnesshub/source.json` / `.harnesshub/pin.json` for safe version-aware updates.
- Use `--json` where available, or `--format json` for risk/diff; failures print `{ "error", "code", "next" }` to stderr.

## Exit Codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | General failure |
| 2 | Auth required or invalid |
| 3 | Validation, eval, risk, or gate failure |
| 4 | Harness or local harness directory not found |
| 5 | Payment required |

## Bundle

The npm package ships `dist/hh.mjs` as a self-contained esbuild bundle with bins `hh` and `onlyharness`.
