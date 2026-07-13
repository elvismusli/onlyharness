# SuperSkill headless MCP production remediation

Дата: 2026-07-13
Статус: **IN IMPLEMENTATION — INDEPENDENT PLAN REVIEW PASSED; PRODUCTION GO NOT YET PROVEN**
Входной аудит: `docs/reports/2026-07-13-superskill-headless-mcp-e2e-go-readiness.md`
Source of truth: SuperSkill MVP contracts, runtime code, production configuration and live production evidence.

Execution status:

- Batch 0/A — **DONE / independent review GO**: public hosted package publish is
  auth-first and default-off; archive errors are sanitized; all ten remote MCP tools have
  exact annotations, schema preflight and structured success/error envelopes. API 94 tests,
  full repo check, MCP smoke and production config checks passed.
- Batch B+ — pending; production GO remains prohibited.

## 1. Цель

Довести SuperSkill до честного headless flow, в котором новый подтверждённый пользователь:

1. подключается к production MCP без утечки credentials;
2. публикует собственный hosted skill и получает immutable digest;
3. после redeploy повторно читает тот же archive;
4. устанавливает публичный SuperSkill plugin в чистый Codex/Claude client;
5. получает рекомендацию только на реально reviewed exact release;
6. отдельно подтверждает activation exact tuple;
7. выполняет весь локальный lifecycle через MCP tools;
8. наблюдает `loaded` и `invoked` как отдельные состояния;
9. отдельно подтверждает `keep` или `remove`;
10. проходит два последовательных production E2E без admin/service-role fallback.

Публичный GO запрещён, пока не закрыты все P0/P1 и не получены два Codex плюс один
Claude production evidence run.

## 2. Проверенный baseline и поправки к входному аудиту

Входной аудит валиден по основным симптомам:

- signup реально получил Supabase `429 email rate limit exceeded`;
- `RESOURCE_ARCHIVE_DIR` в production compose смонтирован `:ro`, хотя publish пишет туда;
- remote MCP содержит только десять registry/publish tools;
- plugin skill contract прямо запрещает managed activation через MCP;
- logical MCP failures сейчас возвращаются обычным successful tool result;
- Codex обнаруживает plugin MCP, но отменяет tool calls;
- Codex CLI/model compatibility не проверяется до E2E.

При этом целевой сценарий аудита требует двух безопасностных уточнений.

### 2.1 Remote MCP не должен писать client-local files

`https://onlyharness.com/mcp` выполняется на production server и не имеет безопасного
доступа к project root пользователя. Передавать в него local paths или давать ему
произвольную filesystem write capability нельзя.

Исправленная архитектура:

- **remote OnlyHarness MCP**: auth, publish, discovery, detail, exact release metadata,
  archive delivery и structured errors;
- **bundled local SuperSkill stdio MCP**: recommendation proxy и все локальные
  `activation_*` операции; использует уже существующие path/symlink/digest/lock guards
  из CLI;
- plugin регистрирует оба server-а; task/prompt/local path никогда не уходит на remote
  server, кроме отдельно consented privacy-safe task summary;
- temporary start пишет только guarded `.onlyharness` cache/state и возвращает local-only
  root-relative plan/MCP resources; только separate keep пишет `.agents/skills` для Codex
  или `.claude/skills` для Claude.

Для пользователя lifecycle всё равно полностью идёт через MCP tools, но security
boundary остаётся корректным.

### 2.2 Unreviewed publish нельзя автоматически превратить в reviewed recommendation

`publish_resource_package` создаёт unverified/`not_scanned` hosted resource. Managed
SuperSkill по действующему контракту имеет право рекомендовать только attested exact
release из curated catalog. Автоматическая рекомендация только что опубликованного
пакета была бы trust escalation.

Поэтому acceptance делится на два связанных proof-а одного пользователя:

- **Publish proof**: новый package публикуется, имеет owner/version/digest, находится,
  скачивается и переживает redeploy; UI/MCP честно называют его unreviewed;
- **Managed activation proof**: recommendation/activation выполняются на заранее
  approved deterministic E2E exact release.

Если обязательна activation именно опубликованного пользователем resource, перед ней
добавляется реальный scan/review/approval gate. Ни тест, ни администратор не могут
подменить этот gate.

## 3. Неподвижные инварианты

- Bearer, refresh, SMTP, service-role и SuperSkill tester tokens не попадают в body,
  tool result, URL, local state, events, logs или документацию.
- Remote MCP никогда не получает произвольный project path и не пишет local files.
- Routing consent, activation consent, keep consent и remove consent — разные решения.
- Consent связан с `capabilityId + version + artifactDigest + recommendationId + expiry`.
- `decisionDigest` связывает exact recommendation tuple, но не является authorization
  grant: authority дают confirmed user credential, authenticated live exact-release/
  revocation recheck и отдельное local explicit consent.
- Candidate/unreviewed resource не получает `approved`, `reviewed` или `verified` claim.
- Archive version immutable; другое содержимое под тем же tuple возвращает conflict.
- Write сначала создаёт/проверяет archive, затем атомарно фиксирует metadata; ошибка не
  оставляет catalog row или orphan temp archive.
- Повтор с тем же idempotency key и тем же digest возвращает тот же результат;
  несовпадающий payload возвращает conflict.
- `detected_on_disk != loaded != invoked != outcome_success`.
- Keep/remove никогда не выполняются автоматически.
- Remove блокируется, если managed file изменён или marker/digest не совпадает.
- Public managed routes остаются dark, пока в catalog нет реального approved supply.
- Unrelated dirty worktree files не изменяются и не попадают в commits.

## 4. Целевая архитектура

```text
Codex / Claude
  |
  +-- remote MCP: onlyharness (HTTPS)
  |     search, detail, publish, archive metadata, structured errors
  |
  +-- local MCP: superskill (stdio, pinned onlyharness runtime)
        doctor, recommend, activation_start, mark_loaded, mark_invoked,
        finish, keep, remove
        |
        +-- HTTPS: curated exact release / archive / events
        +-- local project: temporary guarded .onlyharness cache/state
        +-- explicit keep only: .agents/skills or .claude/skills
```

### 4.1 Local tool contract

| Tool | Mutation | Required input | Result invariant |
| --- | --- | --- | --- |
| `activation_doctor` | no | client, optional live recheck | inventory only; does not claim loaded |
| `recommend` | no remote write | client, privacy-safe summary, routing consent | exact approved tuple or honest no-match |
| `activation_start` | local cache/state write | exact tuple, decision digest/expiry, stable request ID, explicit activation consent | digest verified before cache/state write; native target untouched; idempotent |
| `activation_mark_loaded` | local state | activation ID | only `ready -> loaded`; no disk detection shortcut |
| `activation_mark_invoked` | local state/event | activation ID | only after loaded |
| `activation_finish` | local state/event | activation ID, honest outcome/evidence | no inferred business success |
| `activation_keep` | local write | activation ID, explicit keep confirmation | exact managed files only |
| `activation_remove` | local delete | activation ID, explicit remove confirmation | owning marker/digest verified; changed files preserved |

Every tool returns structured JSON with stable `code`, `status`, safe `next`, and
`isError: true` on failure. Tool annotations must match actual behavior.

## 5. Реализация по batches

Каждый batch заканчивается обязательным независимым subagent review. Reviewer получает:

- этот план и входной аудит;
- exact changed-file list и diff;
- команды и результаты tests/smokes;
- обновлённый end-to-end flow;
- известные blockers/assumptions.

Следующий batch не начинается, пока actionable findings не исправлены и повторно не
проверены. Финальный reviewer не должен быть автором соответствующего batch.

### Batch 0 — immediate production containment

Этот batch выполняется и деплоится первым, не ожидая writable storage migration.

Scope:

```text
apps/harness-api/src/server.ts
apps/harness-api/src/mcp.ts
infra/production-compose.yml
infra/production.env.example
scripts/check-production-config.ts
scripts/deploy-production.sh
```

Работа:

1. Добавить `HOSTED_RESOURCE_PUBLISH_ENABLED=false` по умолчанию.
2. Порядок gate фиксирован: anonymous/invalid credential сначала получает
   `401 AUTH_REQUIRED`/`AUTH_INVALID`; только authenticated principal при выключенном
   flag получает sanitized `503 PUBLISH_DISABLED`, всегда до temp/archive/catalog
   mutations.
3. Убрать raw `tar.stderr`, server paths и provider details из HTTP/MCP response;
   internal diagnostic остаётся только в private sanitized server log.
4. Deploy flag-off containment и проверить anonymous/authenticated publish: оба не
   создают row/temp/archive; codes различаются по предыдущему пункту; ответ не содержит
   `/var/lib`, `/app` или token fragments.

Acceptance:

- live publish fail closed до завершения Batch B;
- server filesystem path больше не раскрывается;
- read/search/detail MCP не регрессируют;
- rollback — оставить flag off, без удаления существующих archives/metadata.

### Batch A — MCP error semantics и contract inventory

Scope:

```text
apps/harness-api/src/mcp.ts
apps/harness-api/src/server.ts
apps/harness-api/src/openapi.ts
apps/harness-api/test/mcp*.test.ts
scripts/smoke-mcp.ts
scripts/check-mcp-registry.ts
apps/registry-web/public/llms.txt
docs/** только синхронизация публичного contract
```

Работа:

1. Ввести typed MCP success/failure envelope helper.
2. Любой handler-result с `error`/non-2xx semantic status преобразовать в
   `isError: true`, content JSON и стабильный machine code.
3. Минимальные codes: `AUTH_REQUIRED`, `AUTH_INVALID`, `RESOURCE_NOT_FOUND`,
   `ARCHIVE_STORAGE_UNAVAILABLE`, `PUBLISH_CONFLICT`, `VALIDATION_FAILED`,
   `PUBLISH_DISABLED`, `PAYMENT_REQUIRED`, `HOSTED_EXECUTION_NOT_AVAILABLE`,
   `INTERNAL_ERROR`.
4. Не возвращать stack, local path, raw provider response или authorization value.
5. Добавить correct tool annotations: public search/detail/docs read-only;
   publish destructive/open-world; archive pull read-only/open-world.
6. Зафиксировать exact tool inventory/version в OpenAPI, llms и smoke.
7. Покрыть anonymous/expired auth, missing resource, storage failure и handler throw.
8. Проверить JSON-RPC transport failure отдельно от logical tool failure.
9. Сохранить Batch 0 containment в regression matrix; включение publish flag до green
   storage migration запрещено.

Acceptance:

- missing resource даёт MCP `isError: true` и `RESOURCE_NOT_FOUND`;
- anonymous publish даёт `AUTH_REQUIRED`; expired token — `AUTH_INVALID`;
- no stack/path/token in output;
- existing successful read tools не регрессируют;
- `npm run smoke:mcp` green.

### Batch B — durable authenticated resource publishing

Scope:

```text
apps/harness-api/src/server.ts
apps/harness-api/src/resources.ts
apps/harness-api/test/resources*.test.ts
supabase/migrations/*resource-packages*.sql
infra/production-compose.yml
infra/production.env.example
scripts/check-production-config.ts
scripts/deploy-production.sh
scripts/smoke-production-compose.sh
scripts/smoke-production-auth.ts
```

Работа:

1. Сохранить `HOSTED_RESOURCE_PUBLISH_ENABLED=false` из Batch 0 до прохождения всех
   migration tests и authenticated production preflight.
2. Существующий mirror archive каталог оставить read-only. Создать отдельный
   `RESOURCE_IMPORT_ARCHIVE_DIR` как dedicated persistent writable bind с минимальными
   permissions только для API process.
3. Deploy preflight выполняет real temp create/fsync/rename/read/delete probe внутри
   API container до переключения traffic.
4. Сохранять package metadata в durable release store со статусами
   `pending|active|failed`: owner subject, immutable version, archive digest/size,
   idempotency key hash, created timestamp, trust=`unreviewed`, storage key.
5. Catalog читает только `active`; unique constraints защищают `(resource_id, version)`
   и `(owner_subject, idempotency_key)`.
6. Не использовать email как public creator identity.
7. Добавить request `version` и `idempotencyKey`; вычислять canonical payload digest.
8. Archive создавать deterministic canonical builder-ом: stable path sort, normalized
   mtime/uid/gid/modes, temp на том же filesystem, file fsync, digest-check, atomic rename
   и parent-directory fsync.
9. Metadata activation происходит после archive commit; при metadata failure новый archive
   удаляется либо остаётся недоступным quarantine object с cleanup marker.
10. Добавить reconciler для зависших `pending` rows и orphan files.
11. Запретить takeover существующего slug другим subject; same owner/digest/key — replay,
   same version/different digest — immutable conflict.
12. Возвращать `resourceId`, `version`, `artifactDigest`, `archiveUrl`, `size`, trust state.
13. Проверить restart и redeploy persistence реальным pull/digest.
14. Добавить production smoke, который не оставляет публичный мусор: unique slug,
    ownership-bound test record и явный cleanup/expiry policy.
15. Добавить crash-injection tests на каждую boundary: temp write/fsync, archive rename,
    directory fsync, pending-row activation и cleanup/reconcile.
16. Перед split-storage снять inventory текущего `RESOURCE_ARCHIVE_DIR`: ID/storage key,
    size/digest, metadata reference и download URL. Не считать каталог чистым mirror:
    там могут лежать уже опубликованные hosted packages.
17. Legacy migration: verify digest -> atomic copy/rename в import store -> создать
    metadata mapping без смены public ID/URL/digest. На migration window download делает
    metadata-directed new-store read и guarded legacy fallback; новые writes никогда не
    идут в legacy root.
18. После полного inventory/digest parity выполнить restart/redeploy pull proof всех
    migrated hosted IDs, затем отключить fallback. Rollback возвращает read routing к
    legacy store, но не включает unsafe writes и не удаляет новый store.

Acceptance:

- storage unavailable оставляет zero visible rows;
- concurrent same-key publish создаёт один archive/row;
- owner mismatch и immutable overwrite заблокированы;
- archive digest совпадает после restart/redeploy;
- existing hosted resource IDs, archive URLs and digests остаются доступными во время и
  после split-storage migration;
- production container preflight fail closed до deploy;
- no public email/local path exposure.

### Batch C — unified confirmed-user principal for managed routes

Scope:

```text
apps/harness-api/src/routes/superskill.ts
apps/harness-api/src/superskill/**
apps/harness-api/test/superskill-routes.test.ts
packages/capability-schema/**
supabase/migrations/*superskill-access-grants*.sql
apps/registry-web/public/llms.txt
docs/plans/superskill-mvp/01-system-architecture.md
docs/plans/superskill-mvp/02-contracts-and-data-model.md
```

GO auth contract:

- remote MCP and managed routes receive the same confirmed Supabase user Bearer credential;
- headless clients import it only from an inherited allowlisted env variable; token is
  never embedded in plugin manifest/tool argument;
- API maps user ID to one pseudonymous subject and checks explicit managed-alpha/public
  policy scope server-side;
- legacy `HH_SUPERSKILL_TOKEN` remains internal-alpha compatibility only and any run using
  it does not count toward user-only production GO;
- OAuth/PKCE is a future interactive convenience, not a hidden GO dependency.

Работа:

1. Добавить confirmed-user authentication adapter для recommend/exact/archive/events.
2. Проверять confirmation and managed access policy/scope fail closed; confirmation нельзя
   принимать из client claim без live provider/user verification.
3. Server-side source of truth — durable `superskill_access_grants` table keyed by user
   subject, со scope/cohort, status, expiry, created/revoked timestamps и actor audit.
   Default — deny; body/header/client claim не может сам выдать scope. Изменение grants
   доступно только отдельной operator/admin control plane, raw admin credential не входит
   в application request. Revocation применяется к следующему request немедленно.
4. Единый pseudonymous subject используется в recommendation, activation event chain и
   hosted resource ownership correlation; email наружу не попадает.
5. `decisionDigest + expiry + authenticated live exact/revocation recheck + local explicit
   consent` остаются canonical activation authority; новая signing system не вводится.
6. Добавить user-token bearer-env transport contract и clean-client tests для remote HTTP
   MCP/managed HTTPS; token refresh для headless run выполняется до session, logout/revoke
   делает последующий write/recommend fail closed.
7. Обновить schemas/docs; tester-token examples не публиковать как public flow.

Acceptance:

- unconfirmed/expired/revoked/out-of-policy user не может publish/recommend/archive/events;
- confirmed in-policy user проходит обе цепочки одним principal;
- tester-token run помечается alpha и не может породить public GO evidence;
- responses/events не раскрывают token, email или provider user payload.

### Batch D — MCP compatibility spike before implementation

До полноценного local MCP создать минимальный exact-pinned stdio probe без business logic.

Проверить в clean public Codex и Claude installations:

1. plugin обнаруживает remote HTTP и local stdio servers;
2. stdio `initialize`, `tools/list` и один read-only tool проходят;
3. `roots/list` возвращает ожидаемый single `file://` root либо клиент корректно
   поддерживает explicit local-only root fallback;
4. Remote HTTP MCP получает Bearer из env-supported client config и выполняет
   authenticated publish dry/fail-closed call; no-token negative даёт `AUTH_REQUIRED`;
5. Local stdio наследует тот же credential только для managed HTTPS proxy и выполняет
   authenticated recommend/no-safe-match call; no-token negative fail closed;
6. ни один transport не отражает bearer в config dump/tool results/logs;
7. read-only annotations не приводят к ложной cancellation;
8. denied mutation не создаёт file/state;
9. unsupported client/plugin schema завершается deterministic preflight failure.

Acceptance:

- spike green в обоих клиентах из clean HOME без repo-local packages;
- если client capability различается, final tool/root/auth contract документирует две
  проверенные адаптации, а не предполагает общую поддержку;
- NO-GO для Batch F при непроверенном stdio/root/env/approval transport.

### Batch E — first real approved deterministic fixture

Создать managed supply отдельным review cycle, не self-approve smoke-скриптом:

1. подготовить immutable deterministic fixture release с artifact-embedded unpredictable
   canary/challenge, которого нет в prompt, plugin или public report;
2. пройти static scan, capability diff, package digest, policy checks и exact archive;
3. пройти clean Codex/Claude evidence на exact digest;
4. агенты готовят package/static/client evidence и review packet, но не выдают approval;
5. реальный named human reviewer, не автор release, выполняет минимум три реальные task
   cases и фиксирует identity/date/per-case verdict/limitations; для high-stakes capability
   обязателен второй независимый human pass;
6. только после полного human sign-off добавить approved exact release в curated
   index/history; до него fixture остаётся candidate, а Batch F/I dark;
7. создать signed/controlled revocation fixture и доказать live block;
8. сохранить negative-control evidence: до activation клиент не может воспроизвести
   canary; после verified load/invoke ответ связан с exact artifact digest.

Acceptance:

- catalog имеет минимум один настоящий approved release;
- human reviewer identity/date и три case verdicts записаны; reviewer не является автором
  fixture/release cut;
- canary не присутствует во входном prompt/plugin/public evidence до invocation;
- revoked fixture не рекомендуют и не активируют;
- candidate history не переписывается задним числом.

### Batch F — bundled local SuperSkill MCP

Scope:

```text
packages/harness-cli/src/mcp/**
packages/harness-cli/src/commands/activation.ts
packages/harness-cli/src/commands/recommend.ts
packages/harness-cli/src/index.ts
packages/harness-cli/package.json
packages/harness-cli/test/superskill-mcp*.test.ts
plugins/superskill/.mcp.json
plugins/superskill/.codex-plugin/plugin.json
plugins/superskill/skills/superskill/SKILL.md
plugins/superskill/skills/superskill/references/*.md
plugins/superskill/runtime.json
scripts/check-plugin.ts / scripts/check-claude-plugin.ts
scripts/smoke-superskill-exact-release.ts
```

Работа:

1. Вынести activation application functions в runtime module без Commander/stdout.
2. Добавить pinned `onlyharness mcp superskill` stdio server.
3. Экспортировать восемь tools из раздела 4.1, переиспользуя существующие locks,
   idempotency, digest, cache, path и symlink guards.
4. Local MCP сначала запрашивает client `roots/list`. Если нет ровно одного `file://`
   root, требует explicit local-only `workspaceRoot`; неоднозначный process cwd не
   считается достаточным. Root никогда не отправляется в API/events/results.
5. Разделить pure inspection (`resolveProjectRoot`/read-only inventory) и state init:
   doctor/recommend не создают `.onlyharness` и не меняют `.git/info/exclude`.
6. `recommend` отправляет только user-approved privacy-safe summary; raw prompt/history
   и local paths не отправляются.
7. `activation_start` требует boolean explicit consent, complete exact tuple,
   `decisionDigest`, expiry и authenticated live exact/revocation recheck; повтор request
   ID валидирует полный tuple.
8. `activation_remove` принимает activation ID и извлекает owning marker из trusted
   activation record; arbitrary marker path от модели не является authority.
9. `activation_finish` умеет честно записать load/invocation failure reason без
   выдуманного outcome success.
10. Tool handlers не пишут stdout кроме MCP protocol; diagnostics идут sanitized stderr.
11. Plugin регистрирует remote and local servers с pinned runtime version.
12. Добавить contract tests поверх real stdio JSON-RPC client и isolated temp HOME/project.
13. Local result может возвращать только root-relative plan files и opaque
    `superskill://activation/...` resources из verified plan. Absolute path не попадает в
    result; remote API/events/evidence не получают даже relative local path.

Acceptance:

- clean client `tools/list` видит 8 local lifecycle tools;
- wrong digest/path traversal/symlink/expired consent дают error до cache/state write;
- same request ID idempotent;
- start не пишет native roots; explicit keep пишет только `.agents/skills` в Codex и
  `.claude/skills` в Claude;
- keep/remove требуют отдельные confirms;
- no token/path/prompt leak in MCP results/events.

### Batch G — plugin approvals и real-client compatibility

Работа:

1. Проверить plugin MCP manifest против официальной Codex/Claude schema.
2. Не трактовать global `approval_policy=never` как tool allowlist. Настроить
   plugin-scoped policy/allowlist только для read-only tools, если client это поддерживает.
3. Mutating local tools должны оставаться consent-bound внутри tool input, даже если
   client policy разрешает вызов без дополнительного UI prompt.
4. Воспроизвести cancellation с trace logging без secrets и классифицировать:
   client approval, server transport, plugin trust или version mismatch.
5. Проверить `search_resources` в новой non-interactive Codex session, затем Claude.
6. Не hardcode одну exact client version. E2E запускает фактически установленный
   supported client в auth-only isolated HOME, записывает observed version и использует
   explicit compatible test model; user `models_cache`/default model не влияет на proof.

Acceptance:

- read-only call проходит без ложного cancellation в documented configuration;
- denied mutating tool не оставляет partial state;
- unsupported client/model завершается preflight code, а не неясным runtime failure;
- plugin installation работает в чистом HOME, без repo paths.

### Batch H — confirmation-first signup и SMTP operations

Code/config scope:

```text
scripts/smoke-production-auth.ts
scripts/smoke-production-compose.sh
scripts/deploy-production.sh
docs/runbooks/superskill-auth-smtp.md
```

External production scope: Supabase Auth SMTP/provider dashboard, sender DNS/domain,
rate limits and delivery monitoring. Secrets остаются вне git.

Работа:

1. Настроить dedicated SMTP provider/sender domain (рекомендуемый sender
   `no-reply@mail.superskill.sh`), SPF/DKIM/DMARC и return path; link tracking выключен.
2. Настроить conservative signup limits и alerting; не отключать confirmation.
3. Удалить auth smoke soft-skip из GO path. Rate-limit skip разрешён только локальному
   compose smoke и никогда не считается production acceptance.
4. E2E использует уникальный реальный inbox, ждёт одно письмо bounded timeout, открывает
   одноразовую link и проверяет unconfirmed/confirmed login behavior.
5. Добавить abuse controls: per-IP/email throttling, no retry storm, cleanup QA user.
6. Документировать provider health, bounce/complaint alarms и incident fallback без
   service-role создания пользователей.
7. Добавить `superskill.sh` и `www.superskill.sh` в Supabase redirect allow-list;
   frontend confirmation redirect должен оставаться на разрешённом SuperSkill origin.

Acceptance:

- три последовательных unique signup/confirmation без 429/manual action;
- письмо проходит SPF/DKIM/DMARC;
- unconfirmed login/publish blocked, confirmed login/publish allowed;
- access/confirmation URLs не логируются.

### Batch I — integrated production E2E and rollout

Preconditions:

- 0–H reviewed and green;
- минимум один real approved deterministic exact release существует;
- deploy authority/SSH и production QA inbox доступны;
- published npm/plugin versions публично доступны и совпадают с runtime manifest.

Flow run:

1. Production preflight: health, versions, SMTP, writable storage, tools inventory,
   logs/traces and observed compatible clients in isolated HOME.
2. Clean confirmation-first signup; user access token only.
3. Authenticated remote MCP initialize/list.
4. Publish unique unreviewed proof skill with idempotency key.
5. Exact discovery/detail/archive/digest/owner proof.
6. Clean SuperSkill plugin install and new client session.
7. Recommend approved deterministic release after routing consent.
8. Run negative control before activation: exact canary/challenge is not reproducible.
9. Separate exact activation consent.
10. Local MCP start -> loaded -> invoked -> artifact-bound unpredictable challenge ->
    finish; evidence binds canary response to exact digest without publishing canary.
11. Separate keep and remove proofs; online revocation recheck.
12. Redeploy; pull published proof archive and recheck digest.
13. Repeat with new user/slug/session/activation ID and cold local state.

Evidence artifact must contain only safe IDs, versions, digests, lifecycle timestamps,
client versions and pass/fail codes. No token, email, local path, raw prompt or confirmation
URL.

Minimum GO:

- two consecutive Codex runs green;
- auth/storage/digest/revocation/permission fail-closed cases green;
- no P0/P1.

Public GO:

- minimum GO plus one clean Claude run;
- full fail-closed matrix green;
- archive persistence proven after production redeploy;
- final independent plan-vs-result reviewer returns GO.

## 6. Fail-closed test matrix

| Case | Required result |
| --- | --- |
| Unconfirmed user | login/publish rejected |
| Expired/invalid token | remote MCP write `isError`, no row/archive |
| Anonymous publish | `AUTH_REQUIRED` |
| Storage readonly/full/unavailable | `ARCHIVE_STORAGE_UNAVAILABLE`, no visible row |
| Same idempotency key/same payload | same resource/version/digest |
| Same key/different payload | `PUBLISH_CONFLICT` |
| Existing slug/other owner | ownership conflict |
| Same version/different digest | immutable conflict |
| Resource missing | `RESOURCE_NOT_FOUND`, `isError: true` |
| Handler timeout/throw | error, never success envelope |
| Unreviewed recommendation | blocked/no-match; no trust escalation |
| Expired recommendation/consent | no local writes |
| Wrong digest | no local writes |
| Revoked exact release | recommend/start blocked |
| Path traversal/symlink | package/start rejected |
| Client permission denied/cancelled | no partial state/files |
| Duplicate start/event | idempotent response |
| Mark invoked before loaded | invalid transition |
| Keep without confirm | rejected |
| Remove changed/non-owned file | preserved and reported |
| Corrupt/missing activation state | fail closed; no reconstruction from untrusted files |
| Disk full during cache/pin/remove | no success state; recoverable prior state |
| Crash at write/rename/fsync/delete boundary | restart reconciles or blocks safely |
| Event queue duplicate/replay | one idempotent logical transition |

## 7. Observability

Internal correlated chain:

```text
registered -> confirmed -> published -> discovered -> recommended -> accepted
-> downloaded -> digest_verified -> loaded -> invoked -> finished
```

Safe fields: pseudonymous subject, resource/capability ID, exact version, digest,
activation/request/idempotency IDs, client/version, outcome code and timestamps.

Forbidden: email, password, auth/refresh/service-role/tester token, confirmation URL,
full prompt/history, private local path and unpublished file contents.

Metrics/alerts:

- signup delivery latency, confirmation success, 429/bounce/complaint rate;
- archive write/rename/fsync latency and free space;
- publish conflicts/rollbacks/orphan cleanup;
- MCP per-tool success/error/cancel/timeout by stable code;
- recommendation no-match/revocation/consent-expiry;
- activation transition violations and cleanup failures.

## 8. Deployment and rollback

1. Deploy Batch 0 immediately: publishing disabled and errors sanitized.
2. Deploy A; verify production MCP annotations/error semantics while publish stays off.
3. Deploy B migration dark; verify durable storage/ownership/idempotency, then enable
   publish only for authenticated QA policy.
4. Deploy C unified user principal dark; tester-token evidence remains alpha-only.
5. Complete D compatibility spike and E reviewed supply before implementing/releasing F.
6. Publish pinned CLI/plugin runtime from F/G; keep managed activation cohort-gated.
7. Configure/verify H SMTP and strict confirmation flow.
8. Run I integrated E2E twice in Codex, once in Claude, then final review.
9. Public enablement only after GO.

Rollback:

- disable managed feature flag and plugin version without deleting activation state;
- preserve immutable archives/metadata; never reuse failed versions;
- local remove remains available offline for already managed pins;
- storage rollback must never remount write target read-only while publish remains enabled;
- auth incident disables new signup/publish explicitly and surfaces honest unavailable state.

## 9. External gates and current honest status

Code can close MCP, storage and runtime defects locally. Production GO additionally needs:

- production SSH/deploy authority (current local shell has no accepted SSH key);
- Supabase/SMTP dashboard access and a real QA inbox;
- public npm/plugin publication rights;
- at least one genuinely approved exact release (catalog currently intentionally has
  zero approved releases).

Until those gates are satisfied, shipped code may be production-ready and dark-deployed,
but final status remains **NO-GO**, not “mostly GO”.

## 10. Final reviewer checklist

Independent reviewer compares this plan, input audit, repo diff, public artifacts and
live evidence. Reviewer must answer:

1. Are all original P0/P1 closed by evidence, not claims?
2. Is activation genuinely MCP-driven while filesystem writes remain local?
3. Did any unreviewed resource gain reviewed semantics?
4. Are auth, owner, immutability and idempotency enforced server-side?
5. Are all logical failures real MCP errors with stable codes?
6. Did both cold Codex runs and the Claude run use public artifacts only?
7. Did archive survive an actual production redeploy?
8. Are all secrets/private paths absent from responses, logs and evidence?
9. Are keep/remove/revocation and client denial fail closed?
10. Do docs, OpenAPI, runtime, npm/plugin versions and live tools agree?

Any actionable finding reopens its batch. Only a clean re-review may produce GO.
