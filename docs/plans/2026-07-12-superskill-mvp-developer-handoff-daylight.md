# SuperSkill MVP — developer handoff с Daylight Design System

Дата: 2026-07-12
Статус: **IMPLEMENTATION HANDOFF**
Исполнитель: следующий coding agent
Цель: реализовать SuperSkill MVP поверх OnlyHarness и подключить приложенную дизайн-
систему **Daylight v1.0** без расхождения с trust/security/runtime контрактами.

## 0. Задание агенту

Работай до проверенного результата, не останавливайся на новом плане.

1. Иди по каноническому backlog `docs/plans/superskill-mvp/06-execution-backlog.md`.
2. Сохраняй legacy API/CLI/skins аддитивно.
3. Реализуй backend/CLI/plugin contracts до подключения живых web actions.
4. Реализуй новый web skin `superskill` по Daylight v1.0.
5. Не копируй демонстрационные цифры/claims из HTML reference как реальные данные.
6. После каждого PR запускай его scoped tests; перед handoff — полный check/smoke/build и
   реальные Claude Code + Codex CLI сценарии.
7. Не меняй money/workspace/bounty flows без прямой необходимости компиляции.
8. Не коммить и не удаляй текущие unrelated worktree changes.

## 1. Source of truth

При противоречии:

1. `docs/plans/2026-07-11-superskill-final-service-concept.md` — product intent.
2. `docs/plans/superskill-mvp/02-contracts-and-data-model.md` — exact runtime contracts.
3. `docs/plans/superskill-mvp/03-trust-routing-and-curation.md` — eligibility/ranking.
4. `docs/plans/superskill-mvp/04-client-integration-and-activation.md` — clients/lifecycle.
5. `docs/plans/superskill-mvp/06-execution-backlog.md` — канонический порядок PR.
6. Этот handoff — точный контракт интеграции Daylight UI в текущий frontend.
7. Design reference — pixel/style source, но не источник runtime facts.

Entry point всего MVP: `docs/plans/superskill-mvp/README.md`.

## 2. Design package

Папка:

```text
/Users/elvismusli/Downloads/Дизайн сервиса с вариантами/
```

### Авторитетные файлы

| Файл | Роль | SHA-256 |
|---|---|---|
| `SuperSkill Design System.dc.html` | tokens, components, states, page patterns | `8df861d09b0c5599cb5ab7c92162bae65aaaef6d9268076a85577b7187301767` |
| `SuperSkill Landing Themes.dc.html` | применённый landing, **theme=daylight** | `e2a23304ea567e6421a485e0f631157220be685a3c86862f7c2807309ca41ad2` |
| `SuperSkill DS Handoff.dc.html` | визуальный acceptance/build contract | `b1a69496c16a1a78c9693fd56e48b418f0e76556d7113505c6f9c8df712a9d8b` |
| `uploads/2026-07-11-superskill-ux-handoff.md` | UX semantics, flows, state matrix | `9f9fde008c004a34bc4a1735fbd9ed2824d0f5eff09b9cba22b1ee1cd93c821c` |

`SuperSkill Directions.dc.html` — exploration/history. Не реализовывать Signal, Passport,
Levitate, Trust Console или Swiss Showroom как дополнительные themes.

`support.js`, `<x-dc>`, `<sc-if>` и inline HTML styles — renderer дизайн-документа, не
production dependencies. Не копировать их в app bundle.

### Выбранное направление

- Theme: **Daylight v1.0**.
- Surface: тёплая бумага, светлые cards, ultramarine только для actions.
- Product UI brand: **SuperSkill**.
- Backend/domain/npm/CLI сохраняют **OnlyHarness / onlyharness**.
- Footer/provenance может писать `SuperSkill by OnlyHarness`.

## 3. Runtime truth всегда сильнее mockup copy

Reference HTML показывает anatomy и визуальную иерархию. Следующие данные в нём
демонстрационные и запрещены без live source:

- `2,140 releases scanned`, `0 unchecked`, `240 verified skills`;
- `12.8k installs`, `most installed`;
- `9/9`, конкретные scan dates/digests;
- `behavioral eval ✓`, SBOM или provenance pass;
- `38s`, token counts, outcome previews;
- Cursor compatibility;
- `superskill.sh/get`, пока маршрут реально не существует.

Правило: нет поля/доказательства в DTO — элемент скрывается или получает честный
`not run / unavailable / example`, а не fake value.

## 4. Обязательные product/runtime overrides дизайна

| Design reference | Реализация MVP |
|---|---|
| T1 silent/notify activation | Не включать. Internal MVP всегда требует explicit activation consent. T1 можно оставить story/test-only как future component. |
| Claude/Codex/Cursor | Живые clients: terminal Claude Code и Codex CLI. Cursor не показывать как supported; только `planned/unsupported`, если DTO это сообщает. |
| `Verified`/`Safe` | Использовать named checks, evidence level, date, limitations. Общий Safe/Verified badge запрещён. |
| `Outcome verified` | Показывать `Outcome agent-reported`, `Outcome user-confirmed` или `Unknown`. Agent report не превращать в verified business outcome. |
| Installed chain | Temporary и pinned отображаются по реальным state/pinState. Copy command/download не равны Installed/Detected/Loaded. |
| Permission delta | При `partial/unknown` прямо показывать неизвестный baseline; не называть candidate powers точным delta. |
| Catalog of many cards | Secondary showroom section only. Recommendation flow всегда one selected + максимум 2 collapsed alternatives. |
| Install action in web | Это handoff в существующий client, не web installation и не hosted execution. |
| Paid/per-call cards | Не входят в managed MVP и не должны появляться в Daylight managed catalog. |

## 5. Web/API boundary для internal alpha

Никогда не помещай `HH_SUPERSKILL_TOKEN` в browser bundle, localStorage, cookie, HTML,
query string или frontend environment variable. Он предназначен для CLI process.

### Public showroom read model

Чтобы Daylight showroom был живым, но не открывал managed execution, добавить отдельные
public read-only routes:

```text
GET /showroom/capabilities?limit=12&job=<optional-slug>
GET /showroom/capabilities/:id
```

Rules:

- list возвращает только current `approved` exact releases;
- detail может вернуть approved/quarantined/revoked для честной shared link;
- source — тот же generated managed index + revoke overlay;
- payload — public-safe `ManagedCapability` projection;
- не возвращать archive URL, `activationAllowed`, review filename, reviewer identity,
  raw findings, internal paths или tokens;
- никакого task input и recommendation на этих routes;
- `Cache-Control: public, max-age=60, stale-while-revalidate=300`;
- malformed/unknown ID → 404; invalid index → 503, legacy health остаётся green.

Protected routes `/recommendations`, exact release recheck и managed archive сохраняют
Bearer auth. Daylight browser их не вызывает в internal alpha.

### Task prompt на landing

В internal alpha prompt остаётся task-first, но submit делает client handoff:

1. task хранится только в React state текущей вкладки;
2. не помещается в URL, analytics, logs или localStorage;
3. пользователь выбирает Claude Code или Codex;
4. P5 показывает точную plugin install command;
5. отдельная кнопка копирует исходный task как plain text для вставки в client;
6. UI не утверждает, что recommendation уже выполнена.

Когда появится утверждённый public recommendation transport, `useRecommendations` можно
подключить без изменения компонентов. Не создавать browser proxy с internal token.

### Showroom preview data

Work preview разрешён только из checked-in reviewed fixture, связанного с exact digest:

```text
data/superskill/showroom-previews/<capability-id>.json
```

```ts
type ShowroomPreview = {
  schemaVersion: "superskill.showroom-preview.v1";
  capabilityId: string;
  artifactDigest: string;
  reviewCaseId: string;
  taskLabel: string;
  lines: string[];       // max 6, public/synthetic fixture only
  outcomeLabel: string;
  reviewedAt: string;
};
```

Build включает preview только при exact digest match. Для Stage A достаточно 3–6
featured previews. Нет preview — card работает без terminal/demo slot.

## 6. Frontend architecture

Не переписывать `win98`, `modern`, `fans` и shared legacy surfaces. Добавить новый
изолированный skin.

### New files

```text
apps/registry-web/src/core/superskill-types.ts
apps/registry-web/src/core/useShowroomCapabilities.ts
apps/registry-web/src/core/useShowroomCapability.ts
apps/registry-web/src/core/useRecommendations.ts          # PR-12, future transport-ready
apps/registry-web/src/core/useCapabilityDetail.ts         # protected/internal use
apps/registry-web/src/core/superskill-route.ts
apps/registry-web/src/core/superskill-install.ts
apps/registry-web/src/generated/superskill-runtime.ts

apps/registry-web/src/skins/superskill/
  index.tsx
  tokens.css
  motion.css
  primitives.tsx
  components/
    VerdictChip.tsx
    LifecycleChain.tsx
    PermissionDelta.tsx
    TrustReport.tsx
    SkillCard.tsx
    TaskPrompt.tsx
    ConsentPanel.tsx
    CopyField.tsx
    StatePanel.tsx
  pages/
    Landing.tsx
    TrustPage.tsx
    InstallHandoff.tsx
    CategoryPage.tsx
  *.test.tsx
```

### Modified files

```text
apps/registry-web/src/skins/registry.ts
apps/registry-web/src/skins/SkinProvider.tsx
apps/registry-web/src/skins/SkinProvider.test.tsx
apps/registry-web/src/skins/skin-switcher.css
apps/registry-web/src/core/types.ts                    # only browser-safe SuperSkill DTOs
apps/registry-web/public/AGENTS.md
apps/registry-web/public/llms.txt
scripts/check-public-copy.ts
```

### Skin behavior

- Add `SkinId = "superskill"`.
- Make it default only after PR-13 acceptance and live public showroom smoke.
- Preserve old skins via `?skin=win98|modern|fans` for regression/debug.
- Hide `GlobalSkinSwitcher` in production by default.
- Show it only when `VITE_ENABLE_SKIN_SWITCHER=true`.
- New skin consumes headless hooks directly and is not coupled to legacy `WinKind`.
- Use hash routes to preserve current static deploy behavior:
  - `#/superskill` — landing;
  - `#/superskill/c/:id` — trust page;
  - `#/superskill/c/:id/install` — install handoff;
  - `#/superskill/tasks/:job` — category.

Do not add React Router for four routes. `superskill-route.ts` owns parse/build helpers,
history/hashchange subscription and tests.

### Runtime version sync

`plugins/superskill/runtime.json` is source of truth for concrete CLI version. Add a
generator/check that produces:

```ts
// generated; do not edit
export const superskillRuntime = {
  cliPackage: "onlyharness",
  cliVersion: "<exact published version>",
  activationContractVersion: "superskill.activation.v1"
} as const;
```

Web install commands must use this generated value, never `latest`.

## 7. Daylight tokens

Implement as CSS custom properties under `.skin-superskill`; do not leak globally.

```css
.skin-superskill {
  --ss-paper: #f7f6f1;
  --ss-surface: #fffdf8;
  --ss-sunken: #f4f2ea;
  --ss-ink: #16150f;
  --ss-muted: #6f6d64;
  --ss-faint: #8a877b;
  --ss-border: #ddd9ca;
  --ss-border-soft: #eeeadd;
  --ss-action: #2f45ff;
  --ss-action-ink: #1e30d8;
  --ss-pass: #1d8a4a;
  --ss-warn: #a4620a;
  --ss-fail: #b4271f;
  --ss-r-chip: 8px;
  --ss-r-inset: 12px;
  --ss-r-card: 18px;
  --ss-r-hero: 22px;
  --ss-r-pill: 999px;
  --ss-shadow-rest: 0 2px 8px rgba(22, 21, 15, .04);
  --ss-shadow-hover: 0 14px 34px rgba(47, 69, 255, .16);
  --ss-content: 1180px;
}
```

Typography:

- UI/display: Archivo 400–900;
- evidence: JetBrains Mono 400/500/700;
- editorial accent only: Spectral italic;
- display: `clamp(42px, 6vw, 82px)`, weight 800, line-height .98;
- section h2: `clamp(28px, 3vw, 42px)`, weight 800;
- body: 14–20px;
- evidence: 10–13px monospace.

For first implementation reuse the exact Google Fonts URL from reference, loaded once
idempotently like existing skins. Do not block MVP on font self-hosting.

Motion:

- `ssSpin 7s`, `ssScan 3.2s`, `ssMarquee`, `ssFloat 15s`, `ssBlink 1.1s`;
- motion is decoration only;
- all animations disabled under `prefers-reduced-motion: reduce`;
- no motion on T3/blocked/error controls.

## 8. Component contracts

### `VerdictChip`

Inputs: verdict, named-check count, label. Always glyph + text + color. A green dot alone
is invalid. `pass/warn/fail/quarantined/revoked/not_scanned` are exhaustive.

### `LifecycleChain`

Inputs come from actual activation/pin record. Trust verdict never appears in the same
row. Temporary mode does not fabricate `Installed`; pinned state does not fabricate
`Loaded`.

### `PermissionDelta`

Sections: new powers, already known, unknown baseline. Each power uses human consequence
copy and `low/elevated/critical`. Empty delta has explicit positive state.

### `TrustReport`

Order:

1. verdict + release + full copyable digest;
2. named checks table;
3. declared vs static observations;
4. permissions;
5. mandatory limitations;
6. compatibility;
7. release/revoke history if present.

No total score. `not_run` remains visible. Never render raw finding excerpts.

### `SkillCard`

Variants: featured, compact, installed. States: default/loading/warn/quarantined/revoked.
Anatomy follows reference, but each optional slot disappears cleanly when data is absent.
Whole card is not the install button; actions remain explicit keyboard-focusable controls.

### `ConsentPanel`

Live MVP supports T2 and T3 only. T3 confirmation is never auto-focused and requires the
explicit text/checkbox described by exact policy. Web panel explains what will happen in
client; it does not perform activation.

### `CopyField`

Digest/command/task copy in one action. Announce success through an `aria-live` region.
Never change lifecycle state merely because copy succeeded.

## 9. Page contracts

### Landing

Desktop order:

1. compact nav;
2. task-first hero;
3. exact client handoff prompt;
4. one real featured approved capability from showroom API;
5. secondary `Watch skills work before you install` section, max 6 cards;
6. named-check explanation;
7. footer/provenance.

No leaderboard/social stats unless real and clearly sourced. No signup wall before trust
content.

States: loading skeleton, approved data, empty approved catalog, API unavailable. Empty
state keeps install/client handoff usable.

### Trust page

Mobile-first share unit. Always render exact release/digest/status from API. Install
handoff stays reachable but disabled for quarantined/revoked. Mandatory limitations are
never collapsed away.

States: pass, warn, quarantined, revoked, loading, not found, catalog unavailable.

### Install handoff

Client choices: Claude Code and Codex only.

Per client:

1. marketplace add command;
2. plugin add/install command;
3. explanation of what new task/session is required;
4. copy task action;
5. fallback manual steps.

Copying a command displays `Copied`, not `Installed`. No deep-link success claim without
client receipt.

### Category

P1 after landing/trust/handoff. Show 3–7 curated resources from public showroom DTO.
Mark one `recommended` only when server supplies task/routing evidence; otherwise label
all as curated, not ranked.

## 10. Responsive contract

Reference HTML is fixed at 1440/1600px and is not responsive source code. Recreate its
visual hierarchy semantically.

Breakpoints:

- `>=1200`: max-width 1180, 3-column/bento catalog;
- `768–1199`: 2 columns, hero type via clamp;
- `<768`: one column, condensed nav, sticky bottom install action on trust page;
- `<480`: evidence tables become labelled rows, never horizontal clipped tables.

Required QA viewports:

```text
1440×900
1024×768
768×1024
390×844
360×800
```

No horizontal page scroll at any viewport. Digest may wrap/break safely; commands use a
scrollable/copyable field without forcing page width.

## 11. Accessibility and content

- WCAG 2.2 AA.
- Full keyboard navigation and visible `:focus-visible`.
- Verdict/state always glyph + label + color.
- `aria-live=polite` for loading/copy/status; critical revoke uses assertive announcement.
- T3 confirm not auto-focused.
- Motion honors reduced-motion.
- Heading order is semantic; cards use `article` and real buttons/links.
- English-first, but no text baked into images/pseudo-elements.
- Ban: `Safe`, `guaranteed`, `100%`, lone `Verified`, generic `Something went wrong`.
- Error always includes reason and next action.

## 12. Implementation sequence

Follow PR-00 through PR-12 unchanged. Daylight is a separate PR-13 after headless
contracts exist; it does not block CLI/plugin Stage A.

### PR-13A — public showroom projection + fixtures

- public read-only routes;
- exact preview schema/digest binding;
- showroom hooks and route parser;
- runtime version generator/check;
- API/web tests.

### PR-13B — tokens, primitives, skin shell

- `superskill` skin registration;
- Daylight tokens/fonts/motion;
- primitives and component state tests;
- old skins untouched and still reachable.

### PR-13C — landing, trust page, install handoff

- real DTO wiring;
- no fake fields;
- all state/error/blocked variants;
- responsive implementation.

### PR-13D — default switch and acceptance

- visual QA at required viewports;
- accessibility/keyboard/reduced-motion checks;
- `superskill` becomes default;
- production switcher hidden;
- live public showroom read smoke;
- public docs updated.

## 13. Tests

Add at minimum:

- DTO mapping: missing optional evidence never becomes pass;
- verdict/lifecycle exhaustiveness;
- partial/unknown permission baseline;
- revoked/quarantined disables install handoff;
- copy command does not set installed/loaded state;
- no token/task content in browser storage, URL or event body;
- real runtime version appears in both client commands;
- router parse/build round-trip;
- loading/empty/error/blocked for each page;
- keyboard activation and T3 initial focus;
- old skin query routes still mount;
- production switcher flag off by default.

Do not snapshot entire pages as the only test. Assert product states/labels first; visual
screenshots are acceptance evidence, not runtime truth.

## 14. Verification

Per web PR:

```bash
npm run typecheck -w @harnesshub/registry-web
npm test -w @harnesshub/registry-web
npm run build -w @harnesshub/registry-web
git diff --check
```

Before merge/default switch:

```bash
npm run check
npm run smoke
npm run smoke:superskill
npm run build
```

Browser acceptance:

1. Landing loads real approved items or honest empty/error state.
2. Task never appears in URL/storage/network events.
3. Trust shared link works at 390px and 1440px.
4. Warn/quarantined/revoked are distinguishable without color.
5. Install handoff uses exact published CLI/plugin commands for both clients.
6. Copy action reports copy only.
7. Old `?skin=win98`, `modern`, `fans` still render.
8. Reduced motion disables decorative animations.

Save final evidence under:

```text
docs/evidence/superskill-ui/<date>/
  README.md
  landing-1440.png
  landing-390.png
  trust-pass-390.png
  trust-revoked-390.png
  install-claude-1440.png
  install-codex-1440.png
```

## 15. Definition of Done

- Claude Code and Codex CLI managed flows pass end to end.
- Daylight is the default production skin only after live data smoke.
- No invented metrics, trust checks, compatibility or outcomes.
- Public showroom routes cannot download/activate and expose no internal data.
- Protected recommendation/archive routes still require internal Bearer token.
- One recommendation remains primary; catalog is secondary.
- Trust is exact digest + named checks + limitations.
- Lifecycle states remain separate and honest.
- User can always remove/exit safely.
- All checks/build/smokes pass twice where required by the MVP rollout spec.
- Final handoff includes changed files, commands, runtime evidence and remaining rollout
  risks; “code complete” is not enough without browser and client proof.

## 16. Agent-first browser auth rollout addendum — 2026-07-14

This section is the current implementation truth for the transition release series.

### Implemented

- `superskill_local` owns interactive authorization, protected publish/workspace calls and
  exact same-task retry. Public search/detail/archive remain anonymous.
- Durable service-only agent requests, 30-day sessions, opaque ten-minute access tokens,
  rotating refresh tokens, consent, replay/reuse detection and immediate revocation are
  defined by `20260714170000_agent_first_auth.sql`.
- `/auth/agent/start`, `browser-bind`, `context`, `decision`, `token`, `refresh` and `revoke`
  use independent proofs. Browser proof is bound from the URL fragment, scrubbed with
  `history.replaceState`, then represented only by an HttpOnly cookie.
- The local CLI uses the OS keychain for refresh credentials, memory-only access tokens and
  an explicit `session_only` fallback without plaintext credential files.
- The Daylight Connect page supports Google, GitHub and email/password, preserves pending
  connect through confirmation and always requires explicit Continue approval.
- A unified principal resolves browser JWT, agent access token, transition device token and
  existing workspace/org automation credentials without substituting client identity for a
  real user id.
- Protected mutations preserve one `Idempotency-Key` across authorization and retry. Exact
  replay returns the original receipt; payload drift returns 409; an indeterminate crash
  window remains fail-closed and never re-executes the mutation automatically.
- `onlyharness@0.3.1` is the transition hotfix candidate. It keeps the `0.3.0` auth broker and
  adds anonymous, redirect-blocked native-harness installation bound to exact version,
  digest, complete immutable snapshot, current passing `static-v2` scan and full manifest
  equivalence. Public projections no longer expose the unbound legacy `hh install` command.

### Rollout state

- Supabase migration is applied and service-only RPC access was verified.
- Production is dark-deployed with `SUPERSKILL_AGENT_AUTH_ENABLED=false`; public reads and
  the universal installer remain available.
- `/.well-known/oauth-authorization-server` remains 404. Native `/mcp/account` OAuth is a
  later stage and must not be advertised before clean Codex and Claude compatibility proof.
- Public enablement is **NO-GO** until production Google and GitHub Supabase providers are
  configured by the account owner, both browser flows pass, and two consecutive clean-user
  Codex and Claude journeys pass. Email is enabled but is not sufficient for GO.
- The hidden legacy device flow remains transition-only. It must not appear in the website,
  universal skill or public docs, and is removed in `0.4.0` only after the observation gates
  in the agent-first auth rollout are satisfied.
