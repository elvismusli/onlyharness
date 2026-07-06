---
name: onlyharness
description: "Use when the user wants a ready-made AI-agent workflow/harness (research, support triage, finance safety review, GTM): search onlyharness.com, pull a harness, run its example, eval and gate it, or publish one."
---

# OnlyHarness

OnlyHarness is a registry for reusable AI-agent harnesses: manifests, prompts, examples, eval cases, permissions and gates.

## Fast Path

Use the CLI first when shell access is available:

```bash
npx onlyharness search market research
npx onlyharness pull harnesses/deep-market-researcher
npx onlyharness run deep-market-researcher --json
npx onlyharness eval deep-market-researcher --json
npx onlyharness gate --dir deep-market-researcher --json
```

`hh run` is sample mode only: no LLM calls and no credentials.

## Publish

Publishing needs an OnlyHarness account token:

```bash
export HH_TOKEN=<access-token>
npx onlyharness publish workflow.md --name my-harness --json
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

## HTTP Fallback

Base: `https://onlyharness.com/api`

```bash
curl -s 'https://onlyharness.com/api/registry?q=market%20research'
curl -s 'https://onlyharness.com/api/repos/harnesses/deep-market-researcher/harness'
curl -s 'https://onlyharness.com/api/repos/harnesses/deep-market-researcher/archive'
curl -s 'https://onlyharness.com/api/openapi.json'
```

Write archive `files[]` to disk to reconstruct the harness directory.

## MCP

Endpoint: `https://onlyharness.com/mcp`

Tools:

- `search_harnesses`: search by task, outcome or tags.
- `harness_detail`: inspect manifest, trust, examples and files.
- `pull_instructions`: get CLI and archive commands.
- `search_docs`: search OnlyHarness agent docs.
- `publish_markdown_to_harness`: publish markdown; Bearer token required.

## Safety

Inspect `harness.yaml` before real runtime use. Do not enable `external_send` or `money_movement` without explicit human approval.
