# SuperSkill production UX remediation plan

Дата: 2026-07-13
Статус: **PHASE 0–4 SHIPPED — APPROVAL EVIDENCE IN PROGRESS**
Источник фактов: production Chrome review `https://superskill.sh`, текущий repo и SuperSkill MVP contracts.

## 1. Цель

Довести публичный SuperSkill до состояния, в котором:

1. главный CTA открывает реальный client-install handoff;
2. Docs и Agent guide доступны как нормальные HTML-страницы в Chrome, при этом raw
   `/llms.txt` и `/AGENTS.md` сохраняются для агентов;
3. mobile navigation не теряет разделы;
4. error/not-found состояния не оставляют пользователя в тупике;
5. страницы имеют корректную heading hierarchy;
6. `www.superskill.sh` канонически перенаправляется на `superskill.sh`;
7. минимум один exact release проходит настоящую review attestation и становится
   первым managed-installable SuperSkill;
8. оставшиеся 11 selected skills проходят тот же review pipeline без массового
   фиктивного approval.

## 2. Подтверждённый production baseline и текущее состояние

Ниже сохранён исходный production baseline, на котором строился remediation. Все UX и
canonical-domain пункты из таблицы закрыты deploy-ем `3bdb523f9cde57ba5025539cde58eaee74e7fea2`.
Единственный открытый production gate — честный review/approval supply.

### Работает

- `/` и `#/superskill` загружают Daylight skin;
- 12/12 selected detail routes остаются в новом дизайне;
- 12/12 task-category routes показывают правильный selected skill;
- Claude Code и Codex CLI handoff показывают синтаксически валидные команды;
- пустая task form показывает валидацию;
- mobile `390x844` не имеет horizontal overflow;
- приложение не пишет собственных ошибок в Chrome console;
- unknown selected skill и unknown hash route fail closed;
- raw `/llms.txt` и `/AGENTS.md` отдаются сервером с HTTP 200.

### Исходные дефекты, закрытые в `3bdb523`

| Приоритет | Исходная проблема | Текущее production состояние |
|---|---|---|
| P1 | `Docs` и `Agent guide` открывали raw files | закрыто: обе human-readable HTML routes доступны, raw endpoints сохранены |
| P2 | mobile скрывал Docs и Agent guide без menu replacement | закрыто: accessible menu работает на 320–767 px |
| P2 | capability/install not-found copy не имел action link | закрыто: состояния имеют working navigation actions |
| P3 | category и часть error pages начинались с `h2` | закрыто: page-level состояния имеют один `h1` |
| P3 | `www.superskill.sh` отдавал копию сайта без redirect | закрыто: permanent redirect сохраняет path/query, hash сохраняется браузером |

### Открытый rollout gate

- production честно показывает `0 approved / 12 selected_unreviewed`;
- managed install для candidate releases остаётся fail closed;
- approval запрещён до exact-release client evidence и человеческого review.

### Закрыто после исходного Chrome review

- `Get SuperSkill` больше не считается открытым P1: generic route впервые был подтверждён
  в `c61f18b`, затем получил regression coverage и был задеплоен в `3bdb523`; текущий
  production bundle содержит и route, и CTA href.
- Исходный дефект был валиден на момент первого Chrome review, но текущая причина уже
  устранена deploy-ем. В плане остаётся только regression coverage и live smoke.

## 3. Ограничения и инварианты

- Не отправлять task text в API, URL, analytics, logs или storage.
- Не помещать `HH_SUPERSKILL_TOKEN` в browser state или public docs.
- Не превращать candidate в approved без exact-digest attestation, обеих client smokes
  и минимум трёх human-reviewed cases.
- Не менять legacy OnlyHarness skins и flows без необходимости компиляции.
- Raw `/llms.txt` и `/AGENTS.md` остаются machine-readable source; HTML docs их не
  заменяют и не редиректят.
- Copy command не означает Installed/Detected/Loaded/Invoked.
- Сохранять текущие unrelated dirty worktree changes. Перед началом реализации снять
  отдельный diff relevant-файлов и не перезаписывать чужие правки.

## 4. Важное состояние repo и production

Повторно проверено после внешнего review плана и production deploy:

- shipped UX baseline: `3bdb523f9cde57ba5025539cde58eaee74e7fea2`;
- exact-release evidence hardening и повторный production deploy: `7290c5fe4c68975a9a075489ff46e9a4f4da261c`;
- low-risk candidate pre-review tooling/batch и production deploy:
  `a554bd8` (`Prepare low-risk SuperSkill review batch`);
- research/data candidate pre-review batch и production deploy:
  `fcc1032` (`Prepare research SuperSkill review batch`);
- operational/high-risk candidate pre-review batch и production deploy:
  `9068146` (`Prepare operational SuperSkill review batch`);
- `apps/registry-web/**` не содержит dirty changes;
- generic install route, CTA и optional `capabilityId` уже закоммичены;
- этот exact commit задеплоен стандартным production script из clean temporary worktree;
- production Chrome подтверждает generic install, HTML Docs/Agent guide, mobile menu,
  heading/actions remediation и отсутствие horizontal overflow;
- `www.superskill.sh` отвечает `301` на apex с сохранением path/query и HSTS;
- public showroom отвечает `0 approved / 12 selected_unreviewed`; все 12 live current
  releases имеют exact version `0.2.1`, trust `candidate` и managed handoff
  `blocked:review_required`;
- текущие незакоммиченные изменения остаются только в пользовательских
  docs/research/output files и не относятся к SuperSkill remediation scope.

Следствие: generic install нельзя планировать как отсутствующую фичу. Это уже shipped
behavior, которое нужно защитить тестами и повторно проверять после следующих deploy.

Отдельного публичного build-SHA endpoint сейчас нет. Сопоставление production с `HEAD`
опирается на asset content и live behavior. Добавление commit SHA в public health не входит
в этот UX scope; при необходимости это отдельный observability task без раскрытия секретов.

## 5. План реализации

### Phase 0 — зафиксировать repo/live baseline и защитить worktree — DONE

1. Снять `git status --short`, `git rev-parse HEAD` и `git rev-parse origin/main`.
2. Подтвердить, что relevant frontend files чистые до начала изменений.
3. Сверить live route/asset behavior с `HEAD`; не считать старый Chrome screenshot
   доказательством текущего production состояния.
4. Отделить UX-remediation files от несвязанных docs/research/output changes.
5. Не удалять и не откатывать пользовательские файлы.
6. Зафиксировать production baseline в тестовой матрице этого документа.

Критерий: repo SHA, origin SHA и live behavior сверены; список remediation-файлов
известен; unrelated changes не попадают в commit.

### Phase 1 — regression coverage для shipped `Get SuperSkill` — DONE

Затрагиваемые файлы:

```text
apps/registry-web/src/core/superskill-route.ts
apps/registry-web/src/core/superskill-route.test.ts
apps/registry-web/src/skins/superskill/index.tsx
apps/registry-web/src/skins/superskill/pages/InstallHandoff.tsx
apps/registry-web/src/skins/superskill/pages/superskill-pages.test.tsx
```

Работа:

1. Не переписывать уже закоммиченный generic route без найденного дефекта.
2. Добавить UI test для единственного глобального header CTA: клик меняет route на
   `#/superskill/install` и показывает `Continue in your existing agent`.
3. Добавить direct-reload test для generic install route.
4. Подтвердить test-ом, что generic route не вызывает capability detail API и показывает
   только shared plugin setup для Claude Code/Codex CLI.
5. Подтвердить, что capability-specific `#/superskill/c/:id/install` сохраняет exact
   release gate.
6. Добавить test, что generic install не заявляет Installed/Activated.
7. В live smoke проверить один глобальный CTA на desktop и mobile; нет отдельных CTA на
   landing/detail/category, поэтому не дублировать одну и ту же проверку как четыре фичи.

Acceptance:

- CTA больше не остаётся на landing;
- прямой reload `#/superskill/install` работает;
- обе client tabs и exact runtime command видимы;
- task privacy contract не меняется.

### Phase 2 — HTML Docs, Agent guide и mobile navigation — DONE

Новые файлы:

```text
apps/registry-web/src/skins/superskill/components/SuperSkillHeader.tsx
apps/registry-web/src/skins/superskill/pages/DocsPage.tsx
apps/registry-web/src/skins/superskill/pages/AgentGuidePage.tsx
```

Изменяемые файлы:

```text
apps/registry-web/src/core/superskill-route.ts
apps/registry-web/src/core/superskill-route.test.ts
apps/registry-web/src/skins/superskill/index.tsx
apps/registry-web/src/skins/superskill/tokens.css
apps/registry-web/src/skins/superskill/pages/superskill-pages.test.tsx
apps/registry-web/public/llms.txt
apps/registry-web/public/AGENTS.md
scripts/check-public-copy.ts
```

Работа:

1. Добавить routes:
   - `#/superskill/docs` — human-readable install, usage, trust states, troubleshooting;
   - `#/superskill/agent-guide` — agent-first commands, consent contract, selected vs
     approved semantics.
2. Header links ведут на HTML routes, не на raw files.
3. На HTML pages оставить явные secondary links `Raw llms.txt` и `Raw AGENTS.md`.
4. Вынести header в компонент с accessible mobile menu:
   - menu button с `aria-expanded` и `aria-controls`;
   - Showroom, Docs, Agent guide, Get SuperSkill доступны на 320–767 px;
   - закрытие по выбору route и Escape;
   - focus возвращается на menu button.
5. Не fetch-ить raw files из браузера для рендера: содержимое HTML pages хранить как
   нормальные React sections, чтобы browser extensions не блокировали основную UX path.
6. Синхронизировать команды с `superskillRuntime`, а не копировать version вручную.

Acceptance:

- Docs и Agent guide открываются в Chrome без `ERR_BLOCKED_BY_CLIENT`;
- raw files продолжают отвечать 200;
- все navigation items доступны keyboard и mobile;
- `check:public-copy` подтверждает синхронные claims.

### Phase 3 — убрать dead ends и исправить semantics — DONE

Затрагиваемые файлы:

```text
apps/registry-web/src/skins/superskill/components/StatePanel.tsx
apps/registry-web/src/skins/superskill/pages/CategoryPage.tsx
apps/registry-web/src/skins/superskill/pages/TrustPage.tsx
apps/registry-web/src/skins/superskill/pages/InstallHandoff.tsx
apps/registry-web/src/skins/superskill/pages/SelectedSkillPage.tsx
apps/registry-web/src/skins/superskill/primitives.tsx
apps/registry-web/src/skins/superskill/pages/superskill-pages.test.tsx
apps/registry-web/src/skins/superskill/components/superskill-components.test.tsx
```

Работа:

1. `StatePanel` получает явный `headingLevel` или page-level wrapper с `h1`.
2. Создать `PageHeading` primitive; `SectionHeading` остаётся section-level `h2`.
3. Category title становится `h1`.
4. Top-level not-found/error/loading state получает `h1`; вложенные states сохраняют
   корректный `h2`.
5. Все not-found/blocked states с copy `Return to showroom` получают реальный
   `Open showroom` link.
6. Capability install error получает также `Open trust report`, если capability ID
   валиден, но release handoff заблокирован.
7. Не превращать retry и navigation в одну кнопку: retry повторяет запрос, navigation
   меняет route.

Acceptance:

- у каждой route ровно один page-level `h1`;
- ни один state не обещает действие без actionable control;
- keyboard tab order логичен;
- blocked states остаются fail closed.

### Phase 4 — canonical domain — DONE

Scope этой фазы намеренно ограничен новым брендом `superskill.sh`. Канонизация
`www.onlyharness.com` относится к legacy OnlyHarness surface и требует отдельного
production/SEO решения; она не должна незаметно расширять этот remediation.

Затрагиваемые файлы:

```text
infra/Caddyfile
scripts/deploy-production.sh
scripts/check-production-config.ts
infra/production-compose.yml        # только если CORS contract требует синхронизации
```

Работа:

1. Выделить `www.superskill.sh` в отдельный Caddy site block.
2. Делать permanent redirect на `https://superskill.sh{uri}` с сохранением path/query.
3. Apex остаётся единственным HTML origin.
4. CORS может продолжать принимать оба origin на время миграции, если это требуется API.
5. Добавить config check и live redirect smoke.

Acceptance:

- `https://www.superskill.sh/...` возвращает redirect на apex;
- apex отвечает 200;
- hash navigation после redirect сохраняется браузером;
- TLS и HSTS остаются валидными.

### Phase 5 — первый настоящий approved exact release — IN PROGRESS

Рекомендуемый первый кандидат: `deep-market-researcher` — простой read/research scope,
нет money movement или external send actions, уже есть понятный `market-research` route.

#### Обязательный pre-review release cut

Исходная проверка snapshots показала, что `deep-market-researcher@0.2.0` и остальные 11
кандидатов нельзя было честно перевести в approved при прежнем artifact/policy state:

- каждый snapshot содержит executable `.gitea/workflows/harness-ci.yml`;
- каждый snapshot содержит обязательный declarative `evals/promptfooconfig.yaml`, а
  исходный canonical contract разрешал только `evals/cases/**`;
- у `deep-market-researcher@0.2.0` static scan/capability diff имеет `warn`: shell signal
  из local runbook и filesystem signal из CI workflow;
- текущие declared eval scores (`0.88`) проходят local gate, но не являются independent
  quality или human-review evidence.

Поэтому review нельзя проводить против `0.2.0` с последующим silent mutation. Сначала:

1. выпустить новый immutable version (начать с `0.2.1`);
2. исключить executable CI workflow из managed source snapshot;
3. отдельно threat-review-нуть и разрешить только точный declarative path
   `evals/promptfooconfig.yaml`: текущая реализация парсит его fail closed, принимает
   только local Markdown prompt refs и literal `echo`, запрещает URL/commands/functions/
   plugins/exec/remote providers; Cycle 3 требует независимого review этого исключения;
4. повторно проверить manifest tuple, полный archive digest, static scan и capability
   diff;
5. только новый digest передавать в Claude/Codex и human cases;
6. старый `0.2.0` сохранить в immutable history и не переименовывать задним числом.

Если новый release ещё не подготовлен, Phase 5 остаётся honest blocked gate с
`selected_unreviewed`; это правильнее фиктивного approval.

Затрагиваемые файлы:

```text
data/superskill/curated.json
data/superskill/reviews/deep-market-researcher-0.2.1.json
data/superskill/showroom-previews/deep-market-researcher.json   # только после digest match
data/superskill/index.json                                      # generated
data/superskill/history.json                                    # generated immutable history
data/harness-versions/harnesses/deep-market-researcher/0.2.1.json
seed-harnesses/deep-market-researcher/harness.yaml
seed-harnesses/deep-market-researcher/.gitea/workflows/harness-ci.yml  # удалить из нового source
scripts/build-superskill-catalog.ts
scripts/check-superskill-showroom-response.mjs
scripts/superskill-showroom-response.test.ts
scripts/deploy-production.sh
docs/plans/superskill-mvp/REVIEW-LOG.md
```

Review procedure:

1. Создать и зафиксировать sanitized immutable `0.2.1` snapshot; вычислить artifact
   digest и записать exact tuple в curated source.
2. Проверить license, provenance, static scan, permissions и executable content.
3. Запустить clean Claude Code session smoke.
4. Запустить clean Codex CLI task smoke.
5. Провести минимум три human-reviewed cases:
   - нормальный market map;
   - неоднозначная задача с честным clarification/no-match;
   - adversarial/out-of-scope case без outreach, покупки данных или side effects.
6. Записать `superskill.review.v1` attestation с named checks, evidence dates,
   limitations и exact digest.
7. Только после успешной attestation поменять status на `approved` и добавить
   `reviewFile`.
8. Генерировать preview только из reviewed synthetic/public case и только при digest
   match.
9. Перестроить managed index.

Необходимая переработка deploy checker:

- убрать предположение `approved total === 0`;
- expected approved IDs получать из generated index или явного checked-in expectation;
- проверять exact set, trust status, artifact digest и available/blocked handoff;
- selected endpoint должен перестать требовать approved resource как
  `selected_unreviewed`, но продолжать строго проверять оставшиеся candidates;
- тест должен падать при fake approval, extra item, missing item и digest mismatch.

Acceptance:

- approved showroom показывает ровно один reviewed exact release;
- trust page показывает named evidence, date, digest и limitations;
- install handoff доступен только этому exact approved release;
- selected shelf честно показывает оставшиеся 11 review-pending skills;
- recommendation router выбирает resource только для matching task и fail closed для
  exclusions/no-match.

### Phase 6 — обработать оставшиеся 11 selected skills — IN PROGRESS

Не делать один массовый approval commit. Работать batch-ами по риску:

1. **Low-risk read/advice:** founder-decision-memo, product-strategy-critic,
   launch-readiness-reviewer, repo-truth-auditor.
2. **Research/data:** gtm-research-sprint, data-quality-sentinel,
   agent-harness-refactorer.
3. **Operational/high-risk:** support-triage-agent, incident-rca-commander,
   security-permission-auditor, finance-payment-safety-reviewer.

Для каждого resource повторить Phase 5 с отдельной attestation и exact digest. Для
high-risk группы cases обязательно проверяют запрет side effects; payment reviewer не
может отправлять платежи, делать refund или менять ledger. Approval каждого high-risk
resource дополнительно требует второй passing human/agent review с отдельным public-safe
reviewer label и exact покрытием всех трёх human case IDs; без этого catalog build
fail closed.

Batch acceptance:

- один broken resource не блокирует review остальных;
- approval count растёт только после реального evidence;
- revoked/quarantined/stale state немедленно убирает managed activation;
- после каждого batch обновляются review log и production smoke expectations.

Текущий pre-review progress:

- добавлен dry-run-by-default `npm run prepare:superskill-release -- --id <id>
  --from <version> --to <version>`; запись требует отдельный `--write`, exclusive lock и
  durable recovery journal, заранее проверяет весь cut и восстанавливает pre-write bytes
  после обработанной ошибки или следующего запуска после crash;
- генератор seed-ов читает checked-in `data/superskill/source-releases.json`, поэтому
  повторный `npm run seed` больше не возвращает sanitized release к старой версии и не
  восстанавливает удалённый workflow;
- low-risk batch подготовлен как четыре отдельных immutable `0.2.1` release cuts:
  `founder-decision-memo`, `product-strategy-critic`, `launch-readiness-reviewer`,
  `repo-truth-auditor`;
- все четыре остаются `candidate`, без `reviewFile`, preview, human verdict или managed
  activation; старые `0.2.0` остаются в immutable history;
- для всех четырёх прошли clean Claude Code `2.1.112` и Codex CLI `0.135.0` exact
  activation sessions; public-safe evidence сохраняет `promotionAuthorized=false`,
  `attestationCreated=false` и `humanReviewEvidence=false`;
- для каждого подготовлен отдельный normal/ambiguous/adversarial human-case packet с
  пустыми reviewer/date/verdict полями; synthetic outputs явно помечены как не полученные
  из managed runtime и не являются attestation;
- первый Claude run для `repo-truth-auditor` честно остановился после `activation_ready`;
  pinned SKILL.md был исправлен так, чтобы показывать точные loaded/invoked/finish
  commands, после чего diagnostic и полный dual-client run прошли;
- capability inference отделён от declarative `harness.yaml` и от negated/review-only
  safety prose, при этом positive imperative credential/network/money actions продолжают
  давать blocking diff; это защищено adversarial positive/negative tests.
- research/data batch подготовлен как три отдельных immutable `0.2.1` release cuts:
  `gtm-research-sprint`, `data-quality-sentinel`, `agent-harness-refactorer`; старые
  `0.2.0` сохранены, status остаётся `candidate`;
- все три прошли generic exact-release smoke и финальные clean Claude Code `2.1.112` /
  Codex CLI `0.135.0` lifecycle sessions; durable reports остаются
  non-promotional и human-case packets имеют пустые reviewer/date/verdict поля;
- первый GTM generic smoke честно упал из-за diluted intent+outcome task и был исправлен
  на exact curated intent с regression test;
- три pre-fix Claude попытки для `agent-harness-refactorer` без Skill/state и один
  invalid positional experiment отвергнуты; переход на canonical single-line
  `/skill <arguments>` positional prompt дал два последовательных diagnostic pass и
  финальный dual-client pass.
- operational/high-risk batch подготовлен как четыре отдельных immutable `0.2.1`
  release cuts: `support-triage-agent`, `incident-rca-commander`,
  `security-permission-auditor`, `finance-payment-safety-reviewer`; все 12 selected
  resources теперь имеют отдельный sanitized current `0.2.1` tuple, а `0.2.0` history
  сохранён;
- все четыре прошли generic exact-release smoke и финальные clean Claude Code `2.1.112`
  / Codex CLI `0.135.0` lifecycle sessions без исполнения capability task и с
  `unknown/unknown` outcome;
- human-case packets для operational batch оставляют reviewer/date/verdict пустыми и
  требуют отсутствие external send, remediation или production mutation; finance
  отдельно запрещает charge/refund/provider call/ledger mutation/withdrawal;
- весь supply остаётся `candidate / selected_unreviewed`; attestation, preview, approval
  и managed activation не создавались. Следующий gate — реальный человеческий review.

## 6. Тесты и verification gates

### Targeted frontend

```bash
npm run typecheck -w @harnesshub/registry-web
npm test -w @harnesshub/registry-web
npm run check:public-copy
npm run check:superskill-runtime
```

`check:superskill-runtime` проверен по реализации: без аргументов он только читает
`plugins/superskill/runtime.json` и generated TypeScript, сравнивает их и падает при
рассинхроне. Запись происходит только при явном запуске generator с `--write`; в
verification gates `--write` не использовать.

Обязательные новые tests:

- generic install route parse/build/reload;
- global header CTA → generic install на representative route плюс отдельный header unit
  test; не дублировать один глобальный CTA как три разные page feature;
- Docs/Agent guide route render;
- mobile menu keyboard behavior;
- raw docs links остаются secondary;
- category/error/install pages имеют один `h1`;
- not-found states содержат working showroom link;
- approved/selected checker поддерживает 1 approved + 11 selected;
- fake approval и digest mismatch fail closed.

### SuperSkill gates

```bash
npm run check:superskill-catalog
npm run check:superskill-router
npm run check:superskill-runtime
npm run smoke:superskill
npm run smoke:superskill-exact-release
```

`smoke:superskill` запускать два раза подряд после первого approval.
`smoke:superskill-exact-release` по умолчанию не вызывает модели и проверяет exact archive
и полный adapter lifecycle в ephemeral bootstrap overlay. Opt-in client evidence запускается
отдельно командами `smoke:superskill-exact-release:claude` и
`smoke:superskill-exact-release:codex`; pass требует actual skill discovery, exact state и
ordered unique managed event chain, а не текстовый ответ модели. Команда
`smoke:superskill-exact-release:evidence` запускает оба клиента и сохраняет sanitized JSON
только если оба pass; Codex использует временный `CODEX_HOME` с auth-only symlink, а оба
model subprocess получают явный environment allowlist и пустые временные npm user/global
configs. Claude pass требует наблюдаемый exact Skill tool-call без state-only fallback.

### Full repository gates

```bash
npm run check
npm run build
npm run smoke
```

### Production Chrome matrix

Проверить после deploy:

| Surface | Desktop | Mobile 390x844 |
|---|---:|---:|
| `/` и `#/superskill` | required | required |
| `#/superskill/install` | required | required |
| Docs | required | required |
| Agent guide | required | required |
| 12 selected details | required | representative + overflow sweep |
| 12 categories | required | representative + overflow sweep |
| approved trust page | required | required |
| approved install handoff | required | required |
| invalid capability/install/selected/hash | required | required |
| `www` redirect | required | required |

Также проверить:

- Chrome console без ошибок приложения;
- task text отсутствует в URL/storage/network payload;
- raw docs HTTP 200;
- CTA, back links, menu и copy controls keyboard-accessible;
- нет horizontal overflow на 320, 390, 768, 1440 px.

## 7. Commit и deploy порядок

Текущее состояние commits:

1. UX и canonical-domain baseline shipped commit
   `3bdb523f9cde57ba5025539cde58eaee74e7fea2`; evidence hardening и повторный deploy
   shipped commit `7290c5fe4c68975a9a075489ff46e9a4f4da261c`; low-risk pre-review tooling и четыре
   candidate cuts shipped commit `a554bd8`; research/data pre-review batch shipped
   commit `fcc1032`; operational/high-risk pre-review batch shipped commit `9068146`.
2. Pre-review tooling/release-cut commits могут публиковать только immutable candidate
   tuples и пустые review packets; они не должны создавать attestation, preview или
   activation handoff.
3. Commit `Approve first reviewed SuperSkill exact release` разрешён только после
   exact-release Claude/Codex evidence и человеческого sign-off.
4. Phase 6 публикуется отдельными risk-batch commits; один broken review не должен
   смешиваться с прошедшими resources.

Перед каждым следующим commit проверить staged diff и исключить unrelated dirty files.

Deploy:

1. push текущей ветки;
2. deploy стандартным production script;
3. API health + showroom approved/selected smoke;
4. проверить, что live asset/behavior соответствует новому `HEAD`, поскольку отдельного
   public build-SHA endpoint пока нет;
5. Chrome production matrix;
6. если approved/install regression — rollback deploy, не ослаблять trust gate.

## 8. Definition of done

- `Get SuperSkill` всегда открывает действующий generic install handoff.
- Docs и Agent guide открываются как HTML в Chrome и доступны на mobile.
- Raw agent documents продолжают отвечать 200.
- Все page routes имеют корректный `h1` и выход из error state.
- `www.superskill.sh` перенаправляется на apex.
- Первый exact release реально approved, а не переименован из candidate.
- Остальные resources сохраняют честный pending/blocked state до собственной review.
- Все targeted, full, SuperSkill и production Chrome gates зелёные.
- Документация, runtime, API и UI показывают одинаковое approval состояние.

## 9. Execution checkpoint — 2026-07-13

Выполнено локально:

- Phase 0–4 реализованы; generic install regression, HTML docs, agent guide, accessible
  mobile menu, heading/actions remediation и canonical `www.superskill.sh` redirect
  покрыты тестами;
- showroom verifier больше не предполагает `0 approved`: он выводит exact expectations
  из curated/index truth и проверяет approved/selected set, digest и handoff state;
- подготовлен sanitized immutable `deep-market-researcher@0.2.1`, старый `0.2.0`
  сохранён в history;
- attestation validation усилена: exact dual-client rows, unique case IDs, public-safe
  reviewer, bounded/fresh dates и обязательные limitation codes для warnings;
- declarative eval exception синхронизирован с canonical policy и защищён content-level
  fail-closed validator без изменения exact `0.2.1` digest;
- exact bootstrap activation smoke проходит полный adapter lifecycle для обоих target и
  подтверждает 12-file archive/digest без изменения checked-in trust data;
- реальные Codex CLI `0.135.0` и Claude Code `2.1.112` sessions прошли exact skill
  discovery, pinned lifecycle и обязательный ordered unique managed event chain; outcomes
  остались честно `unknown/unknown`;
- combined evidence сохранён в public-safe JSON с автоматической privacy-проверкой;
  report сохраняет `promotionAuthorized=false`, `attestationCreated=false` и
  `humanReviewEvidence=false`;
- подготовлен отдельный public-safe human-case packet с normal, ambiguous и adversarial
  outputs; verdict/reviewer/date поля намеренно пусты, packet не является attestation;
- `npm run check`, `npm run build`, два последовательных `npm run smoke:superskill` и
  `npm run smoke` прошли.
- все 12 selected resources подготовлены как immutable current `0.2.1` candidate cuts с
  сохранёнными `0.2.0` snapshots, dual-client evidence и отдельными human-case packets;
  human sign-off по-прежнему отсутствует.

Не выполнено и не должно имитироваться:

- все 12 current `0.2.1` остаются `candidate`; managed activation для них fail closed;
- по три case outputs на resource подготовлены, но ещё не проверены и не подписаны
  человеком;
- review attestation и смена `status` на `approved` запрещены до получения этого
  evidence. Текущая ожидаемая production матрица остаётся `0 approved / 12 selected`.
