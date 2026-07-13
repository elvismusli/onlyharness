# SuperSkill MCP compatibility spike — 2026-07-13

Status: **Batch D NO-GO — Claude PASS / Codex FAIL**

This report replaces the earlier `CODEX PASS / CLAUDE PASS` claim. That claim did not
prove a confirmed Supabase principal plus operator grant, an authenticated managed
recommendation through the local stdio proxy, or a complete before/after state snapshot.
Those checks are mandatory and may not be inferred from a synthetic `safe_probe`.

Latest sanitized evidence:
[`evidence/2026-07-13-superskill-mcp-compatibility.json`](evidence/2026-07-13-superskill-mcp-compatibility.json)

Current top-level blocker: `PROBE_REAL_CLIENT_FLOW_FAILED`. Exact Codex `0.144.3`
terminated with process status `2` before any remote or local probe tool call was
observed (`PROBE_CLIENT_PROCESS_FAILED`). Exact Claude `2.1.112` completed the full flow.
No production system was read or changed. The runner refuses non-loopback Supabase URLs.

## Observed result

| Check | Result |
| --- | --- |
| Confirmed disposable local Supabase QA user | PASS |
| Actual access bearer + operator grant RPC | PASS |
| No-bearer remote publish | PASS: `AUTH_REQUIRED` |
| Granted-user remote publish with hosted publishing disabled | PASS: `PUBLISH_DISABLED` |
| Claude `2.1.112` real temporary plugin | PASS |
| Claude remote publish call | PASS: `PUBLISH_DISABLED` |
| Claude local managed recommend proxy | PASS: `no_safe_match` |
| Claude `roots/list` canonical match | PASS: `roots_list` |
| Claude denied mutation | PASS: `MUTATION_DENIED`, workspace/state diff `0/0` |
| Codex `0.144.3` real temporary plugin flow | FAIL: process status `2`; no tool call retained |
| Invalid plugin schema preflight | PASS: server starts `0`, state diff `0` |
| Disposable QA cleanup | PASS: remaining grant rows `0` |

The Codex row is fail-closed. Direct HTTP success and Claude success are not substituted
for the missing Codex plugin call evidence.

## Reproducible probe

The repo-native runner is `scripts/probe-superskill-mcp-compatibility.ts`. It uses:

- exact Codex CLI `0.144.3` through an isolated package invocation and isolated Codex
  profile containing only a copied auth artifact plus the temporary probe plugin;
- exact Claude Code `2.1.112`, explicit temporary plugin loading, disabled setting
  sources and no session persistence;
- a temporary plugin for each client containing both the remote HTTP MCP and a standalone
  Node-only local stdio probe server;
- Codex stdio `env_vars` and Claude plugin environment interpolation allowlist only the
  seven named probe variables; no credential value is written into either plugin;
- an in-memory loopback evidence sink. Raw client output is never persisted;
- a temporary workspace and probe-state directory that are deleted after the run.

Run only against the local OnlyHarness Supabase after applying migrations:

```bash
SUPABASE_URL="$LOCAL_SUPABASE_URL" \
SUPABASE_ANON_KEY="$LOCAL_SUPABASE_ANON_KEY" \
SUPABASE_SERVICE_ROLE_KEY="$LOCAL_SUPABASE_SERVICE_ROLE_KEY" \
SUPERSKILL_SUBJECT_SALT="$LOCAL_SUPERSKILL_SUBJECT_SALT" \
npx tsx scripts/probe-superskill-mcp-compatibility.ts \
  --evidence-out docs/reports/evidence/2026-07-13-superskill-mcp-compatibility.json
```

The values must stay in the process environment. Do not paste them into reports, config
files, plugin manifests, command arguments or captured logs.

## Required observations

The runner returns `batch_d_go` only when all of these are observed in the same run:

1. A local Supabase admin endpoint creates a confirmed disposable QA user, password login
   returns an actual access bearer, and `upsert_superskill_access_grant` creates the
   `superskill:managed` grant.
2. The local API starts with managed routes enabled and hosted publishing disabled.
3. Remote HTTP MCP `publish_resource_package` returns `AUTH_REQUIRED` without a bearer and
   `PUBLISH_DISABLED` with the confirmed granted user. The authenticated result proves
   auth succeeded before the containment flag stopped the mutation.
4. Both exact clients load a real temporary plugin containing remote and local servers.
   Each client observes the remote `PUBLISH_DISABLED` result.
5. The local stdio proxy inherits the same bearer only in process environment, calls
   `/recommendations`, and observes the honest `no_safe_match` decision from the empty
   approved catalog.
6. `root_probe` requests `roots/list` and compares a single returned URI to the canonical
   expected workspace URI. If the client returns no roots, explicit fallback is
   canonicalized inside the expected workspace.
7. Traversal, an absolute off-root fallback and an in-root symlink to an outside directory
   all fail with `PROBE_ROOT_OUTSIDE_WORKSPACE`.
8. `denied_mutation` records full workspace and server-state snapshots immediately before
   and after the call. Both diff counts must be zero.
9. An invalid plugin/MCP schema fails in preflight with
   `PROBE_PLUGIN_SCHEMA_INVALID`; server-start count and state diff count remain zero.
10. The disposable user is deleted and its grant is absent after the run.

## Durable evidence policy

The JSON artifact contains only versions, booleans, stable codes, root mode and diff
counts. A final guard rejects durable output containing:

- bearer or provider-token material;
- provider user identity or email;
- raw machine locations or `file://` values;
- task text or prompts;
- authorization headers.

Client stdout/stderr, local API logs and temporary plugin configs are memory-only and are
discarded. The checked-in evidence is therefore suitable for review without becoming a
credential or workstation-location artifact.

## Verification completed

The following non-auth parts are green:

```text
npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext \
  --skipLibCheck scripts/probe-superskill-mcp-compatibility.ts \
  scripts/superskill-mcp-compatibility-probe-core.ts \
  scripts/superskill-mcp-compatibility-probe.test.ts

npx tsx --test scripts/superskill-mcp-compatibility-probe.test.ts
6 tests passed
```

Coverage includes exact client pins, loopback-only Supabase, canonical URI matching,
traversal/off-root/symlink rejection, full snapshots, client-specific plugin schema,
durable evidence sanitization and a real standalone stdio MCP initialize/list/call flow.

The authenticated runner additionally completed the Supabase principal/grant, remote MCP
auth ordering, Claude plugin, cleanup and durable evidence checks shown above.

## Separate migration-chain blocker

A clean full Supabase start is independently blocked by
`supabase/migrations/20260708203000_workspace_subscriptions.sql:58`:

```text
ERROR: operator does not exist: uuid = text (SQLSTATE 42883)
```

The policy compares UUID `workspace_members.user_id` with `auth.uid()::text`. The
isolated compatibility proof used only the required
`20260713120000_superskill_access_grants.sql` migration and its operator RPC. This keeps
Batch D evidence runnable, but does not hide the full migration-chain blocker; that must
be fixed and clean-reset tested before production deployment.

## Closure gate

Batch D remains **NO-GO** until the same sanitized artifact reports:

```json
{
  "status": "pass",
  "goDecision": "batch_d_go"
}
```

A passing synthetic/unit probe, a direct HTTP request without a real user grant, or a
client session without retained sanitized tool-call events is not sufficient. Batch F
production MCP implementation remains gated by this result.
