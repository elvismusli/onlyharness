# 04 — Client integration and activation

## 1. Goal

Internal MVP managed execution должен одинаково работать в terminal-launched:

- Claude Code;
- Codex CLI.

Codex app/IDE остаются plugin compatibility surfaces, но не входят в activation
acceptance до отдельного безопасного credential onboarding for GUI-launched processes.

Нельзя создавать два разных router prompts или два lifecycle implementations.

## 2. Shared plugin layout

```text
plugins/superskill/
  .claude-plugin/
    plugin.json
  .codex-plugin/
    plugin.json
  .mcp.json
  runtime.json
  skills/
    superskill/
      SKILL.md
      references/
        consent.md
        lifecycle.md
```

### Shared `.mcp.json`

```json
{
  "mcpServers": {
    "superskill": {
      "type": "http",
      "url": "https://superskill.sh/mcp"
    },
    "superskill_local": {
      "command": "npx",
      "args": ["--yes", "onlyharness@0.2.16", "mcp", "superskill"]
    }
  }
}
```

The remote `superskill` MCP is the public browse/search and hosted-skill instruction path. The project-local
`superskill_local` MCP owns recommendation and the complete managed lifecycle through
exactly eight tools. Its checked-in command is generated from `runtime.json`; contract
checks compare the runtime file, shared skill, one-link bootstrap and generated markers.

Internal onboarding sets one tester-specific environment variable outside repo/plugin:

```bash
export HH_TOKEN=<confirmed-account-bearer-token>
```

The skill never asks the model to print/read the value. Missing token stops network
recommend/start/keep/live-doctor with setup guidance, but offline remove remains
available. Token is inherited by the local MCP process and is not copied into `.mcp.json`,
local state or events. `HH_SUPERSKILL_TOKEN` is legacy internal-alpha compatibility and
cannot produce public-GO evidence.

## 3. Plugin manifests

### 3.1 Claude Code

`plugins/superskill/.claude-plugin/plugin.json`:

```json
{
  "name": "superskill",
  "description": "Install once from a pinned link, then find and consent to an exact reviewed capability.",
  "version": "0.2.0",
  "author": {
    "name": "SuperSkill",
    "url": "https://superskill.sh"
  }
}
```

Claude marketplace root remains `.claude-plugin/marketplace.json` and gets a
`superskill` entry pointing to `./plugins/superskill`.

Install path for internal team:

```bash
claude plugin marketplace add elvismusli/onlyharness
claude plugin install superskill@superskill
```

### 3.2 Codex

`plugins/superskill/.codex-plugin/plugin.json`:

```json
{
  "name": "superskill",
  "version": "0.2.0",
  "description": "Install once from a pinned link, then find and consent to an exact reviewed capability.",
  "author": {
    "name": "SuperSkill",
    "url": "https://superskill.sh"
  },
  "homepage": "https://superskill.sh",
  "repository": "https://github.com/elvismusli/onlyharness",
  "license": "MIT",
  "keywords": ["skills", "agent-tools", "trust", "routing"],
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "SuperSkill",
    "shortDescription": "Choose and activate a reviewed capability for a task",
    "longDescription": "SuperSkill maps a task to an exact reviewed instruction resource, shows permissions and limitations, then activates it temporarily or pins it with explicit consent.",
    "developerName": "SuperSkill",
    "category": "Developer Tools",
    "capabilities": ["Interactive", "Read", "Write"],
    "websiteURL": "https://superskill.sh",
    "defaultPrompt": [
      "Find the best reviewed capability for this task.",
      "Use SuperSkill to help with this task."
    ]
  }
}
```

Optional privacy/terms fields stay omitted until the canonical SuperSkill URLs exist.

Codex marketplace file: `.agents/plugins/marketplace.json`.

Minimal internal entry:

```json
{
  "name": "superskill",
  "interface": { "displayName": "SuperSkill" },
  "plugins": [
    {
      "name": "superskill",
      "source": { "source": "local", "path": "./plugins/superskill" },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL",
        "products": ["CODEX"]
      },
      "category": "Developer Tools"
    }
  ]
}
```

Install path:

```bash
codex plugin marketplace add elvismusli/onlyharness --ref main
codex plugin add superskill@superskill
```

Implementation smoke must validate the actual checked-in marketplace with installed
Codex CLI; this JSON is not accepted only because it matches docs examples.

## 4. Shared master skill

`skills/superskill/SKILL.md` is identical for both clients.

### Trigger boundary

Use when:

- user explicitly asks SuperSkill/OnlyHarness to find a capability;
- task clearly maps to one of curated JTBD categories;
- task is substantial enough that a reusable reviewed workflow may help.

Do not use for:

- trivial edit/translation/formatting;
- task already covered by an explicitly selected local skill;
- unsupported task category;
- user says not to use external resources.

### Client binding

The skill must pass one explicit `client` to every local MCP tool call:

- current host is Claude Code → `claude-code`;
- current host is Codex → `codex`.

Do not infer client from presence of `.claude`/`.agents` directories because both may
exist in the same repo.

If the host cannot determine its own product, stop before recommendation and return
`CLIENT_NOT_DETECTED` guidance. This should not occur in normal plugin use.

### Master flow

```text
1. Decide whether task is eligible for routing.
2. Create <=500 char privacy-safe task summary.
3. Before network, disclose exact sanitized summary and destination and ask routing
   consent. Explicit invocation may reuse one session opt-in; activation consent remains
   separate.
4. Call local `activation_doctor` if inventory is absent or stale.
5. Call local `recommend` with explicit client and routing consent.
6. If no_safe_match: continue task without SuperSkill resource.
7. If needs_clarification: ask only the returned clarification question.
8. If recommend: render candidate/why/limits/permission delta.
9. Ask explicit activation consent.
10. On yes: call local `activation_start` with the exact recommendation tuple and
    `activationConsent=true`.
11. Read only returned `plan.files[].resourceUri` values; never scan or guess local paths.
12. Call `activation_mark_loaded`.
13. Call `activation_mark_invoked` immediately before applying the first workflow stage.
14. Apply stages in declared order.
15. Complete the user task.
16. Call `activation_finish` with an honest outcome; use `user_confirmed` only after an
    explicit user signal.
17. Offer keep after outcome only when repeated use is plausible; keep has separate
    consent.
```

### Consent boundary

Routing consent occurs before task summary leaves the machine. Activation consent occurs
after showing:

- name and exact version;
- why selected;
- permissions/delta;
- trust checks;
- limitations;
- temporary/pinned mode;
- whether task summary leaves the machine.

User approval to use SuperSkill generally is not blanket approval for future resources.

### No-match behavior

No match is not an error. The agent says no suitable reviewed resource exists and
continues with its normal capabilities if the original task is still executable.

It must not fall back to an unscanned browse-only package automatically.

## 5. Local state and sandbox compatibility

Default state root:

```text
<project>/.onlyharness/
```

Reason: both Claude Code and Codex can operate inside the current workspace without
requiring new home-directory write permission.

Layout:

```text
.onlyharness/
  client.json
  inventory.json
  cache/sha256/<digest>/...
  activations/<activation-id>.json
  events-pending.jsonl
```

Rules:

- resolve one project root: explicit `--project-dir` → `git rev-parse --show-toplevel`
  → current working directory, then canonicalize with realpath;
- every state, inventory and pinned adapter path uses that same root;
- if git repo, get exclude file through `git rev-parse --git-path info/exclude` and add
  the root-relative `.onlyharness/` pattern idempotently, including linked worktrees;
- do not edit tracked `.gitignore` automatically;
- support `ONLYHARNESS_STATE_DIR` override;
- reject state root outside allowed workspace unless user explicitly chose it;
- never put secrets in local state;
- cache content is read-only after digest verification.

## 6. Temporary activation

### Start transaction

```text
create activation accepted
→ exact release GET
→ assert activationAllowed
→ state downloading
→ download to .onlyharness/staging/<random>
→ validate paths/file count/size
→ recompute digest
→ validate native manifest and plan files
→ atomic rename to cache/sha256/<digest>
→ write activation ready atomically
```

On any failure:

- remove staging;
- keep previous cache untouched;
- write terminal failed record with safe reasonCode;
- emit activation_failed best-effort.

### Activation plan

Only these files may be exposed to master skill:

- agent prompts referenced by manifest;
- workflow stage mapping;
- runbook explicitly marked relevant;
- optional example input/output.

Do not automatically read:

- `.harnesshub/results.json`;
- every README/reference;
- unrelated files;
- server/local metadata.

### Applying stages

The client agent applies each stage as instruction context. It does not spawn a new
runtime process. If a stage requests a tool:

- use current client tools only;
- respect current sandbox/approval policy;
- do not install missing MCP/package automatically;
- if required tool unavailable, finish with failed/unknown outcome and clear reason.

### Finish

`agent_reported success` means the client believes the requested task completed. It does
not prove business effect or external side effect.

If the task includes required external action that was not performed, success is invalid.

## 7. Pinned skill generation

Pinned directory is self-contained and does not depend on temporary cache.

### Claude Code

```text
.claude/skills/superskill-<capability-id>/
  SKILL.md
  .superskill-managed.json
  references/resource/<required instruction files>
```

### Codex

```text
.agents/skills/superskill-<capability-id>/
  SKILL.md
  .superskill-managed.json
  references/resource/<required instruction files>
```

### Managed marker

```json
{
  "schemaVersion": "superskill.pinned.v1",
  "client": "codex",
  "capabilityId": "market-research",
  "ref": "harnesses/deep-market-researcher",
  "version": "0.2.0",
  "artifactDigest": "sha256:...",
  "cliPackage": "onlyharness",
  "cliVersion": "0.2.16",
  "activationContractVersion": "superskill.activation.v1",
  "pinActivationId": "act_...",
  "pinRequestId": "req_...",
  "managedFiles": {
    "SKILL.md": "sha256:<generated-file-digest>",
    "references/resource/agents/researcher.md": "sha256:<copied-file-digest>"
  },
  "packageDigest": "sha256:<canonical-managed-files-digest>"
}
```

Capability ID and generated directory/frontmatter name use one validated slug:
`^[a-z0-9][a-z0-9-]{0,62}$`. Marker paths are normalized relative paths inside the
pinned root. A symlink in a managed file or any ancestor fails closed.

### Generated SKILL.md requirements

- valid frontmatter `name` and `description`;
- description names real trigger phrases;
- exact version/digest visible;
- permissions/limitations visible;
- references use relative paths;
- before applying workflow, record a new pinned-use activation;
- no absolute cache paths;
- no secret or environment value;
- no auto-update instructions.
- exact CLI package/version and activation contract are copied from `runtime.json`;
- doctor verifies the exact npm version can resolve before reporting pin healthy.

### Pinned reuse lifecycle

On later trigger, the generated skill calls local `activation_start` with the trusted
owning `pinnedActivationId`, an explicit client, one fresh random request ID and
`activationConsent=true`. It never accepts an arbitrary marker path from model output.
The project-local MCP command remains pinned to the exact CLI version copied from
`runtime.json` when the universal skill was installed.

This creates a new activation ID referencing the existing managed copy, rechecks remote
status/digest plus append-only revoke overlay, then follows loaded/invoked/outcome states.
Offline activation always fails closed in MVP.

## 8. Client adapters

Implement a small interface:

```ts
type ClientAdapter = {
  id: "claude-code" | "codex";
  pinnedRoot(projectRoot: string): string;
  pluginDoctor(): Promise<ClientDoctorResult>;
  preflightPinned(input: PinnedInput): Promise<PreflightResult>;
  writePinned(input: PinnedInput): Promise<PinnedResult>;
};
```

Shared transaction code calls adapter only for paths/doctor/write.

### Claude adapter

- root `.claude/skills`;
- SKILL.md required;
- doctor checks plugin/skill files and current marketplace guidance;
- detected on disk is not loaded.

### Codex adapter

- root `.agents/skills`;
- SKILL.md required;
- never write new managed files to `.codex/harnesses`;
- doctor may use `codex plugin list` and filesystem checks;
- plugin smoke uses isolated `CODEX_HOME`;
- detected on disk is not loaded.

### Legacy migration

Existing `.codex/harnesses/<name>/AGENTS.md` generated by old adapter:

- do not delete automatically;
- `audit-setup --target codex` reports it as legacy unmanaged adapter;
- offer guidance to create a fresh managed activation/pin into `.agents/skills`;
- automatic legacy migration is outside MVP;
- no double counting as active managed skill.

Pinned update is outside MVP. Doctor reports outdated/replacement; supported flow is
explicit remove followed by a fresh temporary activation and pin. There is no in-place
update or auto-update daemon.

## 9. Inventory

### Claude scan

- project `.claude/skills`;
- existing current audit behavior;
- identify `.superskill-managed.json`.

### Codex scan

- every `.agents/skills` from CWD to repo root;
- optional user `$HOME/.agents/skills` read-only if accessible;
- current legacy `.codex/harnesses` reported separately;
- duplicate name detection does not assume Codex merges same-name skills.

### Shared summary sent to API

Only counts and managed exact refs. No paths, descriptions, contents or usernames.

## 10. Internal client test protocol

### Claude Code

1. Clean plugin install/update.
2. New session/task.
3. Explicit SuperSkill task.
4. Recommendation and consent.
5. Temporary activation.
6. Check loaded/invoked/outcome event chain.
7. Pin resource.
8. New session triggers pinned skill.
9. Revoke drill.
10. Safe removal.

### Codex

1. Temporary isolated `CODEX_HOME`.
2. Add repo marketplace.
3. Install `superskill@superskill`.
4. Verify plugin list and bundled skill.
5. Run task in clean repo.
6. Recommendation and consent.
7. Temporary activation.
8. Pin to `.agents/skills`.
9. New task detects pinned skill.
10. Revoke and removal drill.

## 11. Client acceptance

- Same task/context returns same candidate on both clients.
- Shared skill file is byte-identical.
- Temporary activation does not write pinned skill paths.
- Claude pinned writes only `.claude/skills`.
- Codex pinned writes only `.agents/skills`.
- Legacy `.codex/harnesses` is detected but not reused as target.
- Both clients require explicit consent.
- Both clients record the same lifecycle semantics.
- Sandbox/approval policies are never weakened.
- Plugin update requirements are honest: install/refresh may need a new task, temporary
  resource activation does not.
