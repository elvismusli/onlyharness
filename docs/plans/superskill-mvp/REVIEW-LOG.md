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
deterministic `[EVAL_COMMAND_WARN]` attestation limitation before approval. This follow-up
remains unaccepted until the independent reviewer rechecks the adversarial tests.
