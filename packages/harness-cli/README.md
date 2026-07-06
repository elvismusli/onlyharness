# OnlyHarness CLI

`onlyharness` installs the `hh` command for agent harness discovery, local sample runs, evals and quality gates.

```bash
npx onlyharness search market research
npx onlyharness pull harnesses/deep-market-researcher
npx onlyharness run deep-market-researcher
npx onlyharness eval deep-market-researcher
npx onlyharness gate --dir deep-market-researcher
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

## Publishing

Publishing needs an OnlyHarness access token.

```bash
HH_TOKEN=<access-token> hh publish workflow.md --name my-harness
```

## Agent Contract

- `hh search <terms> --json` prints machine-readable registry results.
- `hh pull owner/name` writes a runnable harness directory.
- `hh run` is sample mode only: no LLM calls, no credentials.
- `hh eval` writes `.harnesshub/results.json`.
- `hh gate` enforces `quality_gates` from `harness.yaml`.

## Exit Codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | General failure or failed gate/eval |

## Bundle

The npm package ships `dist/hh.mjs` as a self-contained esbuild bundle with bins `hh` and `onlyharness`.
