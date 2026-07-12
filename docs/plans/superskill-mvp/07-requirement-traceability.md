# 07 — Requirement traceability

This is the final implementation audit map. A requirement is complete only when the
listed runtime evidence exists; a merged file or passing unit test alone is insufficient.

| Requirement | Contract/source | Delivery PR | Required evidence |
|---|---|---|---|
| Claude Code is a first client | `04` sections 1–3, 8, 10 | PR-08, PR-10, PR-11 | Isolated marketplace install, shared skill discovery, real temporary activation, native pin/reuse/remove |
| Codex CLI is a first client | `04` sections 1–3, 8, 10 | PR-08, PR-10, PR-11 | Isolated `CODEX_HOME`, plugin add/list, real temporary activation, `.agents/skills` pin/reuse/remove |
| Codex app/IDE scope is honest | `04` section 1 | Later credential onboarding | Compatibility may be observed; not counted in internal MVP activation gate |
| One shared product core | `01` section 4 | PR-01, PR-05, PR-07 | Same schemas/ranking/state transitions for both targets; only adapters differ |
| Task-first recommendation | `02` 5.1, `03` sections 7–8 | PR-05, PR-06 | 30 fixtures at Stage A, 60 at Stage B, 100 at final proof; deterministic rerun and no popularity input |
| No-match and ambiguity are honest | `02` 5.1, `03` 7.4 | PR-05, PR-06 | `no_safe_match`/`needs_clarification` HTTP 200 fixtures and client copy |
| Consent covers current decision | `02` 5.1 and 6.2 | PR-05, PR-07 | Decision digest/expiry mismatch returns `CONSENT_STALE`; fresh consent succeeds |
| Task summary privacy | `04` sections 4–5 | PR-06, PR-10 | Routing disclosure before network; secret/path/body-log adversarial tests |
| Internal access is controlled | `01` section 7, `02` section 5 | PR-05, PR-09 | Per-tester Bearer 401/403/200 matrix; only hashes stored; subject server-derived |
| 20-user gate is real | `05` sections 7–8 | PR-09, PR-11 | 20 distinct issued tokens/derived subjects; shared token invalidates report |
| Exact artifact identity | `02` section 4 | PR-01 | API/CLI golden digest parity; Unicode/order/content mutation fixtures |
| Archive cannot escape/truncate or pull payment into managed flow | `02` 4.1 and 5.4 | PR-01, PR-05 | Pre-PR-05 import-boundary check; symlink/out-of-root and partial/oversize rejected |
| Money paths are outside MVP | `02` 4.3 and 5.4 | PR-04, PR-05 | Only free archive eligible; managed route never invokes payment/x402/entitlement helpers/events |
| Trust is exact and named | `02` sections 2–3, `03` sections 2–5 | PR-03, PR-04 | Exact review attestation, both-client smoke, three cases, named evidence without generic safety claim |
| Static absence is not proof | `02` 3.1, `03` section 4 | PR-04 | Declared permission and `not_detected` rendered separately |
| Only approved resources route | `03` sections 2 and 6 | PR-02–PR-05 | 12 exact free releases start Stage A; 20 required by Stage B exit/final proof; unsafe states filtered |
| Temporary activation is transactional | `02` section 6, `04` section 6 | PR-07 | Idempotent request, staging cleanup, crash retry, exact state/event sequence |
| Pinned package is native/self-contained | `04` section 7 | PR-08 | Works after plugin/global CLI removal via exact marker CLI version |
| Pin/remove preserves user files | `02` 6.5–6.6, `04` section 7 | PR-08 | Per-file/marker/owning-record preflight; changed file blocks; missing state deletes nothing |
| Project root is deterministic | `01` section 5, `04` section 5 | PR-07, PR-08 | Nested cwd, explicit project dir, linked worktree and submodule fixtures |
| Revoke is rollback-proof | `02` 3.2, `03` section 9 | PR-04, PR-11 | Operator script append, global digest tombstone, previous-index rollback still blocked |
| Offline behavior is safe | `02` section 6 | PR-07, PR-08 | Recommend/start/keep fail without recheck; local mark/finish/remove remain available |
| Legacy remains compatible | master sections 2–3, `01` section 10 | PR-00, PR-01, PR-03 | Frozen registry/resource/archive/MCP fixtures; legacy `verified` behavior unchanged |
| Old Codex adapter is handled | `04` section 8 | PR-08 | `.codex/harnesses` detected as legacy; no auto-delete/migration; fresh-pin guidance |
| Plugin/runtime releases are reproducible | `04` sections 2–3, `02` section 6 | PR-10 | Concrete `runtime.json`, manifest/runtime/skill command check, no `latest` or placeholder |
| Events are privacy-safe/idempotent | `02` sections 5.6 and 8 | PR-09 | Unique event ID, strict whitelist, body subject ignored, telemetry-off flow works |
| Headless web stays decoupled | master Phase 7, `06` PR-12 | PR-12 | Typed hooks/states build with current skins unchanged |
| Daylight v1.0 design is implemented honestly | Daylight developer handoff, `06` PR-13 | PR-13 | Public-safe live DTOs, no fake data, desktop/mobile browser evidence |
| Rollout is reversible | `05` sections 9–11 | PR-11 | Dark deploy, two consecutive smoke runs, feature-off rollback, revoke overlay retained |

## Final start condition

Implementation may start only when:

1. baseline PR-00 is green;
2. every implementation agent treats `README.md` authority order as binding;
3. no PR marks a requirement complete without the evidence in this table;
4. Daylight visual work starts only as PR-13 after PR-12 headless contracts and PR-11
   live managed-data proof.
