# 05 — Verification and rollout

## 1. Verification principle

Green tests не доказывают MVP сами по себе. Финальный proof состоит из:

```text
schema/unit proof
→ API/CLI integration proof
→ clean client plugin proof
→ real task activation proof
→ revoke/rollback proof
→ internal pilot evidence
```

## 2. Baseline gate before implementation

Текущий baseline:

- root smoke passes;
- API/CLI/schema tests pass;
- root check fails because 19 web tests have missing `localStorage` environment;
- public docs have workspace subscription drift.

Before SuperSkill feature code:

1. Fix Vitest setup.
2. Sync public/root docs.
3. Run `npm run check` twice.
4. Run `npm run smoke` twice.
5. Record baseline output in implementation PR description/report.

No feature PR may redefine existing failing baseline as acceptable.

## 3. New test suites

## 3.1 Shared schema tests

Path: `packages/capability-schema/test/`.

Cases:

- every enum accepts/rejects expected values;
- managed capability validates;
- unknown fields rejected where strict;
- digest fixtures stable;
- path normalization rejects traversal, absolute, duplicate, NUL;
- byte-order/CRLF/BOM/Unicode digest fixtures are stable;
- symlink-to-outside is rejected before read;
- 81 files, oversized file and oversized total artifact fail closed;
- lifecycle transition matrix;
- error code schemas;
- example JSON from specs validates.

## 3.2 API unit tests

New files:

- `apps/harness-api/test/capabilities.test.ts`;
- `apps/harness-api/test/trust-policy.test.ts`;
- `apps/harness-api/test/recommendations.test.ts`;
- extend `events.test.ts` and registry/archive tests.

Cases:

- managed index load success/failure;
- approved/candidate/quarantine/revoke behavior;
- eligibility hard blocks;
- exact scoring points and tie order;
- no heat/popularity effect;
- client compatibility filtering;
- task secret/size rejection;
- no-match and clarification are 200 decisions;
- exact release recheck;
- decision digest expiry/mismatch requires fresh consent;
- managed archive never calls payment/x402/entitlement helpers;
- missing/invalid/valid Bearer token returns 401/403/200;
- server derives subject from tester token and ignores body `subject`;
- paid/gate_escrow/per_call resource fails without purchase, entitlement or payment
  events;
- archive digest response;
- task/prompt/path stripped from events;
- event idempotency.

## 3.3 Router fixture gate

Command:

```bash
npm run check:superskill-router
```

Runs the current staged suite for both clients: at least 30 before Stage A, 60 before
Stage B exit and 100 before Stage C/final proof. Report contains aggregate counts and
case IDs, not user tasks from production. Top-3 gate is always 90%.

Failure conditions defined in trust/routing spec.

## 3.4 CLI tests

Extend `packages/harness-cli/test/` or split managed tests into dedicated files.

Current legacy baseline is one `exit-codes.test.ts` file with 51 tests around a 4,768-line
`src/index.ts`. Do not characterize all CLI code upfront. Whenever a shared legacy branch
is touched, first add focused characterization for that branch; put new managed behavior
in dedicated recommend/activation/adapter test files and keep the full 51-test legacy
suite green.

Recommendation:

- request target propagated;
- JSON/text outputs;
- no match exit 3;
- clarification exit 0;
- secret task rejected locally;
- server error next step.

Activation:

- exact version required;
- exact digest required;
- snapshot false blocked;
- server/curated/local digest mismatch;
- staging cleanup;
- cache hit;
- concurrent start;
- repeated activation request ID returns the same activation;
- state transition matrix;
- outcome evidence same-repeat/agent-to-user-upgrade/outcome-change-rejected;
- execution state and pin state remain independent;
- repeated transition idempotency;
- keep transaction rollback;
- keep/remove crash after every write/delete boundary;
- marker without owning activation record produces guidance and zero deletion;
- remove protects changed user file;
- revoke recheck blocks cached artifact;
- offline pinned reuse is blocked;
- telemetry failure non-fatal;
- pending event retry idempotent.

Adapters:

- Claude path exact;
- Codex path exact;
- no writes to `.codex/harnesses`;
- legacy adapter detection/fresh-pin guidance;
- duplicated skill names reported;
- generated pinned package self-contained.
- nested CWD and linked-worktree project root/exclude resolution;
- capability slug traversal/collision rejection.

## 3.5 Plugin contract checks

Commands:

```bash
npm run check:claude-plugin
npm run check:codex-plugin
```

Checks:

- both manifests present and valid;
- manifest versions equal;
- shared `SKILL.md` exists once;
- MCP endpoints equal;
- marketplace names/selectors correct;
- Codex paths start `./` where required;
- no app/hooks declared;
- no dead privacy/terms links;
- exact CLI version placeholder substituted and compatible;
- Node/npm preflight and `LOCAL_CLI_UNAVAILABLE` behavior;
- SKILL.md contains consent/no-match/lifecycle/privacy rules;
- docs install commands match manifests.

## 4. End-to-end SuperSkill smoke

New script: `scripts/smoke-superskill.ts`.

Run isolated API with:

```text
SUPERSKILL_ENABLED=true
SUPERSKILL_TOKEN_HASHES=<fixture-token-sha256>
SUPERSKILL_REVOCATIONS_PATH=<persistent-fixture-path>
isolated HARNESS_EVENTS_PATH
isolated curated/index paths
```

### 4.1 Happy path per client

For `claude-code` then `codex`:

1. Recommend fixture task.
2. Assert exact selected ID/version/digest.
3. Record acceptance.
4. Start temporary activation in temp project.
5. Assert `.onlyharness` locally excluded from git.
6. Assert server/client digest equal.
7. Mark loaded.
8. Mark invoked.
9. Finish agent-reported success.
10. Assert ordered unique event chain.
11. Repeat activation; assert cache hit.
12. Keep pinned with separate explicit confirmation.
13. Assert native client path only.
14. Remove pinned; assert unrelated fixture file remains.

### 4.2 Failure path smoke

- disabled feature;
- missing/denied internal token;
- invalid catalog;
- no safe match;
- ambiguous task;
- revoked between recommend/start;
- digest mismatch;
- truncated archive;
- permission blocked;
- target collision;
- managed file changed;
- events store unavailable;
- offline pinned/exact status check.

### 4.3 Revoke drill

Same script or dedicated `scripts/smoke-superskill-revoke.ts`:

- pin one resource for both clients;
- change fixture status to revoked;
- rebuild index/reload API;
- recommendation disappears;
- cached activation blocks;
- roll back to previous index and confirm tombstone still blocks;
- both doctors report digest;
- removal succeeds only for untouched managed files.

## 5. Clean-client distribution smoke

## 5.1 Claude Code

Use isolated `CLAUDE_CONFIG_DIR=<temp>` and explicit user scope.

Required evidence:

- marketplace add;
- plugin install;
- plugin validate/list;
- `claude mcp list` shows existing OnlyHarness MCP enabled;
- bundled master skill visible in new session;
- recommendation CLI available;
- remove/cleanup.

Update smoke:

```bash
CLAUDE_CONFIG_DIR=<temp> claude plugin marketplace update onlyharness
CLAUDE_CONFIG_DIR=<temp> claude plugin update superskill@onlyharness
```

Start a new session and verify updated plugin/CLI contract version.

If full Claude session automation is not stable, keep machine-readable plugin validation
plus one documented manual internal run. Do not claim automated activation coverage from
manifest validation alone.

## 5.2 Codex

Use isolated environment:

```bash
CODEX_HOME=<temp> codex plugin marketplace add <repo-or-local-path>
CODEX_HOME=<temp> codex plugin add superskill@onlyharness
CODEX_HOME=<temp> codex plugin list
CODEX_HOME=<temp> codex mcp list
```

Then run Codex with temp project and verify:

- plugin enabled;
- shared skill discovered;
- MCP visible or CLI fallback works;
- temporary activation writes only project `.onlyharness`;
- pinned skill is `.agents/skills/...`;
- new task detects pinned skill.
- after pin, remove plugin/global CLI and prove generated skill reuses exact CLI version
  from marker via `npx`;

Update smoke runs `codex plugin marketplace upgrade onlyharness`, re-adds the plugin,
starts a new task and verifies stale cache cleanup without touching project pinned files.

The installed local Codex CLI version is part of smoke report. Do not hardcode one version
as a product requirement.

Internal activation acceptance is for terminal-launched Codex CLI. App/IDE discovery may
be observed, but is not counted until GUI credential onboarding is specified and tested.

## 6. Real internal task protocol

Automated smoke cannot prove resource usefulness. Internal team tests each approved
resource on three tasks.

Per run record only:

- tester pseudonymous ID;
- client;
- capability exact release;
- recommendation accepted/rejected;
- activation state;
- outcome evidence;
- reason code;
- optional human note stored in separate internal review doc, not telemetry.

Reviewers answer:

1. Was the recommendation appropriate?
2. Did permission/limitation copy match behavior?
3. Did workflow materially help?
4. Was any instruction misleading or unsafe?
5. Should resource remain approved?

## 7. Internal alpha stages

### Stage A — developer canary

- 2–3 engineers;
- both clients;
- 12 migrated and approved exact releases;
- feature allowlist;
- one distinct `HH_SUPERSKILL_TOKEN` per tester; sharing tokens invalidates pilot counts;
- 20–30 tasks.

Exit:

- no P0/P1 safety bug;
- activation ready >=85%;
- no digest/state corruption;
- all failures have reason codes.

### Stage B — team alpha

- 5–10 teammates;
- catalog grows to 20 approved resources;
- 50+ cumulative tasks;
- pinned flow optional but tested.

Exit:

- 20 approved exact releases;
- activation ready >=90%;
- loaded >=90% of ready;
- no automatic permission escalation;
- recommendation top-3 accepted >=70%.

### Stage C — MVP proof

- 20 users;
- 20 distinct server-derived tester subjects from 20 issued tokens, not project-local
  IDs;
- 100 task attempts;
- Claude Code and Codex both have weekly usage;
- repeat use tracked.

Exit criteria equal master MVP acceptance.

## 8. Metrics and queries

### Funnel

```text
recommended
→ recommendation_accepted
→ activation_started
→ activation_ready
→ activation_loaded
→ activation_invoked
→ outcome_reported
```

Rates use unique `event_id`, correlated by recommendation/activation ID.

### Required splits

- client;
- capability ID/version;
- temporary/pinned;
- reason code;
- evidence type.

### Prohibited metrics

- raw task text;
- prompt/output content;
- file paths;
- repository identity;
- secrets/tokens;
- inferred personal identity.

## 9. Production deployment sequence

### 9.1 Pre-deploy

```bash
npm run check
npm run smoke
npm run smoke:mcp
npm run check:superskill-router
npm run smoke:superskill
npm run build
```

Run `smoke:superskill` twice.

### 9.2 API deploy dark

- deploy code with `SUPERSKILL_ENABLED=false`;
- verify `https://onlyharness.com`, `/api/healthz`, `/api/registry`, `/api/resources`,
  `/mcp`;
- verify disabled managed endpoint response;
- no CLI/plugin publish yet.

### 9.3 Internal enable

- set feature true;
- set allowlisted per-tester token hashes and telemetry HMAC salt;
- mount current append-only revoke overlay;
- deploy generated curated index;
- verify exact production capability detail/digest;
- run production read-only recommendation smoke;
- run one reversible temporary activation from internal machine.

### 9.4 CLI publish

- initial managed CLI version was already published at Release gate A;
- verify its npm integrity/version and clean `doctor/recommend` against live dark API;
- publish a patch only if post-gate fixes changed CLI behavior;
- if patched, update `runtime.json` and repeat both clean-client plugin smokes before
  marketplace publish;
- old install/search still work.

### 9.5 Plugins publish

- update both manifest versions together;
- push marketplace files;
- Claude clean install/list;
- Codex clean marketplace/add/list under isolated home;
- new task/session smoke;
- docs become primary only after both pass.

### 9.6 Daylight web release

Daylight v1.0 deploy is separate PR-13 after headless contracts and live data proof. It
consumes public-safe showroom projection and cannot be used as proof that local activation
works. Keep legacy skins as rollback until browser smoke passes.

## 10. Rollback

### Fast rollback

1. Set `SUPERSKILL_ENABLED=false`.
2. Remove/disable internal recommendation guidance.
3. Keep legacy API/CLI/plugin paths available.
4. Do not delete event or curated history.
5. Keep current append-only revoke overlay mounted; rollback is forbidden if it would
   drop tombstones.

### CLI/plugin rollback

- publish patch only when necessary;
- old CLI must still fail closed on unknown managed response;
- marketplaces can point internal users to last known-good plugin version;
- pinned resources remain local and doctor must explain server unavailable state.

### Data rollback

Curated index generated from versioned source. Rollback may use previous known-good git
revision, but persisted revocation overlay is never rolled back. Smoke proves
`revoke → previous index → activation still blocked`.

## 11. Incident classes

| Priority | Example | Action |
|---|---|---|
| P0 | Unsafe/revoked artifact activated, secret stored | Disable feature, revoke digest, investigate immediately |
| P1 | Wrong permission copy, digest/state corruption | Disable affected capability or feature |
| P2 | Bad recommendation/no-match, one client adapter fail | Quarantine resource/client path, continue limited alpha |
| P3 | Copy/docs/metric issue | Fix next patch |

## 12. Final verification commands

At completion record exact outputs for:

```bash
git diff --check
npm run check
npm run smoke
npm run smoke:mcp
npm run check:superskill-router
npm run smoke:superskill
npm run build
CLI_VERSION=$(node -p "require('./plugins/superskill/runtime.json').cliVersion")
npx onlyharness@"$CLI_VERSION" doctor --json
codex --version
claude --version
```

Also record:

- production health/read recommendation;
- Claude plugin version/list;
- Codex plugin version/list;
- one activation chain per client;
- revoke drill evidence.

## 13. Verification acceptance

- All automated suites green twice where specified.
- Both real clients complete temporary activation.
- Both client-native pinned paths verified.
- Revoke blocks cache and detects pinned digest.
- No telemetry privacy violation in adversarial tests.
- Production legacy routes remain healthy.
- Internal 20-user/100-task gate measured, not inferred.
