---
name: superskill
description: "Use when the user explicitly asks SuperSkill to find a reviewed capability, search the public agent-resource catalog, or install an explicitly selected SuperSkill-hosted skill or native public harness; also use when a substantial task maps to a curated job category and no selected local skill covers it."
---

# SuperSkill

Use the same managed flow in Claude Code and Codex. The project-local `superskill_local` MCP owns the managed lifecycle. The public SuperSkill MCP is browse/search fallback only and cannot recommend or activate managed files.

## Runtime preflight

This plugin is bound to `onlyharness@0.3.1` and activation contract `superskill.activation.v1`.

Before managed work, require the project-local `superskill_local` MCP with the lifecycle, browser-auth, publishing and workspace tools listed below. One fresh client session and normal MCP trust approval may be required after one-link install. If it is absent, stop with `LOCAL_MCP_UNAVAILABLE`; do not replace it with shell commands, a global CLI, `latest`, or the public MCP.

Never ask the user or tools to print/read a token. The local MCP stores a renewable session in the OS keychain and keeps access tokens only in process memory. Credentials must never be tool arguments, tool results, project config, browser query parameters or agent-visible logs.

On `SUPERSKILL_AUTH_REQUIRED`, `SUPERSKILL_AUTH_INVALID` or `AUTH_SCOPE_REQUIRED`:

1. Retain the original tool name, arguments and idempotency key locally.
2. Call `auth_start` with the explicit client and only the scopes required by that operation.
3. Tell the user to complete the browser page that was opened. Never ask for a URL, code, proof or token.
4. Call `auth_wait` until it returns `AUTH_AUTHORIZED`, denial or expiry. Do not restart the task. On authorization the local broker replays its saved protected call exactly once with the unchanged arguments and idempotency key.
5. If `auth_wait.continuation` is present, use that result and do not submit the original tool again. During the one-release transition only, an older broker may return authorized without `continuation`; in that case retry the exact original tool once. Never loop mutations.

If `auth_start` reports `AUTH_BROWSER_UNAVAILABLE`, tell the user to run `hh auth login --no-browser --client <client>` plus one `--scope` flag for every exact scope in the matrix below, in a trusted terminal. This is the only path that may display the fragment authorization URL. Never omit the operation scopes or request broader scopes.

Set one explicit `client` on every tool call:

- Claude Code: `claude-code`
- Codex: `codex`

Do not infer the host from `.claude` or `.agents` directories. If the host is unknown, stop with `CLIENT_NOT_DETECTED`.

Use this exact protected-operation scope matrix:

- Managed `recommend`, live `activation_doctor`, `activation_start`, `activation_keep`: `superskill:managed`.
- `publish_markdown_to_harness`, `publish_resource_package`: `resources:publish`.
- `workspace_create`: `workspaces:write`.
- `workspace_get`, `workspace_install`: `workspaces:read`.
- `workspace_publish_resource`: both `workspaces:write` and `resources:publish`.

Workspace scopes never grant membership. The server separately requires a current active, unexpired, non-suspended membership and the role needed by the workspace route. A 403 after successful authorization is terminal for that call: explain the membership/role failure and do not start another auth loop.

The universal installer may create a private pending exact handoff. Treat it only as a request. Before generic routing, call local `recommend` with `pendingHandoffAction=disclose`, the explicit client and routing consent. It rechecks the exact tuple online without sending a task summary. Show the returned disclosure and ask separate activation consent. `activation_start` atomically acknowledges the exact handoff only after `ready`; an explicit `pendingHandoffAction=dismiss` also requires `handoffDismissConsent=true`. Never activate merely because the handoff exists.

## When not to route

Do not use SuperSkill for trivial edits, translation or formatting; when the user already selected a local skill; for unsupported categories; or when the user says not to use external resources. Never auto-fallback to an unscanned browse-only package.

## Explicit public catalog install

Keep this separate from managed recommendation. Use it only when the user explicitly asks to search/install a public catalog resource or chooses one exact installable resource after `no_safe_match`.

1. Use the public `superskill` MCP `search_resources`, `resource_detail`, and `resource_use_instructions` without forcing `type=skill`. Do not send repository context, prompts, credentials or personal data as the query. If the public MCP tools are not attached but a local shell is available, the only allowed fallback is the same pinned read-only CLI surface: `npx --yes onlyharness@0.3.1 resources search ... --json` and `resources detail ... --json`; never use `latest` or an unpinned package.
2. There are exactly two installable public modes. A hosted skill must have resource type `skill`, exact ID `onlyharness:packages/<name>`, an immutable SuperSkill archive, and matching version/digest/size/trust tuples from `resource_detail` and `resource_use_instructions`. For an exact shared URL `/resources/{id}/releases/{version}`, preserve the version unchanged in both calls; never downgrade an exact link to an id-only/latest call. A native harness must have resource type `harness`, exact ID `onlyharness:<owner>/<name>`, `installability=installable`, and an exact `nativeInstall` tuple; a raw `install` action or legacy `hh install` command is forbidden. For a native harness also call `harness_detail` and `pull_instructions`; require a valid public free manifest, `content.type=harness`, a semantic version, passing `static-v2` security, and byte-identical native tuples and client commands across all four detail/instruction responses. Refuse paid, entitlement-gated, private, directory, `open_only`, missing-archive, redirecting, failing-scan, or every other resource type as a native install.
3. Show title, exact resource ID, current version, security-scan/risk/license state, and that browse-catalog install is neither managed approval nor Verified evidence.
4. Ask explicit install consent. This consent is not routing, activation or pin consent. `not_scanned`/`warn` requires a direct acknowledgement before `--allow-unreviewed`; never infer it from a generic request.
5. After consent, use the exact current-client command returned by `resource_use_instructions` for a hosted skill or `pull_instructions.commands` for a native harness. It must be pinned to `onlyharness@0.3.1`, preserve the exact version, pass the explicit `--target`, and use `--allow-unreviewed` only for the disclosed hosted-skill release. Never add `--pay`, `--force`, a token, or an environment credential.
6. Report the returned native target, exact version and archive digest. A new client task may be required before the newly installed skill or harness adapter triggers.

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

The required local tools are:

- Auth: `auth_status`, `auth_start`, `auth_wait`, `auth_logout`.
- Managed lifecycle: `activation_doctor`, `recommend`, `activation_start`, `activation_mark_loaded`, `activation_mark_invoked`, `activation_finish`, `activation_keep`, `activation_remove`.
- Account publishing: `publish_markdown_to_harness`, `publish_resource_package`.
- Workspaces: `workspace_create`, `workspace_get`, `workspace_publish_resource`, `workspace_install`.

Use remote `superskill` MCP only for anonymous public search/detail/install guidance. Use local account tools for protected publishing and workspaces. Call `workspace_install` only after explicit consent; report local writes only when it returns `WORKSPACE_INSTALLED` or `WORKSPACE_UNCHANGED`.

Read [consent.md](references/consent.md) before presenting disclosure and [lifecycle.md](references/lifecycle.md) before changing activation state.
