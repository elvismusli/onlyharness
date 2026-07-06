---
name: onlyharness
description: "Use when the user wants a ready-made AI-agent workflow/harness (research, support triage, finance safety review, GTM): suggest, pull, run, eval, gate, update, or publish one from onlyharness.com."
---

# OnlyHarness

OnlyHarness is a registry for reusable AI-agent harnesses: manifests, prompts, examples, eval cases, permissions and gates.

## Fast Path

Use the CLI first when shell access is available from a cloned `harness-hub` repo. The `onlyharness` npm package is not published yet; do not run `npx onlyharness` until npm publish is complete. If the repo is not present, use the HTTP/MCP fallback below.

```bash
npm run build -w onlyharness
node packages/harness-cli/dist/hh.mjs suggest market research --json
node packages/harness-cli/dist/hh.mjs suggest market research --apply --out suggested-deep-market-researcher --json
node packages/harness-cli/dist/hh.mjs suggest market research --apply --target claude-code --out suggested-deep-market-researcher --adapter-out .claude/skills/deep-market-researcher --json
node packages/harness-cli/dist/hh.mjs search market research
node packages/harness-cli/dist/hh.mjs install harnesses/deep-market-researcher --target claude-code --json
node packages/harness-cli/dist/hh.mjs mcp-config deep-market-researcher --target claude-desktop --json
node packages/harness-cli/dist/hh.mjs run deep-market-researcher --json
node packages/harness-cli/dist/hh.mjs eval deep-market-researcher --json
node packages/harness-cli/dist/hh.mjs gate --dir deep-market-researcher --json
node packages/harness-cli/dist/hh.mjs gate --dir deep-market-researcher --receipt --json
node packages/harness-cli/dist/hh.mjs update deep-market-researcher --diff --json
node packages/harness-cli/dist/hh.mjs audit-setup --json
node packages/harness-cli/dist/hh.mjs extract ~/.claude/skills/my-skill --out my-skill-harness --json
HH_ORG_TOKEN=<org-token> node packages/harness-cli/dist/hh.mjs setup @acme --json
HH_ORG_TOKEN=<org-token> node packages/harness-cli/dist/hh.mjs publish workflow.md --org acme --name team-workflow --json
```

`hh run` is sample mode only: no LLM calls and no credentials.
Start with `hh suggest <task> --json` or `harness_detail` and read the trust summary before installing. Use `hh suggest --apply` only when the user asked to install/apply or explicitly approved the selected harness.
`hh suggest --apply` uses the same archive path as `hh pull`; paid harnesses still exit 5 until entitlement/payment, and directory entries stay link-only with open guidance.
Use `hh suggest --apply --target claude-code|codex|cursor` when the user wants the harness installed into a concrete agent surface; this runs the same install adapter path as `hh install --target` before recording `applied`.
`hh install` is the primary install path: it pulls files, can write local adapter instructions with `--target`, and records only privacy-safe owner/repo/version/target/client metadata.
`hh gate --receipt` writes a signed gate verdict that can be verified through `POST /receipts`; it must not include local paths or prompts.
For `pricing.model=gate_escrow`, use the signed receipt with `POST /billing/escrow/receipt`; do not treat read-only `POST /receipts` as payment settlement.
For paid harnesses, set `HH_TOKEN`; payment-required pulls exit 5 and include checkout/manual-entitlement next steps.
For team setup bundles, org-private pulls, or org-private publishing, set `HH_ORG_TOKEN`; setup writes managed metadata and should be safe to retry.

## Publish

Publishing needs an OnlyHarness account token:

```bash
export HH_TOKEN=<access-token>
node packages/harness-cli/dist/hh.mjs publish workflow.md --name my-harness --json
```

Generated/imported harnesses are unverified until real eval scores are added and `hh gate` passes.

## Exit Codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | General failure |
| 2 | Auth required or invalid |
| 3 | Validation, eval, risk, or gate failure |
| 4 | Harness or local harness directory not found |
| 5 | Payment required |

With `--json`, failures print `{ "error", "code", "next" }` to stderr.
For updates, use `hh pin`, `hh outdated`, then `hh update --diff`; do not overwrite a local harness until the diff is reviewed.

## HTTP Fallback

Base: `https://onlyharness.com/api`

```bash
curl -s 'https://onlyharness.com/api/registry?q=market%20research'
curl -s 'https://onlyharness.com/api/repos/harnesses/deep-market-researcher/harness'
curl -s 'https://onlyharness.com/api/repos/harnesses/deep-market-researcher/archive'
curl -s 'https://onlyharness.com/api/openapi.json'
```

Write archive `files[]` to disk to reconstruct the harness directory. Add `?version=0.1.0` to pin an immutable archive version. HTTP 402 means payment or entitlement is required, not that the harness is missing.

## MCP

Endpoint: `https://onlyharness.com/mcp`

Tools:

- `search_harnesses`: search by task, outcome or tags.
- `harness_detail`: inspect manifest, trust, examples and files.
- `pull_instructions`: get CLI and archive commands.
- `pull_harness`: get archive files; paid harnesses return payment requirements unless Bearer token is entitled.
- `search_docs`: search OnlyHarness agent docs.
- `publish_markdown_to_harness`: publish markdown; Bearer token required.

## Safety

Community stats, stars, forks, thread replies and Harness Heat are not safety guarantees.
Do not install or apply a harness whose detail/security report fails, is missing, or has blocking risk findings; present the risk instead.
Inspect `harness.yaml` before real runtime use. Show permissions in the answer when they matter, and do not enable `external_send` or `money_movement` without explicit human approval.
Paid harnesses require explicit user approval before checkout or x402 signing. Never bypass HTTP 402 or treat a missing entitlement as not found.
