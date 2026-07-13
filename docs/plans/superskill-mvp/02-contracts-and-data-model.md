# 02 — Contracts and data model

## 1. Conventions

- JSON field names: `camelCase` for new managed contracts.
- IDs: opaque lower-case prefix + URL-safe random value.
- Timestamps: RFC 3339 UTC.
- Digests: `sha256:<64 lowercase hex>`.
- Capability/job IDs: `^[a-z0-9][a-z0-9-]{0,62}$`.
- Client enum: `claude-code | codex`.
- No arbitrary metadata objects in telemetry.
- Unknown state must be explicit; never infer optimistic state.

## 2. Shared types

Реализовать в browser-safe entrypoint `packages/capability-schema/src/browser.ts`;
Node digest helpers экспортировать отдельно из `src/node.ts`.

### 2.1 Enums

```ts
const clientSchema = z.enum(["claude-code", "codex"]);

const managedStatusSchema = z.enum([
  "candidate",
  "approved",
  "quarantined",
  "revoked"
]);

const evidenceLevelSchema = z.enum([
  "author_declared",
  "static_checked",
  "compatibility_smoked",
  "human_reviewed",
  "independently_evaluated"
]);

const recommendationDecisionSchema = z.enum([
  "recommend",
  "needs_clarification",
  "no_safe_match"
]);

const activationModeSchema = z.enum(["temporary", "pinned"]);

const activationExecutionStateSchema = z.enum([
  "accepted",
  "downloading",
  "digest_verified",
  "ready",
  "loaded",
  "invoked",
  "outcome_success",
  "outcome_failed",
  "outcome_unknown",
  "failed"
]);

const activationPinStateSchema = z.enum(["none", "pinned", "removed"]);

const outcomeEvidenceSchema = z.enum([
  "agent_reported",
  "user_confirmed",
  "unknown"
]);
```

### 2.2 Permissions

Переиспользовать существующий semantic shape без нового permission DSL:

```ts
type ManagedPermissions = {
  network: "false" | "allowlist" | "unrestricted";
  networkAllowlist: string[];
  filesystem: "none" | "readonly" | "workspace-write" | "unrestricted";
  shell: boolean;
  browser: boolean;
  credentials: "false" | "runtime_injected" | "persistent";
  externalSend: boolean;
  moneyMovement: boolean;
  userData: boolean;
  humanApprovalRequired: string[];
};
```

API adapter преобразует snake_case manifest fields в camelCase DTO. Native manifest
schema не переименовывается.

### 2.3 Trust check

```ts
type TrustCheck = {
  id:
    | "schema"
    | "artifact_digest"
    | "source_license"
    | "static_security"
    | "capability_diff"
    | "claude_code_activation"
    | "codex_activation"
    | "human_review"
    | "independent_eval";
  status: "pass" | "warn" | "fail" | "not_run";
  evidenceLevel: EvidenceLevel;
  checkedAt: string;
  expiresAt?: string;
  summary: string;
};
```

### 2.4 Managed capability

```ts
type ManagedCapability = {
  id: string;
  type: "instruction_harness";
  title: string;
  summary: string;
  jobs: Array<{
    id: string;
    intents: string[];
    outcomes: string[];
    exclusions: string[];
  }>;
  release: {
    ref: string;
    version: string;
    artifactDigest: string;
    immutable: true;
    publishedAt: string;
    delivery: "free_archive";
  };
  source: {
    owner: string;
    url: string;
    revision?: string;
    license: string;
  };
  compatibility: Array<{
    client: Client;
    status: "verified" | "available" | "blocked";
    verifiedAt?: string;
    notes?: string;
  }>;
  permissions: ManagedPermissions;
  contextCost: {
    approxTokens: number;
    files: number;
    bytes: number;
    status: "estimated";
  };
  trust: {
    status: ManagedStatus;
    riskScore: number;
    riskTier: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    checks: TrustCheck[];
    limitations: string[];
    reviewedAt: string;
  };
};
```

Public DTO не содержит filesystem paths, reviewer email, raw scan excerpts или full
attestation files.

## 3. Curated source schema

`data/superskill/curated.json`:

```json
{
  "schemaVersion": "superskill.curated.v1",
  "generatedFor": "internal-alpha",
  "resources": [
    {
      "id": "market-research",
      "ref": "harnesses/deep-market-researcher",
      "version": "0.2.0",
      "expectedDigest": "sha256:...",
      "status": "approved",
      "jobs": [
        {
          "id": "market-research",
          "intents": ["competitor research", "market map"],
          "outcomes": ["source-backed comparison"],
          "exclusions": ["send outreach", "buy data"]
        }
      ],
      "reviewFile": "reviews/deep-market-researcher-0.2.0.json"
    }
  ]
}
```

Validation:

- `id` unique;
- `ref+version` unique;
- `expectedDigest` exact;
- candidate `reviewFile` may be absent; if present it stays under
  `data/superskill/reviews`;
- approved item requires `reviewFile` plus all mandatory checks;
- quarantined/revoked item may remain for doctor lookup but is not returned by list;
- no unknown license/source.

### 3.1 Review attestation schema

`data/superskill/reviews/<id>-<version>.json` validates against:

```ts
type ReviewAttestation = {
  schemaVersion: "superskill.review.v1";
  capability: {
    id: string;
    ref: string;
    version: string;
    artifactDigest: string;
  };
  source: {
    url: string;
    revision?: string;
    license: string;
  };
  scanner: {
    status: "pass" | "warn" | "fail";
    rulesetVersion: string;
    checkedAt: string;
    findings: Array<{ ruleId: string; severity: "info" | "warn" | "fail" }>;
  };
  capabilityDiff: {
    status: "pass" | "warn" | "fail";
    declared: ManagedPermissions;
    inferred: Array<{
      capability: string;
      status: "detected" | "not_detected";
      evidence: Array<{ file: string; rule: string }>;
    }>;
    differences: Array<{ field: string; declared: string; inferred: string }>;
  };
  compatibility: Array<{
    client: Client;
    clientVersion: string;
    os: "darwin" | "linux" | "win32";
    verdict: "pass" | "fail";
    checkedAt: string;
    fixtureId: string;
  }>;
  humanCases: Array<{
    caseId: string;
    verdict: "pass" | "partial" | "fail";
    limitationCodes: string[];
  }>;
  reviewer: { label: string };
  independentReview?: {
    reviewer: { label: string };
    verdict: "pass" | "fail";
    reviewedAt: string;
    caseIds: string[];
  };
  limitations: string[];
  reviewedAt: string;
  expiresAt: string;
  replacement?: {
    ref: string;
    version: string;
    artifactDigest: string;
  };
};
```

Validation rules:

- capability tuple equals curated tuple byte-for-byte;
- compatibility contains exactly two rows: one `claude-code` and one `codex`; approved
  status requires both to be passing, not future-dated and no older than 90 days;
- at least three human cases with unique trimmed `caseId` values and none with `fail` for
  approved status;
- scanner/capability diff `fail` blocks approval;
- scanner/capability `warn` requires an explicit public limitation beginning with
  `[SCANNER_WARN]` or `[CAPABILITY_DIFF_WARN]` respectively;
- a non-empty manifest `evals.command` is author-declared shell-shaped metadata and
  requires an explicit public limitation beginning with `[EVAL_COMMAND_WARN]`; managed
  activation never executes it;
- `not_detected` means only “no static signal”; it never proves declared `false` and
  public copy keeps declared value separate from scanner observation;
- reviewer contains a public-safe team label, not email/user ID, including an email
  embedded inside a longer label;
- support, incident, security and finance high-stakes review-only capabilities require a
  second passing `independentReview`; its public-safe reviewer label must differ from the
  primary reviewer and its unique `caseIds` must cover every human case exactly once;
- independent high-stakes review uses the same 180-day freshness window, cannot be
  future-dated and remains separate from the stronger `independent_eval` outcome claim;
- `reviewedAt` and mandatory evidence cannot be future-dated beyond five minutes of clock
  skew; human review is valid at most 180 days; `expiresAt` must be after `reviewedAt` and
  no later than 180 days after it;
- quarantine/revoke reason and timestamp live in the append-only tombstone overlay, not
  by rewriting this attestation.

### 3.2 Revocation tombstone

Each line at `SUPERSKILL_REVOCATIONS_PATH` is strict JSON:

```ts
type RevocationTombstone = {
  schemaVersion: "superskill.revoke.v1";
  eventId: string;
  artifactDigest: string;
  aliases: Array<{ capabilityId: string; ref: string; version: string }>;
  reasonCode: string;
  actorLabel: string;
  revokedAt: string;
  replacement?: { ref: string; version: string; artifactDigest: string };
};
```

Revoke is global by artifact digest. Same digest under another ref/version appends/merges
an audit alias and remains blocked everywhere. Duplicate event/alias is idempotent;
conflicting digest for the same event ID fails startup. Tombstone cannot be removed by
catalog rebuild/rollback. Quarantine may live in current curated status; confirmed revoke
always writes this overlay first.

## 4. Artifact digest contract

### 4.1 Input normalization

For each archive file:

1. Convert path separators to `/`.
2. Reject original `\\`, absolute path, NUL, empty segment, `.`/`..`, Unicode NFC
   normalization change and duplicate canonical path.
3. Server uses `lstat`; only regular files are allowed. Reject symlinks before read and
   assert `realpath(file)` remains under `realpath(resourceRoot)`.
4. Strict-decode UTF-8 with fatal errors; CRLF and BOM are not normalized.
5. Reject whole artifact if any file is truncated/unsafe or archive metadata says
   `archiveTruncated=true`.
6. Limits are identical in API/CLI: maximum 80 files, 256 KiB per file, 2 MiB total.
7. Encode validated archive string with `Buffer.from(value, "utf8")`.
8. Sort paths with `Buffer.compare(Buffer.from(path, "utf8"), ...)`, not JS default sort.

### 4.2 Hash

```text
fileHash = SHA256(contentBytes) as lowercase hex
chunk = UTF8(path) + 0x00 + ASCII(fileHash) + 0x0A
artifactHash = SHA256(concat(chunks)) as lowercase hex
digest = "sha256:" + artifactHash
```

Empty artifact is invalid.

API returns `totalFileCount` and `archiveTruncated`. Managed build/activation requires
`archiveTruncated=false` and `totalFileCount===files.length`; an 81-file artifact fails
closed rather than hashing a partial package.

### 4.3 Snapshot rule

Managed release requires:

- requested explicit version;
- archive response `snapshot=true`;
- returned version equals requested version;
- server digest equals curated expected digest;
- locally recomputed digest equals both.
- `delivery=free_archive` and source `pricing.model=free`;
- artifact digest absent from append-only revocation overlay.

Any mismatch returns `ARTIFACT_DIGEST_MISMATCH` and blocks cache promotion.

## 5. HTTP contracts

Base URL remains `/api` through Caddy. Fastify route paths omit `/api` internally.

Internal-alpha auth for every managed execution route:

```http
Authorization: Bearer ${HH_SUPERSKILL_TOKEN}
```

Each tester gets a different opaque token. Server compares SHA-256 with
`SUPERSKILL_TOKEN_HASHES`, derives telemetry subject server-side using HMAC and never
logs/stores the raw token. Missing token returns `401 SUPERSKILL_AUTH_REQUIRED`; invalid
token returns `403 INTERNAL_ALPHA_DENIED`. Legacy routes keep their current auth.

Public showroom routes below are the only exception. They are read-only projections and
cannot recommend, download or activate.

### 5.0 Public showroom read model

```text
GET /showroom/capabilities?limit=12&job=<optional-slug>
GET /showroom/capabilities/:id
```

```ts
type ShowroomPreview = {
  schemaVersion: "superskill.showroom-preview.v1";
  capabilityId: string;
  artifactDigest: string;
  reviewCaseId: string;
  taskLabel: string;
  lines: string[]; // 1..6 reviewed public/synthetic lines
  outcomeLabel: string;
  reviewedAt: string;
};

type ShowroomCapability = {
  capability: ManagedCapability;
  preview?: ShowroomPreview;
};

type ShowroomListResponse = {
  items: ShowroomCapability[];
  total: number;
  generatedAt: string;
};
```

Rules:

- list returns only current `approved` exact releases;
- detail may return approved/quarantined/revoked for an honest shared link;
- preview is included only when capability ID and artifact digest match exactly;
- public projection omits archive URL, `activationAllowed`, review filename, reviewer,
  raw findings, paths and internal identifiers;
- no task text/request context accepted;
- response header is `Cache-Control: public, max-age=60, stale-while-revalidate=300`;
- unknown ID is 404; invalid managed index is 503 without affecting legacy health.

### 5.1 POST `/recommendations`

Request:

```ts
type RecommendationRequest = {
  task: string; // 3..500 chars after normalization
  context: {
    client: Client;
    clientVersion?: string; // <= 40 safe chars
    os: "darwin" | "linux" | "win32" | "unknown";
    arch: "arm64" | "x64" | "unknown";
    installedManagedRefs: Array<{
      ref: string;
      version: string;
      artifactDigest: string;
    }>;
    inventorySummary?: {
      managedSkills: number;
      unmanagedSkills: number;
      approxTokens: number;
      conflicts: number;
      permissionsKnown: boolean;
    };
  };
};
```

Request limits:

- maximum 20 installed refs;
- task normalization removes repeated whitespace;
- reject obvious secret patterns;
- do not accept project path, prompt history or arbitrary metadata.

Response:

```ts
type RecommendationResponse = {
  recommendationId: string; // rec_<base64url>
  decisionDigest: string; // sha256 of consent-relevant decision contract
  decision: RecommendationDecision;
  confidence: number; // 0..1
  selected?: RecommendationCandidate;
  alternatives: RecommendationCandidate[]; // max 2
  clarification?: {
    code: "CLIENT_CONSTRAINT" | "TASK_SCOPE" | "AMBIGUOUS_OUTCOME";
    question: string;
  };
  expiresAt: string; // now + 15 min
};

type RecommendationCandidate = {
  capability: ManagedCapability;
  score: number; // 0..100
  why: Array<{ code: string; text: string; points: number }>;
  limitations: string[];
  permissionDelta: {
    status: "known" | "partial" | "unknown";
    added: string[];
    unchanged: string[];
    unknownBecause?: string;
  };
  consent: "required";
};
```

`decisionDigest` is SHA-256 of canonical JSON containing selected capability
ID/ref/version/artifact digest, selected client, permissions, trust checks, limitations
and `expiresAt`. Object keys are recursively sorted; arrays keep response order. The raw
task is not included. Activation re-fetches exact release and recomputes this digest;
expiry or mismatch returns `CONSENT_STALE` and requires a new recommendation/disclosure.

MVP does not claim a full client-sandbox delta. `permissionDelta.status` is always
`partial` unless every compared permission comes from installed managed refs; candidate
permissions are listed in `added`, unmanaged/client policy remains `unknownBecause`, and
ranking uses candidate permissions rather than the boolean baseline.

Status codes:

- `200` for all three decisions;
- `400 TASK_INVALID`;
- `401 SUPERSKILL_AUTH_REQUIRED`;
- `403 INTERNAL_ALPHA_DENIED`;
- `503 SUPERSKILL_DISABLED`;
- `503 CATALOG_NOT_READY`.

`no_safe_match` is a successful product decision, not HTTP 404.

### 5.2 GET `/capabilities/:id`

Returns current curated public-safe DTO.

Status:

- `200` approved or public quarantine/revoke detail;
- `404 CAPABILITY_NOT_FOUND` for browse-only/unknown IDs.

Response includes `trust.status`. Clients must not treat `200 revoked` as installable.

### 5.3 GET `/capabilities/:id/releases/:version`

Returns exact release if it exists in curated history.

Used immediately before activation. Response additionally includes:

```json
{
  "activationAllowed": true,
  "archive": {
    "url": "/api/capabilities/market-research/releases/0.2.0/archive",
    "artifactDigest": "sha256:..."
  }
}
```

For quarantine/revoke:

- `200` detail;
- `activationAllowed=false`;
- `blockCode=CAPABILITY_QUARANTINED|CAPABILITY_REVOKED`;
- optional approved replacement ref.

### 5.4 GET `/capabilities/:id/releases/:version/archive`

This is the only managed activation download route. It requires internal Bearer auth and
rechecks ID/version/digest, revoke overlay, snapshot completeness, `delivery=free_archive`
and current `pricing.model=free` before reading files.

Implementation calls the safe snapshot builder directly. It must not call checkout,
payment, entitlement, x402 verification/settlement or payment-event helpers. Pricing drift
returns `PAYMENT_NOT_SUPPORTED_IN_SUPERSKILL` before archive construction.

### 5.5 Existing archive response

Additive fields only:

```json
{
  "owner": "harnesses",
  "repo": "deep-market-researcher",
  "version": "0.2.0",
  "snapshot": true,
  "artifactDigest": "sha256:...",
  "totalFileCount": 12,
  "archiveTruncated": false,
  "files": []
}
```

Legacy clients may ignore digest. SuperSkill never uses this payment-aware legacy route.

### 5.6 POST `/events`

Extend existing endpoint; no new endpoint.

Request:

```ts
type ManagedEventInput = {
  eventId: string; // evt_<base64url>
  kind: ManagedEventKind;
  owner?: string;
  repo?: string;
  version?: string;
  target?: Client;
  client: "hh" | "superskill-claude" | "superskill-codex";
  recommendationId?: string;
  activationId?: string;
  mode?: ActivationMode;
  evidence?: OutcomeEvidence;
  outcome?: "success" | "failed" | "unknown";
  reasonCode?: string;
};
```

Unknown fields are discarded. Invalid enum/ID rejects the event with 400. Duplicate
`eventId` returns 200 `{ recorded:false, duplicate:true }`.

`subject` is never accepted from request body. Server derives it from the authenticated
user or internal tester token using a rotatable HMAC salt. Body attempts to set
`subject`, email or arbitrary identity are discarded and tested.

## 6. CLI contracts

Network commands `recommend`, `activation start`, `activation keep` and live `doctor`
require `HH_SUPERSKILL_TOKEN`; the value is sent only in the Authorization header and
never written to local state/events. `mark`, `finish` and `remove` remain local/offline;
events queue best-effort. Plugin releases read a checked-in concrete runtime contract:

```json
{
  "schemaVersion": "superskill.runtime.v1",
  "cliPackage": "onlyharness",
  "cliVersion": "0.2.12",
  "activationContractVersion": "superskill.activation.v1"
}
```

Source: `plugins/superskill/runtime.json`. Shared/generated skills invoke
`npx --yes onlyharness@<concrete runtime.json cliVersion>`. Release PR updates this
concrete version after CLI publish; checks compare runtime file, commands and marker.
Missing Node/npm returns `LOCAL_CLI_UNAVAILABLE`; existing MCP remains browse/search only
and cannot continue managed flow.

Local activation record keeps execution and pin lifecycle separate:

```ts
type ActivationRecord = {
  schemaVersion: "superskill.activation.v1";
  activationId: string;
  activationRequestId: string;
  projectRoot: string; // local only
  recommendationId?: string;
  mode: "temporary" | "pinned";
  sourceMarkerPath?: string;
  capability: { id: string; ref: string; version: string; artifactDigest: string };
  client: Client;
  executionState: ActivationExecutionState;
  pinState: "none" | "pinned" | "removed";
  pinned?: { markerPath: string; markerDigest: string; packageDigest: string };
  outcome?: { value: "success" | "failed" | "unknown"; evidence: OutcomeEvidence };
  createdAt: string;
  updatedAt: string;
};
```

Every managed local command accepts common `--project-dir <path>`. If omitted, root is
git top-level then cwd. All relative marker/state paths resolve from this root.

### 6.1 `hh recommend`

```bash
hh recommend <task...> --target claude-code|codex [--json]
```

Exit codes:

- `0` recommend or needs_clarification;
- `3` no_safe_match or validation;
- `4` capability not found where exact ref requested;
- `1` server/network failure.

JSON stdout equals HTTP response plus:

```json
{
  "client": "codex",
  "next": ["hh activation start ..."]
}
```

### 6.2 `hh activation start`

```bash
hh activation start <capability-id> \
  --version <semver> \
  --digest <sha256:...> \
  --recommendation <rec-id> \
  --decision-digest <sha256:...> \
  --recommendation-expires-at <rfc3339> \
  --activation-request <req-id> \
  --target claude-code|codex \
  --mode temporary \
  --consent explicit \
  --json
```

`version`, `digest`, `decision-digest`, `recommendation-expires-at`, `target`, `mode`,
`activation-request` and explicit consent are required. Do not silently use current
version. Repeating the same request ID and exact tuple returns the existing activation;
reuse with a different tuple fails. Expired/mismatched decision returns `CONSENT_STALE`.

Success JSON:

```ts
type ActivationStartResult = {
  activationId: string;
  executionState: "ready";
  pinState: "none";
  mode: "temporary";
  client: Client;
  capability: {
    id: string;
    ref: string;
    version: string;
    artifactDigest: string;
  };
  plan: {
    root: string; // local-only output
    files: Array<{ path: string; purpose: "agent_prompt" | "runbook" | "example" }>;
    stages: Array<{ id: string; agent: string; promptPath: string }>;
  };
};
```

Absolute root may appear in local CLI stdout but must not be sent to server events.

Pinned reuse has one separate exact form:

```bash
hh activation start \
  --from-pinned <project-root-relative-marker-path> \
  --activation-request <req-id> \
  --target claude-code|codex \
  --consent explicit \
  --json
```

Marker supplies capability/version/digest, `recommendationId=null`, execution uses a new
activation ID and plan rooted inside the verified pinned directory. Command performs a
successful online exact-release/revocation recheck before `ready`; offline reuse is
blocked.

### 6.3 `hh activation mark`

Allowed transitions:

```text
ready -> loaded
loaded -> invoked
```

Command rejects skipped, repeated-different or backward transitions. Exact same repeat is
idempotent and returns current state.

Complete transition table:

| From | Allowed next |
|---|---|
| `accepted` | `downloading`, `failed` |
| `downloading` | `digest_verified`, `failed` |
| `digest_verified` | `ready`, `failed` |
| `ready` | `loaded`, `failed` |
| `loaded` | `invoked`, `failed` |
| `invoked` | `outcome_success`, `outcome_failed`, `outcome_unknown`, `failed` |
| `outcome_*` | none; evidence correction only |
| `failed` | none |

Pin transitions are independent: `none -> pinned` only after `outcome_*`, then
`pinned -> removed`; repeating the same pin/remove is idempotent.

Crash recovery:

- `accepted|downloading|digest_verified` may resume only with the same request ID/tuple;
- stale staging is removed before retry;
- `ready|loaded|invoked|outcome_*|failed` is never advanced implicitly on process start;
- any nonterminal state can move to `failed` with a whitelisted reason;
- `failed` and `outcome_*` are terminal execution states.

### 6.4 `hh activation finish`

Allowed after `invoked` for the first outcome, or after the same terminal `outcome_*`
only to upgrade evidence for that same outcome:

```bash
hh activation finish <id> \
  --outcome success|failed|unknown \
  --evidence agent_reported|user_confirmed|unknown \
  --json
```

Rules:

- `success + unknown evidence` is invalid;
- after a terminal outcome, a later `user_confirmed` may upgrade evidence for the same
  outcome without changing execution state;
- same outcome/evidence repeat is idempotent;
- changing the terminal outcome is rejected in MVP;
- command does not delete cache;
- temporary record becomes terminal outcome state.

### 6.5 `hh activation keep`

Allowed only after `outcome_*` and requires a second explicit flag:

```bash
hh activation keep <id> --confirm-keep --json
```

Writes pinned skill transactionally to target-native path and returns:

```json
{
  "executionState": "outcome_success",
  "pinState": "pinned",
  "client": "codex",
  "managedFiles": [".agents/skills/superskill-market-research/SKILL.md"],
  "doctor": { "status": "detected_on_disk" }
}
```

`detected_on_disk` is not `loaded`.

Keep writes marker with owning activation/request IDs. If process crashes after atomic
directory rename but before record update, retry with the same request adopts the existing
directory only when marker and all package digests match exactly; otherwise collision
fails closed.

### 6.6 `hh activation remove`

Exact offline command:

```bash
hh activation remove \
  --marker <project-root-relative-marker-path> \
  --confirm-remove \
  [--project-dir <path>] \
  --json
```

No token/network is required. It removes only managed files whose marker/package/per-file
digests match. Preflight verifies every existing regular file and ancestor before any
delete and requires the owning activation record referenced by marker to exist and match
marker digest/package digest. If local activation state is missing/corrupt, command makes
no changes and returns safe manual-cleanup guidance. A missing previously-owned file
counts as already removed; a changed existing file blocks all remaining deletion. Marker
is deleted last. Exact retry is idempotent. Crash fixtures cover every write/delete
boundary.

## 7. MCP contracts

No new managed MCP tools are shipped in internal alpha. Both first clients are
shell-capable and use the version-pinned CLI, which is the only local activation
transport.

The existing public MCP remains available for browse/search. It does not return managed
recommendations and cannot activate local files.

After alpha, two thin adapters may be added only after bearer transport is proven in both
clients. They must call the same HTTP/core contracts:

### `recommend_capability`

Input mirrors RecommendationRequest with flat task/client plus optional structured
context. Output is RecommendationResponse as JSON text/content.

### `capability_detail`

Input:

```json
{ "id": "market-research", "version": "0.2.0" }
```

Output exact release public-safe DTO and activationAllowed. MCP does not activate local
files.

## 8. Event model

New kinds:

```text
recommended
recommendation_accepted
activation_started
activation_ready
activation_loaded
activation_invoked
outcome_reported
activation_pinned
activation_removed
activation_failed
```

Database columns:

```sql
event_id text unique
recommendation_id text null
activation_id text null
mode text null
evidence text null
outcome text null
reason_code text null
```

Indexes:

- unique `event_id` where not null;
- `(recommendation_id, created_at)` where not null;
- `(activation_id, created_at)` where not null;
- `(subject, kind, created_at)` for pilot report.

No foreign-key recommendation/activation tables in MVP.

## 9. Stable error codes

| Code | Layer | Meaning |
|---|---|---|
| `SUPERSKILL_DISABLED` | API | Feature off |
| `SUPERSKILL_AUTH_REQUIRED` | API/CLI | Missing internal Bearer token |
| `INTERNAL_ALPHA_DENIED` | API | Client not allowlisted |
| `CATALOG_NOT_READY` | API | Managed index invalid/missing |
| `TASK_INVALID` | API/CLI | Empty, oversized or secret-like task |
| `CAPABILITY_NOT_FOUND` | API/CLI | No managed ID/release |
| `CAPABILITY_QUARANTINED` | API/CLI | Temporarily blocked |
| `CAPABILITY_REVOKED` | API/CLI | Permanently blocked release |
| `ARTIFACT_NOT_IMMUTABLE` | CLI | Snapshot requirement failed |
| `ARTIFACT_DIGEST_MISMATCH` | CLI | Server/curated/local digest mismatch |
| `ACTIVATION_INVALID_TRANSITION` | CLI | Illegal state change |
| `ACTIVATION_NOT_FOUND` | CLI | Missing local record |
| `CLIENT_UNSUPPORTED` | API/CLI | Not Claude Code/Codex |
| `CLIENT_NOT_DETECTED` | CLI | Requested adapter unavailable |
| `TARGET_COLLISION` | CLI | Target exists and is unmanaged/different |
| `MANAGED_FILE_CHANGED` | CLI | Safe remove/update cannot proceed |
| `PERMISSION_BLOCKED` | API/CLI | Policy forbids requested capability |
| `CONSENT_REQUIRED` | CLI | Explicit activation/keep flag missing |
| `CONSENT_STALE` | API/CLI | Recommendation expired or decision contract changed |
| `LOCAL_CLI_UNAVAILABLE` | Plugin | Compatible Node/npm CLI runtime unavailable |
| `PAYMENT_NOT_SUPPORTED_IN_SUPERSKILL` | CLI | Managed activation reached paid delivery |

JSON CLI error remains:

```json
{ "error": "human message", "code": 3, "reasonCode": "...", "next": "..." }
```

## 10. Contract acceptance

- API, CLI and web compile against shared schemas; browser imports only browser entrypoint.
- All examples in this document validate in tests.
- No new contract uses legacy `RegistryItem` or `ResourceItem` directly.
- Archive digest is byte-identical on API and CLI fixtures.
- Unsupported fields cannot enter events storage.
- Claude Code and Codex use the same recommendation and activation DTOs and exact pinned
  CLI contract version.
- OpenAPI, `llms.txt`, root/public `AGENTS.md` and plugin docs are updated in the same PR
  as runtime contract changes.
