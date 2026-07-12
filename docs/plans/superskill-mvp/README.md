# SuperSkill MVP — implementation specification set

Дата: 2026-07-12
Статус: **IMPLEMENTATION SOURCE SET**
Целевая среда: внутренняя alpha команды
Первые clients: **Claude Code и Codex**

Этот каталог содержит минимально достаточные подробные спецификации для реализации
SuperSkill MVP поверх текущего OnlyHarness.

## Порядок авторитетности

При противоречии использовать следующий порядок:

1. [Итоговая концепция SuperSkill](../2026-07-11-superskill-final-service-concept.md) —
   продуктовая модель и границы.
2. [Master MVP plan](../2026-07-12-superskill-mvp-legacy-upgrade-plan.md) — sequencing,
   legacy migration и phase gates.
3. Документы этого каталога — точные implementation contracts.
4. Текущий код — authoritative legacy behavior, которое нужно сохранить или явно
   мигрировать.

Special case: для порядка implementation PR и merge dependencies
[`06-execution-backlog.md`](06-execution-backlog.md) является каноном и заменяет
обзорный список master §11.

Если runtime и документ расходятся во время реализации, нельзя молча подогнать тест под
код. Нужно определить: это legacy compatibility или баг относительно этой спецификации.

## Документы

| Документ | Назначение |
|---|---|
| [01-system-architecture.md](01-system-architecture.md) | Компоненты, границы, runtime и data flow |
| [02-contracts-and-data-model.md](02-contracts-and-data-model.md) | Exact schemas, HTTP/CLI/MCP/events contracts |
| [03-trust-routing-and-curation.md](03-trust-routing-and-curation.md) | Trust levels, eligibility, ranking, curation, revoke |
| [04-client-integration-and-activation.md](04-client-integration-and-activation.md) | Общий plugin, Claude/Codex adapters и lifecycle |
| [05-verification-and-rollout.md](05-verification-and-rollout.md) | Test matrix, internal alpha, deploy и rollback |
| [06-execution-backlog.md](06-execution-backlog.md) | PR-by-PR реализация с файлами, зависимостями и gates |
| [07-requirement-traceability.md](07-requirement-traceability.md) | Requirement → contract → PR → runtime evidence |
| [REVIEW-LOG.md](REVIEW-LOG.md) | Независимые review-циклы и disposition замечаний |

Design implementation handoff:

- [Daylight developer handoff](../2026-07-12-superskill-mvp-developer-handoff-daylight.md) —
  точная интеграция приложенной Daylight v1.0 design system в текущий React/frontend и
  MVP contracts.

## Зафиксированные решения

### Один product core, два native clients

Claude Code и Codex используют одинаковые:

- managed capability schema;
- curated index;
- recommendation API;
- ranking;
- trust policy;
- archive/digest;
- CLI activation state machine;
- privacy-safe events;
- общий `skills/superskill/SKILL.md`.

Различаются только:

- plugin manifest и marketplace;
- skill discovery path;
- client detection/doctor;
- pinned adapter writer;
- client compatibility smoke.

### Current official client facts

Codex:

- repo skills находятся в `.agents/skills`;
- user skills находятся в `$HOME/.agents/skills`;
- распространяемый plugin использует `.codex-plugin/plugin.json`;
- Codex marketplace использует `.agents/plugins/marketplace.json`;
- plugin может включать `skills/` и `.mcp.json`.

Источники:

- [Codex skill locations](https://learn.chatgpt.com/docs/build-skills#where-to-save-skills)
- [Codex plugin structure](https://learn.chatgpt.com/docs/build-plugins#plugin-structure)
- [Codex plugin path rules](https://learn.chatgpt.com/docs/build-plugins#path-rules)

Следствие: текущий legacy adapter `.codex/harnesses/<name>/AGENTS.md` не является
целевым Codex skill install path и должен быть мигрирован.

Claude Code:

- сохраняется текущий marketplace/plugin flow;
- pinned skill path MVP: `.claude/skills/<name>/SKILL.md`;
- plugin package использует `.claude-plugin/plugin.json`.

### Managed MVP resources

MVP рекомендует только:

- `type=instruction_harness`;
- exact immutable snapshot;
- text-only artifact;
- known source/license;
- declared permissions;
- approved trust attestation;
- fresh verified compatibility для Claude Code и Codex; routing дополнительно проверяет
  выбранный client.

Browse-only resources не становятся managed автоматически.

### Internal alpha simplifications

Чтобы не усложнять внутреннюю проверку:

- без аккаунтной auth/сессий: только per-tester Bearer token для internal alpha;
- без billing и creator payouts;
- без hosted execution;
- без arbitrary scripts/hooks;
- без silent auto-activation;
- без сложной admin UI;
- один opaque `HH_SUPERSKILL_TOKEN` на каждого internal tester; managed HTTP routes
  требуют Bearer token и сервер хранит только его hash;
- новые managed MCP tools отложены до public-read/bearer transport после alpha;
- plugin release вызывает exact совместимую версию `onlyharness`, а не `latest`;
- curated data хранится в reviewable JSON + filesystem snapshots;
- deterministic ranking без embeddings/LLM server dependency;
- outcome в alpha — `agent_reported`, `user_confirmed` или `unknown`;
- rollout через feature flag и allowlisted per-tester tokens.

## Definition of Done пакета спецификаций

Пакет считается полным, если реализационный агент может без дополнительных
архитектурных решений ответить на вопросы:

1. Какие модули и файлы создавать?
2. Какие exact request/response schemas использовать?
3. Как рассчитывать digest и score?
4. Что делает resource eligible или blocked?
5. Как проходит temporary и pinned activation в обоих clients?
6. Какие события и состояния считаются доказанными?
7. Какие тесты и production checks обязательны?
8. Как выполнить rollout и rollback без поломки legacy?
