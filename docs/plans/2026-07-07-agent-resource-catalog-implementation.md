# Agent Resource Catalog — detailed implementation plan

Date: 2026-07-07  
Status: draft for approval  
Depends on: `2026-07-07-agent-resource-catalog-concept.md`

## 0. Goal

Ship a useful populated OnlyHarness resource catalog fast.

The first release should let a user install the OnlyHarness plugin or CLI,
search the curated seed catalog, see where every item came from, and use the
resource through the best available action: install, copy config, open upstream,
import, or convert.

This is not a full marketplace launch. It is a resource-filled product launch
with honest provenance and a path to later verification and monetization.

## 1. Implementation principles

1. `/api/registry` keeps its current contract: installable harnesses plus
   link-only directory shelf entries. External mixed resources must not leak
   into `/api/registry`.
2. `/api/resources` is the new mixed catalog for skills, plugins, workflows,
   MCP servers, configs, guides, frameworks, runtimes, directories and
   harnesses.
3. `sourceCheckedAt` is not product verification.
4. GitHub stars and upstream popularity are allowed, but always labeled by
   source and log-scaled in ranking.
5. Conversion, bundling, publishing and paid listing are blocked until license
   status is explicit and acceptable or manually reviewed.
6. Reuse current implementation: directory shelf, denylist tests,
   `hh publish <git-url> --path`, `hh extract`, verified publish gate,
   server-side star/thread patterns.
7. Marketplace adapters beyond GitHub start read-only until API/ToS review.

## 2. Target MVP

MVP user flow:

1. User opens OnlyHarness or asks the plugin/CLI for a resource.
2. Search returns real populated results from the curated 253-resource seed.
3. Each card shows:
   - resource type;
   - creator/upstream owner;
   - GitHub/source URL;
   - GitHub stars snapshot;
   - source checked date;
   - license status;
   - installability;
   - best next action.
4. User can:
   - open upstream;
   - install/copy config when a safe install path is known;
   - import or convert only after source/license guardrails.

MVP is complete when this works through:

- Web Explore;
- HTTP API;
- MCP tool;
- CLI command.

## 3. Data model

Add a resource data layer independent from harness manifests.

Suggested files:

```text
apps/harness-api/src/resources.ts
apps/harness-api/test/resources.test.ts
data/resources/verified-2026-07.json
data/resources/summary-en.json
scripts/build-verified-resource-catalog.ts
scripts/refresh-resource-catalog.ts
scripts/resource-catalog.test.ts
```

### Resource shape

```ts
type ResourceType =
  | "harness"
  | "skill"
  | "plugin"
  | "workflow"
  | "mcp_server"
  | "service_endpoint"
  | "agent_team"
  | "subagent_pack"
  | "command_pack"
  | "config"
  | "guide"
  | "framework"
  | "agent_runtime"
  | "directory";

type SourcePlatform =
  | "github"
  | "claude_plugin_marketplace"
  | "anthropic_official"
  | "github_copilot"
  | "cursor"
  | "skillsmp"
  | "agensi"
  | "tonsofskills"
  | "smithery"
  | "glama"
  | "pulsemcp"
  | "mcp_so"
  | "mcp_market"
  | "agentic_market"
  | "promptbase"
  | "gumroad"
  | "whop"
  | "vendor_official"
  | "manual";

type Installability = "open_only" | "importable" | "installable" | "verified";

type LicenseStatus =
  | "permissive"
  | "copyleft"
  | "proprietary"
  | "unknown"
  | "blocked"
  | "manual_review";

type ResourceIdentity = {
  scheme: "github" | "onlyharness" | "marketplace" | "manual";
  key: string;
  subpath?: string;
};

type Resource = {
  id: string;
  identity: ResourceIdentity;
  sourceCatalogId?: string;
  title: string;
  summary: string;
  summaryOriginal?: string;
  resourceType: ResourceType;
  sourcePlatform: SourcePlatform;
  canonicalUrl: string;
  upstreamId: string;
  upstreamOwner: string;
  upstreamRepo?: string;
  creatorName?: string;
  licenseStatus: LicenseStatus;
  licenseName?: string;
  sourceCheckedAt: string;
  sourceCheckMethod: "github_api" | "marketplace_api" | "manual_research";
  sourceCheckStatus: "active" | "stale" | "archived" | "unavailable";
  lastSeenAt: string;
  installability: Installability;
  tags: string[];
  worksWith: Array<"claude-code" | "codex" | "cursor" | "mcp" | "cli" | "github">;
  upstreamPopularity: {
    githubStarsSnapshot?: number;
    githubStarsCurrent?: number;
    githubForks?: number;
    marketplaceInstalls?: number;
    marketplaceRating?: number;
    sourceLabel: string;
  };
  onlyHarnessSignals: {
    stars: number;
    opens: number;
    imports: number;
    installs: number;
    threads: number;
    passedGates: number;
  };
  popularityScore: number;
  popularityBreakdown: {
    upstreamScore: number;
    onlyHarnessScore: number;
    freshnessBoost: number;
    riskPenalty: number;
  };
  trust: {
    sourceChecked: boolean;
    securityScan?: "pass" | "warn" | "fail" | "not_scanned";
    installVerifiedAt?: string;
    gateVerifiedAt?: string;
    riskTier?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
  };
  actions: ResourceAction[];
};
```

### Identity and dedupe

Resource IDs must be stable and collision-safe:

- GitHub repo resource: `github:<owner>/<repo>`.
- GitHub subpath resource: `github:<owner>/<repo>#<path>`.
- OnlyHarness harness: `onlyharness:<owner>/<name>`.
- OnlyHarness directory shelf entry: `onlyharness:directories/<name>`.
- Marketplace resource: `marketplace:<platform>/<external-id>`.
- Manual resource: `manual:<slug>`.

If an external GitHub resource later becomes a published OnlyHarness harness,
link them as related resources first. Collapse them only when owner/source proof
confirms they are the same distributable artifact.

### ResourceAction

```ts
type ResourceAction =
  | { id: "open_mirror"; label: "Use via OnlyHarness"; url: string }
  | { id: "open_upstream"; label: string; url: string }
  | { id: "copy_mcp_config"; label: string; command?: string }
  | { id: "install"; label: string; command: string; target: string }
  | { id: "import_github"; label: string; command: string }
  | { id: "claim"; label: string; proofRequired: true };
```

`open_mirror` is preferred only after the GitHub fork exists under the
OnlyHarness mirror namespace. `open_upstream` remains visible for attribution and
fallback. Do not expose failed mirror attempts in the public catalog.

## 4. Seed catalog build

Input:

- `docs/research/verified-catalog-2026-07.md`
- `docs/research/catalog-denylist.json`
- `data/resources/summary-en.json`

Output:

- `data/resources/verified-2026-07.json`
- `data/resources/mirrors-overclawswarm.json` as local batch state; not a public
  product contract.

Build script:

```bash
tsx scripts/build-verified-resource-catalog.ts
tsx scripts/mirror-resource-catalog.ts --minimal-api --auth-login overclawswarm
```

Parsing requirements:

- parse all markdown table rows;
- assert source row count is exactly 253. This is a flat seed count, not a
  derived subtraction; denylist is defense-in-depth for future regressions;
- assert denylisted repos are absent;
- map each section to `resourceType`;
- preserve upstream stars as `githubStarsSnapshot`;
- store `sourceCheckedAt=2026-07-05`;
- store initial `lastSeenAt=2026-07-05`;
- preserve Russian summary as `summaryOriginal`;
- read English public `summary` from committed `data/resources/summary-en.json`;
- fail the build if an English summary is missing or still matches the Russian
  source text;
- set `licenseStatus=unknown` unless license is detected from a source field;
- set every seed entry to `installability=open_only` unless a separate
  explicit adapter verification file proves a safer action.

Section mapping:

| Section | resourceType |
| --- | --- |
| Official Anthropic resources | `plugin`, `skill`, `guide`, or `framework` by row |
| Awesome lists and catalogs | `directory` |
| Skill frameworks and large collections | `skill` or `framework` |
| Single skills | `skill` |
| Domain skill packs | `skill` |
| Subagents and agent teams | `agent_team` |
| Plugins, commands, configs | `plugin`, `command_pack`, or `config` |
| Spec-driven and workflow methodologies | `workflow` |
| Orchestration and meta-harnesses | `framework` or `agent_runtime` |
| Memory and context engineering | `framework` or `workflow` |
| Hooks, safety, observability | `config`, `plugin`, or `workflow` |
| MCP servers | `mcp_server` |
| Harnesses: terminal/autonomous agents | `agent_runtime` |
| Infrastructure around harnesses | `framework` or `config` |
| Guides and learning | `guide` |
| Adjacent frameworks | `framework` |

Acceptance:

- JSON has 253 resources.
- No denylist repos.
- Every resource has `resourceType`, `sourcePlatform`, `canonicalUrl`,
  `sourceCheckedAt`, `lastSeenAt`, `licenseStatus`, `installability`.
- Public `summary` is English; `summaryOriginal` preserves original text.
- Resource IDs are stable and collision-free across GitHub, OnlyHarness,
  marketplace and manual entries.

## 5. Refresh and staleness

Add a deterministic refresh script:

```bash
tsx scripts/refresh-resource-catalog.ts
```

GitHub refresh behavior:

- call GitHub API only for resources with `sourcePlatform=github`;
- update `githubStarsCurrent`, forks, pushed date, archived state, license and
  `lastSeenAt`;
- leave `githubStarsSnapshot` and `sourceCheckedAt` immutable;
- set `sourceCheckStatus=stale` when `lastSeenAt` is older than 90 days;
- set `sourceCheckStatus=archived` when GitHub marks the repository archived;
- set `sourceCheckStatus=unavailable` when the repository cannot be resolved;
- never upgrade `installability` during refresh.

Acceptance:

- fixture tests cover active, stale, archived and unavailable repos;
- refresh is safe to run repeatedly;
- UI labels current stars as current GitHub stars and snapshot stars as the
  original July 2026 source snapshot.

## 6. Resource API

Add `apps/harness-api/src/resources.ts`.

Functions:

```ts
readResourceCatalog(): ResourceCatalog
searchResources(query: ResourceQuery): Resource[]
resourceDetail(id: string): Resource | undefined
resourcesFromRegistryCatalog(items: RegistryItem[]): Resource[]
popularityScore(resource: Resource): number
```

`resourcesFromRegistryCatalog` may synthesize OnlyHarness harness and directory
resources only with explicit defaults. It must not pretend that `RegistryItem`
contains license, source platform or external provenance fields that are not
present in the registry payload.

Popularity formula:

```ts
const upstreamScore =
  Math.min(Math.log1p(githubStarsCurrent ?? githubStarsSnapshot ?? 0), 12) * 4 +
  Math.min(Math.log1p(marketplaceInstalls ?? 0), 12) * 3;

const onlyHarnessScore =
  stars * 2 +
  opens * 0.1 +
  imports * 3 +
  installs * 5 +
  passedGates * 8 +
  threads * 1.5;

const freshnessBoost =
  sourceCheckStatus === "active" && lastSeenAgeDays <= 30 ? 5 :
  sourceCheckStatus === "active" && lastSeenAgeDays <= 90 ? 2 :
  0;

const riskPenalty =
  sourceCheckStatus === "unavailable" ? 100 :
  sourceCheckStatus === "archived" ? 25 :
  licenseStatus === "unknown" ? 3 :
  licenseStatus === "blocked" ? 100 :
  0;

popularityScore = Math.round(upstreamScore + onlyHarnessScore + freshnessBoost - riskPenalty);
```

This keeps huge GitHub projects useful for discovery without letting raw stars
overwhelm OnlyHarness usage, install and gate signals.

Search query:

```ts
type ResourceQuery = {
  q?: string;
  type?: string;
  source?: string;
  installability?: string;
  worksWith?: string;
  license?: string;
  sort?: "popular" | "github-stars" | "new" | "source-checked" | "onlyharness";
  limit?: number;
};
```

Server routes:

```text
GET /resources
GET /resources/:id
```

Response should include:

- normalized resource fields;
- `actions`;
- `popularityBreakdown`;
- `source` block;
- no local filesystem paths.

OpenAPI:

- add `/resources`;
- add `/resources/{id}`;
- document `sourceCheckedAt` vs `installVerifiedAt`.

Smoke assertions:

- `/resources` returns `counts.externalSeed === 253` plus current internal
  harness/directory resources after dedupe;
- `/resources?q=superpowers` finds `obra/superpowers`;
- `/resources?type=mcp_server` returns MCP resources;
- `/registry` keeps current behavior: harnesses plus link-only directory shelf;
- external `/resources` entries do not appear in `/registry`;
- `/repos/.../archive` stays archive-safe and returns `DIRECTORY_LINK_ONLY` for
  directory shelf entries.

## 7. Social signals for resources

Current harness social path exists for `/repos/:owner/:repo/star` and thread.
Do not write resource stars directly from browser to Supabase.

Add later, but design now:

```text
POST /resources/:id/star
GET /resources/:id/thread
POST /resources/:id/thread
POST /events kind=open/import/install for resource ids
```

For MVP:

- resource cards can show upstream stars;
- OnlyHarness stars for resources can be zero or derived from events only if
  server-side path is ready;
- do not fake resource installs.

## 8. Web implementation

Files:

```text
apps/registry-web/src/types.ts
apps/registry-web/src/main.tsx
apps/registry-web/src/explore.tsx
apps/registry-web/src/detail.tsx
apps/registry-web/src/windows.tsx
apps/registry-web/src/styles.css
```

Recommended UI approach:

1. Keep the Win98 shell.
2. Main Explore defaults to `Harnesses`; mixed resources are available through
   `All` and type tabs after `/api/resources` exists.
3. Add tabs or segmented filter:
   - `Harnesses`
   - `All`
   - `Skills`
   - `Plugins`
   - `Workflows`
   - `MCP`
   - `Runtimes`
   - `Guides`
4. Card layout:
   - title;
   - resource type badge;
   - source platform badge;
   - creator/upstream owner;
   - GitHub/source stars;
   - source checked date;
   - license badge;
   - installability badge;
   - CTA.

CTA mapping:

| installability/resource | Primary CTA |
| --- | --- |
| `harness` + installable/verified | Install |
| `skill`/`plugin` + installable | Add to setup |
| `mcp_server` | Copy MCP config |
| `workflow`/`guide`/`framework` | Open upstream |
| `importable` | Import |
| `open_only` | Open upstream |

Detail view:

- show `Source` panel;
- show `Trust` panel;
- show `Use it` panel;
- show `Convert/import` panel with license block if applicable.

Copy rules:

- Avoid saying "verified" for source-checked entries.
- Use `Source checked` and `GitHub stars`.
- Use `Verified install` only when we have client evidence.

## 9. CLI implementation

Keep existing `hh search` harness-first.

Add:

```bash
hh resources search <query...> --json
hh resources open <resource-id>
hh resources detail <resource-id> --json
hh resources import <github-url> --json
hh resources convert <resource-id> --out <dir> --json
```

MVP commands:

1. `hh resources search`
2. `hh resources detail`
3. `hh resources open`

Defer import/convert command until API classification exists.

Text output example:

```text
github:obra/superpowers — superpowers
  type skill · source GitHub · GitHub ★ 246.6k · source checked 2026-07-05
  availability OnlyHarness mirror · license unknown · works with Claude Code
  use via OnlyHarness https://github.com/overclawswarm/oh-obra-superpowers
```

JSON output should preserve all fields.

Exit codes:

- not found: existing `EXIT.NOT_FOUND`;
- validation/source blocked: existing validation code;
- no browser opener available: print URL, do not fail hard.

## 10. MCP implementation

Add MCP tools:

```text
search_resources
resource_detail
resource_use_instructions
```

Tool behavior:

- `search_resources` searches all resources and returns top N with provenance.
- `resource_detail` returns detail and actions.
- `resource_use_instructions` returns install/open/import guidance by type.

Keep existing harness tools unchanged:

- `search_harnesses`
- `harness_detail`
- `pull_instructions`
- `pull_harness`
- `search_docs`
- `publish_markdown_to_harness`

This prevents agents from trying to pull a non-harness as an archive.

## 11. GitHub import and conversion

Use existing verified publish path for true harness repos:

```bash
hh publish https://github.com/acme/harnesses.git --path harnesses/researcher --json
```

New classifier path:

```text
POST /imports/github-resource
```

Request:

```json
{
  "url": "https://github.com/acme/agent-skills",
  "path": "skills/researcher",
  "action": "classify"
}
```

Classification:

- `harness.yaml` -> `harness_candidate`;
- `SKILL.md` -> `skill`;
- `.claude-plugin/plugin.json` -> `plugin`;
- `.mcp.json`, `server.json`, known MCP files -> `mcp_server` or `plugin`;
- slash commands/settings -> `command_pack` or `config`;
- README-only -> `workflow` or `guide`.

Guardrails:

- no shell execution on server;
- URL host allowlist: `github.com`, `api.github.com`, `codeload.github.com`;
- reject localhost, private IPs, link-local IPs and non-HTTPS URLs;
- revalidate final URL host after every redirect;
- fetch only GitHub archive/API URLs, not arbitrary raw user-provided URLs;
- max response bytes;
- max decompressed archive bytes;
- max files, archive entries and nested path depth;
- path traversal protection;
- reject symlinks and special files;
- secret scanning;
- denylist check;
- license detection;
- conversion blocked until license passes.

Output:

- classification;
- detected files;
- license status;
- recommended action;
- conversion blocked reason if blocked.

## 12. Marketplace adapters

Do not implement all marketplace adapters in MVP.

Phase after MVP:

1. Glama MCP: likely high value because it exposes quality/license/maintenance
   style signals publicly.
2. Smithery/PulseMCP/mcp.so: MCP discovery depth.
3. SkillsMP: large skill surface, API advertised, ToS/API review required.
4. tonsofskills/Claude plugin marketplaces: plugin/skill bundles.
5. Agentic.Market: x402 service endpoints.

Adapter checklist per source:

- API or allowed crawl path;
- ToS/robots review;
- attribution format;
- rate limits;
- freshness model;
- unique ID format;
- source-specific popularity signals;
- install/action mapping.

No prohibited scraping.

## 13. Tests and verification

Unit tests:

```bash
npm run typecheck -w @harnesshub/api
npm run typecheck -w @harnesshub/registry-web
npm run typecheck -w onlyharness
npm run test -w @harnesshub/api
npm test -w onlyharness
tsx --test scripts/resource-catalog.test.ts
tsx --test scripts/resource-refresh.test.ts
```

Root checks:

```bash
npm run check
npm run smoke
npm run smoke:mcp
```

New smoke coverage:

- resource catalog loads;
- denylist enforced;
- English summaries are present through `summary-en.json`;
- resource IDs dedupe without collision;
- refresh fixtures cover stale/archived/unavailable sources;
- `/resources` search works;
- MCP `search_resources` works;
- CLI `hh resources search` works;
- `/registry` remains current harness-plus-directory feed;
- external non-harness resources cannot be pulled through archive;
- conversion is blocked without acceptable license.
- GitHub import rejects SSRF hosts, unsafe redirects, traversal, symlinks and
  zip-bomb fixtures.

Browser smoke:

- Explore shows resource cards;
- source badges are visible;
- GitHub stars are labeled as GitHub;
- source-checked is not shown as verified install;
- primary CTA opens/copies the right action.

## 14. Deployment plan

For Phases 1-4:

1. Merge data/API/CLI/UI behind normal behavior.
2. Run `npm run check`.
3. Run `npm run smoke`.
4. Deploy with existing production script.
5. Verify:
   - `https://onlyharness.com/api/resources?q=superpowers`;
   - `https://onlyharness.com/api/registry` still returns harnesses plus the
     link-only directory shelf;
   - web Explore defaults to Harnesses and exposes mixed resources through
     resource tabs;
   - MCP resource search works.

Do not enable marketplace adapters in production until each source has ToS/API
approval.

## 15. Work breakdown

### PR 1: Structured resource seed

Files:

- `scripts/build-verified-resource-catalog.ts`
- `scripts/refresh-resource-catalog.ts`
- `scripts/resource-catalog.test.ts`
- `scripts/resource-refresh.test.ts`
- `data/resources/verified-2026-07.json`
- `data/resources/summary-en.json`

Acceptance:

- generated JSON has 253 resources;
- denylist test passes;
- English summaries exist;
- IDs/dedupe and refresh fixtures pass.

### PR 2: API resource module

Files:

- `apps/harness-api/src/resources.ts`
- `apps/harness-api/src/server.ts`
- `apps/harness-api/src/openapi.ts`
- `apps/harness-api/test/resources.test.ts`

Acceptance:

- `/resources` and `/resources/:id` work;
- `/registry` keeps existing harness-plus-directory behavior;
- OpenAPI updated.

### PR 3: MCP resources

Files:

- `apps/harness-api/src/mcp.ts`
- `scripts/smoke-mcp.ts`
- `apps/registry-web/public/llms.txt`
- `apps/registry-web/public/AGENTS.md`

Acceptance:

- `search_resources` returns source-aware resources;
- existing harness tools still work.

### PR 4: CLI resources

Files:

- `packages/harness-cli/src/index.ts`
- `packages/harness-cli/test/exit-codes.test.ts`
- `packages/harness-cli/README.md`

Acceptance:

- `hh resources search/open/detail` work with JSON and text output.

### PR 5: Web resource Explore

Files:

- `apps/registry-web/src/types.ts`
- `apps/registry-web/src/main.tsx`
- `apps/registry-web/src/explore.tsx`
- `apps/registry-web/src/detail.tsx`
- `apps/registry-web/src/windows.tsx`
- `apps/registry-web/src/styles.css`

Acceptance:

- mixed resources visible outside the default Harnesses tab;
- harness install cards remain clear;
- resource cards show provenance and correct CTA.

### PR 6: GitHub classify/import design

Files:

- `apps/harness-api/src/github-import.ts`
- `apps/harness-api/test/github-import.test.ts`
- `packages/harness-cli/src/index.ts`

Acceptance:

- classify GitHub URL without importing;
- existing harness git publish reused;
- conversion blocked by license guard;
- SSRF, redirect, traversal, symlink and decompression limits tested.

## 16. Recommended sequence

Build in this order:

1. PR 1: structured seed.
2. PR 2: `/resources` API.
3. PR 3: MCP resources.
4. PR 4: CLI resources.
5. PR 5: Web Explore.
6. Deploy and smoke.
7. PR 6: GitHub classify/import.
8. Decide first external marketplace adapter.

This order makes the catalog useful before solving full import/conversion.

## 17. Approval checklist

Approve this plan if these statements are correct:

- The immediate goal is a populated, usable resource catalog, not full
  marketplace monetization.
- GitHub stars and upstream popularity can seed discovery, with clear source
  labels.
- `/registry` remains the current harness-plus-directory feed.
- `/resources` becomes the mixed resource catalog.
- Source-checked is not the same as verified install.
- License and ownership gates block conversion and paid listing.
- GitHub is Wave A; other marketplaces are Wave B+ after ToS/API review.
