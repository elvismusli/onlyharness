# OnlyHarness Agent Resource Catalog — concept and rollout plan

Date: 2026-07-07  
Status: draft for approval

## 1. Decision

OnlyHarness should not stop at harness listings. The product should become an
agent resource hub: one search, trust and install layer for harnesses, skills,
plugins, workflows, MCP servers, configs, command packs, guides, frameworks and
agent runtimes.

The current source-checked GitHub catalog is the first seed set, not the full
source universe. GitHub remains the best canonical source for many resources,
but the system must also ingest existing marketplaces and directories where
agent resources already live.

Important semantic boundary: the research catalog's "verified" means source
existence and activity were checked through upstream data. Product "verified"
means OnlyHarness has verified installation or gate evidence. The data model
must keep these separate.

## 2. Product position

OnlyHarness is the layer that answers:

1. What resource should my agent use for this task?
2. Can I trust it?
3. Does it work in my setup?
4. Can I install, import, convert or monetize it?

This keeps the fun showroom/marketplace feel, but the underlying model becomes
resource-first instead of harness-first.

## 3. Resource model

`Resource` is the top-level entity.

Required fields:

- `id`
- `title`
- `summary`
- `resourceType`
- `sourcePlatform`
- `canonicalUrl`
- `upstreamId`
- `upstreamOwner`
- `licenseStatus`
- `sourceCheckedAt`
- `lastSeenAt`
- `installability`
- `trust`
- `popularity`
- `actions`

### resourceType

- `harness`
- `skill`
- `plugin`
- `workflow`
- `mcp_server`
- `service_endpoint`
- `agent_team`
- `subagent_pack`
- `command_pack`
- `config`
- `guide`
- `framework`
- `agent_runtime`
- `directory`

### sourcePlatform

- `github`
- `claude_plugin_marketplace`
- `anthropic_official`
- `github_copilot`
- `cursor`
- `skillsmp`
- `agensi`
- `tonsofskills`
- `smithery`
- `glama`
- `pulsemcp`
- `mcp_so`
- `mcp_market`
- `agentic_market`
- `promptbase`
- `gumroad`
- `whop`
- `vendor_official`
- `manual`

### installability

- `open_only`: useful resource, but no known install path.
- `importable`: can be imported or converted.
- `installable`: can be installed into at least one supported agent setup.
- `verified`: install was tested and the resource passed the relevant checks.

### source verification vs product verification

Do not overload the word verified.

- `sourceCheckedAt`: upstream existence/activity was checked.
- `sourceCheckMethod`: for example `github_api`, `marketplace_api`,
  `manual_research`.
- `sourceCheckStatus`: `active | stale | archived | unavailable`.
- `installability: verified`: OnlyHarness has installation evidence.
- `trust.gateVerifiedAt`: OnlyHarness gate/eval evidence for harnesses.

User-facing copy should say `Source checked 2026-07-05` for catalog entries and
reserve `Verified install` / `Gate verified` for OnlyHarness checks.

## 4. Stars and popularity

GitHub stars and marketplace popularity should be used. They are valuable
discovery signals.

Display should show the source breakdown:

```text
GitHub ★ 136.2k · OnlyHarness ★ 12 · 4 installs · 2 passed gates
```

Ranking can use a blended score. Large upstream star counts must be log-scaled
or capped so one mega-repo does not permanently dominate task-specific resources
with real OnlyHarness install evidence.

```text
popularity =
  githubStarsWeight * log1p(githubStars)
  + marketplaceInstallsWeight * marketplaceInstalls
  + onlyHarnessStarsWeight * onlyHarnessStars
  + installsWeight * onlyHarnessInstalls
  + gatesWeight * passedGates
  + freshnessBoost
  - riskPenalty
```

Important boundary: popularity is not safety. Safety comes from scans,
permissions, install verification, evals and gates.

## 5. License and ownership rules

Listing a link-only resource is not redistribution. Importing, converting,
bundling or selling it is.

Rules:

- `open_only` listing may keep `licenseStatus: unknown`.
- `Convert to harness`, `Add to setup package`, `Publish`, and paid listing are
  blocked until license is detected and acceptable, or manually reviewed.
- Default markdown/skill imports stay `UNSPECIFIED` until explicitly reviewed.
- Resources from leaked/system-prompt dumps remain blocked by denylist and must
  not be listed, vendored or counted as discovery entries.
- Creator claim is required before paid listing, not only before payouts.
- Claim proof must use GitHub OAuth, a repository proof file, DNS-style proof,
  or equivalent marketplace ownership proof.

## 6. Actions by resource type

### Harness

- `Install`
- `Pull`
- `Run sample`
- `Eval`
- `Gate`
- `Pin/update`
- `Publish paid/free`

### Skill / plugin / command pack / config

- `Open upstream`
- `Install to Claude Code`
- `Install to Codex`
- `Install to Cursor`
- `Audit before install`
- `Convert to harness`
- `Claim as creator`

### MCP server

- `Open upstream`
- `Copy MCP config`
- `Add to client`
- `Check auth/secrets`
- `Review permissions`
- `Convert to harness dependency`

### Workflow / guide / framework / runtime

- `Open upstream`
- `Save to setup`
- `Extract workflow`
- `Convert to harness`
- `Compare alternatives`

### Service endpoint / x402 service

- `Open service`
- `Inspect pricing`
- `Call through agent-native payment`
- `Add as harness dependency`

## 7. Existing implementation to reuse

Do not rebuild what already exists.

Already available in the repo:

- directory shelf with 253-item catalog count and denylist tests;
- `hh publish <git-url> --path ...` for verified harness publication from Git;
- `hh extract <skill>` for local skill-to-harness scaffolding;
- verified publish gate: schema, security, eval and gate must pass;
- server-side star and thread APIs for harness social signals;
- link-only directory archive protection.

New resource work should extend these paths rather than create parallel flows.

## 8. Source adapters

Each source adapter should normalize external data into `Resource`.

### Wave A: GitHub

Use for the existing 253-item source-checked catalog and future creator imports.

Signals:

- stars
- forks
- pushedAt
- archived flag
- license
- README
- topics
- repo contents

Import behavior:

- if `harness.yaml` exists: validate as harness candidate;
- if `SKILL.md` or `.claude/skills` exists: classify as skill;
- if `.claude-plugin/plugin.json` exists: classify as plugin;
- if MCP config/server files exist: classify as MCP-related;
- otherwise classify by README/topics and allow manual convert only after
  license/source review.

### Wave B: MCP directories

Sources:

- Smithery
- Glama
- PulseMCP
- mcp.so
- MCP Market
- official MCP Registry

Signals:

- server name
- categories
- package/install method
- auth requirements
- quality/license/maintenance signals where available
- docs URL

### Wave C: skill and plugin marketplaces

Sources:

- SkillsMP
- Agensi
- tonsofskills
- Claude plugin marketplaces
- Anthropic official skills/plugins
- Cursor/GitHub Copilot resource catalogs

Signals:

- install method
- supported clients
- creator
- pricing if public
- marketplace popularity if available
- source URL

Adapter constraint:

- SkillsMP currently advertises a REST API and public GitHub-source skill
  indexing, but adapter implementation still needs ToS/API verification.
- Agensi, Whop, PromptBase and similar marketplaces must start read-only with
  attribution unless API/ToS explicitly allows deeper ingestion.

### Wave D: service and workflow marketplaces

Sources:

- Agentic.Market / x402 Bazaar
- PromptBase
- Gumroad/Whop-style digital products
- vendor official catalogs

Use only when the item is relevant to agent setup, agent workflow,
agent-native service calls or reusable operational patterns.

## 9. GitHub import flow

Goal: a user should be able to bring their own resource from GitHub.

Recommended paths:

### CLI

```bash
hh import-github https://github.com/acme/agent-skills --json
hh import-github https://github.com/acme/agent-skills --path skills/researcher --json
hh publish https://github.com/acme/harnesses.git --path harnesses/researcher --json
```

### Web

Flow:

1. Paste GitHub URL.
2. Detect resource type.
3. Show files that will be read.
4. Show license/source status.
5. Choose action:
   - list as resource;
   - import as unverified candidate;
   - publish verified harness after eval/gate.

Server safety:

- no arbitrary shell execution for web import;
- fetch archives only through GitHub API or GitHub archive endpoints;
- allow only `github.com`, `api.github.com`, and `codeload.github.com`;
- reject localhost, private IPs, link-local IPs, non-HTTPS URLs and unsafe
  redirects after final host revalidation;
- enforce max response bytes, decompressed bytes, file count, archive entries
  and path depth;
- reject path traversal, symlinks and special files;
- never import secrets;
- keep license unknown unless detected;
- block conversion/publishing until license is explicit and acceptable.

## 10. UX changes

Explore becomes a resource catalog, but the default tab stays `Harnesses` for
the first release so the install-first flow is not buried under 253 open-only
seed resources.

Top-level filters:

- All
- Harnesses
- Skills
- Plugins
- Workflows
- MCP
- Agent teams
- Configs
- Guides
- Frameworks
- Runtimes

Secondary filters:

- Source platform
- Installability
- Verified install
- Risk tier
- License status
- Works with: Claude Code, Codex, Cursor, MCP, CLI

Card badges:

- `GitHub resource`
- `Marketplace resource`
- `Installable`
- `Verified install`
- `Source checked`
- `Needs source review`
- `License unknown`
- `MCP auth required`

Primary CTA rules:

- `verified/installable harness` -> Install
- `installable skill/plugin` -> Add to setup
- `mcp_server` -> Copy MCP config
- `workflow/guide/framework` -> Open / Extract
- `open_only` -> Open upstream
- `importable` -> Import / Convert

## 11. API surface

New endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/resources` | Search all resources |
| GET | `/api/resources/{id}` | Resource detail |
| POST | `/api/imports/github-resource` | Import or classify a GitHub URL |
| POST | `/api/resources/{id}/claim` | Creator claim flow |
| POST | `/api/resources/{id}/convert-to-harness` | Create unverified harness candidate |

Existing endpoints stay:

- `/api/registry` remains the current harness-plus-link-only-directory feed to
  preserve the existing agent contract.
- `/api/repos/{owner}/{repo}/archive` remains archive-safe: harnesses may return
  files, directory shelf entries return `DIRECTORY_LINK_ONLY`, and external
  mixed resources are not served as archives.

Recommended compatibility mode:

```text
/api/registry                -> harnesses plus link-only directory shelf
/api/resources               -> all resources
```

Web Explore should move to `/api/resources` for mixed search. Existing agent
clients using `/api/registry` should not suddenly receive external mixed
resources.

## 12. CLI and MCP

CLI:

```bash
hh search market research --json
hh resources search spec workflow --json
hh resources open github:github/spec-kit
hh resources import https://github.com/acme/agent-skills --json
hh resources convert github:acme/agent-skills --out acme-agent-skills --json
hh catalog search mcp browser --json
```

`hh search` remains harness-first. `hh resources search` searches all resources.
`hh suggest` may include non-harness resources only when the output clearly marks
them as `open_only`, `importable`, `installable`, or `verified`.

MCP tools:

- `search_resources`
- `resource_detail`
- `import_github_resource`
- `conversion_instructions`
- keep `search_harnesses`, `harness_detail`, `pull_instructions`,
  `pull_harness`, `search_docs`, and `publish_markdown_to_harness` for the
  existing harness/docs contract.

## 13. Trust model

Trust layers:

1. Upstream signals: stars, update recency, license, source platform.
2. Static safety: file scan, suspicious instructions, permissions, secret patterns.
3. Install safety: client-specific install verification.
4. Execution proof: eval/gate for harnesses.
5. Community proof: OnlyHarness stars, imports, installs, passed gates, threads.
6. Creator proof: claimed profile, history, payout/entitlement integrity.

Rules:

- external resource can be popular but still untrusted;
- installable does not mean verified;
- paid requires source/license clarity;
- money movement and credentials require explicit warnings;
- all provenance must be visible.
- resource stars, threads and comments should reuse the existing server-side
  social API pattern rather than reintroducing browser-only writes.

## 14. Rollout plan

### Phase 0: Approve model

Output:

- approve `Resource` as top-level entity;
- approve resource types and source platforms;
- approve split between `/registry` and `/resources`.

### Phase 1: Data foundation

Tasks:

- parse `docs/research/verified-catalog-2026-07.md` into `data/resources/verified-2026-07.json`;
- preserve GitHub stars/update snapshots;
- map each item to `resourceType`;
- translate or rewrite Russian summaries into English for the public product
  surface while preserving the original source summary;
- write `sourceCheckedAt`, `sourceCheckMethod`, `lastSeenAt`, and
  `sourceCheckStatus`;
- add refresh design for GitHub/API-backed sources;
- keep denylist enforced;
- add tests for count and denylist.

Acceptance:

- structured JSON item count matches the parsed source catalog;
- initial source catalog loads 253 resources;
- no leaked prompt dumps;
- each item has type, source, URL, stars snapshot, updatedAt, sourceCheckedAt
  and lastSeenAt.

### Phase 2: API and search

Tasks:

- add `/api/resources`;
- add `/api/resources/{id}`;
- add search/filter/sort by type, source, popularity, freshness;
- expose blended popularity fields.

Acceptance:

- API returns all resources from the structured source catalog;
- search can find skills, MCP servers, workflows and plugins;
- archive behavior remains safe: harness files only, directory shelf as
  `DIRECTORY_LINK_ONLY`, no external resource archives;
- `/api/registry` keeps the existing harness-plus-directory semantics.

### Phase 3: Web Explore

Tasks:

- add resource-aware cards;
- add filters by type/source/installability;
- show GitHub/marketplace/OnlyHarness popularity breakdown;
- show correct CTAs per resource type.

Acceptance:

- user can browse and open resources without reading the md file;
- installable harnesses are visually distinct from external resources;
- no external resource is presented as already verified unless it is.

### Phase 4: CLI/MCP

Tasks:

- add `hh resources search/open`;
- add MCP `search_resources` and `resource_detail`;
- update llms.txt and AGENTS.md.

Acceptance:

- agent can search resources without a browser;
- agent can distinguish open-only/importable/installable/verified.

### Phase 5: GitHub import

Tasks:

- reuse the existing `hh publish <git-url> --path ...` verified harness path;
- add GitHub URL classifier for resources that are not already harnesses;
- detect harness/skill/plugin/MCP/workflow/config;
- add CLI import path;
- add web import wizard;
- create unverified candidate harness only after user confirms.

Acceptance:

- own GitHub repo can be imported;
- existing harness repo can be validated and published;
- non-harness resource can be listed or converted without pretending to be verified;
- conversion is blocked when license is missing, incompatible or not reviewed.

### Phase 6: Marketplace adapters

Order:

1. MCP registries: Smithery, Glama, PulseMCP, mcp.so.
2. Skills/plugins: SkillsMP, Agensi, tonsofskills, Claude plugin marketplaces.
3. x402/services: Agentic.Market / Bazaar.
4. Prompt/workflow marketplaces where relevant.

Tasks:

- verify API availability, ToS, robots and attribution requirements per source;
- start non-GitHub marketplaces as read-only links unless deeper ingestion is
  explicitly allowed;
- store `sourcePlatform`, `sourceTermsCheckedAt`, and source URL.

Acceptance:

- at least 3 non-GitHub source platforms ingest into the same resource model;
- each adapter has source attribution and freshness metadata;
- no marketplace adapter relies on prohibited scraping.

### Phase 7: Promotion to installable and verified resources

Tasks:

- select top resources by category;
- run source/license/security review;
- add install adapters where possible;
- convert selected resources into installable harnesses or setup packages;
- add verified-install checks per client.

Acceptance:

- first 20 high-value resources become installable or verified;
- resources keep upstream attribution;
- user sees clear before/after status.

## 15. Resolved decisions

1. `/api/registry` stays as the current harness-plus-directory feed. Mixed
   search lives under `/api/resources`.
2. Upstream stars are useful but must be log-scaled/capped in ranking.
3. `hh search` remains harness-first. Add `hh resources search`.
4. Marketplace imports start read-only with attribution until ToS/API review.
5. Creator claim with proof-of-ownership is required before paid listing.

## 16. Open decisions for approval

1. Should resource claim use GitHub OAuth first, proof-file first, or both?
2. Which three source adapters should ship after GitHub: Glama, Smithery,
   SkillsMP, Agensi, or Agentic.Market?
3. After the first release, should web Explore switch from default `Harnesses`
   to default `All`, or keep resource search secondary?

## 17. Recommended approval

Approve phases 0-4 as the first implementation batch.

Do not build marketplace write/publish flows yet. First ship:

- structured 253-resource catalog;
- resource API;
- resource-aware web Explore;
- CLI/MCP search;
- clear GitHub import design.

Then approve Phase 5 after seeing the first resource catalog in the product.

## 18. Reference sources

- Verified seed catalog: `docs/research/verified-catalog-2026-07.md`
- Denylist: `docs/research/catalog-denylist.json`
- Competitor research: `docs/research/monetization-competitors-2026-07.md`
- Custdev results: `docs/research/custdev-results-2026-07.md`
- SkillsMP: https://skillsmp.com/
- Glama MCP: https://glama.ai/mcp/servers
- tonsofskills: https://github.com/jeremylongshore/claude-code-plugins-plus-skills
- Agentic.Market: https://www.coinbase.com/developer-platform/discover/launches/agentic-market
- Agensi Claude plugin guide: https://www.agensi.io/learn/claude-code-plugin-marketplace-guide
