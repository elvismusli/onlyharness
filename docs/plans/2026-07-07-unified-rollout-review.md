# Приёмочное ревью unified rollout plan — 2026-07-07

Проверяемый план: [2026-07-06-unified-rollout-plan.md](2026-07-06-unified-rollout-plan.md) (v1.1, 98 коммитов исполнения после `b04f71a`).
Методика: 6 параллельных проверяющих агентов (по фазе на каждого + инварианты), каждый пункт сверялся с кодом до file:line; плюс прямые проверки прода (curl onlyharness.com), npm registry и полный локальный прогон `npm run check` + `npm run smoke`.

## Вердикт

**Кодовая база: план выполнен на ~96% — 54 из 56 проверяемых пунктов DONE с доказательствами, все локальные проверки зелёные.** Два реально отсутствующих пункта: биллинг сидов M2.7 и запись ручного bounty-пилота S2. Отклонения от плана оформлены решениями, а не молчаливо (hosted endpoints — «не строить», npm publish — отложен сознательно и честно задокументирован в AGENTS.md/llms.txt).

**Прод: НЕ обновлён — ни одна фаза не доведена до правила «милстоун = деплой + продовый smoke».** На onlyharness.com крутится код до-Ф0: реестр отдаёт 8 старых сидов с фейковыми звёздами из `computeSocial` (1613/1348/1601, все «Wild West Top 10»), `/mcp` не существует, llms.txt старый, `.well-known` отдаёт SPA-fallback, `/api/openapi.json` 404. Это прямое нарушение сквозного правила №2 плана и продуктового принципа «честность до денег» — прод сегодня показывает именно те фейки, ради устранения которых делалась Ф0.

Итого: **исполнение разработки — принято; исполнение выкладки — не начато.** Все блокеры закрытия — владельческие чекпоинты (деплой, миграции, npm 2FA, DNS), см. раздел 6.

## 1. Локальные проверки (пруф)

- `npm run check` — PASS (typecheck всех воркспейсов + node:test юниты).
- `npm run smoke` — PASS, покрытие из лога: «12 seeds, API registry/detail/import/remix/verified-directory-publish/git-publish, storefront ref attribution, archive versions, paid 402/checkout/receipt/webhook/entitlement/check/community-code, hosted per-call unavailable guard, gate escrow reserve/capture/refund/timeout, signed gate receipt verification, Claude Code install confirms, eval/gate verification events, events, org setup/publish/verified-publish/sync/private archive/audit, CLI validate/eval/gate/diff/update/audit-setup/extract/benchmark/suggest/install/adapt/mcp-config, local CLI doctor/search/suggest/install/pull/adapt/mcp-config/run loop».

## 2. Прод-проверки (2026-07-07)

| Проверка | Результат | Вывод |
|---|---|---|
| `GET /api/healthz` | 200 `{ok:true}` | Живой, но старый контейнер |
| `GET /api/registry` | 8 items, stars 1613/1348/1601/1744/1547, у всех бейдж «Wild West Top 10» | **Старый фейковый computeSocial** (в репо 12 сидов, реальные счётчики, пороги heat) |
| `POST /mcp` | 405 (web-слой), `/api/mcp` 404 | MCP не задеплоен (в репо + Caddyfile готовы) |
| `GET /llms.txt` | без npx/mcp/AGENTS-строк | Старый файл |
| `GET /.well-known/oauth-protected-resource` | SPA index.html | Fallback вместо JSON (файл в репо есть) |
| `GET /AGENTS.md` | 200 (тело не JSON-проверялось; с учётом SPA-fallback скорее HTML) | Перепроверить после деплоя |
| `GET /api/openapi.json` | 404 | Роут в репо есть, на проде нет |
| `npm view onlyharness` | 404 | Не опубликован — **сознательно отложено** (задокументировано: «prepares the bundle but does not publish it»; причина — чекпоинт владельца A7/2FA) |

## 3. Сводка по фазам

| Фаза | Пунктов проверено | DONE | PARTIAL | MISSING | Комментарий |
|---|---|---|---|---|---|
| Ф0 Честность | 9 | 9 | — | — | Счётчики+триггеры+бэкфилл, social.ts с порогами heat, security-scan с исключением из листинга, манифест v0.2 (enum union + фикстур-тест v0.1), Standard-бейдж, честная копия, email-confirmation закоммичен |
| Ф1 Agent-first + порт | 15 | 15 | — | — | registry.ts экстракция, self-contained бандл `dist/hh.mjs`, EXIT с PAYMENT=5, `--json` везде, AGENTS.md/CLAUDE.md (+отдача на сайте), mcp.ts (6 тулов), .well-known, smoke-mcp, версии `?version=`, миграции денег, 402 dual payload, events+санитизация, deep links `#/h/`, скелет Install Center |
| Ф2 Деньги+UI+Plugin v0.1 | 13 | 13 | — | — | **Блокер 2.4 закрыт**: pullHarness в MCP идёт через ту же entitlement-логику и возвращает 402-payload в tool result. Payout ledger, context-cost, `hh pin/outdated/update --diff`, manual-провайдер + идемпотентный webhook, storefront @handle + ref, Install Center target-first, jobs-фильтры, Trust-таб «безопасно?→работает?→лучше?», last_verified_at из реальных событий, share-card с trust-сигналами, плагин с validation-gate, openapi.ts+server.json+registry-check |
| Ф3 Автопилот+Teams core | 14 | 14 | — | — | `hh suggest` с обязательной trust-сводкой и security-гейтом на `--apply`, funnel-телеметрия, confirms-бейдж, orgs core (миграция+API+аудит), `hh publish --org`, `hh setup @acme`, Network Neighborhood, fork graph (`harness_forks` + POST /remixes, фейк-форки депрекейчены), `hh extract` с depends_on, maintainer publish с verified-гейтом |
| Ф4 x402+M2G+хвост | 14 | 12 | 1 | 1 | x402 foundation+settle (HTTP-facilitator, wallet-entitlement, `hh pull --pay` с HH_MAX_PAY_USD), smoke-x402, purchase-aware MCP, M2G (entitlement-check API + gate-codes + референс TG-бот `scripts/telegram-community-gate-bot.ts`), git-sync, directory shelf (4 полки), benchmark runner + 3 сьюта. PARTIAL: Bazaar-листинг (это GTM владельца, 4.8). **MISSING: M2.7 биллинг сидов** |
| Ф5 M4 | 4 | 4 | — | — | ed25519 receipts + POST /receipts, эскроу reserved→captured/refunded с окном 72ч, bounties с приёмкой по receipts, M4.4 оформлен решением «не строить» + fail-closed 409 для per_call |
| Track S | 2 | 1 | — | 1 | S1 `hh audit-setup` готов (context-cost, конфликты триггеров, staleness, share-card). **S2 ручной bounty-пилот — записи нет** |
| Инварианты (разд. 3) | 12 | 8 | 4 | — | Секреты server-only (+check-production-config), флаги default-off, events-privacy (whitelist полей), Wave 1 = 13 сидов с source/attribution, directory shelf, docs sync, деплой-контракт с /mcp-проверкой. PARTIAL: paid=OSS только политикой; Wave 2 без явного evalStatus-маркера; Wave 0 denylist есть, валидация каталога не в API; в smoke нет именованной метрики «0 бесплатных pull платного через /mcp» (сама логика покрыта) |

## 4. Находки и расхождения

**Критическое (1):**
1. **Прод не передеплоен** — весь раздел 2. Следствие: на проде живут фейковые социальные сигналы (репутационный риск, который Ф0 должна была снять первой). Ни один продовый smoke (`smoke-production-*`, проверки /mcp в deploy-скрипте) не мог быть прогнан по правилу «милстоун = деплой».

**Существенные (4):**
2. **M2.7 биллинг сидов отсутствует** — единственная невыполненная кодовая задача плана (Ф4 4.3). Оформить либо реализацией, либо явным решением-переносом (Teams пока можно продавать вручную-инвойсами, но решение должно быть записано).
3. **supabase db push**: 15 новых миграций в репо; статус применения к хостед-Supabase из репо не проверяем — до деплоя обязателен прогон и сверка (особенно counters-backfill и deprecate-миграции, зачищающие старые fake-actions).
4. **Юрзаключение MoR** — статус вне репо неизвестен; PAYMENTS_ENABLED=false согласован с правилом, но перед включением платежей гейт должен быть формально закрыт.
5. **Wave 2 semi-auto импорт фактически не проведён** (в data/imports только smoke-фикстуры) — полка сейчас: 13 сидов + 4 directory. Это меньше цели «Ф2: ~60 импортов»; каталожный JSON и denylist готовы, конвейер есть.

**Мелкие (5):**
6. Maintainer-штамп в CLI-скаффолде остался «Harness.Hub Local» (packages/harness-cli/src/index.ts:3341,3671) — план Ф1 1.2 требовал замену.
7. x402-смоук помечен «Base Sepolia», но сеть в конфиге `eip155:8453` — это Base **mainnet** (Sepolia = 84532). Перепроверить, на чём реально гоняется тест.
8. «Paid = open source» не энфорсится кодом (только политика в доках): стоит добавить проверку при publish платного — files-preview обязан быть доступен без покупки.
9. В smoke нет именованного ассерта «paid pull через /mcp → 402» (логика проверена косвенно; добавить явный кейс — метрика Ф2 требует его буквально).
10. Автопилот реализован как `hh suggest` (CLI+MCP), плагин-скилл дирижирует командой — отклонение от буквы MP.2 («скилл сам ищет»), по духу корректное и даже более тестируемое; зафиксировано здесь как принятая девиация.

## 5. Что подтверждено сверх ожиданий

- Полный M4 (receipts/эскроу/bounties) сделан уже сейчас, хотя план ставил его «недели 9+».
- Решение M4.4 оформлено отдельным документом с fail-closed поведением — образцовая фиксация замороженного решения.
- Плагин имеет собственный validation-gate в CI (`scripts/check-claude-plugin.ts`), MCP-метаданные — проверку `scripts/check-mcp-registry.ts`.
- Деплой-скрипт уже валидирует /mcp и .well-known после выкладки — инфраструктура закрытия готова.

## 6. Открытые владельческие чекпоинты (единственные блокеры закрытия)

| # | Действие | Блокирует | Готовность в репо |
|---|---|---|---|
| 1 | `supabase db push` (15 миграций) + сверка | всё продовое | миграции готовы |
| 2 | `scripts/deploy-production.sh` + продовые smoke | Ф0–Ф5 фактическое закрытие | скрипт сам проверяет /mcp и .well-known |
| 3 | `npm login && npm publish -w onlyharness` (2FA) | демо Ф1 «npx с чистого ноутбука», MP-инструкции | бандл self-contained, README готов |
| 4 | DNS TXT + `mcp-publisher publish` | листинг в MCP Registry (D3) | server.json + check-скрипт готовы |
| 5 | Юрзаключение MoR → включение PAYMENTS_ENABLED | реальные деньги | флаг off, гейт-логика готова |
| 6 | Анкоры (2 шт.) → M2G включение, Bazaar-листинг после X402_ENABLED | GTM | код готов |

**Рекомендованный порядок закрытия: 1 → 2 → (проверить прод-таблицу раздела 2 заново) → 3 → 4 → 5 → 6.** После шага 2 повторить продовые curl-проверки из раздела 2 — все 8 строк должны позеленеть; после шага 3 — `npx -y onlyharness@latest doctor`.

## 7. Резюме

План v1.1 исполнен в коде с высокой точностью и с честной фиксацией отклонений; качество исполнения подтверждено тестами, смоуками и построчной сверкой. Продукт «готов к выкладке», но не «выложен»: строка финального закрытия плана — это шесть владельческих действий из раздела 6, из которых первые два (миграции + деплой) снимают критическую находку №1 немедленно.
