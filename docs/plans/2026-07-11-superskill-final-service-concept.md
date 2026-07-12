# SuperSkill — итоговая концепция сервиса и основа для PRD

Дата: 2026-07-11
Статус: **PRODUCT CONCEPT SOURCE OF TRUTH**
Основание: полный [research source of truth](../research/2026-07-11-onlyharness-research-source-of-truth.md),
[100-pain master map](../research/2026-07-11-agent-skills-harnesses-workflows-pain-map.md),
market/competition research, security research и обсуждения SuperSkill.

Этот документ фиксирует целевую форму сервиса и sequencing. Он не заменяет отдельные
PRD, а задаёт для них общую модель, границы и критерии.

## 1. Концепция одним экраном

### Категория

> **Trusted Agent Capability Platform** — единый слой выбора, проверки, подключения,
> эксплуатации и развития AI-инструментов для пользователя, команды и агента.

### Продуктовая формула

```text
Задача пользователя
→ понять контекст
→ подобрать лучший подходящий agent resource
→ выбрать exact artifact и exact permissions
→ безопасно подключить его в существующий agent setup
→ доказать activation и результат
→ обновить, заменить, отключить или отозвать
→ вернуть опыт использования автору и команде
```

### Главный промис

> **Один доверенный вход ко всем AI-возможностям: пользователь описывает задачу,
> SuperSkill находит, проверяет и подключает подходящий инструмент.**

Пользователь не обязан знать, нужен ли ему skill, plugin, MCP, workflow, custom agent
или script pack. Он думает в терминах результата.

## 2. Архитектура бренда и продуктов

| Название | Роль |
|---|---|
| **SuperSkill** | Master brand и вся platform infrastructure |
| **SuperSkill** | Основной agent-facing plugin/router: задача → capability → доверенное подключение |
| **SuperSkill Workspace** | Командный inventory, approvals, policies, rollout, audit и revoke |
| **Skill Arena** | Сравнение ресурсов на одинаковых задачах: качество, cost, latency, compatibility |
| **Skill Factory** | Expertise/SOP/docs/incidents → maintained resource + evals + permissions + публикация |
| **Trust Engine** | Exact artifact, capabilities, named checks, attestations, quarantine и rescan |

SuperSkill не является отдельным каталогом. Это пользовательская точка входа в
SuperSkill.

## 3. Какую проблему решает сервис

### Для пользователя

- не умеет и не хочет выбирать между тысячами skills и plugins;
- не понимает, сработает ли ресурс в его client/version/setup;
- накапливает legacy: дубли, устаревшие и неиспользуемые ресурсы;
- платит context/token tax за всё установленное;
- не знает, был ли skill действительно загружен и применён;
- не может самостоятельно проверить безопасность и permissions.

### Для команды

- ресурсы разбросаны по repositories, чатам и локальным папкам;
- нет effective inventory и владельцев;
- копии расходятся, обновления и revoke неуправляемы;
- GitHub stars и один security badge не подходят для approval;
- невозможно доказать, что exact approved release реально использовался;
- разные agent clients создают разные install и policy surfaces.

### Для автора и эксперта

- трудно превратить expertise в maintained executable product;
- публикация, dependencies, compatibility и evals требуют слишком много ручной работы;
- нет обратной связи: где ресурс активировался, почему упал, кто обновился;
- продажа статического файла имеет слабую экономику;
- нет честного revenue mechanism за поддерживаемый полезный инструмент.

### Для security/compliance

- agent resource наследует filesystem, shell, env, network и SaaS powers агента;
- prompt injection и tool poisoning не видны обычному AV;
- источник, лицензия и точный artifact часто неизвестны;
- нет quarantine, rescan, kill switch и downstream notification;
- «проверено» не раскрывает, что именно было проверено.

## 4. Продуктовые принципы

1. **Task-first, не catalog-first.** Начинать с пользовательской задачи.
2. **Curated, не exhaustive.** Лучше 30 доказанных resources, чем 30 000 карточек.
3. **Automation with control.** Система выбирает, но не скрывает why, permissions и risk.
4. **Exact trust.** Доверие относится к exact digest, а не к URL, автору или имени.
5. **Evidence over badges.** Показывать named checks, compatibility и runtime evidence.
6. **Progressive permissions.** Low-risk можно автоматизировать; новые/high-risk powers
   требуют явного подтверждения или workspace policy.
7. **Git-native, но не Git-limited.** Git остаётся source of truth; поддерживаются
   repositories, subpaths и immutable artifacts.
8. **Install into existing setup.** SuperSkill не заставляет менять Claude, Codex,
   Cursor, Copilot или внутренний runtime.
9. **Resource-neutral.** Общая модель для skills, plugins, MCP, workflows и agents.
10. **Lifecycle, не download.** Selection → install → activation → update → revoke.
11. **Learning loop.** Failures и incidents должны превращаться в eval/update.
12. **Honest state.** Installed, detected, loaded, invoked и outcome verified — разные
    состояния.

## 5. Целевые пользователи и Jobs to Be Done

### P1. Individual power user / AI operator

> Когда у меня появляется задача, подбери и подключи лучший инструмент, не загрязняя
> setup и не заставляя меня разбираться в десятках repositories.

### P2. Team lead / AI enablement / platform owner

> Собери все используемые AI-resources, дай команде approved набор, поддерживай версии
> и покажи, что реально установлено и используется.

### P3. Developer / creator

> Помоги упаковать мой рабочий метод, проверить, распространить во все clients и
> получать feedback и доход от использования.

### P4. Security / compliance reviewer

> Покажи source, artifact, capabilities, checks и runtime evidence; дай заблокировать
> опасную версию и доказать, кому она была доступна.

### Первый клин

**Power users и небольшие AI-first teams**, которые:

- используют минимум два agent clients;
- уже имеют 10+ skills/plugins/workflows/MCP resources;
- сталкиваются с setup bloat, выбором, обновлениями и trust;
- могут начать без долгого enterprise procurement.

Собственная группа компаний используется как design-partner контур. Это не отменяет
consumer SuperSkill, а даёт реальные private resources, policies и lifecycle cases.

## 6. Основные пользовательские поверхности

### 6.1 SuperSkill plugin — основной flow

Плагин устанавливается один раз в Claude/Codex/Cursor/другой client и предоставляет:

- понимание задачи и минимально необходимого контекста;
- task-aware search и ranking;
- один рекомендуемый resource и объяснение выбора;
- альтернативы, если confidence недостаточен;
- trust summary и permission delta;
- temporary или pinned activation;
- post-install doctor;
- activation/outcome evidence;
- cleanup, update и replacement.

### 6.2 Web showroom

Публичная Win98/Bento поверхность для:

- share-ссылок;
- JTBD-карточек;
- trust и comparison pages;
- creator profiles;
- Skill Arena;
- install/open actions.

Это не основное место выполнения работы. Оно помогает **понять, довериться и
подключить** ресурс в существующий setup.

### 6.3 Workspace

Серьёзная командная поверхность:

- Inventory;
- Review queue;
- Approved collections;
- Installed/Active/Outdated;
- Policies;
- Quarantine/Revoke;
- Audit;
- Members and access.

### 6.4 Creator Studio / Skill Factory

- import repository/subpath;
- interview/SOP/docs/incident ingestion;
- resource unit detection;
- dependency and capability declaration;
- generated examples/evals;
- security findings and fixes;
- release and distribution;
- usage/failure/update analytics.

### 6.5 Agent-first interfaces

- CLI;
- API/OpenAPI;
- MCP;
- ARD;
- GitHub App/checks;
- vendor-native marketplace/config outputs.

## 7. End-to-end flows

### 7.1 Пользователь решает задачу

```text
User asks for an outcome
→ SuperSkill extracts intent and constraints
→ searches approved/public/private resources
→ ranks by fit, trust, compatibility, currentness and context cost
→ shows best candidate + why + permission delta
→ user/policy approves
→ exact release is activated temporarily or pinned
→ doctor confirms detected/loaded state
→ task runs in the user's agent
→ outcome/activation receipt is recorded
→ temporary resource is removed or kept by choice
```

### 7.2 Команда подключает repositories

```text
Create workspace
→ connect GitHub/GitLab
→ select repositories
→ detect resource units/dependencies
→ freeze exact releases
→ run security/eval checks
→ review and approve
→ publish approved collection
→ distribute to clients
→ monitor active/outdated/revoked state
```

### 7.3 Автор публикует инструмент

```text
Connect source or complete guided interview
→ package resource
→ declare permissions/dependencies/license
→ generate and run evals
→ pass security review
→ publish exact release
→ share page/install command
→ receive privacy-safe usage/failure feedback
→ issue improved release
```

### 7.4 Security отзывает версию

```text
Finding/advisory/report
→ affected digest identified
→ quarantine
→ block new installs
→ notify downstream installations
→ recommend fixed release or uninstall
→ record remediation and audit trail
```

## 8. SuperSkill routing model

### Candidate generation

Search public, private и locally available resources по:

- task intent и expected outcome;
- domain/region;
- client/model/OS compatibility;
- required capabilities;
- workspace policy;
- source/license;
- current/revoked state.

### Ranking

Рекомендуемый score должен учитывать:

1. task fit;
2. compatibility confidence;
3. exact-release trust;
4. eval evidence и negative deltas;
5. permissions/risk;
6. currentness/maintenance;
7. context, latency и cost overhead;
8. workspace/creator preference;
9. previous successful use в похожем setup.

Popularity и stars могут быть только слабым дополнительным сигналом.

### Consent model

| Сценарий | Поведение |
|---|---|
| Approved low-risk, permissions не меняются | Workspace/user может разрешить auto-activation |
| Новый resource или новые permissions | Явное подтверждение |
| Shell, secrets, external writes, money, production | Обязательное подтверждение и policy gate |
| Warn finding | Показ findings; opt-in только если policy разрешает |
| Fail/quarantined/revoked | Установка и activation запрещены |

### JIT performance

- metadata и trust cache;
- prefetch top candidates без исполнения install scripts;
- content-addressed local cache;
- temporary overlay вместо загрязнения global setup;
- graceful fallback на уже pinned resource;
- routing latency budget фиксируется в PRD.

## 9. Resource и lifecycle model

### Поддерживаемые resource types

- skill;
- plugin/extension;
- workflow/runbook;
- MCP server/config;
- custom agent/subagent pack;
- commands/hooks/scripts;
- policy/config pack;
- native harness;
- API/service endpoint;
- Git repository или subpath;
- composite bundle.

### Канонические объекты

| Объект | Назначение |
|---|---|
| `Resource` | Логическая capability и ownership |
| `Release` | Версия ресурса |
| `Artifact` | Неизменяемый content digest/files/SBOM |
| `Capability` | Filesystem, shell, network, env, secrets, writes, money и другие powers |
| `Attestation` | Provenance и результаты named checks |
| `Evaluation` | Task suite, outcome, cost, latency, environment |
| `Approval` | Кто и по какой policy разрешил exact release |
| `Installation` | Кем, куда и какая версия установлена |
| `Activation` | Detected, loaded, invoked и applied states |
| `ExecutionReceipt` | Доказательство обязательных действий/outcome без prompts и PII |
| `Collection` | Approved набор для пользователя/workspace/use case |
| `Policy` | Правила выбора, permissions, updates и enforcement |

### Lifecycle

```text
Discovered
→ Draft
→ Scanning
→ Review required / Rejected
→ Approved
→ Available
→ Installed
→ Detected
→ Loaded
→ Invoked
→ Outcome verified
→ Outdated / Deprecated / Quarantined / Revoked
```

## 10. Trust and security contract

SuperSkill не обещает абсолютную безопасность. Он обещает воспроизводимое решение:

> Этот exact artifact прошёл перечисленные проверки в указанное время, имеет такие
> capabilities, совместим с таким environment и разрешён такой policy.

### Обязательные слои

1. isolated ingestion;
2. path/symlink/archive-bomb/size protection;
3. content digest, provenance и SBOM;
4. schema и declared permissions;
5. secret/malware/IOC scan;
6. SCA/SAST/license checks;
7. Unicode/obfuscation/secondary-download analysis;
8. semantic prompt/tool-poisoning review;
9. declared-vs-inferred capability diff;
10. behavioral eval/sandbox для executable/high-risk resources;
11. human review для high risk;
12. rescan on update/advisory/schedule;
13. quarantine, revoke и downstream notification.

Security verdict не должен зависеть от того, заплатил ли creator за аудит. Платным
может быть SLA/скорость обработки, но не результат проверки.

## 11. Skill Arena

Arena сравнивает несколько resources, решающих одну JTBD-задачу.

Для каждого участника показываются:

- success/pass rate;
- negative delta vs baseline;
- mandatory action/side-effect proof;
- compatibility matrix;
- token/context overhead;
- latency;
- monetary cost;
- permissions/risk;
- tested release digest и date;
- known failures.

Evals могут выполняться локально или в controlled server environment. Нельзя смешивать
declared author scores и independently measured results.

## 12. Creator Life Cycle

```text
Expertise / SOP / docs / incident
→ guided capture
→ resource package
→ examples + evals + permissions
→ security review
→ exact release
→ distribution
→ activation/failure signals
→ proposed update + regression case
```

Главная ценность Skill Factory — не генерация файла, а превращение знания в
поддерживаемый learning loop.

Privacy-safe creator analytics:

- installs и active versions;
- invocation/activation rate;
- compatibility failures;
- eval regressions;
- update adoption;
- category comparison;
- без prompts, local paths, secrets и пользовательского контента.

## 13. Бизнес-модель

### План-гипотезы

| План | Ценность | Предварительный диапазон для теста |
|---|---|---:|
| Free | Manual search/install, public cards, local library | $0 |
| Pro | SuperSkill routing, JIT activation, personal inventory, updates | около $20/месяц |
| Team | Workspace, approved collections, Git sync, basic audit | $99–199/месяц |
| Business | Policies, effective inventory, revoke, advanced checks | $499–999/месяц |
| Enterprise | SSO/SCIM/SIEM, SLA, self-hosted/single-tenant | от $15k/год |

Цены — hypotheses, не утверждённый прайс.

### Creator economics

- revenue pool от Pro/Team usage;
- выплаты только по fraud-resistant verified usage/outcome, не по raw invocation;
- paid expedited audit не влияет на verdict;
- обновления, maintenance, compatibility SLA и private distribution могут быть
  отдельными платными продуктами;
- HTTP 402/per-call остаётся опциональным поздним rail, не условием MVP.

### Enterprise outcome

Продавать не «каталог skills», а измеримый результат:

> «Мы соберём ваши AI-tools, дадим один безопасный способ их использовать, сократим
> setup/selection overhead и обеспечим управляемые update и revoke».

## 14. Distribution и growth loops

### User loop

```text
Install SuperSkill
→ solve task faster
→ keep trusted capability
→ reuse for next task
→ recommend plugin
```

### Creator loop

```text
Publish resource
→ share trust page
→ installs/usage
→ feedback and revenue
→ improved release
```

### Team loop

```text
Connect repo
→ inventory
→ approved collection
→ more users/teams
→ more evidence and governance value
```

### Viral utilities

- `audit my setup`;
- duplicate/context-cost report;
- public trust card;
- Skill Arena comparison;
- shareable `{profession}.exe`/Win98 pages;
- one-link install into existing agent.

## 15. North star и метрики

### North star

> **Weekly successful task outcomes using an exact resource selected or managed by
> SuperSkill.**

Пока outcome verification неполный, промежуточная north star:

> **Weekly successful activations of exact releases across agent clients.**

### Funnel

- task → recommendation;
- recommendation → accepted;
- accepted → installed/activated;
- activated → invoked;
- invoked → successful outcome;
- successful outcome → repeat use;
- outdated notification → update/remediation.

### Product metrics

- time to useful capability;
- recommendation acceptance rate;
- top-1/top-3 successful fit;
- install and activation success by client/version/OS;
- context/token reduction after cleanup;
- wrong-tool and failed-routing rate;
- repeat usage and retention;
- cross-client reuse;
- share-to-install conversion.

### Trust metrics

- coverage of exact digest/source/owner/capabilities;
- scan/eval coverage;
- false positive/false negative review rate;
- time to quarantine/revoke;
- affected-install remediation rate;
- percentage of installs on allowed current releases.

### Business metrics

- Free → Pro/Team conversion;
- active paid workspaces;
- weekly admins using review/update/audit;
- creator supply with real external usage;
- revenue concentration and fraud rate;
- paid willingness-to-continue after pilot.

## 16. Тезисный roadmap

### Phase 0 — Product and trust foundation, 0–2 недели

- единая terminology и canonical object model;
- exact artifact/release/capability model для всех resource types;
- curated seed set: 20–30 resources в 3–5 JTBD-категориях;
- privacy-safe events для recommendation/activation/outcome;
- trust contract и consent policy;
- блокировка `not_scanned`/mutable resource в managed flow;
- выбрать первый client и design partners.

**Gate:** каждый seed resource имеет owner, source, digest, permissions, compatibility
и понятный JTBD.

### Phase 1 — SuperSkill guided alpha, 3–6 недели

- один plugin/client;
- task context → ranked candidate;
- best candidate + alternatives + explanation;
- explicit apply;
- temporary/pinned install;
- post-install doctor;
- local setup inventory и duplicate/context audit;
- recommendation/activation telemetry.

**Gate:** 20 реальных пользователей, 100 задач, измерены acceptance, activation,
task success, latency и repeat use.

### Phase 2 — Trust, lifecycle and cross-client beta, 7–12 недель

- unified scan pipeline generic resources;
- exact permissions и permission diff;
- quarantine/rescan/revoke;
- второй и третий agent clients;
- install/activation states;
- personal/team approved collections;
- basic Workspace и GitHub sync;
- Skill Arena для 2–3 категорий.

**Gate:** 3 design partners, 20+ real resources, 100+ successful activations, revoke
drill и минимум 2 client types в weekly use.

### Phase 3 — Creator Life Cycle and monetization, 3–6 месяцев

- Git/subpath import и guided authoring;
- SOP/docs/interview → package;
- generated eval/regression cases;
- creator analytics;
- release/update workflow;
- Pro/Team pricing experiments;
- verified-usage revenue pool experiment;
- public share/install loops.

**Gate:** 10 external creators, 30 externally used resources, repeat updates и первые
платящие Pro/Team users.

### Phase 4 — Enterprise governance and verified execution, 6–12 месяцев

- org/repo discovery at scale;
- policy packs и four-eyes approval;
- SSO/SCIM/SIEM;
- signed attestations;
- execution receipts для high-stakes workflows;
- idempotency/checkpoint/selective replay integrations;
- compliance packs;
- optional self-hosted/single-tenant.

**Gate:** paid enterprise deployments, recurring admin usage, measured reduction of
operational/security risk.

### Expansion tracks — после доказательства core loop

Эти боли не удаляются, но не должны одновременно перегрузить MVP:

- durable workflow runtime;
- multi-agent task/control plane;
- portable truth/memory lifecycle;
- advanced cost/FinOps routing;
- hosted execution marketplace;
- bounties и outcome escrow.

Каждый expansion track получает отдельный market study и PRD до попадания в roadmap.

## 17. Что не является MVP

- полный GitHub replacement;
- собственная универсальная IDE/chat/model;
- exhaustive public marketplace;
- silent autonomous installation high-risk resources;
- абсолютная гарантия безопасности;
- hosted execution arbitrary third-party code;
- полноценный multi-agent orchestrator;
- универсальная memory platform;
- сложные payouts/x402/bounties до доказанного usage;
- enterprise checkbox features до working user loop.

Это sequencing, а не отказ от соответствующих pain clusters.

## 18. Главные риски

| Риск | Митигирование |
|---|---|
| Неверный автоматический выбор | Explainable ranking, alternatives, feedback, confidence threshold |
| Security incident разрушит доверие | Exact evidence, defense in depth, fail closed, quarantine/revoke, без абсолютных claims |
| JIT latency ухудшит UX | Cache, prefetch, temporary overlays, latency budget, fallback |
| Plugin собирает слишком много контекста | Data minimization, local extraction, explicit scopes, no prompt storage |
| Cold start рекомендаций | Небольшой curated seed и category-specific evals |
| Vendor встроит routing/marketplace | Cross-client neutrality, private resources, trust/lifecycle evidence |
| Revenue share будут накручивать | Verified activation/outcome, caps, anomaly detection, delayed settlement |
| Слишком широкий продукт | Phase gates и отдельные PRD по слоям |
| Web превратится в основной workspace | Сохранять showroom/install/admin boundary |
| Badge станет ложной гарантией | Named checks, digest, dates и limitations на каждом trust page |

## 19. Обязательная PRD-декомпозиция

| PRD | Scope | Зависит от |
|---|---|---|
| **PRD-00 Resource Graph** | Resource/Release/Artifact/Capability/lifecycle schema | — |
| **PRD-01 Trust Engine** | Ingestion, scans, attestations, policy, quarantine/revoke | PRD-00 |
| **PRD-02 SuperSkill Router** | Intent/context, candidate generation, ranking, feedback | PRD-00, PRD-01 |
| **PRD-03 Client Adapter and JIT Activation** | Install overlays, doctor, temporary/pinned state | PRD-00, PRD-02 |
| **PRD-04 Inventory and Lifecycle** | Effective setup, activation states, update/replacement | PRD-00, PRD-03 |
| **PRD-05 Workspace Governance** | Collections, approval, policy, members, audit | PRD-01, PRD-04 |
| **PRD-06 Skill Arena** | Eval suites, comparisons, cost/latency/compatibility | PRD-00, PRD-01 |
| **PRD-07 Creator Life Cycle** | Import, guided capture, publish, feedback, updates | PRD-00, PRD-01, PRD-06 |
| **PRD-08 Web Showroom and Trust Pages** | JTBD cards, share/install, creator/arena pages | PRD-01, PRD-06 |
| **PRD-09 Billing and Creator Economics** | Pro/Team plans, verified usage, payouts | PRD-04, PRD-07 |
| **PRD-10 Verified Execution Evidence** | Receipts, side effects, idempotency/replay integration | PRD-01, PRD-04 |

Каждый PRD обязан включать:

- problem и persona;
- JTBD и user stories;
- exact in/out scope;
- user flow и error states;
- data model/API/events;
- permissions/privacy/security threat model;
- rollout и migration;
- metrics и experiment design;
- acceptance criteria;
- failure/revoke behavior;
- docs/runtime synchronization.

## 20. Открытые решения до PRD-02/03

1. Первый client: Codex, Claude Code или оба.
2. Что является task success в alpha без доступа к приватному output.
3. Какие context fields разрешены для routing и где они обрабатываются.
4. Exact consent defaults для temporary activation.
5. Ranking weights и confidence threshold.
6. Формат portable capability manifest.
7. Как доказать detected/loaded/invoked для каждого client.
8. Какие 3–5 JTBD-категорий войдут в seed set.
9. Где проходит граница local execution и controlled server eval.
10. Какое usage evidence достаточно для creator revenue share.

## 21. Финальное определение

> **SuperSkill — платформа доверенных AI-возможностей. Её SuperSkill-плагин понимает
> задачу пользователя, выбирает лучший курируемый agent resource, подключает exact
> release с exact permissions в существующий agent setup и управляет его жизненным
> циклом. Trust Engine доказывает, что именно было проверено; Skill Arena сравнивает
> качество; Skill Factory превращает expertise и incidents в maintained resources;
> Workspace даёт компаниям approval, inventory, policy и revoke.**

Продукт начинается с guided task-to-capability loop и постепенно расширяется до
creator, enterprise и verified-execution layers. Все 100 pain points сохраняются как
problem space; roadmap определяет только порядок их превращения в проверяемый продукт.
