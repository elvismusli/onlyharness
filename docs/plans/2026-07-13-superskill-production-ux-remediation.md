# SuperSkill production UX remediation plan

Дата: 2026-07-13
Статус: **IMPLEMENTATION IN PROGRESS — UX READY, APPROVAL GATE OPEN**
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

## 2. Подтверждённый production baseline

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

### Требует обработки

| Приоритет | Проблема | Production evidence |
|---|---|---|
| P1 | `Docs` и `Agent guide` открывают raw files, которые в текущем Chrome блокируются с `ERR_BLOCKED_BY_CLIENT` | сервер отвечает 200, но пользовательская навигация сломана |
| P2 | mobile скрывает Docs и Agent guide без menu replacement | при 390 px видны только brand и `Get SuperSkill` |
| P2 | capability/install not-found copy предлагает вернуться, но не даёт ссылки | `#/superskill/c/<missing>` и `/install` не содержат action link |
| P3 | category и часть error pages начинаются с `h2` | page-level `h1` отсутствует |
| P3 | `www.superskill.sh` отдаёт копию сайта без redirect | duplicate public origin |
| Rollout gate | 12 selected / 0 approved | managed install честно заблокирован для всех кандидатов |

### Закрыто после исходного Chrome review

- `Get SuperSkill` больше не считается открытым P1: `HEAD=c61f18b`, `origin/main`
  указывает на тот же commit, generic route `#/superskill/install` закоммичен, а текущий
  production lazy bundle содержит и route, и CTA href.
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

Проверено после внешнего review плана:

- `HEAD=c61f18b84158f44d9d7e27f234b225008b8ad74a`;
- `origin/main` указывает на тот же commit;
- `apps/registry-web/**` не содержит dirty changes;
- generic install route, CTA и optional `capabilityId` уже закоммичены;
- production asset содержит `#/superskill/install`, `Get SuperSkill` с этим href и
  актуальную b2a/Daylight font configuration;
- незакоммиченные изменения находятся в docs/research/output и не относятся к текущему
  frontend remediation scope.

Следствие: generic install нельзя планировать как отсутствующую фичу. Это уже shipped
behavior, которое нужно защитить тестами и повторно проверять после следующих deploy.

Отдельного публичного build-SHA endpoint сейчас нет. Сопоставление production с `HEAD`
опирается на asset content и live behavior. Добавление commit SHA в public health не входит
в этот UX scope; при необходимости это отдельный observability task без раскрытия секретов.

## 5. План реализации

### Phase 0 — зафиксировать repo/live baseline и защитить worktree

1. Снять `git status --short`, `git rev-parse HEAD` и `git rev-parse origin/main`.
2. Подтвердить, что relevant frontend files чистые до начала изменений.
3. Сверить live route/asset behavior с `HEAD`; не считать старый Chrome screenshot
   доказательством текущего production состояния.
4. Отделить UX-remediation files от несвязанных docs/research/output changes.
5. Не удалять и не откатывать пользовательские файлы.
6. Зафиксировать production baseline в тестовой матрице этого документа.

Критерий: repo SHA, origin SHA и live behavior сверены; список remediation-файлов
известен; unrelated changes не попадают в commit.

### Phase 1 — regression coverage для shipped `Get SuperSkill`

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

### Phase 2 — HTML Docs, Agent guide и mobile navigation

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

### Phase 3 — убрать dead ends и исправить semantics

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

### Phase 4 — canonical domain

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

### Phase 5 — первый настоящий approved exact release

Рекомендуемый первый кандидат: `deep-market-researcher` — простой read/research scope,
нет money movement или external send actions, уже есть понятный `market-research` route.

#### Обязательный pre-review release cut

Проверка текущих snapshots показала, что `deep-market-researcher@0.2.0` и остальные 11
кандидатов нельзя честно перевести в approved при текущей instruction-only policy:

- каждый snapshot содержит executable `.gitea/workflows/harness-ci.yml`;
- каждый snapshot содержит обязательный `evals/promptfooconfig.yaml`, но текущий
  `assertInstructionOnly` разрешает только `evals/cases/**`;
- у `deep-market-researcher@0.2.0` static scan/capability diff имеет `warn`: shell signal
  из local runbook и filesystem signal из CI workflow;
- текущие declared eval scores (`0.88`) проходят local gate, но не являются independent
  quality или human-review evidence.

Поэтому review нельзя проводить против `0.2.0` с последующим silent mutation. Сначала:

1. выпустить новый immutable version (начать с `0.2.1`);
2. исключить executable CI workflow из managed source snapshot;
3. отдельно threat-review-нуть и разрешить только точный declarative path
   `evals/promptfooconfig.yaml` либо изменить manifest/package contract так, чтобы
   approved archive оставался полным без расширения allowlist;
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

### Phase 6 — обработать оставшиеся 11 selected skills

Не делать один массовый approval commit. Работать batch-ами по риску:

1. **Low-risk read/advice:** founder-decision-memo, product-strategy-critic,
   launch-readiness-reviewer, repo-truth-auditor.
2. **Research/data:** gtm-research-sprint, data-quality-sentinel,
   agent-harness-refactorer.
3. **Operational/high-risk:** support-triage-agent, incident-rca-commander,
   security-permission-auditor, finance-payment-safety-reviewer.

Для каждого resource повторить Phase 5 с отдельной attestation и exact digest. Для
high-risk группы cases обязательно проверяют запрет side effects; payment reviewer не
может отправлять платежи, делать refund или менять ledger.

Batch acceptance:

- один broken resource не блокирует review остальных;
- approval count растёт только после реального evidence;
- revoked/quarantined/stale state немедленно убирает managed activation;
- после каждого batch обновляются review log и production smoke expectations.

## 6. Тесты и verification gates

### Targeted frontend

```bash
npm run typecheck -w @harnesshub/registry-web
npm test -w @harnesshub/registry-web
npm run check:public-copy
npm run check:superskill-runtime
```

`check:superskill-runtime` по умолчанию является read-only verification: он сравнивает
generated TypeScript с `plugins/superskill/runtime.json` и падает при рассинхроне. Запись
происходит только при явном запуске generator с `--write`; в verification gates `--write`
не использовать.

Обязательные новые tests:

- generic install route parse/build/reload;
- global header CTA → generic install from landing/detail/category contexts;
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
```

`smoke:superskill` запускать два раза подряд после первого approval.

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

Рекомендуемые атомарные commits:

1. `Cover SuperSkill generic install navigation`
2. `Add SuperSkill HTML docs and accessible mobile navigation`
3. `Fix SuperSkill state actions and page semantics`
4. `Canonicalize superskill.sh production domain`
5. `Approve first reviewed SuperSkill exact release`

Перед каждым commit проверить staged diff и исключить unrelated dirty files.

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
- `npm run check`, `npm run build`, два последовательных `npm run smoke:superskill` и
  `npm run smoke` прошли.

Не выполнено и не должно имитироваться:

- `0.2.1` остаётся `candidate`; managed activation для него fail closed;
- exact-release Claude/Codex managed activation и три human-reviewed cases ещё не
  подписаны человеком;
- review attestation и смена `status` на `approved` запрещены до получения этого
  evidence. Текущая ожидаемая production матрица остаётся `0 approved / 12 selected`.
