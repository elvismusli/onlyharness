# OnlyHarness CLI

`onlyharness` installs the `hh` command for agent harness discovery, local sample runs, evals and quality gates.

```bash
npx onlyharness search market research
npx onlyharness suggest market research --json
npx onlyharness suggest market research --apply --out suggested-deep-market-researcher --json
npx onlyharness install harnesses/deep-market-researcher --target claude-code --json
npx onlyharness mcp-config deep-market-researcher --target claude-desktop --json
npx onlyharness run deep-market-researcher
npx onlyharness eval deep-market-researcher
npx onlyharness gate --dir deep-market-researcher
npx onlyharness update deep-market-researcher --diff
npx onlyharness audit-setup
npx onlyharness benchmark benchmarks/research-discovery.yaml --json
npx onlyharness extract ~/.claude/skills/my-skill --out my-skill-harness
HH_ORG_TOKEN=<org-token> npx onlyharness setup @acme
HH_ORG_TOKEN=<org-token> npx onlyharness publish workflow.md --org acme --name team-workflow
HH_ORG_TOKEN=<org-token> npx onlyharness sync git@github.com:acme/skills.git --org acme
```

Global install after npm publish:

```bash
npm i -g onlyharness
hh doctor
```

This local branch only prepares the npm bundle; it does not publish the package.

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
```

## Agent Contract

- `hh search <terms> --json` prints machine-readable registry results.
- `hh suggest <terms> --json` searches, fetches detail, and prints a trust summary for the selected harness.
- `hh suggest <terms> --apply --out <dir>` installs through the same archive path as `hh pull`, preserves paid 402/directory 409 behavior, and records `applied` only after files are written.
- Registry and local inspect payloads include `contextCost: { approxTokens, files, bytes, status: "estimated" }` from markdown instruction files.
- `hh install owner/name --target cli|claude-code|codex|cursor` pulls a runnable harness and records a privacy-safe `install` event after optional adapter generation succeeds.
- `hh pull owner/name` writes a runnable harness directory and sends `HH_TOKEN` when set.
- `hh install owner/name --pay` and `hh pull owner/name --pay` use `HH_WALLET_KEY` or `EVM_PRIVATE_KEY` for x402-enabled 402 responses and refuse to sign above `HH_MAX_PAY_USD`.
- `hh install @org/name` and `hh pull @org/name` send `HH_ORG_TOKEN` when set.
- `hh adapt [dir] --target claude-code|codex|cursor` writes local adapter instruction files and refuses to overwrite without `--force`.
- `hh mcp-config [dir] --target claude-desktop|claude-code|cursor` generates package-backed MCP client JSON from `tools.mcp_servers`.
- `hh run` is sample mode only: no LLM calls, no credentials.
- `hh eval` writes `.harnesshub/results.json`.
- `hh gate` enforces `quality_gates` from `harness.yaml`.
- `hh gate --receipt` writes a signed gate receipt to `.harnesshub/gate-receipt.json` by default. The receipt includes harness ref, version, `resultsHash`, verdict and timestamp, signed with the local ed25519 install key at `~/.onlyharness/key`.
- `hh doctor --harness [dir]` checks a local harness plus registry connectivity.
- `hh audit-setup` scans local `~/.claude` and `./.claude` skills for trigger conflicts, stale skills and estimated markdown context cost. It stays local and emits a sanitized share card.
- `hh benchmark <suite.yaml>` runs a local category benchmark suite across candidate and analog harness paths. It compares declared eval case scores and exits 3 for invalid, unverified, or below-threshold candidate suites.
- `hh extract <skill-dir|SKILL.md>` creates a private `harness.v0.2` scaffold from local skill markdown, infers candidate `depends_on`, and redacts obvious token-shaped secrets.
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
