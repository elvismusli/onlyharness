# OnlyHarness CLI

`onlyharness` installs the `hh` command for agent harness discovery, local sample runs, evals and quality gates.

```bash
npx onlyharness search market research
npx onlyharness pull harnesses/deep-market-researcher
npx onlyharness run deep-market-researcher
npx onlyharness eval deep-market-researcher
npx onlyharness gate --dir deep-market-researcher
npx onlyharness update deep-market-researcher --diff
npx onlyharness audit-setup
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

Paid harness pulls send `HH_TOKEN` as a bearer token. Without entitlement the registry returns 402 and `hh pull --json` exits 5 with `{ "error", "code", "next" }`.

## Publishing

Publishing needs an OnlyHarness access token.

```bash
HH_TOKEN=<access-token> hh publish workflow.md --name my-harness
```

## Agent Contract

- `hh search <terms> --json` prints machine-readable registry results.
- Registry and local inspect payloads include `contextCost: { approxTokens, files, bytes, status: "estimated" }` from markdown instruction files.
- `hh pull owner/name` writes a runnable harness directory and sends `HH_TOKEN` when set.
- `hh run` is sample mode only: no LLM calls, no credentials.
- `hh eval` writes `.harnesshub/results.json`.
- `hh gate` enforces `quality_gates` from `harness.yaml`.
- `hh doctor --harness [dir]` checks a local harness plus registry connectivity.
- `hh audit-setup` scans local `~/.claude` and `./.claude` skills for trigger conflicts, stale skills and estimated markdown context cost. It stays local and emits a sanitized share card.
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
