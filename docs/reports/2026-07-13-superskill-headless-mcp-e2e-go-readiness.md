# SuperSkill Headless MCP E2E / GO Readiness — 2026-07-13

## Назначение

Этот документ объединяет:

- фактический production E2E-прогон без UI;
- найденные блокеры и частично работающие участки;
- полный целевой flow, который должен пройти для статуса GO;
- обязательные fail-closed сценарии и финальные acceptance criteria.

Проверка выполнялась через публичный auth, опубликованный npm/Codex CLI и реальный production MCP. Локальные тесты и чтение кода не использовались как доказательство работоспособности production flow.

## Итоговый вердикт

**NO-GO.**

Публичный MCP read path работает, SuperSkill устанавливается и обнаруживается новой Codex-сессией, но полный пользовательский путь разорван в трёх критичных местах:

1. Новая регистрация блокируется production mailer rate limit.
2. Публикация skill-пакета блокируется read-only archive storage.
3. Текущий SuperSkill contract не поддерживает managed activation через MCP: MCP разрешён только как browse/search fallback.

## Проверенный целевой сценарий

Проверялся следующий непрерывный flow:

1. Создать нового пользователя без UI.
2. Получить и подтвердить регистрационное письмо.
3. Получить пользовательский access token.
4. Подключиться к production MCP с этим token.
5. Опубликовать собственный skill через MCP.
6. Найти exact resource через MCP.
7. Установить SuperSkill в чистый Codex client.
8. В новой сессии получить exact recommendation.
9. Дать отдельный activation consent.
10. Активировать и применить опубликованный skill.
11. Продолжить весь lifecycle через MCP.
12. Получить детерминированный результат и закрыть activation с evidence.

## Тестовый skill

Для проверки был создан минимальный валидный skill:

- skill name: `superskill-mcp-e2e-proof`;
- attempted resource name: `superskill-mcp-e2e-proof-mrj500eb11366a92`;
- resource type: `skill`;
- compatibility: Codex и Claude Code;
- package files: `SKILL.md` и `agents/openai.yaml`;
- validation: `quick_validate.py` — pass.

Skill должен возвращать только следующий детерминированный результат:

```text
SUPERSKILL_MCP_E2E_OK
payload: mcp-roundtrip-20260713
skill: superskill-mcp-e2e-proof
```

Такой output нужен, чтобы доказать фактическую загрузку опубликованного skill, а не реконструкцию ответа общей моделью.

## Фактические результаты

| Участок | Статус | Production evidence |
| --- | --- | --- |
| Public npm CLI | PASS | `onlyharness@latest = 0.2.13` |
| CLI doctor | PASS | registry `https://onlyharness.com/api`, `ok: true`, 16 indexed |
| Чистая регистрация | FAIL | Supabase signup вернул `429 email rate limit exceeded` |
| Email confirmation | BLOCKED | письмо не было отправлено из-за rate limit |
| Пользовательский token | BLOCKED | нормальная signup session не была создана |
| MCP initialize | PASS | protocol `2025-06-18`, server `onlyharness 0.2.13` |
| MCP tools/list | PASS | production MCP вернул 10 tools |
| MCP publish skill | FAIL | archive storage смонтирован read-only |
| Atomic rollback | PASS | после 500 target resource не появился в каталоге |
| MCP search существующего resource | PASS | найден `onlyharness:harnesses/deep-market-researcher` |
| MCP detail существующего resource | PASS | trust/security/installability возвращаются |
| MCP use instructions | PASS | возвращается реальный install path |
| SuperSkill marketplace install | PASS | marketplace `onlyharness` добавлен |
| SuperSkill plugin install | PASS | `superskill@onlyharness 0.1.0` installed/enabled |
| Новая Codex-сессия видит SuperSkill | PASS | загружен `superskill:superskill` |
| Exact target recommendation | BLOCKED | target resource отсутствует после rollback |
| MCP-вызов из Codex plugin | FAIL | `onlyharness.search_resources` отменяется клиентом |
| Managed activation через MCP | NOT IMPLEMENTED | текущий plugin contract разрешает MCP только для browse/search |
| Exact skill invocation | BLOCKED | skill не опубликован и не активирован |

## 1. Регистрация

### Что было сделано

- Создан отдельный уникальный QA mailbox.
- Выполнен production signup через публичный Supabase auth endpoint.
- Использован новый email и новый password.
- UI и browser session не использовались.

### Фактический ответ

- HTTP status: `429`.
- Error: `email rate limit exceeded`.
- User session: отсутствует.
- `confirmation_sent_at`: отсутствует.

### Вывод

Нормальная пользовательская регистрация не работает стабильно. Это P0-блокер: без подтверждённого пользователя нельзя честно проверить authenticated publish и последующий ownership flow.

### Admin fallback

Чтобы проверить следующие участки независимо от mailer, был временно создан подтверждённый QA-user через service-role admin API.

Этот fallback:

- позволил получить настоящий user access token;
- использовался только для продолжения MCP-проверки;
- **не засчитан** как успешная регистрация;
- после проверки пользователь был удалён.

## 2. MCP handshake и auth

Authenticated MCP initialization прошёл:

- endpoint: `https://onlyharness.com/mcp`;
- protocol: `2025-06-18`;
- server name: `onlyharness`;
- server version: `0.2.13`;
- response transport: `text/event-stream`;
- `notifications/initialized`: `202 Accepted`.

Production `tools/list` вернул:

1. `search_harnesses`
2. `harness_detail`
3. `search_resources`
4. `resource_detail`
5. `resource_use_instructions`
6. `pull_instructions`
7. `pull_harness`
8. `search_docs`
9. `publish_markdown_to_harness`
10. `publish_resource_package`

## 3. Публикация собственного skill через MCP

Был вызван `publish_resource_package` с валидным двухфайловым skill-пакетом и пользовательским Bearer token.

### Фактический ответ

```text
status: 500
error: failed to create hosted resource archive
tar: can't open '/var/lib/onlyharness/resource-archives/...tmp': Read-only file system
```

### Вывод

Production API принимает authenticated MCP-вызов, но не может записать hosted archive. Это P0-блокер publish path.

### Проверка консистентности

После ошибки выполнены:

- exact `search_resources`;
- `resource_detail` ожидаемого resource ID;
- `resource_use_instructions` ожидаемого resource ID.

Результат:

- target resource отсутствует;
- ghost listing не создан;
- карточка без архива не утекла в каталог.

Atomic rollback работает корректно.

## 4. Проверка public MCP read path

Чтобы отделить publish failure от общего состояния MCP, был проверен существующий production resource:

- ID: `onlyharness:harnesses/deep-market-researcher`;
- title: `Deep Market Researcher`;
- resource type: `harness`;
- installability: `installable`;
- security scan: `pass`;
- risk tier: `MEDIUM`.

`resource_use_instructions` вернул:

- install command;
- upstream source;
- честное предупреждение об unknown license;
- отсутствие ложного Verified evidence.

Итог: MCP search/detail/use path для существующих ресурсов работает.

## 5. Ошибка MCP error semantics

Для отсутствующего target resource MCP вернул JSON:

```json
{
  "error": "Resource not found",
  "id": "onlyharness:packages/superskill-mcp-e2e-proof-mrj500eb11366a92"
}
```

Но одновременно:

- HTTP/MCP status остался успешным;
- `result.isError` отсутствовал.

Для agent-first UX это риск: клиент может принять логическую ошибку за успешный tool result. Все logical failures должны возвращаться с `isError: true` и стабильным machine-readable error code.

## 6. SuperSkill plugin

Установка через реальный Codex CLI прошла:

```text
codex plugin marketplace add elvismusli/onlyharness --ref main
codex plugin add superskill@onlyharness
```

Фактическое состояние:

- marketplace: `onlyharness`;
- plugin: `superskill@onlyharness`;
- version: `0.1.0`;
- status: installed, enabled.

Новая ephemeral Codex-сессия обнаружила и загрузила `superskill:superskill`.

### Client compatibility note

Первая сессия упала до выполнения задачи:

- Codex CLI: `0.135.0`;
- default configured model: `gpt-5.6-sol`;
- ответ сервера: требуется более новая версия Codex.

Повтор с `gpt-5.4` прошёл до загрузки SuperSkill. Это отдельная client-version/config проблема, а не причина publish failure.

### MCP call из Codex

В новой сессии SuperSkill дважды попытался вызвать:

```text
onlyharness.search_resources
```

Оба вызова были отменены клиентом как `user cancelled MCP tool call`, включая запуск с `approval_policy = never`.

При этом тот же production MCP tool успешно вызывается напрямую. Значит проблема локализована в Codex plugin/MCP approval integration.

## 7. Архитектурный разрыв: activation не через MCP

Текущий SuperSkill contract явно говорит:

- public MCP — только browse/search fallback;
- MCP не может recommend или activate managed files;
- managed flow выполняется через `onlyharness@0.2.13 activation ...`.

Это противоречит целевому требованию: после SuperSkill весь lifecycle должен идти через MCP.

Для GO необходимо либо:

1. добавить полный managed activation lifecycle в MCP; либо
2. официально отказаться от требования «всё через MCP».

Для текущей целевой модели выбран первый вариант.

## Блокеры

### P0 — Registration mailer

Проблема:

- production signup упирается в `email rate limit exceeded`.

Нужно:

- подключить production SMTP;
- настроить sender domain, rate limits и delivery monitoring;
- проверить signup, resend и confirmation на новом адресе;
- исключить service-role fallback из acceptance.

### P0 — Hosted archive storage read-only

Проблема:

- `publish_resource_package` не может создать tar archive.

Нужно:

- смонтировать `/var/lib/onlyharness/resource-archives` как writable persistent volume;
- проверить owner/permissions внутри production container;
- проверить сохранность архива после restart/redeploy;
- добавить production authenticated publish smoke.

### P0 — Managed activation отсутствует в MCP

Проблема:

- MCP умеет browse/search/publish, но не умеет полный SuperSkill lifecycle.

Нужно добавить MCP tools:

- `activation_doctor`;
- `recommend`;
- `activation_start`;
- `activation_mark_loaded`;
- `activation_mark_invoked`;
- `activation_finish`;
- `activation_keep`;
- `activation_remove`.

### P1 — Codex отменяет MCP tool calls

Проблема:

- plugin обнаружен;
- MCP server обнаружен;
- tool call формируется правильно;
- клиент возвращает `user cancelled MCP tool call` без пользовательского действия.

Нужно:

- проверить plugin MCP permission declaration;
- проверить trust/approval integration Codex CLI;
- добиться успешного non-interactive read-only MCP-вызова;
- отдельно проверить interactive consent для write/activation tools.

### P1 — MCP logical errors не помечаются как errors

Нужно:

- выставлять `isError: true`;
- возвращать стабильные коды, например `RESOURCE_NOT_FOUND`;
- не заставлять агента распознавать ошибку по свободному тексту внутри успешного result.

### P2 — Codex client/model drift

Нужно:

- синхронизировать минимальную версию Codex CLI с моделями из конфигурации;
- добавить понятный preflight и upgrade guidance;
- не допускать падения E2E до загрузки plugin из-за несовместимого default model.

## Целевой GO-flow

Ниже описан обязательный последовательный production flow. GO выдаётся только при прохождении всей цепочки одним новым пользователем без административных обходов.

## Этап 0. Production preflight

Должно быть подтверждено:

- health endpoint — green;
- npm package, MCP server, OpenAPI и plugin runtime используют совместимые версии;
- SMTP доступен;
- archive volume writable и persistent;
- MCP activation tools присутствуют в `tools/list`;
- Codex/Claude minimum client versions задокументированы;
- production logs и tracing доступны без утечки secrets.

Acceptance:

- все preflight checks проходят до создания пользователя;
- никакие локальные repo paths или unpublished packages не используются.

## Этап 1. Чистая регистрация

1. Создать новый уникальный email.
2. Выполнить публичный signup.
3. Получить ответ без session до confirmation.
4. Получить confirmation email.
5. Перейти по одноразовой confirmation link.
6. Выполнить password login.
7. Получить user access token.
8. Проверить user/profile endpoint.

Acceptance:

- письмо приходит без retry storm и ручного вмешательства;
- `email_confirmed_at` заполнен;
- unconfirmed login блокируется;
- confirmed login работает;
- service-role не используется.

## Этап 2. Authenticated MCP session

1. Выполнить MCP `initialize` с user Bearer token.
2. Отправить `notifications/initialized`.
3. Получить `tools/list`.
4. Проверить доступные read/write scopes.

Acceptance:

- token передаётся только в Authorization header;
- token не появляется в MCP responses, events и logs;
- anonymous publish запрещён;
- authenticated publish разрешён.

## Этап 3. Публикация собственного skill

1. Создать валидный skill package.
2. Вызвать `publish_resource_package`.
3. Проверить package paths и secret denylist.
4. Создать archive во временном пути.
5. Рассчитать SHA-256 digest.
6. Атомарно сохранить archive и registry row.
7. Вернуть resource ID, version, digest и archive metadata.

Acceptance:

- MCP result содержит structured success;
- archive реально существует;
- archive переживает restart/redeploy;
- повтор с тем же idempotency key не создаёт дубликат;
- сбой archive write не создаёт catalog row;
- ни один secret/generated файл не попадает в package.

## Этап 4. Discovery и exact release proof

1. `search_resources` находит exact resource.
2. `resource_detail` возвращает metadata и trust state.
3. `resource_use_instructions` возвращает SuperSkill path.
4. Archive/pull возвращает опубликованные файлы.
5. Клиент пересчитывает digest.

Acceptance:

- найден ровно один exact resource;
- returned digest совпадает с локально рассчитанным;
- version immutable;
- trust state не преувеличивает review/verification;
- resource owner совпадает с новым пользователем.

## Этап 5. Установка SuperSkill

1. Добавить публичный marketplace.
2. Установить SuperSkill plugin.
3. Запустить новую client session.
4. Убедиться, что plugin обнаружен.
5. Не подкладывать target skill локально заранее.

Acceptance:

- новая сессия видит SuperSkill без чтения repo;
- plugin version и runtime compatibility подтверждены;
- target skill ещё отсутствует на диске;
- нет legacy install path.

## Этап 6. Recommendation

1. Сформировать privacy-safe task summary.
2. Показать summary пользователю.
3. Получить routing consent.
4. Вызвать MCP `recommend`.
5. Получить exact release recommendation.
6. Показать:
   - name;
   - version;
   - digest;
   - selection reasons;
   - named checks;
   - permissions;
   - limitations;
   - temporary/pinned mode.

Acceptance:

- рекомендован именно опубликованный resource;
- похожий resource не подставляется;
- no-match остаётся честным no-match;
- summary не содержит email, paths, secrets или полный prompt history.

## Этап 7. Отдельный activation consent

После recommendation пользователь отдельно подтверждает activation exact release.

Acceptance:

- routing consent не считается activation consent;
- consent связан с exact name/version/digest;
- повторное использование или pin требуют отдельных решений.

## Этап 8. Managed activation через MCP

1. Вызвать `activation_start` с одним стабильным request ID.
2. Скачать exact archive.
3. Проверить digest.
4. Проверить разрешённый root.
5. Записать только files из activation plan.
6. Для Codex использовать `.agents/skills`.
7. Вернуть activation ID и plan.
8. После загрузки вызвать `activation_mark_loaded`.
9. Перед первым применением вызвать `activation_mark_invoked`.

Acceptance:

- digest mismatch блокирует любые writes;
- path traversal и symlink запрещены;
- повтор `activation_start` с тем же request ID идемпотентен;
- `detected_on_disk` не считается `loaded`;
- write выполняется только после explicit consent.

## Этап 9. Реальное применение skill

Выполнить:

```text
E2E_PROBE: mcp-roundtrip-20260713
```

Ожидаемый результат:

```text
SUPERSKILL_MCP_E2E_OK
payload: mcp-roundtrip-20260713
skill: superskill-mcp-e2e-proof
```

Acceptance:

- output получен после `loaded` и `invoked`;
- модель не реконструирует ожидаемый ответ без загруженного skill;
- activation trace содержит exact digest;
- evidence не выдаётся за independently verified business outcome.

## Этап 10. Finish, keep и remove

1. Вызвать `activation_finish` с честным outcome.
2. Записать минимальное evidence.
3. При необходимости отдельно запросить keep consent.
4. Проверить pin state.
5. В новой сессии выполнить online exact-release/revocation recheck.
6. Проверить `activation_remove` с отдельным confirm.

Acceptance:

- lifecycle:
  `accepted → downloading → digest_verified → ready → loaded → invoked → outcome_*`;
- keep/remove не выполняются автоматически;
- revoked release не загружается повторно;
- remove не удаляет чужие или изменённые файлы.

## Этап 11. Повторный чистый прогон

Полный flow нужно пройти минимум два раза подряд:

- новый QA-user;
- новый resource slug;
- новый client session;
- новый activation ID;
- без использования кэша предыдущего прогона.

Acceptance:

- оба прогона полностью green;
- нет ручного SQL/service-role fallback;
- нет UI-only steps;
- нет flaky retry, скрывающего первый failure;
- после redeploy опубликованные archives остаются доступными.

## Обязательная fail-closed матрица

Перед GO нужно доказать:

| Сценарий | Ожидаемое поведение |
| --- | --- |
| Неподтверждённый email | login и publish запрещены |
| Просроченный access token | MCP write запрещён |
| Anonymous publish | authentication error |
| Archive storage unavailable | no catalog row, structured error |
| Повтор publish с idempotency key | один resource, один archive |
| Resource not found | `isError: true`, стабильный code |
| Wrong digest | activation блокируется до writes |
| Revoked release | recommend/activation fail closed |
| MCP timeout | не превращается в success |
| Path traversal/symlink | package или activation отклоняются |
| Tool permission denied | нет частично записанных files |
| Повтор lifecycle event | идемпотентный ответ |
| Remove с изменённым digest | автоматическое удаление запрещено |

## Observability и безопасность

Для каждого успешного flow должна существовать связанная цепочка:

```text
registered
confirmed
published
recommended
accepted
downloaded
digest_verified
loaded
invoked
finished
```

Обязательные поля:

- user subject;
- resource ID;
- exact version;
- digest;
- activation ID;
- request/idempotency ID;
- target client;
- outcome;
- safe timestamps.

Запрещено хранить или логировать:

- access/refresh tokens;
- passwords;
- confirmation URLs;
- полный prompt history;
- private local paths;
- raw files вне опубликованного package;
- email в публичных audit/event payloads.

## Финальные критерии GO

### Минимальный GO

Нужно получить два последовательных green production-прогона в Codex:

- чистая регистрация и confirmation;
- authenticated MCP;
- публикация собственного skill;
- exact MCP discovery;
- SuperSkill recommendation;
- отдельный activation consent;
- activation полностью через MCP;
- exact deterministic invocation;
- finish с lifecycle evidence;
- fail-closed checks для auth, storage, digest и revocation.

### Публичный GO

Дополнительно:

- повторить тот же flow в Claude Code;
- подтвердить совместимость опубликованных plugin/runtime версий;
- пройти всю fail-closed матрицу;
- подтвердить persistence после production redeploy;
- не иметь открытых P0/P1 по registration, publish, activation, permissions и MCP error semantics.

## Текущий cleanup

- Временный admin-fallback QA-user удалён.
- После failed publish target catalog row отсутствует.
- Production archive для target resource не создан.
- SuperSkill plugin оставлен установленным и enabled для повторного E2E.
- Production code и runtime конфигурация в рамках этой проверки не изменялись.

## Итог

SuperSkill нельзя выпускать как полностью рабочий headless MCP flow до устранения трёх P0:

1. стабильная confirmation-first регистрация;
2. writable persistent hosted archive storage;
3. полный managed activation lifecycle через MCP.

После исправлений этот документ должен использоваться как acceptance checklist для повторного production E2E. GO выдаётся только по фактическому непрерывному прогону, а не по локальным тестам, отдельным успешным endpoint checks или административным обходам.
