---
name: superskill
description: "Use when the user explicitly asks SuperSkill or OnlyHarness to find a reviewed capability, or when a substantial task clearly maps to a curated job category and no explicitly selected local skill already covers it."
---

# SuperSkill

Use the same managed flow in Claude Code and Codex. The public OnlyHarness MCP is browse/search fallback only; it cannot recommend or activate managed files.

## Runtime preflight

This plugin is bound to `onlyharness@0.2.13` and activation contract `superskill.activation.v1`.

Before a managed command, verify Node.js and npm are available. If they are missing, stop with `LOCAL_CLI_UNAVAILABLE`; do not use a global or `latest` CLI as a substitute. Never ask the user or tools to print/read `HH_SUPERSKILL_TOKEN`. The token may exist only in the terminal environment and is sent by the CLI only as an Authorization header.

Set one explicit host target on every command:

- Claude Code: `--target claude-code`
- Codex: `--target codex`

Do not infer the host from `.claude` or `.agents` directories. If the host is unknown, stop with `CLIENT_NOT_DETECTED`.

## When not to route

Do not use SuperSkill for trivial edits, translation or formatting; when the user already selected a local skill; for unsupported categories; or when the user says not to use external resources. Never auto-fallback to an unscanned browse-only package.

## Managed flow

1. Create a privacy-safe task summary of 3–500 characters. Exclude paths, prompt history, credentials, personal data and repository identity.
2. Before the summary leaves the machine, show the exact sanitized summary, say it will be sent to `https://onlyharness.com/api`, and ask routing consent. Explicit invocation may cover routing for the current session only.
3. Run `npx --yes onlyharness@0.2.13 activation doctor --target <host> --json` if inventory is absent or stale.
4. Run `npx --yes onlyharness@0.2.13 recommend <summary> --target <host> --json`.
5. `no_safe_match` is a normal decision: explain that no suitable reviewed resource exists and continue with normal capabilities. For `needs_clarification`, ask only the returned question.
6. For `recommend`, show the exact name/version/digest, selection reasons, named checks, declared permissions, honest partial/unknown baseline, limitations, temporary mode, and that the summary left the machine.
7. Ask separate explicit activation consent. General SuperSkill approval is not activation consent.
8. Create one random `req_...` ID and retain it unchanged for retries. Run the exact `activation start` command returned by `recommend`, with `--consent explicit`.
9. Read only `plan.files` below `plan.root`; do not scan every reference, result file or local metadata.
10. Run `activation mark <id> --state loaded --json` after loading only that plan. Run `activation mark <id> --state invoked --json` immediately before applying its first stage.
11. Apply stages in returned order using only current-client tools and existing sandbox/approval policy. Do not install missing tools or weaken policy automatically.
12. Run `activation finish` with honest outcome and evidence. `agent_reported` is not a verified business outcome; required external work that was not performed cannot be success.
13. Offer keep only after outcome when reuse is plausible. Ask separate consent, then run `activation keep <id> --confirm-keep --json`.

## Pinned and removal lifecycle

Pinned skills must perform an online exact-release/revocation recheck on every new use. Offline reuse is blocked. `detected_on_disk` is not `loaded`.

Never auto-update a pin. Doctor may recommend explicit marker-based remove followed by a fresh temporary activation and pin. Remove works offline and must use the exact project-relative marker:

`npx --yes onlyharness@0.2.13 activation remove --marker <path> --confirm-remove --json`

If the marker, owning activation record, or any managed file digest does not match, make no further deletion and give manual-cleanup guidance. Never delete legacy `.codex/harnesses`; report it as unmanaged and pin fresh Codex skills only under `.agents/skills`.

Read [consent.md](references/consent.md) before presenting disclosure and [lifecycle.md](references/lifecycle.md) before changing activation state.
