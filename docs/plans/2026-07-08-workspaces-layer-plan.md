# OnlyHarness Workspaces Layer Plan

Дата: 2026-07-08  
Статус: подробный implementation plan после E2E-проверки, npm `onlyharness@0.2.3` и resource-first pivot.

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
- персональные подборки.

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
personal
```

Тип влияет на defaults, UX-copy и policy templates, но не меняет базовую архитектуру.

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
- `gated`: join через entitlement, Telegram/Discord verification, email domain, paid subscription, external role.
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
- type enum: `company|community|team|course|agency|chat|personal`.
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
- `subscription`
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
- `blocked`
- `deprecated`

Important boundary: workspace approval is not OnlyHarness verification. Copy must say `Approved by Acme`, not `Verified by OnlyHarness`.

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

Community `moderator` can add public resources to collections, but cannot publish private packages unless explicitly granted.

### 6.4 Manage access

Manage members/tokens/billing:

- `owner`: all;
- `admin`: members/resources/collections, no billing owner transfer by default;
- `moderator`: community collections and review queue;
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

### 7.3 Collections

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

MVP:

- support `HH_WORKSPACE_TOKEN`;
- keep `HH_ORG_TOKEN` compatibility.

Next:

- `hh login`;
- device flow or copy token from web;
- user membership replaces shared human token use.

## 9. Web UX plan

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

Visible in app shell:

- Personal
- Company/community workspaces user belongs to
- Join workspace
- Create workspace

The Win98/fun shell stays. The workspace settings and auth/payment/security copy stays plain.

### 9.3 Workspace home

Tabs:

```text
Catalog | Collections | Members | Access | Audit | Setup | Settings
```

For community/public workspaces:

```text
Catalog | Collections | Join | Moderation | Setup
```

For viewer/member:

```text
Catalog | Collections | Setup
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

- purchase/subscription creates entitlement;
- join checks entitlement;
- membership can expire if subscription expires;
- archive access checks live membership/entitlement.

No real payment side effects should be hidden inside read endpoints.

## 11. Migration from current org model

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

Goal: user membership exists beside token access.

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

- workspace can be loaded with user membership;
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

### Phase 3: Collections and approved marketplace resources

Goal: a workspace can curate public and private resources.

Tasks:

- add `workspace_collections`;
- add `workspace_collection_items`;
- add API for collection CRUD;
- add “Add to workspace” action on public resource detail;
- support approval states;
- show approved resources in workspace catalog;
- preserve upstream attribution and OnlyHarness trust labels.

Acceptance:

- admin can add `github:obra/superpowers` to `@acme/approved`;
- member sees it as “Approved by Acme”;
- public users do not see Acme approval unless workspace is public;
- blocked items cannot be installed through workspace setup;
- audit records add/approve/block.

### Phase 4: Web workspace UI

Goal: real workspace management for companies and communities.

Tasks:

- workspace switcher;
- workspace home tabs;
- members/invites UI;
- collections UI;
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
- support entitlement/subscription join;
- add bot-facing verification with workspace token scopes;
- add membership expiry handling.

Acceptance:

- Telegram member can join gated workspace;
- non-member cannot access private install paths;
- expired subscription removes archive access;
- bot verification is read-only except explicit membership grant endpoint.

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

## 18. Open decisions

1. Should personal workspace exist as a first-class workspace or stay local-only?
2. Should public community workspaces be indexed in global search?
3. Should every workspace have a default `approved` collection?
4. Should `moderator` be allowed to approve installable resources or only propose them?
5. Should marketplace approval require security scan before `approved`, or allow `approved_with_warning`?
6. Should workspace private resource packages support paid resale later, or only internal use?
7. How much of members/invites should be available on Free vs Team plans?

## 19. Recommended first sprint

Build the smallest honest version:

1. Add `workspaces`, `workspace_members`, `workspace_tokens`, `workspace_audit`.
2. Implement membership/token authorization.
3. Add `/workspaces/{slug}/workspace` read endpoint.
4. Alias existing `/orgs/{slug}/workspace`.
5. Add `POST /workspaces/{slug}/imports/resource-package`.
6. Add `hh publish-resource --workspace`.
7. Add workspace-private archive route.
8. Add API/CLI tests for deny/allow.
9. Keep web UI minimal: connect workspace, list resources, copy install commands.

Do not start with a big admin UI. The first value is private resource distribution plus approved collection semantics. Admin UX can follow once access rules are real.

