---
name: onlyharness
description: "Use when the user wants a ready-made AI-agent resource or native harness package (research, support triage, finance safety review, GTM): search, suggest, pull, run, eval, gate, update, or publish one from onlyharness.com."
---

# OnlyHarness

OnlyHarness is a registry for reusable AI-agent resources: skills, plugins, workflows, MCP servers, command packs, guides, runtimes and native harness packages. A native harness package is one strict format with manifest, prompts, examples, eval cases, permissions and gates.

## Fast Path

Use the CLI first when shell access is available. The `onlyharness` npm package is published for search/suggest/install/run/eval/gate and mixed resource catalog commands. If shell access is not available, use the HTTP/MCP fallback below.

```bash
npx onlyharness@latest suggest market research --json
npx onlyharness@latest resources search superpowers --json
npx onlyharness@latest resources detail github:obra/superpowers --json
npx onlyharness@latest resources open github:obra/superpowers --json
npx onlyharness@latest suggest market research --apply --out suggested-deep-market-researcher --json
npx onlyharness@latest suggest market research --apply --target claude-code --out suggested-deep-market-researcher --adapter-out .claude/skills/deep-market-researcher --json
npx onlyharness@latest install harnesses/deep-market-researcher --target claude-code --json
npx onlyharness@latest publish-resource ./agent-tool --name agent-tool --type command_pack --json

npm run build -w onlyharness
node packages/harness-cli/dist/hh.mjs resources search superpowers --json
node packages/harness-cli/dist/hh.mjs resources detail github:obra/superpowers --json
node packages/harness-cli/dist/hh.mjs resources open github:obra/superpowers --json
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
HH_TOKEN=<access-token> node packages/harness-cli/dist/hh.mjs publish-resource ./agent-tool --name agent-tool --type command_pack --json
HH_TOKEN=<access-token> node packages/harness-cli/dist/hh.mjs publish-resource https://github.com/acme/agent-tool.git --path packages/tool --name agent-tool --type command_pack --json
HH_ORG_TOKEN=<org-token> node packages/harness-cli/dist/hh.mjs setup @acme --json
HH_ORG_TOKEN=<org-token> node packages/harness-cli/dist/hh.mjs publish workflow.md --org acme --name team-workflow --json
```

`hh run` is sample mode only: no LLM calls and no credentials.
Start with `hh suggest <task> --json` or `harness_detail`; read the ranked candidates plus the selected harness trust summary before installing. Use `--pick <rank>` when another candidate is a better fit. Use `hh suggest --apply` only when the user asked to install/apply or explicitly approved the selected harness.
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
node packages/harness-cli/dist/hh.mjs publish-resource ./agent-tool --name agent-tool --type command_pack --json
```

`hh publish workflow.md` creates a small markdown-derived scaffold. `hh publish <dir>` is the strict native verified path and requires eval/gate. `hh publish-resource <dir-or-git-url>` publishes a hosted mixed resource package for skills, plugins, workflows, MCP servers, command packs, scripts, docs and source bundles; it does not grant a Verified harness badge.

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
- `harness_detail`: inspect manifest, trust, examples, files and read-only access/payment state.
- `pull_instructions`: get CLI/archive commands plus entitlement-aware payment state.
- `pull_harness`: get archive files; paid harnesses return payment requirements unless Bearer token is entitled.
- `search_resources`: search mixed source-aware resources such as skills, plugins, workflows and MCP servers.
- `resource_detail`: inspect provenance, trust, popularity and actions for one resource.
- `resource_use_instructions`: get OnlyHarness-first use/open/install guidance; hosted packages expose OnlyHarness archive URLs, upstream-only resources stay open-only.
- `search_docs`: search OnlyHarness agent docs.
- `publish_markdown_to_harness`: publish markdown; Bearer token required.
- `publish_resource_package`: publish a hosted resource package from bounded file contents; Bearer token required; not a Verified harness badge.

## Safety

Community stats, stars, forks, thread replies and Harness Heat are not safety guarantees.
Do not install or apply a harness whose detail/security report fails, is missing, or has blocking risk findings; present the risk instead.
Inspect `harness.yaml` before real runtime use. Show permissions in the answer when they matter, and do not enable `external_send` or `money_movement` without explicit human approval.
Paid harnesses require explicit user approval before checkout or x402 signing. Never bypass HTTP 402 or treat a missing entitlement as not found.
