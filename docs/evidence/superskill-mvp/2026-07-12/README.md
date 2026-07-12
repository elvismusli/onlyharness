# SuperSkill MVP + Daylight v1.0 local implementation evidence

Date: 2026-07-12

## Local result

- Shared strict capability schema, canonical artifact digest and immutable exact-release history.
- Candidate-only generated catalog: 12 current releases and 12 retained historical releases.
- Bearer-protected recommendation, exact release and archive routes; public-safe showroom routes.
- Current-time eligibility, digest-bound archive, global revoke overlay and lock-safe revoke writer.
- Transactional temporary/pinned activation for Claude Code and Codex with symlink-safe paths,
  atomic state, idempotent retries, adoption and safe removal.
- Dual Claude/Codex SuperSkill plugin manifests using exact local runtime `onlyharness@0.2.13`.
- Daylight v1.0 SuperSkill skin, headless hooks, honest trust/lifecycle states and legacy skin access.
- Content-free managed event chain, idempotent event IDs and strict optional correlation fields.

## Verification

The final matrix passed twice consecutively on the same worktree:

```bash
npm run check
npm run smoke
npm run smoke:superskill
npm run build
git diff --check
```

Latest counts:

- API: 79 tests passed.
- Web: 92 tests passed across 21 files.
- Capability schema: 4 tests passed.
- CLI: 62 tests passed.
- Harness schema: 3 tests passed.
- Root scripts: 23 tests passed.
- Managed smoke additionally covered schema, 19 API contract tests, 6 catalog/revoke
  tests and 11 Claude/Codex lifecycle/contract tests.
- Stage A router: 30 cases for each client; top-1 18/18, top-3 18/18,
  ambiguous 5/5, out-of-scope 3/3, adversarial 4/4, forbidden/revoked 0.
- Legacy smoke is side-effect free for checked-in seed evidence (same aggregate SHA-256
  before and after the smoke run).

Browser evidence and the exact viewport/privacy checks are in
`docs/evidence/superskill-ui/2026-07-12/`.

## Independent review fixes

The independent reviewer found and the implementation fixed:

- foreign revoke lock deletion and concurrent revoke corruption risk;
- state/pin writes through symlink ancestors;
- stale exact-release eligibility on activation/archive routes;
- attestation trust without deterministic immutable snapshot rescan/diff;
- an invalid router fixture mix that overstated the Stage A gate;
- loss of pinned exact releases after a current-version advance;
- malformed optional event IDs being silently stored as null.

## Honest rollout blockers

- npm currently publishes `onlyharness@0.2.12`; local managed runtime `0.2.13` must be
  published and verified from a clean home before clean distribution is proven.
- The generated managed catalog intentionally has 12 candidates and 0 approved releases
  until real scanner/diff, human-case and dual-client attestations are produced.
- Pilot report is 0/20 distinct testers and 0/100 attempts.
- Production Daylight default remains off until live approved showroom smoke succeeds.

No commit, push, deployment, token issuance or production mutation was performed.
