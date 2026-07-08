# OnlyHarness CLI

`onlyharness` installs the `hh` command for agent harness discovery, local sample runs, evals and quality gates.

```bash
npm run build -w onlyharness
node packages/harness-cli/dist/hh.mjs search market research
node packages/harness-cli/dist/hh.mjs suggest market research --json
node packages/harness-cli/dist/hh.mjs suggest market research --apply --out suggested-deep-market-researcher --json
node packages/harness-cli/dist/hh.mjs suggest market research --apply --target codex --out suggested-deep-market-researcher --adapter-out .codex/harnesses/deep-market-researcher --json
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
HH_TOKEN=<access-token> node packages/harness-cli/dist/hh.mjs publish-resource ./agent-tool --name agent-tool --type command_pack --json
HH_TOKEN=<access-token> node packages/harness-cli/dist/hh.mjs publish-resource https://github.com/acme/agent-tool.git --path packages/tool --name agent-tool --type command_pack --json
HH_ORG_TOKEN=<org-token> node packages/harness-cli/dist/hh.mjs setup @acme
HH_ORG_TOKEN=<org-token> node packages/harness-cli/dist/hh.mjs publish workflow.md --org acme --name team-workflow
HH_ORG_TOKEN=<org-token> node packages/harness-cli/dist/hh.mjs sync git@github.com:acme/skills.git --org acme
```

The npm package is published for clean-user installs:

```bash
npx onlyharness@latest doctor
npx onlyharness@latest resources search superpowers --json
npm i -g onlyharness
hh doctor
hh resources detail github:obra/superpowers --json
```

## Registry

By default `hh` talks to `https://onlyharness.com/api`.

```bash
HH_REGISTRY_URL=http://127.0.0.1:8799 hh doctor
```

Paid harness installs/pulls send `HH_TOKEN` as a bearer token. Without entitlement the registry returns 402 and `hh install --json` / `hh pull --json` exits 5 with `{ "error", "code", "next" }`. If the registry includes x402 requirements, `HH_WALLET_KEY=<evm-key> HH_MAX_PAY_USD=20 hh install owner/name --pay` signs one x402 payment and retries; the default cap is 20 USD. The registry must verify/settle via its facilitator before archive files are returned.

Team setup, org-private install/pull, org publishing, repo sync, and Network Neighborhood use a separate org token. `HH_ORG_TOKEN=<org-token> hh setup @acme` installs the org bundle into `.harnesshub/orgs/acme` by default. `hh install @acme/name`, `hh pull @acme/name`, `hh publish workflow.md --org acme`, and `hh sync <git-url-or-local-path> --org acme` use the same org token path; the web/API workspace is `GET /orgs/{slug}/workspace`.

## Publishing

Publishing needs an OnlyHarness access token.

```bash
HH_TOKEN=<access-token> hh publish workflow.md --name my-harness
HH_TOKEN=<access-token> hh publish <verified-harness-dir> --name my-harness
HH_TOKEN=<access-token> hh publish-resource ./agent-tool --name agent-tool --type command_pack
HH_TOKEN=<access-token> hh publish-resource https://github.com/acme/agent-tool.git --path packages/tool --name agent-tool --type command_pack
```

Use `hh publish` for markdown scaffolds or eval/gate-verified native packages. Use
`hh publish-resource` for universal hosted agent resource packages: skills,
plugins, workflows, MCP servers, command packs, scripts, docs and source bundles.
Resource packages are hosted archives in the mixed catalog, but they do not get a
Verified harness badge.

## Agent Contract

- `hh search <terms> --json` prints machine-readable registry results.
- `hh resources search <terms> --json` searches the mixed source-aware catalog: skills, plugins, workflows, MCP servers, configs, guides, runtimes, directories and native harness-format packages.
- `hh resources detail github:obra/superpowers --json` prints provenance, sourceCheckedAt, GitHub popularity, availability, license status and actions. Source checked is not Verified install.
- `hh resources open github:obra/superpowers` opens the OnlyHarness resource page. Hosted resources expose an OnlyHarness archive URL; upstream GitHub remains attribution/source, not the primary use path.
- `hh resources import https://github.com/acme/agent-skills --json` classifies a GitHub repo through the guarded read-only server path before adding/listing it.
- `hh suggest <terms> --json` searches, returns a ranked candidate shortlist with trust fields, fetches detail, and prints a full trust summary for the selected harness. Use `--pick <rank>` to inspect or apply another candidate.
- `hh suggest <terms> --apply --out <dir>` installs through the same archive path as `hh pull`, preserves paid 402/directory 409 behavior, records `accepted` when `--apply` is chosen, and records `applied` only after files are written.
- `hh suggest <terms> --apply --target cli|claude-code|codex|cursor` runs the full `hh install --target` adapter path before recording `applied`.
- Registry and local inspect payloads include `contextCost: { approxTokens, files, bytes, status: "estimated" }` from markdown instruction files.
- `hh install owner/name --target cli|claude-code|codex|cursor` pulls a runnable harness and records a privacy-safe `install` event after optional adapter generation succeeds.
- `hh pull owner/name` writes a runnable harness directory and sends `HH_TOKEN` when set.
- `hh pull owner/name --version <semver>` and `hh install owner/name --version <semver>` request that registry version and write the resolved version to `.harnesshub/source.json`; require `snapshot:true` in the archive response when immutability matters.
- `hh install owner/name --pay` and `hh pull owner/name --pay` use `HH_WALLET_KEY` or `EVM_PRIVATE_KEY` for x402-enabled 402 responses and refuse to sign above `HH_MAX_PAY_USD`.
- `hh install @org/name` and `hh pull @org/name` send `HH_ORG_TOKEN` when set.
- `hh adapt [dir] --target claude-code|codex|cursor` writes local adapter instruction files and refuses to overwrite without `--force`.
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
