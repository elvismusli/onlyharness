# OnlyHarness Workspaces Layer Plan

Дата: 2026-07-08  
Статус: detailed implementation plan after E2E review, resource-first pivot, first workspace production slice shipped in npm `onlyharness@0.2.4`, workspace collections/approval shipped in npm `onlyharness@0.2.5`, approval security hardening shipped/deployed in `onlyharness@0.2.6`, workspace membership/invites shipped in `onlyharness@0.2.7`, shared-neutral workspace UI wiring shipped in the web app, workspace approval add/remove admin flow implemented for `onlyharness@0.2.8`, workspace setup bundles implemented for `onlyharness@0.2.9`, community join policies/gate codes implemented for `onlyharness@0.2.10`, membership expiry handling implemented for `onlyharness@0.2.11`, and recurring workspace subscription lifecycle implemented as a manual/provider-agnostic track for `onlyharness@0.2.12`.

Current implementation status:

- shipped: universal public resource packages, workspace token API foundation, workspace member/invite API, workspace member authorization beside token auth, workspace-private resource package publish/search/detail/archive, workspace collections, default `approved` collection, approved public resource listings, `hh publish-resource --workspace`, `hh resources approve`, `hh resources unapprove`, `hh resources search --workspace`, `hh resources detail @workspace/name`, shared-neutral resource-first workspace UI across W98/Modern/Fans, workspace approval add/remove UI, members/invites/join UI, workspace setup bundles, community join policies, short-lived workspace gate codes, read-only gate verification, explicit gate grants, recurring workspace subscription lifecycle, org route compatibility aliasing, OpenAPI/check/smoke coverage;
- prod default: `WORKSPACES_ENABLED=false`, so prod fails closed until a seed workspace and membership policy are ready;
- not done yet: production workspace enablement seed/policy and real recurring charge provider integration.

Review corrections incorporated:

- workspace UI must follow the current `core/` + `win98|modern|fans` skin architecture;
- Phase 1-3 CLI remains token-based unless `hh login` is explicitly pulled forward;
- hosted personal workspace is not v1 and must not be conflated with storefront/profile;
- workspace collections are distinct from public marketplace collections;
- marketplace approval requires a current trust/security snapshot; `not_scanned` and `fail` must fail closed for installable approval, `warn` becomes `approved_with_warning`;
- community `moderator` can propose/curate, but cannot approve installable resources unless also granted publisher/admin/owner power;
- private workspace packages are internal-use only in v1; paid resale is a separate legal/billing track;
- recurring subscriptions are a separate billing track, not a community-gate footnote;
- org-to-workspace migration is mostly greenfield on prod because orgs are disabled;
- workspace list/search/audit APIs need pagination/index guardrails from the start.

## 1. Короткий вывод

OnlyHarness не должен строить только `Company Workspace`. Нужен универсальный слой:

```text
Workspace = подборка agent resources + участники + правила доступа + аудит + install/setup paths.
```

Этот слой покрывает:

- компании с 20+ разработчиками;
- закрытые комьюнити и чаты;
- курсы и cohorts;
- агентства и клиентские подборки;
- open-source сообщества;
- future personal/local saved setups, without a hosted personal workspace in v1.

Главное: OnlyHarness остается showroom + trust + install layer. Workspace не становится местом, где агент выполняет всю работу. Он отвечает за то, что можно найти, кому это доступно, как это безопасно поставить в Claude Code/Codex/Cursor/MCP/CLI, и почему конкретный ресурс разрешен или запрещен.

## 2. Почему не хватит текущего `org`

Сейчас в коде есть foundation:

- `GET /orgs/{slug}/bundle`
- `GET /orgs/{slug}/workspace`
- `POST /orgs/{slug}/imports/markdown-to-harness`
- `POST /orgs/{slug}/imports/harness-dir`
- `HH_ORG_TOKEN`
- scopes: `read`, `setup`, `publish`, `entitlements:read`
- Network workspace UI с private harnesses, audit, permission summary.

Ограничения текущей модели:

- на prod `ORGS_ENABLED=false`, org endpoints возвращают disabled `404`;
- доступ построен вокруг org token, а не user membership;
- нет invites, members, roles UI;
- нет per-user/per-group ACL;
- нет private universal resource packages в workspace;
- нет company/community collections;
- нельзя добавить public marketplace item в свою подборку как approved resource;
- `org` терминологически узко: не подходит для чатов, курсов, community clubs.

Решение: оставить существующие org endpoints как compatibility layer, но продуктово и схемно перейти на `workspaces`.

## 3. Product model

### 3.1 Workspace types

```text
company
community
team
course
agency
chat
```

Тип влияет на defaults, UX-copy и policy templates, но не меняет базовую архитектуру.

`personal` intentionally stays out of v1. The app already has storefront/profile identity for individual creators, and local agent setups already live in the user's filesystem. A first-class personal workspace would duplicate those surfaces before there is proven demand.

### 3.2 Workspace visibility

```text
private
invite_only
gated
public
unlisted
```

- `private`: видят только members.
- `invite_only`: join по invite link/code/email invite.
- `gated`: join через entitlement, Telegram/Discord verification, email domain, future paid subscription, external role.
- `public`: страница видна всем, install может быть public или gated.
- `unlisted`: страница доступна по ссылке, не в public discovery.

### 3.3 Resource scope

В Workspace могут лежать все agent resources:

- native verified harness;
- skill;
- plugin;
- workflow;
- MCP server;
- command pack;
- scripts/docs/source bundle;
- guide/framework/runtime;
- public marketplace listing;
- hosted OnlyHarness resource package.

`Harness` остается только одним resource type. Workspace UI и API не должны говорить так, будто все является harness.

### 3.4 Personal workspace vs storefront

Do not merge these concepts:

- `storefront` is a public creator/business profile and distribution page.
- `personal workspace` would be a private saved setup for one user.

V1 decision: no hosted personal workspace. Keep personal setup local and use storefront for public creator identity. Revisit personal workspace only after company/community workspaces prove recurring usage.

### 3.5 Collection namespaces

`workspace_collections` are not the same as public marketplace collections.

- Public collections: editorial/product bundles visible in public catalog.
- Workspace collections: private or semi-private curation inside one workspace.

User-facing copy should say `Workspace collection` or `Approved resources` inside workspace contexts. Public catalog can keep `Collections` only when it clearly means public marketplace bundles.

## 4. User stories

### 4.1 Company

Компания из 20 devs хочет:

- хранить private skills/harnesses/scripts;
- выдавать доступ конкретным людям;
- иметь roles: owner/admin/publisher/member/viewer;
- собрать approved marketplace resources;
- дать новичку setup одной командой;
- видеть audit: кто опубликовал, кто поставил, кто тянул archive;
- видеть permission/risk summary по всем approved resources;
- отозвать доступ у человека без ротации общего токена.

### 4.2 Community or chat

Комьюнити хочет:

- публичную или закрытую страницу подборки;
- модераторов, которые добавляют resources;
- join через invite link, Telegram/Discord gate, paid membership или entitlement;
- “approved by community” подборку из public marketplace;
- optional private resources для members;
- простую ссылку “install this workspace setup”.

### 4.3 Course

Курс хочет:

- cohort workspace;
- resources по модулям;
- locked/unlocked доступ;
- starter kit для Claude Code/Codex;
- read-only students, publishers только instructors;
- archive access после enrollment.

### 4.4 Agency

Агентство хочет:

- отдельные client workspaces;
- private resources и public approved list;
- не смешивать доступ между клиентами;
- экспорт setup bundle клиенту;
- audit для handoff.

## 5. Data model

### 5.1 New tables

#### `workspaces`

```text
id uuid primary key
slug text unique not null
name text not null
type text not null
visibility text not null
owner_user_id uuid null
plan text not null default 'free'
description text null
avatar_url text null
created_at timestamptz not null
updated_at timestamptz not null
archived_at timestamptz null
```

Constraints:

- slug: lowercase, public-safe.
- type enum: `company|community|team|course|agency|chat`.
- visibility enum: `private|invite_only|gated|public|unlisted`.

#### `workspace_members`

```text
id uuid primary key
workspace_id uuid not null
user_id uuid not null
role text not null
status text not null
source text not null
joined_at timestamptz not null
removed_at timestamptz null
```

Roles:

- `owner`
- `admin`
- `moderator`
- `publisher`
- `member`
- `viewer`

`source`:

- `direct`
- `invite`
- `email_domain`
- `telegram`
- `discord`
- `entitlement`
- `paid_entitlement`
- `token_bootstrap`

#### `workspace_invites`

```text
id uuid primary key
workspace_id uuid not null
email text null
code_hash text not null
role text not null
max_uses int null
uses_count int not null default 0
expires_at timestamptz null
created_by uuid null
created_at timestamptz not null
revoked_at timestamptz null
```

Rules:

- store hash, never raw invite code;
- invite can be email-bound or link-style;
- join writes `workspace_members`.

#### `workspace_tokens`

Replacement for `org_tokens`, but compatible.

```text
id uuid primary key
workspace_id uuid not null
name text not null
token_hash text not null
scopes text[] not null
expires_at timestamptz null
created_by uuid null
created_at timestamptz not null
revoked_at timestamptz null
last_used_at timestamptz null
```

Scopes:

- `workspace:read`
- `workspace:setup`
- `resource:publish`
- `resource:read`
- `resource:archive`
- `collection:write`
- `audit:read`
- `entitlements:read`

Tokens are for CI/bots only. Human access should use user login + membership.

#### `workspace_resources`

Private hosted resources and native workspace harnesses.

```text
id uuid primary key
workspace_id uuid not null
resource_id text not null
resource_kind text not null
title text not null
summary text not null
resource_type text not null
visibility text not null
source_platform text not null
canonical_url text not null
archive_ref text null
manifest jsonb null
trust jsonb not null
installability text not null
created_by uuid null
created_at timestamptz not null
updated_at timestamptz not null
archived_at timestamptz null
```

`resource_kind`:

- `native_harness`
- `hosted_package`
- `external_listing`

`visibility`:

- `workspace`
- `collection_only`
- `public_mirror`

#### `workspace_resource_acls`

Fine-grained access overrides.

```text
id uuid primary key
workspace_id uuid not null
resource_id text not null
principal_type text not null
principal_id text not null
access text not null
created_by uuid null
created_at timestamptz not null
```

`principal_type`:

- `workspace_role`
- `user`
- `group`
- `external_subject`

`access`:

- `view`
- `install`
- `archive`
- `manage`

MVP can start role-only. User/group ACL comes next.

#### `workspace_collections`

```text
id uuid primary key
workspace_id uuid not null
slug text not null
title text not null
summary text null
visibility text not null
created_by uuid null
created_at timestamptz not null
updated_at timestamptz not null
archived_at timestamptz null
```

Examples:

- `approved`
- `onboarding`
- `research`
- `mcp-stack`
- `course-week-1`
- `community-favorites`

#### `workspace_collection_items`

```text
id uuid primary key
workspace_id uuid not null
collection_id uuid not null
item_ref text not null
item_source text not null
pinned_version text null
pinned_archive_hash text null
approval_state text not null
approved_by uuid null
approved_at timestamptz null
note text null
risk_snapshot jsonb null
created_at timestamptz not null
```

`item_source`:

- `public_resource`
- `workspace_resource`
- `native_harness`
- `external_url`

`approval_state`:

- `pending_review`
- `approved`
- `approved_with_warning`
- `blocked`
- `blocked_by_scan`
- `deprecated`

Important boundary: workspace approval is not OnlyHarness verification. Copy must say `Approved by Acme`, not `Verified by OnlyHarness`.

Installable approval rules:

- `securityScan=pass` -> `approved`;
- `securityScan=warn` -> `approved_with_warning`;
- `securityScan=fail` -> reject approval and store/emit `blocked_by_scan` where a review queue exists;
- `securityScan=not_scanned` -> reject installable approval until a scan exists.

#### `workspace_audit`

```text
id uuid primary key
workspace_id uuid not null
actor_type text not null
actor_id text null
action text not null
target_type text not null
target_ref text null
metadata jsonb not null default '{}'
created_at timestamptz not null
```

Never store:

- raw tokens;
- prompts;
- local filesystem paths;
- archive contents;
- personal contact/payment details beyond existing auth identity ids.

## 6. Access model

### 6.1 Read access

User can read workspace if:

1. workspace is `public`, or
2. workspace is `unlisted` and route allows public page by slug, or
3. user is active member, or
4. valid workspace token has read/setup scope, or
5. gated join has created membership.

### 6.2 Archive access

Archive download is stricter:

1. public resource archive follows current public rules;
2. workspace private archive requires active member with `install/archive`, or workspace token with `resource:archive`;
3. collection approval alone does not grant private archive access unless collection policy says install is allowed.

### 6.3 Publish access

Publish allowed if:

- role is `owner|admin|publisher`, or
- token has `resource:publish`.

Community `moderator` can propose public resources and manage review queues, but cannot approve installable resources or publish private packages unless explicitly granted.

### 6.4 Manage access

Manage members/tokens/billing:

- `owner`: all;
- `admin`: members/resources/collections, no billing owner transfer by default;
- `moderator`: community proposals, non-installable curation and review queue;
- `publisher`: publish/update resources;
- `member`: install/use;
- `viewer`: read only.

## 7. API plan

### 7.1 Workspace core

```text
GET    /workspaces/{slug}
POST   /workspaces
PATCH  /workspaces/{slug}
GET    /workspaces/{slug}/members
POST   /workspaces/{slug}/invites
POST   /workspaces/{slug}/join
DELETE /workspaces/{slug}/members/{user_id}
GET    /workspaces/{slug}/audit
```

Compatibility:

```text
/orgs/{slug}/workspace -> aliases /workspaces/{slug}/workspace for company/team workspaces
/orgs/{slug}/bundle    -> aliases /workspaces/{slug}/setup-bundle
```

### 7.2 Resources

```text
GET  /workspaces/{slug}/resources
GET  /workspaces/{slug}/resources/{resource_id}
GET  /workspaces/{slug}/resources/{resource_id}/archive
POST /workspaces/{slug}/imports/resource-package
POST /workspaces/{slug}/imports/harness-dir
POST /workspaces/{slug}/imports/markdown-to-harness
```

`/imports/resource-package` must reuse the safe package rules added for public resource publish:

- bounded file count;
- bounded file size;
- text-only allowlist;
- no `.env`, keys, credentials, archives, binaries, generated dirs;
- no Verified badge.

### 7.3 Workspace collections

```text
GET    /workspaces/{slug}/collections
POST   /workspaces/{slug}/collections
GET    /workspaces/{slug}/collections/{collection_slug}
PATCH  /workspaces/{slug}/collections/{collection_slug}
POST   /workspaces/{slug}/collections/{collection_slug}/items
PATCH  /workspaces/{slug}/collections/{collection_slug}/items/{item_id}
DELETE /workspaces/{slug}/collections/{collection_slug}/items/{item_id}
```

Primary flows:

- add public marketplace resource to workspace collection;
- remove approved public marketplace resource from workspace collection;
- add workspace private resource to collection;
- approve/block/deprecate item;
- pin version/archive hash where applicable.

### 7.4 Setup bundles

```text
GET /workspaces/{slug}/setup-bundle
PUT /workspaces/{slug}/setup-bundle
```

Bundle contains:

- collection refs;
- pinned harness refs;
- resource package refs;
- config snippets;
- target adapters: `claude-code`, `codex`, `cursor`, `mcp`, `cli`.

## 8. CLI plan

### 8.1 Workspace commands

```bash
hh workspace connect acme
hh workspace status
hh workspace resources acme
hh workspace collections acme
hh workspace setup acme
```

`hh setup @acme` remains as compatibility alias.

### 8.2 Private publishing

```bash
hh publish-resource ./repo --workspace acme --name deploy-tools --type command_pack
hh publish ./harness-dir --workspace acme --name deploy-checklist
hh publish workflow.md --workspace acme --name onboarding-flow
```

Aliases:

```bash
--org acme -> --workspace acme
HH_ORG_TOKEN -> HH_WORKSPACE_TOKEN fallback
```

### 8.3 Search and install

```bash
hh resources search "market research" --workspace acme
hh resources detail @acme/deploy-tools
hh resources open @acme/deploy-tools
hh resources approve onlyharness:harnesses/deep-market-researcher --workspace acme --collection approved
hh resources unapprove @acme/deep-market-researcher --workspace acme --collection approved
hh install @acme/deploy-checklist --target claude-code
hh pull @acme/deploy-checklist
```

Search behavior:

- default public search stays public;
- `--workspace` includes private + approved collection items;
- results must show source:
  - `public marketplace`
  - `workspace private`
  - `approved by workspace`
  - `OnlyHarness verified`

### 8.4 Auth

Phase 1-3 MVP:

- support `HH_WORKSPACE_TOKEN`;
- keep `HH_ORG_TOKEN` compatibility.
- user membership works in web/API through the existing auth session;
- CLI remains token-based unless `hh login` ships in the same sprint.

This is an intentional limitation, not an implied complete membership rollout. If the first workspace customers need CLI access by named users instead of shared tokens, `hh login` must move into Phase 1.

Phase 1.5 / before broad beta:

- `hh login`;
- device flow or copy token from web;
- user membership replaces shared human token use.
- CLI writes a scoped local credential, never the raw browser session.

## 9. Web UX plan

### 9.0 Frontend architecture integration

The workspace UI must follow the current skin architecture:

- state and API calls live in `apps/registry-web/src/core`, not in one skin;
- `core/useWorkspace` already exists for new workspace endpoints; remaining web work is wiring it into the shared store/surface and demoting `core/useOrgWorkspace` to compatibility;
- serious workspace surfaces should render through shared-neutral components, like checkout/review/network already do;
- W98, Modern and Fans skins consume the same core state and neutral surface instead of duplicating logic;
- skin-specific copy can frame the doorway, but auth/access/security/payments copy stays plain.

Do not build a one-off workspace screen for only one skin.

### 9.1 Rename surface

Current:

```text
Network / Org Workspace
```

Target:

```text
Workspaces
```

Subcopy:

```text
Private and shared resource collections for teams, companies, communities, courses and chats.
```

### 9.2 Workspace switcher

Workspace selection is a global control, so it must not fight the existing skin switcher.

Required global-control plan:

- skin switcher;
- workspace selector;
- login/profile state;
- mobile-safe placement;
- keyboard/focus behavior.

Visible workspace selector states:

- current personal/local profile state, not a hosted personal workspace
- Company/community workspaces user belongs to
- Join workspace
- Create workspace

The Win98/fun shell stays. The workspace settings and auth/payment/security copy stays plain.

V1 can avoid a permanent global selector and put workspace switching inside the Workspaces window. Promote it to the shell only after layout and mobile checks pass across all skins.

### 9.3 Workspace home

Tabs:

```text
Catalog | Approvals | Members | Access | Audit | Setup | Settings
```

For community/public workspaces:

```text
Catalog | Approvals | Join | Moderation | Setup
```

For viewer/member:

```text
Catalog | Approvals | Setup
```

### 9.4 Resource card labels

Cards need explicit state:

```text
Workspace private
Approved by Acme
Approved by Research Guild
Public marketplace
OnlyHarness hosted archive
Not hosted yet
Verified harness
Source checked
```

Do not blur trust states.

### 9.5 Add to workspace

On public resource detail:

```text
Add to workspace
```

Flow:

1. choose workspace;
2. choose collection;
3. approval state: `pending_review` or `approved`;
4. optional note;
5. optional pin version/archive hash;
6. write audit event.

### 9.6 Community gating UX

Join modal variants:

- invite code;
- Telegram verification;
- Discord verification;
- paid entitlement;
- email domain;
- manual approval.

Copy must be honest:

- “This workspace is gated by Telegram membership.”
- “OnlyHarness will verify membership before showing private install paths.”
- “Public resources remain public; this workspace approval is a local recommendation.”

## 10. Community and chat integrations

### 10.1 Reuse existing primitives

Already present:

- `/community/invite-code`
- `/community/verify-code`
- `/entitlements/check`

Extend them from harness-only community access into workspace gates.

### 10.2 Telegram gate

Flow:

1. user opens workspace join;
2. OnlyHarness mints short-lived signed join code;
3. user sends code to Telegram bot or clicks deep link;
4. bot verifies code with workspace token;
5. bot checks Telegram membership/role;
6. API creates `workspace_members` row with `source=telegram`.

### 10.3 Discord gate

Same model:

- verify OAuth/role;
- create membership;
- audit join source;
- never trust a subject typed into chat.

### 10.4 Paid community

If workspace is paid:

- purchase or future subscription creates entitlement;
- join checks entitlement;
- membership can expire if subscription expires;
- archive access checks live membership/entitlement.

No real payment side effects should be hidden inside read endpoints.

Scope warning: recurring subscription lifecycle is not part of the current manual one-time checkout foundation. Paid workspace membership needs a separate billing track:

- subscription provider model;
- renewal/expiry webhooks;
- grace period policy;
- membership expiry job;
- receipt/customer portal UX;
- no hidden entitlement mutation in read paths.

MVP community gates should start with invite/Telegram/Discord/manual entitlement. Subscription-gated workspaces ship only after subscription lifecycle is implemented and smoked end-to-end.

## 11. Migration from current org model

This is mostly greenfield in production. Current prod has `ORGS_ENABLED=false`, so there is no large live org dataset to migrate. The risk is less data migration and more compatibility: existing CLI/docs/tests should not break while the product language moves from `org` to `workspace`.

### 11.1 Keep compatibility

Do not break:

```bash
HH_ORG_TOKEN=... hh setup @acme
HH_ORG_TOKEN=... hh publish --org acme
HH_ORG_TOKEN=... hh pull @acme/name
```

Internally map:

```text
org -> workspace(type=company)
org_tokens -> workspace_tokens
org_setup_bundles -> workspace_setup_bundles
org_audit -> workspace_audit
```

### 11.2 API aliases

Existing org endpoints can remain:

```text
/orgs/{slug}/bundle
/orgs/{slug}/workspace
/orgs/{slug}/imports/*
```

But new code should call:

```text
/workspaces/{slug}/...
```

### 11.3 UI migration

Step 1:

- rename visible copy to Workspaces;
- keep underlying `/orgs` API.

Step 2:

- add `/workspaces` API;
- route UI to new API.

Step 3:

- keep `/orgs` only as compatibility aliases.

## 12. Implementation phases

### Phase 0: Spec and naming cleanup

Goal: stop product drift before code.

Tasks:

- add this plan;
- update AGENTS/docs terms: workspace is top-level, org is company/team compatibility;
- define resource/trust copy rules;
- decide initial workspace types enabled in UI.

Acceptance:

- docs consistently say workspace for shared/private distribution;
- no claim that org UI is live while `ORGS_ENABLED=false`.

### Phase 1: Workspace schema and auth foundation

Goal: user membership exists beside token access for web/API. CLI remains token-based until `hh login` is shipped.

Tasks:

- create Supabase migrations for `workspaces`, `workspace_members`, `workspace_invites`, `workspace_tokens`, `workspace_audit`;
- add local JSON fallback for smoke, like current orgs;
- implement membership resolver:
  - user JWT;
  - workspace token;
  - legacy org token;
- add role/scope checks;
- add audit writer.

Acceptance:

- workspace can be loaded with user membership through web/API auth;
- workspace can be loaded with token;
- denied user gets explicit `403`;
- audit stores no raw token.

Checks:

```bash
npm run typecheck -w @harnesshub/api
npm run smoke
```

### Phase 2: Workspace resources and private universal publish

Goal: private skills/scripts/resource packages work, not only native harnesses.

Tasks:

- add `workspace_resources`;
- add `POST /workspaces/{slug}/imports/resource-package`;
- add `GET /workspaces/{slug}/resources`;
- add `GET /workspaces/{slug}/resources/{id}`;
- add `GET /workspaces/{slug}/resources/{id}/archive`;
- add CLI:
  - `hh publish-resource --workspace acme`;
  - `hh resources search --workspace acme`;
  - `hh resources detail @acme/name`;
- reuse safe resource package scanner.

Acceptance:

- private `scripts/` package can be published to workspace;
- `.env`, `dist`, archives and binary files are rejected/skipped;
- public search does not show private workspace package;
- authorized member/token can download archive;
- unauthorized user gets `401/403`.

Checks:

```bash
npm run typecheck -w @harnesshub/api
npm run typecheck -w onlyharness
npm test -w onlyharness
npm run smoke
```

### Phase 3: Workspace collections and approved marketplace resources

Status: shipped as the `onlyharness@0.2.5` production slice for token-authenticated API/CLI flows; `onlyharness@0.2.6` hardens approval so `not_scanned` resources cannot become installable workspace approvals; the current web/CLI slice adds approval removal.

Goal: a workspace can curate public and private resources.

Security decision: approval requires a current security/trust verdict. `pass` can become `approved`, `warn` can become `approved_with_warning`, and `fail` or `not_scanned` stays blocked for workspace setup/install. This keeps workspace approval aligned with the product trust model.

Tasks:

- add `workspace_collections`;
- add `workspace_collection_items`;
- add API for collection CRUD;
- add CLI/UI remove flow for approved public marketplace resources;
- add “Add to workspace” action on public resource detail;
- support approval states;
- add `approved_with_warning` and `blocked_by_scan` states;
- require scan/trust snapshot before `approved`;
- show approved resources in workspace catalog;
- preserve upstream attribution and OnlyHarness trust labels.

Acceptance:

- admin can add a scanned resource such as `onlyharness:harnesses/deep-market-researcher` to `@acme/approved`;
- member sees it as “Approved by Acme”;
- public users do not see Acme approval unless workspace is public;
- blocked items cannot be installed through workspace setup;
- failed or missing security scan cannot be approved for install;
- warning scan can be approved only with warning label;
- audit records add/approve/remove/block.

### Phase 4: Web workspace UI

Goal: real workspace management for companies and communities.

Tasks:

- wire existing `core/useWorkspace` into `core/store.tsx` and the shared surface stack;
- keep `core/useOrgWorkspace` only as a legacy org compatibility wrapper until `/orgs` aliases are retired;
- render workspace management through a shared-neutral surface consumed by all skins;
- verify W98, Modern and Fans entry points;
- workspace switcher;
- workspace home tabs;
- members/invites UI;
- approvals add/remove UI;
- full collection CRUD UI;
- access/roles UI;
- setup bundle UI;
- audit UI;
- community join modal.

Acceptance:

- owner can invite a member;
- admin can approve a resource;
- publisher can publish but not manage billing/owner settings;
- member can install but not publish;
- viewer can read but not archive unless policy allows.

### Phase 5: Setup bundles v2

Goal: one command installs approved workspace setup.

Tasks:

- generalize `org_setup_bundles` to workspace bundles;
- bundle can include:
  - native harnesses;
  - hosted resource packages;
  - public approved resources with install instructions;
  - config snippets;
- CLI:
  - `hh workspace setup acme`;
  - alias `hh setup @acme`;
- support target-specific setup:
  - Claude Code;
  - Codex;
  - Cursor;
  - MCP;
  - CLI.

Acceptance:

- new developer can run one command and get the approved setup;
- local writes are idempotent;
- token/user auth is required for private resources;
- public-only approved setup can be generated without leaking private archives.

### Phase 6: Community gates

Goal: community/chat workspaces are not second-class.

Tasks:

- add workspace join policies;
- add Telegram gate flow;
- add Discord gate flow;
- support invite code join;
- support one-time entitlement/manual entitlement join;
- add bot-facing verification with workspace token scopes;
- add membership expiry handling.
- add recurring paid subscription checkout/webhook/sweep lifecycle.

Acceptance:

- Telegram member can join gated workspace;
- non-member cannot access private install paths;
- expired/revoked membership removes archive access;
- bot verification is read-only except explicit membership grant endpoint.
- paid subscription checkout alone does not grant access; webhook renewal/grace/cancel/expiry and sweep drive membership expiry.

### Phase 7: Production enablement

Goal: turn it on safely.

Tasks:

- configure `ORGS_ENABLED` successor flag, e.g. `WORKSPACES_ENABLED`;
- keep `ORGS_ENABLED` as compatibility flag or map it internally;
- run prod smoke for:
  - workspace disabled state;
  - workspace enabled auth failure;
  - workspace token success;
  - user membership success;
  - private archive access denied/allowed;
- update `/llms.txt`, OpenAPI, MCP docs;
- add support/admin runbook.

Acceptance:

- prod has no anonymous private leaks;
- no public search private leakage;
- no raw tokens in logs/audit;
- deploy smoke passes.

## 13. MCP plan

Add tools:

```text
search_workspaces
workspace_detail
workspace_resources
workspace_collections
add_resource_to_workspace
publish_workspace_resource_package
workspace_setup_instructions
```

Rules:

- tools never return private archive files unless authorized;
- `workspace_setup_instructions` can return commands, not raw private content;
- `publish_workspace_resource_package` requires auth and same scanner;
- `add_resource_to_workspace` must label approval as workspace approval, not OnlyHarness verification.

## 14. Security rules

Non-negotiable:

- private workspace resources never appear in public search;
- workspace archive route always checks current access;
- public marketplace item in workspace collection remains public-source;
- workspace approval never becomes product verification;
- tokens are hashed;
- audit does not store prompts, local paths, raw tokens, archive content;
- invite codes are hashed and expiring;
- Telegram/Discord gates verify live external state;
- revoking a member removes archive access immediately;
- generated setup files must not write outside target dir;
- paid/gated membership checks stay read-only unless endpoint is explicitly a join/grant mutation.

## 14.5 Scale and performance guardrails

MVP can be simple, but it should not bake in unbounded scans.

Required from first implementation:

- paginate workspace audit and member lists;
- paginate workspace resource search;
- index `workspace_id`, `resource_id`, `collection_id`, `created_at`, `user_id`;
- search should merge public + private + approved results with deterministic ordering;
- setup bundle reads should be bounded and cacheable;
- audit writes should be append-only and cheap;
- collection item lookup should not require loading every public resource into memory.

Smoke can use small fixtures, but API shape should already include `limit`/`cursor` where lists can grow.

## 15. Product copy rules

Use precise labels:

```text
Workspace private
Approved by {workspace}
Public marketplace resource
OnlyHarness hosted archive
OnlyHarness verified harness
Source checked
Not hosted yet
Access denied
Join required
```

Avoid:

```text
Verified by Acme
Safe because approved
Installed by community
Private but downloadable
```

Plain copy around auth/security:

```text
You do not have access to this workspace resource.
Ask a workspace admin for an invite, or connect with a token that has resource:archive.
```

## 16. Testing plan

### API tests

- workspace slug validation;
- role checks;
- token scope checks;
- invite join;
- private resource denied in public search;
- authorized archive success;
- unauthorized archive denied;
- collection item approval;
- audit redaction.

### CLI tests

- `publish-resource --workspace` sends token and safe files;
- `resources search --workspace` includes private results;
- `install @workspace/name` uses workspace token;
- denied access exits with documented code;
- setup bundle idempotency.

### Web tests

- workspace switcher;
- shared-neutral workspace surface renders in W98, Modern and Fans;
- global controls do not overlap skin switcher/login/workspace selector;
- connect token;
- members table role gating;
- add public resource to collection;
- private resource card labels;
- denied state copy;
- mobile layout.

### Smoke

```bash
npm run check
npm run build
npm run smoke
npm run smoke:mcp
```

Add dedicated:

```bash
npm run smoke:workspaces
```

Add check wiring:

```bash
npm run check:workspaces
```

`check:workspaces` should verify:

- org/workspace compatibility docs stay in sync;
- workspace labels do not claim approval equals verification;
- `hh --version`, server metadata and MCP metadata stay aligned;
- workspace routes remain documented in OpenAPI and `/llms.txt`;
- public copy does not imply private resources are publicly downloadable.

## 17. Rollout plan

### Internal alpha

- one seed company workspace;
- one seed community workspace;
- token-only plus admin-created membership;
- no paid gates.

### Private beta

- invite 2-3 real teams or communities;
- enable members/invites;
- enable private resource package publish;
- enable approved marketplace collections.

### Public launch

- public community workspaces;
- “Add to workspace” from any resource card;
- workspace setup bundle sharing;
- Discord/Telegram gates.

## 18. V1 decisions

1. Personal workspace stays local-only at first. Do not create hosted personal workspace rows until there is demand beyond storefront/profile.
2. Public community workspaces can appear in global search only when `visibility=public`, with a separate workspace/community facet and no implied OnlyHarness verification.
3. Every workspace gets one default `approved` collection.
4. `moderator` can propose and curate review queues. Approval for installable resources requires `owner`, `admin` or `publisher`.
5. Marketplace approval requires a security/trust snapshot. `pass` can be `approved`; `warn` can be `approved_with_warning`; `fail` and `not_scanned` are blocked for setup/install approval.
6. Private workspace resource packages are internal-use only in v1. Paid resale is a separate creator/legal/billing track.
7. Free plan can allow one small workspace and basic members. Invites, roles, audit retention, private packages and gates belong to Team/Community paid tiers unless intentionally comped for beta.

Still open:

- exact free member limit;
- whether community moderators can approve non-installable guide-only resources;
- exact subscription billing provider and lifecycle policy.

## 19. First sprint status and next slice

Already shipped in the first production slice:

1. `workspaces`, `workspace_members`, `workspace_tokens`, `workspace_audit`, `workspace_resources` migration.
2. Workspace token authorization with legacy `HH_ORG_TOKEN` fallback.
3. `/workspaces/{slug}/workspace` read endpoint.
4. `POST /workspaces/{slug}/imports/resource-package`.
5. `GET /workspaces/{slug}/resources`, detail and archive routes.
6. `hh publish-resource --workspace`.
7. `hh resources search --workspace` and `hh resources detail @workspace/name`.
8. Workspace-private archive route with denied/allow smoke coverage.
9. `core/useWorkspace` hook foundation.
10. `check:workspaces` wired into `npm run check`.
11. `smoke:workspaces`.
12. `workspace_collections` and `workspace_collection_items`.
13. Default `approved` workspace collection.
14. API/CLI for approving a public resource into a workspace collection.
15. Trust/security snapshot on approval, with `fail` and `not_scanned` failing closed for installable approval.
16. Workspace-scoped `Approved by {workspace}` labels without implying OnlyHarness verification.
17. Honest `409 not hosted by workspace` for approved listings without workspace-hosted archive files.
18. Shared-neutral workspace approval UI and `hh resources unapprove` removal flow.
19. Workspace setup bundle API `GET/PUT /workspaces/{slug}/setup-bundle`, shared-neutral Setup tab, and `hh workspace setup`.
20. Community join policy API `GET/PUT /workspaces/{slug}/join-policies`, short-lived `ohwj_` gate codes, read-only `/join-code/verify`, explicit `/join-grants`, shared-neutral gate UI, and org workspace/setup aliasing to workspace semantics.
21. Workspace membership expiry handling: `POST /workspaces/{slug}/members` accepts `expiresAt`, active member lists hide expired rows, and member-session reads/private archive paths fail closed for expired or removed members.
22. The recurring workspace subscription lifecycle is now implemented as a manual/provider-agnostic track: `POST /workspaces/{slug}/subscriptions/checkout`, read-only `GET /workspaces/{slug}/subscriptions/me`, idempotent `POST /webhooks/workspace-subscriptions`, admin/cron `POST /workspaces/{slug}/subscriptions/sweep`, Supabase `workspace_subscriptions`/`workspace_subscription_events`, active `paid_subscription` policies behind `WORKSPACE_SUBSCRIPTIONS_ENABLED=true`, and smoke coverage for checkout/no-access, activation, renewal, grace, cancellation, expiry, and sweep.

Remaining from the original first sprint:

1. Production workspace enablement seed/policy.
2. Real recurring charge provider integration if/when a provider is selected; the shipped lifecycle is provider-agnostic and does not charge money by itself.

Recommended next production slice:

1. Keep `HH_ORG_TOKEN` and `/orgs` compatibility.
2. Keep CLI token-based unless `hh login` is pulled forward.
3. Keep prod `WORKSPACES_ENABLED=false` until a seed workspace and membership policy are configured.

Do not jump straight to a big admin UI. Private resource distribution and approved collection semantics are now the shipped baseline; the next admin UX should follow real member/invite access rules.

Do not block first alpha on full `hh login`; token-based CLI is acceptable if the plan labels it that way and web/API user membership work is tracked separately.
