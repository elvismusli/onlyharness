# SuperSkill MVP specification review log

## Cycle 1 — independent review

Review scopes:

- architecture, legacy compatibility and YAGNI;
- trust, security, privacy and state contracts;
- Claude Code/Codex native integration and verification.

### Accepted corrections

| Finding | Disposition |
|---|---|
| Internal alpha auth was undefined | Added one opaque `HH_SUPERSKILL_TOKEN` per tester, Bearer contract, stored hashes, 401/403 tests and server-derived HMAC subject |
| Managed MCP created a second unproven auth transport | Deferred new managed MCP tools; both first clients use one version-pinned CLI |
| Review attestation had no exact schema | Added strict `superskill.review.v1` contract |
| Revoke could be bypassed offline/after index rollback | Disabled offline activation and added persisted append-only digest tombstones plus rollback smoke |
| Archive could follow symlinks or hash a truncated 80-file subset | Added pre-read `lstat`/realpath checks, complete-archive metadata, exact size/count limits and adversarial fixtures |
| Activation/pin state machine was mixed and start was not idempotent | Split execution/pin states, added request ID, transition/crash table and separate keep consent |
| Changed pinned files could be deleted | Added per-file/package digests, marker digest in activation record and all-files preflight before remove |
| Project root/worktree behavior was undefined | Added explicit root resolution and `git rev-parse --git-path info/exclude` contract |
| Legacy `verified` migration was non-additive | Preserved legacy semantics; added separate evidence/managed eligibility fields |
| Pinned in-place update was under-specified | Removed it from MVP; doctor reports remove + fresh pin path |
| 20-user metric was actually project-local | Derived stable tester identity from distinct issued tokens; project ID is not counted as a user |
| Event body accepted client-provided subject | Removed public subject and made identity server-derived |
| Task summary left machine before disclosure | Added routing disclosure/consent before recommendation and separate activation consent |
| Paid legacy archive could enter MVP | Added `free_archive` eligibility and fail-closed 402 behavior without money mutations |
| `available` compatibility could rank | Approved recommendation now requires fresh `verified` smoke for both clients |
| Permission delta claimed unavailable baseline | Restricted it to partial/managed-known facts and explicit unknown client/unmanaged baseline |
| Plugin used `onlyharness@latest` | Added checked-in concrete CLI runtime contract and Node/npm preflight |
| Pinned reuse overload and slug safety were unspecified | Added exact command, online recheck, slug regex and path/symlink guards |
| Browser package boundary was missing | Split browser-safe schemas from Node digest entrypoint and added Vite build gate |
| Backlog dependency allowed activation before exact routes | Added PR-05 → PR-07 merge dependency |

### Rejected findings

None. Where reviewers proposed alternatives, the lower-complexity fail-closed choice was
selected: version-pinned CLI instead of managed MCP auth, and no offline activation or
in-place pinned update in MVP.

## Cycle 2

Second independent review found no remaining P0. Accepted corrections:

| Finding | Disposition |
|---|---|
| Token requirement could block safe removal | Token limited to network operations; marker-based remove is explicit, offline and idempotent |
| Generated pin depended on undefined global `hh` | Added concrete `runtime.json`; marker and generated skill use exact `npx` CLI version |
| Pinned reuse command was incomplete | Added target, request ID, consent, project-root marker and exact retry behavior |
| Activation record missed correlation | Added recommendation, mode and source marker fields |
| Revoke had no reproducible operator path | Added strict dry-run/apply script contract with locking, fsync and alias semantics |
| Managed download still crossed payment-aware legacy route | Added dedicated authenticated free-only archive endpoint with payment-helper negative tests |
| Consent could become stale | Added decision digest and expiry binding with `CONSENT_STALE` |
| Static absence could look like proven false | Replaced inferred full permissions with detected/not-detected observations |
| Pin/remove crash recovery was incomplete | Added adoption/idempotent delete rules and boundary crash fixtures |
| Outcome evidence upgrade was unreachable | Defined same-outcome evidence upgrade and rejected outcome changes |
| App/IDE token inheritance was unspecified | Limited internal activation acceptance to terminal Claude Code/Codex CLI |
| Automatic legacy Codex migration was under-specified | Deferred migration; MVP detects and guides a fresh managed pin |
| Candidate/review PR dependency was cyclic | Made review optional for candidate and mandatory only for approved |

The corrected set proceeds to final requirement audit. Any later implementation change
to these contracts requires a new review cycle.

## Closure audit

Architecture closure found two final P1 issues and both were corrected:

- offline remove now requires the matching owning activation record; missing state makes
  no changes and returns manual-cleanup guidance;
- Release gate A publishes/verifies the new CLI version before PR-10 clean-client plugin
  E2E; local binary override is not distribution proof.

Final results from all three reviewers:

- architecture/legacy/backlog: no remaining actionable P0/P1/P2;
- security/trust/state/privacy/payment: no remaining actionable P0/P1/P2;
- Claude Code/Codex first-client contracts: no remaining actionable P0/P1/P2.

Status: **implementation-ready**.

## External review follow-up

Validated against current code before editing:

- `registry.buildArchiveForVersion()` is already separate from payment-aware
  `server.archiveForClient()`; accepted as a pre-PR-05 characterization/import-boundary
  gate so this separation cannot regress;
- accepted Stage A start with 12 approved seeds; 20 remains Stage B exit/final proof;
- unified router top-3 fixture gate at 90%; real-user top-3 acceptance remains a separate
  70% product metric;
- staged router suite accepted: 30 at Stage A, 60 at Stage B, 100 at final proof;
- accepted incremental CLI characterization based on the current 4,768-line implementation
  and single 51-test legacy file;
- `06-execution-backlog.md` is now explicitly canonical over master §11 sequencing.

Not accepted:

- Claude-first/Codex-later contradicts the explicit product requirement that both are
  first clients, so dual-client scope remains unchanged.

## Cycle 3 — instruction-only eval contract correction

Implementation review found a mismatch: the canonical instruction-only list allowed only
`evals/cases/**`, while catalog build also allowed `evals/promptfooconfig.yaml` by path
without validating its contents.

Correction:

- `evals/promptfooconfig.yaml` is now an explicit, narrow declarative-evidence exception;
- approved artifacts parse it fail-closed and allow only a short description, existing
  local Markdown prompt references and the literal `echo` provider;
- URLs, commands, functions, plugins, exec and remote providers are rejected;
- the config is excluded from managed runtime/model context and is never executed;
- `harness.yaml` `evals.command` remains inert during managed activation and its shell
  signal must be recorded as a review limitation.

This is a post-Cycle-2 contract change. An independent reviewer must validate the code,
tests and canonical wording before any exact release using this exception is approved.

Cycle 3 reviewer rejected the first correction because case-insensitive path matching
allowed a config alias to bypass validation, manifest `evals.promptfoo_config` was not
bound to the validated file, and the eval-command limitation existed only in prose. The
follow-up correction makes all managed paths case-sensitive, requires the manifest path
to equal `evals/promptfooconfig.yaml`, validates exactly that file, and enforces the
deterministic `[EVAL_COMMAND_WARN]` attestation limitation before approval. The follow-up
was independently rechecked and accepted on 2026-07-13 after the adversarial tests and
exact-release evidence hardening passed. That code/policy acceptance is not human case
sign-off and does not authorize any capability approval.

## Phase 6 pre-review low-risk batch

The first four remaining low-risk candidates were cut independently to immutable
`0.2.1` snapshots after removing only `.gitea/workflows/harness-ci.yml` and bumping the
manifest version. Their `0.2.0` snapshots remain in history. The checked-in
`source-releases.json` state makes seed regeneration reproduce the exact source instead
of silently restoring the executable workflow.

The release cutter is dry-run by default and requires explicit ID/from/to plus `--write`.
It verifies source = old snapshot = curated tuple, rejects unsafe instruction files and
blocking capability diffs, uses an exclusive writer lock plus durable recovery journal,
and never creates an attestation, preview or approval. Capability inference now ignores declarative manifest
metadata and negated/review-only prose while adversarial tests retain detection of real
imperative credential, network and money actions.

Clean Claude Code `2.1.112` and Codex CLI `0.135.0` exact lifecycle sessions passed for:

- `founder-decision-memo@0.2.1`;
- `product-strategy-critic@0.2.1`;
- `launch-readiness-reviewer@0.2.1`;
- `repo-truth-auditor@0.2.1`.

The first Claude attempt for `repo-truth-auditor` stopped after `activation_ready` and
was not accepted as evidence. The generated pinned SKILL.md lifecycle was corrected to
include exact loaded/invoked/finish commands; the diagnostic and final dual-client runs
then passed. All four durable reports remain non-promotional and all human-case packet
review fields remain blank. Status: **pre-review prepared; human sign-off pending**.

## Phase 6 pre-review research/data batch

Three further candidates were cut independently to immutable `0.2.1` snapshots after
removing only `.gitea/workflows/harness-ci.yml` and bumping the manifest version:

- `gtm-research-sprint@0.2.1`;
- `data-quality-sentinel@0.2.1`;
- `agent-harness-refactorer@0.2.1`.

Their `0.2.0` snapshots remain in history. Generic exact-release smoke initially derived
the GTM task by concatenating intent and outcome, which diluted the known-positive route
into `needs_clarification`. That failed run was rejected. Smoke now uses the first exact
curated intent as its routing probe, with a focused regression test; all three generic
exact-release smokes then passed.

Clean Claude Code `2.1.112` and Codex CLI `0.135.0` exact lifecycle evidence passed for
all three releases. The first `agent-harness-refactorer` full run and two pre-fix Claude
diagnostics produced no Skill tool call or pinned activation state and were rejected. One
intermediate positional-argument experiment also failed at CLI input validation and was
not treated as client evidence. The root cause was a multiline `/skill` invocation whose
discovery remained model-dependent. Claude now receives the canonical single-line
user-invoked `/skill <arguments>` as a positional prompt. Two consecutive isolated Claude
diagnostics and the final dual-client evidence run then passed.

All durable reports remain non-promotional:
`promotionAuthorized=false`, `attestationCreated=false`,
`humanReviewEvidence=false`, and `sourceTruthUnchanged=true`. The three human-case
packets retain blank reviewer/date/verdict fields and are explicitly synthetic review
inputs, not attestations. Status: **pre-review prepared; human sign-off pending**.

## Phase 6 pre-review operational/high-risk batch

The final four candidates were cut independently to immutable `0.2.1` snapshots after
removing only `.gitea/workflows/harness-ci.yml` and bumping the manifest version:

- `support-triage-agent@0.2.1`;
- `incident-rca-commander@0.2.1`;
- `security-permission-auditor@0.2.1`;
- `finance-payment-safety-reviewer@0.2.1`.

Their `0.2.0` snapshots remain in history. Generic exact-release smoke and clean Claude
Code `2.1.112` / Codex CLI `0.135.0` lifecycle evidence passed for all four. The sessions
performed activation lifecycle only, executed no capability task, reported
`unknown/unknown`, and made no production, provider, payment, refund, withdrawal,
ledger, credential, remediation or external-send action.

Each human-case packet contains normal, ambiguous and adversarial synthetic review
inputs with explicit side-effect boundaries. Support drafts are not sent and do not
promise refunds. Incident/security outputs remain read-only and do not execute fixes or
use credentials. Finance output cannot charge, refund, call a provider, mutate a ledger,
withdraw funds or send messages. Reviewer/date/verdict fields remain blank.

All durable reports remain non-promotional:
`promotionAuthorized=false`, `attestationCreated=false`,
`humanReviewEvidence=false`, and `sourceTruthUnchanged=true`. No review attestation,
preview, approval or managed activation was created. Status: **pre-review prepared;
human sign-off pending**.
