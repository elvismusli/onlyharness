---
name: superskill
description: "Use when the user explicitly asks SuperSkill to find a reviewed capability, search the public skill catalog, or install an explicitly selected SuperSkill-hosted skill; also use when a substantial task maps to a curated job category and no selected local skill covers it."
---

# SuperSkill

Use the same managed flow in Claude Code and Codex. The project-local `superskill_local` MCP owns the managed lifecycle. The public SuperSkill MCP is browse/search fallback only and cannot recommend or activate managed files.

## Runtime preflight

This plugin is bound to `onlyharness@0.2.19` and activation contract `superskill.activation.v1`.

Before managed work, require the project-local `superskill_local` MCP with exactly the eight lifecycle tools listed below. A fresh client session and normal MCP trust approval may be required after one-link install. If it is absent, stop with `LOCAL_MCP_UNAVAILABLE`; do not silently replace the lifecycle with shell commands, a global CLI, `latest`, or the public MCP. The pinned CLI is only a fail-closed installer/diagnostic recovery path.

Never ask the user or tools to print/read `HH_TOKEN`. It may exist only in the inherited process environment and is sent by the local MCP runtime only as an Authorization header. It is never a tool argument or stored in project config. `HH_SUPERSKILL_TOKEN` is legacy internal-alpha compatibility and is not public proof.

If managed access reports `SUPERSKILL_AUTH_REQUIRED` or `SUPERSKILL_AUTH_INVALID`, do not run login through an agent shell or ask for a pasted token. Tell a Codex user to run `eval "$(npx --yes onlyharness@0.2.19 auth login --shell --client codex)"` in a trusted terminal; use the `claude-code` client value for Claude Code. They approve the one-time code on the signed-in SuperSkill Account page, then start a fresh client session from that terminal. The short-lived token must never enter agent context or project files.

Set one explicit `client` on every tool call:

- Claude Code: `claude-code`
- Codex: `codex`

Do not infer the host from `.claude` or `.agents` directories. If the host is unknown, stop with `CLIENT_NOT_DETECTED`.

The universal installer may create a private pending exact handoff. Treat it only as a request. Before generic routing, call local `recommend` with `pendingHandoffAction=disclose`, the explicit client and routing consent. It rechecks the exact tuple online without sending a task summary. Show the returned disclosure and ask separate activation consent. `activation_start` atomically acknowledges the exact handoff only after `ready`; an explicit `pendingHandoffAction=dismiss` also requires `handoffDismissConsent=true`. Never activate merely because the handoff exists.

## When not to route

Do not use SuperSkill for trivial edits, translation or formatting; when the user already selected a local skill; for unsupported categories; or when the user says not to use external resources. Never auto-fallback to an unscanned browse-only package.

## Explicit public catalog install

Keep this separate from managed recommendation. Use it only when the user explicitly asks to search/install a public catalog skill or chooses one exact hosted skill after `no_safe_match`.

1. Use the public `superskill` MCP `search_resources`, `resource_detail`, and `resource_use_instructions`. For an exact shared URL `/resources/{id}/releases/{version}`, parse and preserve both `id` and `version`, and pass that unchanged `version` to both `resource_detail` and `resource_use_instructions`; never downgrade an exact link to an id-only/latest call. Require both returned release tuples and both install commands to match the shared version and one artifact digest, otherwise fail closed. Do not send repository context, prompts, credentials or personal data as the query.
2. Install only a `skill` with an exact `onlyharness:packages/<name>` ID and a SuperSkill-hosted immutable archive. Refuse `open_only`, missing-archive, redirecting, failing-scan or non-skill resources.
3. Show title, exact resource ID, current version, security-scan/risk/license state, and that browse-catalog install is neither managed approval nor Verified evidence.
4. Ask explicit install consent. This consent is not routing, activation or pin consent. `not_scanned`/`warn` requires a direct acknowledgement before `--allow-unreviewed`; never infer it from a generic request.
5. After consent, use the exact current-client command returned by `resource_use_instructions`. It must be pinned to `onlyharness@0.2.19`, pass the explicit `--target`, and use `--allow-unreviewed` only for the disclosed release.
6. Report the returned native target, exact version and archive digest. A new client task may be required before the newly installed skill triggers.

Never call managed lifecycle tools for a browse-catalog install or describe the installed files as activated, reviewed, approved, pinned or kept.

## Managed flow

1. Call local `recommend` in pending-handoff disclosure mode. If it returns `EXACT_HANDOFF_READY`, use that exact decision and do not send a generic task summary. `HANDOFF_NOT_FOUND` means continue normally.
2. Otherwise create a privacy-safe task summary of 3–500 characters. Exclude paths, prompt history, credentials, personal data and repository identity.
3. Before the summary leaves the machine, show the exact sanitized summary, say it will be sent to `https://superskill.sh/api`, and ask routing consent. Explicit invocation may cover routing for the current session only.
4. Call local `activation_doctor` if inventory is absent or stale.
5. Call local `recommend` with the exact displayed summary and `routingConsent=true`.
6. `no_safe_match` is a normal decision: explain that no suitable reviewed resource exists and continue with normal capabilities. For `needs_clarification`, ask only the returned question.
7. For `recommend`, show the exact name/version/digest, selection reasons, named checks, declared permissions, honest partial/unknown baseline, limitations, temporary mode, and that the summary left the machine.
8. Ask separate explicit activation consent. General SuperSkill approval is not activation consent.
9. Create one random `req_...` ID and retain it unchanged for retries. Call local `activation_start` with the exact recommendation ID, decision digest, expiry, release tuple and `activationConsent=true`.
10. Read only the opaque `resourceUri` values returned in `plan.files`; never use returned or guessed filesystem paths and never scan local metadata.
11. Call local `activation_mark_loaded` after loading only that plan. Call local `activation_mark_invoked` immediately before applying its first stage.
12. Apply stages in returned order using only current-client tools and existing sandbox/approval policy. Do not install missing tools or weaken policy automatically.
13. Call local `activation_finish` with honest outcome and evidence. `agent_reported` is not a verified business outcome; required external work that was not performed cannot be success.
14. Offer keep only after outcome when reuse is plausible. Ask separate consent, then call local `activation_keep` with the exact activation ID and `keepConsent=true`.

## Pinned and removal lifecycle

Pinned skills must perform an online exact-release/revocation recheck on every new use. Call local `activation_start` with the trusted owning `pinnedActivationId`, a fresh request ID and `activationConsent=true`; do not pass an arbitrary marker path. The returned MCP plan includes every digest-bound managed instruction reference. Offline reuse is blocked. `detected_on_disk` is not `loaded`.

Never auto-update a pin. Doctor may recommend explicit removal followed by a fresh temporary activation and pin. Remove works offline through local `activation_remove` and must use the trusted owning activation ID with `removeConsent=true`.

If the marker, owning activation record, or any managed file digest does not match, make no further deletion and give manual-cleanup guidance. Never delete legacy `.codex/harnesses`; report it as unmanaged and pin fresh Codex skills only under `.agents/skills`.

The required local tools are exactly: `activation_doctor`, `recommend`, `activation_start`, `activation_mark_loaded`, `activation_mark_invoked`, `activation_finish`, `activation_keep`, and `activation_remove`.

Read [consent.md](references/consent.md) before presenting disclosure and [lifecycle.md](references/lifecycle.md) before changing activation state.
