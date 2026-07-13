# SuperSkill consolidation and universal install plan

Status: **in implementation; production NO-GO until every gate below is green**

This plan extends `2026-07-13-superskill-headless-mcp-production-remediation.md`.
It does not weaken that plan's approval, exact-release, consent, auth, storage, SMTP,
client-compatibility, or independent-review gates.

## 1. Outcome

SuperSkill becomes the only human-facing product surface. The existing OnlyHarness
backend remains a compatibility and control-plane foundation for accounts, workspaces,
catalog records, immutable releases, archives, security evidence, and installed clients.

The user-facing install contract is one canonical, version- and digest-bound URL:

```text
https://superskill.sh/api/superskill/install
https://superskill.sh/api/superskill/install/{capability}/{version}/{sha256}
```

The first link installs the shared universal routing skill. The exact link additionally
records a pending approved release handoff. Neither link performs recommendation or
activation, and neither is activation consent.

## 2. Verified starting state

- `superskill.sh` and `onlyharness.com` currently serve the same web asset.
- `superskill.sh/install` is currently only the SPA fallback and its deployed base HTML
  still identifies as OnlyHarness 98.
- production workspace and org routes return `404 ... not enabled`.
- the linked production Supabase ledger has 17 applied migrations through
  `20260707160000`; 10 local migrations are pending through `20260713130000`.
- the mixed production catalog reports 269 resources: 253 external and 16 internal.
- SuperSkill exposes 12 selected candidates and zero approved releases.
- `onlyharness@0.2.13` is the published runtime. The new installer requires an immutable
  `0.2.14` release; the unrelated public npm name `superskill` cannot be used.

## 3. Non-negotiable invariants

- Existing Supabase users, profiles, identities, sessions, workspace IDs, membership,
  invites, policies, collections, tokens, releases, archive URLs, and resource IDs are
  not renamed or recreated.
- Database table names, `.harnesshub`, `HH_*`, the `hh` binary, `onlyharness:` IDs, and
  `onlyharness.com/api|mcp` may remain compatibility aliases. They are not public product
  navigation.
- `superskill.sh` always renders the SuperSkill skin. Query parameters and stored legacy
  skin state cannot switch products.
- Human GET pages on `onlyharness.com` redirect to the matching SuperSkill origin.
  API, MCP, OAuth metadata, registry metadata, and immutable old archive links do not use
  redirects that would change methods, bodies, auth headers, or digest identity.
- A universal installer detects exactly one supported client. Both clients produce
  `CLIENT_AMBIGUOUS` unless the user explicitly selects a target or `--all`; no client
  produces `CLIENT_NOT_DETECTED`.
- The installer writes only the allowlisted project-local skill root plus the matching
  project-local MCP config: `.agents/skills/superskill` + `.codex/config.toml` for Codex,
  or `.claude/skills/superskill` + `.mcp.json` for Claude Code. An exact link may also
  write `.onlyharness/superskill-handoff.json`. It preserves unrelated config, rejects
  conflicting `superskill_local` entries, rolls back byte-exact on pre-commit failure,
  and never stores a token. No arbitrary target path is accepted.
- Every installed universal skill file is byte-bound to one checked-in canonical source
  and one artifact digest. Symlinks, collisions, path escapes, partial writes, wrong
  manifest digest, wrong npm integrity, and unpublished runtime fail before success.
- Candidate, selected-unreviewed, quarantined, stale, or revoked releases never receive
  an exact install URL. Approval remains a real non-author human gate.
- Registration remains confirmation-first. Access tokens, invite codes, SMTP secrets,
  confirmation URLs, local paths, prompts, and provider identities never appear in a
  bootstrap URL, public manifest, logs, or retained evidence.

## 4. Keep, migrate, redirect

### Keep as foundation

- Supabase Auth, profiles, user IDs and sessions.
- Workspace schema and API: members, invites, join policies, collections, setup bundles,
  subscriptions and audit.
- Resource catalog, exact release store, archive storage, security scans, trust evidence,
  recommendation and managed activation state.
- Existing compatibility coordinates and old immutable URLs.

### Migrate into SuperSkill

- account registration, sign-in, resend confirmation, confirmation state and sign-out;
- workspace load, join, resources, collections, members and setup handoff;
- canonical API, MCP, OpenAPI, OAuth metadata, docs and plugin public identity;
- install handoff from client-specific tabs/commands to one exact universal link;
- public HTML title, description, OpenGraph, icon, footer and error/fallback copy.

### Redirect or hide

- OnlyHarness Win98/Modern/Fans human pages;
- old leaderboard, storefront, bounty, social, remix and payment UI unless explicitly
  reintroduced as SuperSkill scope;
- the legacy `onlyharness` Claude plugin marketplace listing after the universal plugin
  compatibility path is live.

## 5. Implementation batches

### U1 — host and metadata isolation

- force SuperSkill hostname before query/storage skin selection;
- make base HTML and social metadata SuperSkill-native;
- split Caddy human routing from compatibility machine routes;
- add tests for `?skin=win98|modern|fans` on SuperSkill host and old-host redirects.

### U2 — account and workspace migration

- reuse `useAuth`, `useWorkspace`, and existing session handling;
- add SuperSkill-native Account and Workspaces routes/pages;
- do not expose workspace automation tokens or raw access tokens;
- show membership/resources only after the server returns them;
- apply pending production migrations after backup/dry-run, enable workspaces, and run
  owner/member/invite/expiry/RLS browser and API smoke.

### U3 — universal exact install link

- bump the public runtime to `onlyharness@0.2.14`;
- add a fail-closed bootstrap manifest endpoint and OpenAPI contract;
- publish `0.2.14`, read its real npm `dist.integrity`, then pin it in runtime source;
- add `superskill install [url] --auto|--target|--all --dry-run --json`;
- package the canonical full SuperSkill skill and references, not a reduced duplicate;
- update Daylight handoff to one copy field and honest state copy;
- test client detection, ambiguity, missing clients, idempotency, collision, symlink,
  digest/integrity mismatch, unpublished runtime, offline behavior and rollback.

### U4 — compatibility and public identity

- make `superskill.sh/api` and `/mcp` canonical while keeping old aliases;
- update OpenAPI, MCP identity, llms, AGENTS, README, plugin manifests and generated
  runtime;
- remove the legacy plugin from public marketplace discovery only after clean new-session
  Codex and Claude installs pass;
- keep old archive and resource identifiers resolvable.

### U5 — production proof

- take/verify a recoverable production backup and run linked migration dry-run;
- apply all pending migrations and verify migration parity;
- deploy with hosted publishing still disabled;
- prove existing user login, confirmation-first signup and workspace membership;
- publish and pin runtime `0.2.14`, then verify the bootstrap URL returns the same digest
  across restart/redeploy;
- run clean Codex and Claude universal install evidence;
- run the original Batch D/F/G/I fail-closed matrices against the final plugin;
- complete real non-author human review, negative-control and revocation proof before any
  capability link becomes installable;
- perform Chrome click-through on every SuperSkill page and old-host redirect;
- obtain final independent plan-vs-result GO.

## 6. Production stop conditions

Remain NO-GO if any condition holds:

- a SuperSkill URL renders a legacy skin or legacy base metadata;
- an existing user, workspace membership, invite, release, or archive is missing;
- workspace migrations are pending or workspace API remains disabled;
- the universal endpoint references an unpublished runtime or unverified npm integrity;
- both/no clients are guessed instead of returning a stable selection error;
- a candidate/unreviewed/revoked capability receives an install link;
- installation writes partial/native files after any preflight failure;
- registration confirmation/SMTP, clean Codex/Claude evidence, or independent review is
  incomplete;
- hosted publishing is enabled before its separate authenticated production smoke.
