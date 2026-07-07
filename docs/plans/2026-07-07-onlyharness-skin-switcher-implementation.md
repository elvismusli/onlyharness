# OnlyHarness Multi-Skin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship one OnlyHarness product with three interchangeable, full-featured
skins (🪟 W98 · 🖥 Modern · 💙 Fans) on a shared, skin-agnostic core, with an
always-visible switcher and context-preserving switching.

**Architecture:** Extract all data/logic out of the Win98 `App()` in `main.tsx`
into a `core/` layer of hooks + a `HarnessStore` context + a skin-neutral
navigation model (`useAppNav`, a "surface stack"). The current Win98 render
becomes `skins/win98/`, a renderer of that surface stack. Two new skins
(`skins/modern/`, `skins/fans/`) render the same core in their own idiom. A
`SkinProvider` resolves the active skin (default **W98**) and a `SkinSwitcher`
lets the user swap live.

**Tech Stack:** React 19 + Vite 7 + TypeScript 5.8, `@supabase/supabase-js`,
Fastify API (`VITE_HARNESS_API_URL`). Tests: Vitest + Testing Library + jsdom
(added in Task 0.1).

**Companion design doc:** `docs/plans/2026-07-07-onlyharness-skin-switcher-design.md`
(architecture, tokens, decisions). Read it first.

---

## How to use this plan

- **Phase 0 is fully task-decomposed and TDD-first** — it is the risky,
  precise refactor; execute it exactly, one task per commit.
- **Phases 1–3 are screen-level tasks.** Each names its files, the core hooks
  it consumes, a concrete **design spec** (from §Design additions), and its
  verification. Visual components are verified by `typecheck` + `build` +
  preview (screenshot/inspect), not unit tests — only pure logic gets unit
  tests. This is a deliberate adaptation of TDD for a re-skin: the logic under
  test already lives in the core hooks (Phase 0), so skins are thin render.
- **DRY / YAGNI / frequent commits.** One task = one commit.
- **Serious-stays-serious rule (product constraint):** money (checkout),
  permissions/org, and security/review surfaces carry **no parody** in any
  skin. Modern and Fans render these through **one shared neutral component**
  (see §Design additions C). This is the assumed default; if full bespoke Fans
  art is wanted for those, expand Tasks 2.9–2.11 accordingly.

## Verification strategy (run per task)

| Check | Command | When |
|---|---|---|
| Types | `npm run typecheck -w @harnesshub/registry-web` | every task |
| Unit tests | `npm run test -w @harnesshub/registry-web` | logic tasks |
| Build | `npm run build -w @harnesshub/registry-web` | end of each phase |
| App runs | preview server + `preview_snapshot` / `preview_screenshot` | UI tasks |
| Repo check | `npm run check` (root) | before finishing branch |

`npm run check` (root) already runs `test --workspaces --if-present`, so adding a
`test` script to the web workspace (Task 0.1) wires unit tests into repo CI
automatically.

---

## Target file layout

```
apps/registry-web/src/
  core/
    supabase.ts        supabase client + env
    constants.ts       apiUrl, JOB_FILTERS, install commands, remixRecipe
    url.ts             pure deep-link parse/build fns  (tested)
    types.ts           (moved from src/types.ts)
    format.ts          (moved)   compat.ts (moved)
    useClipboard.ts    useAuth.ts  useRegistry.ts  useSocial.ts
    usePublish.ts      useStorefront.ts  useOrgWorkspace.ts
    useAppNav.ts       skin-neutral surface stack + intents + deep-link
    store.tsx          <HarnessStore> provider + useHarness()
  skins/
    registry.ts        skin list {id,label,icon,mount}
    SkinProvider.tsx   resolves active skin (default win98) + persistence
    SkinSwitcher.tsx   headless switcher; each skin styles its own render
    win98/             current render moves here (wm + views + chrome + css)
    modern/            new
    fans/              new
  main.tsx             thin: mount <SkinProvider><ActiveSkin/></SkinProvider>
```

## Refactor map (source of truth: main.tsx line refs)

`CORE` → `core/` hook · `WM` → `skins/win98/wm` · `CHROME` → `skins/win98/` chrome.

| Concern | main.tsx lines | Destination |
|---|---|---|
| Registry/resources/leaderboard/detail state + 3 fetch effects + derived (271–304) | 41–53, 117–165, 271–304, 453–482 | `core/useRegistry.ts` |
| Star/remix/thread/run/events | 56–61, 622–733, 355–370 | `core/useSocial.ts` |
| Supabase session + auth handlers + user-stars/storefront effects | 64–74, 110–115, 167–211, 769–830, 372–377 | `core/useAuth.ts` |
| Publish import | 77–80, 735–765 | `core/usePublish.ts` |
| Storefront cache + editor + save | 48, 68–74, 469–482, 560–602 | `core/useStorefront.ts` |
| Org workspace | 83–87, 484–510, 463–467 | `core/useOrgWorkspace.ts` |
| Clipboard + fallback | 98, 308–353 | `core/useClipboard.ts` |
| Deep-link pure fns + intent effect | 102,106, 218–267, 1209–1262, 419–440 | `core/url.ts` + `core/useAppNav.ts` |
| Constants + supabase client | 14–21 | `core/constants.ts`, `core/supabase.ts` |
| Window manager (wins/stack/openWin/renderWinBody/winMeta/taskEntries) | 90–94, 385–449, 841–1045, 23–35 | `skins/win98/wm/` |
| Desktop chrome (Taskbar/StartMenu/DesktopIcons/Mascot/Paint/Award/Dialog) | 1049–1199 | `skins/win98/` |

**Key coupling to break:** the `open*` actions (`openHarness` 512, `openStorefront`
543, `openInstall` 604, `openMyBriefcase` 550, `openReview` 902, `submitImport`→
`closeWin` 735, `remixHarness`→`openHarness` 647) mix **core data-load** with
**`openWin`/`closeWin`**. Split each: core does load/cache/hash and calls
`nav.openX(key)` (pushes a surface intent); the skin's renderer turns surfaces
into windows (W98) or routed pages (Modern/Fans).

---

## The navigation model (`useAppNav`) — read before Phase 0

Core owns a **surface stack** — skin-neutral, replaces the WM state:

```ts
type Surface = { id: string; kind: WinKind; key?: string; tab?: DetailTab };
// state: surfaces: Surface[]  (order = history/taskbar) ; activeId: string
// intents (push-or-reuse a surface, set activeId, write deep-link hash):
openHarness(item, tab?) · openResource(item) · openInstall(item) · openCheckout(key)
openPublish() · openCli(item) · openReview(item) · openLeaderboard()
openStorefront(handle) · openProfile() · openNetwork() · openShare(item)
close(id) · focus(id) · setTab(id, tab)
```

- **W98** renders **all** surfaces as `FloatWindow`s (adds its own `x/y/minimized/
  z` view-state layered on top of the stack) — identical to today.
- **Modern / Fans** render the **active** surface as a routed page/section, with
  the rest as back-history.
- Deep-link (`core/url.ts`) parses a route → emits the matching intent; the same
  `#/h/owner/name`, `#/@handle`, `/checkout?…`, `?ref=` scheme is preserved, and
  `?skin=` is added in Phase 3.
- **Context-preserving switch** falls out for free: the surface stack lives in
  core, so swapping skins keeps `surfaces` + `activeId`.

---

# DESIGN ADDITIONS — screens missing from the handoffs

Handoffs cover only **Modern Explore** and the **Fans landing hero**. Every
other product surface (11 window kinds + 7 detail tabs + auth) must be designed
for the two new skins. Tokens below are from the handoff READMEs.

**Modern tokens:** canvas `#0a0a0b`, surface `#111114`, elevated `#141417`,
hairline `#212127`, hover `#33333c`, accent `#ff6b35`, text `#e7e7ea`, muted
`#a1a1aa`, faint `#71717a`, eval-green `#4ade80`, star-gold `#ffd28a`. Fonts:
Space Grotesk (display) / Inter (UI) / JetBrains Mono (technical). Radii ladder
6/8-10/11-12/14/16. **Borders, not shadows.**

**Fans tokens:** brand `#00aff0`, hover `#0090d0`, wash `#e9f8ff`, tint `#f6fbfe`,
ink `#0a1721`, body `#4a5a67`, hairline `#eef1f4`, eval-green `#16b364`. Font:
Nunito (900/800/700/600) + JetBrains Mono for `@handles`/CLI. Radii: 999px pills,
12 inputs, 20-22 cards, 50% avatars. Soft **blue-tinted** shadows.

## A. Playful surfaces — lean into each skin

### Harness Detail (tabs: Overview/Install/Trust/Try sample/Thread/Files/Versions)
- **🖥 Modern:** two-column detail route. **Left** = tabbed content (tabs as a
  hairline pill row): Overview (cleaned README + numbered workflow stages +
  "works best for" chips), Install (mono `<pre>` command block + target chips +
  Copy), Trust (3 boxes: safe-to-inspect / works-in-setup / better-than-alts —
  eval cases table, risk tier, permissions), Try (input/expected `<pre>` panes +
  Preview button + browser-only disclaimer), Thread (composer w/ kind select +
  post list), Files (icon-by-ext list + repo link), Versions (archive list +
  pull commands). **Right** = sticky trust panel: ★/⑂/💬/✓ stats, Harness Heat
  meter, InfoLines (version/verified/source/eval/risk/runtime/context/gate/perms),
  buttons [Install][Copy CLI][Star][Remix][Share]. Surface `#111114`, hairline
  borders, accent only on primary action. Directory mode → link-only Overview,
  no Try/Install-loop.
- **💙 Fans:** "creator profile" page. Header: big round avatar (`iconBg`),
  title, `@handle` (mono blue), **Subscribe** pill (`$0/mo`), heat/forks/eval
  stat-row. Tabs as a rounded segmented control; Thread = "fan wall"; trust info
  as a friendly light-blue "verified creator" card. Nunito, 20-22px cards.

### Leaderboard (Wild West seasonal)
- **🖥 Modern:** ranked table, per-row heat bar + ▲/▼ delta, `#1` accent, ISO-week
  header, heat-formula footnote.
- **💙 Fans:** "Top creators this week" — podium cards (the landing already has a
  🏆 badge), blue, playful.

### Share card ("harness_flex.exe")
- **🖥 Modern:** dark OG-style card (matches `og.png`): WordArt title, 5 stats,
  giant Harness-Heat number + trend, badge; [Copy brag][Copy link].
- **💙 Fans:** blue "look at my harness 🤠" flex card — most on-brand surface.

### Publish (import markdown → harness)
- **🖥 Modern:** centered modal card: name input, mono textarea, "what gets
  created" checklist, [Publish] accent (or [Log on to publish]) + status line.
- **💙 Fans:** friendly "Start your harness" (CTA already in landing), rounded.

### Storefront + Profile editor
- **🖥 Modern:** profile page (avatar/handle/bio/published-grid/totals) + editor
  form modal (handle/display-name/bio + rules) + ref-link box.
- **💙 Fans:** this **is** the Fans core metaphor — creator storefront with
  Subscribe, "supporters", published harnesses as a feed.

### Explore (finish the two skins)
- **🖥 Modern:** already in handoff — build as-drawn (hero, filter chips, 3-col
  card grid, CLI strip). **Add** the resource-catalog tabs (All/Skills/Plugins/
  Workflows/MCP/Runtimes/Guides/Harnesses) + `ResourceCard` variant.
- **💙 Fans:** landing hero (as drawn) **then** a full "creators" feed below with
  the same filter chips + sort + resource tabs.

### Collections (in concept, drawn nowhere) — OPTIONAL / Phase 3+
- Modern: bundle index + collection grid. Fans: "playlists" of creators. Deferred
  (YAGNI) unless prioritized.

## B. Card vocabulary (both new skins read the same `RegistryItem`)
Modern & Fans each need a `HarnessCard` and a `ResourceCard`. Field mapping is in
the design doc §7. "Subscribe" (Fans) = the existing star/install action
relabeled; `$0/mo` is cosmetic (free) for v1.

## C. Serious / power surfaces — ONE shared neutral component per surface
Rendered inside either skin's chrome, no parody. Build once, reuse in Modern &
Fans (this is the assumed reuse decision):
- **Checkout** — price, what-you-get, manual-checkout next steps, [Continue];
  keeps `core/useCheckout` fetch (`POST /billing/checkout`) + receipt curl.
- **Trust/Review** — eval-cases table, security findings, risk tier; maintainer
  PR-review markdown + risk-diff. Green eval, amber/red severities.
- **Network/Org** — permissions matrix, risk-tier breakdown, audit-log table,
  connect form. Power/admin surface.
- **Install/CLI** — terminal card (traffic lights, mono `oh pull/run`, copy,
  adapter chips). Modern styles the frame; Fans wraps it in a rounded sheet.
- **Auth** — Fans hero sign-up card already drawn; Modern gets an equivalent
  dark modal. Both bind the documented `LogonDialog` contract (onSignIn/onSignUp/
  onResendConfirmation/onClose + note/status/busy/configured).

---

# PHASE 0 — Core extraction + skin infrastructure (no visual change)

**Exit criteria:** the site renders **pixel-identical** W98, all flows work
(star/remix/thread/publish/auth/install/checkout/org/deep-link), `typecheck` +
`build` pass, unit tests green. Only after this do skins get added.

### Task 0.1 — Add the Vitest test harness

**Files:**
- Modify: `apps/registry-web/package.json` (devDeps + scripts)
- Modify: `apps/registry-web/vite.config.ts`
- Create: `apps/registry-web/src/core/url.test.ts` (placeholder to prove wiring)

**Step 1 — install:**
```bash
npm i -D -w @harnesshub/registry-web vitest @testing-library/react @testing-library/jest-dom jsdom
```
**Step 2 — scripts** in `apps/registry-web/package.json`:
```json
"test": "vitest run",
"test:watch": "vitest"
```
**Step 3 — vite.config.ts** add:
```ts
/// <reference types="vitest" />
// in defineConfig: test: { environment: "jsdom", globals: true }
```
**Step 4 — smoke test** `src/core/url.test.ts`:
```ts
import { expect, test } from "vitest";
test("vitest wired", () => { expect(1 + 1).toBe(2); });
```
**Step 5 — verify:** `npm run test -w @harnesshub/registry-web` → PASS.
**Step 6 — commit:** `chore(web): add vitest harness`.

### Task 0.2 — Create `core/` and move neutral modules

**Files:** move `src/types.ts`→`src/core/types.ts`, `src/format.ts`→`src/core/
format.ts`, `src/compat.ts`→`src/core/compat.ts`; create `src/core/constants.ts`,
`src/core/supabase.ts`.

**Steps:**
1. `git mv` the three files into `core/`. Update all imports (they are imported by
   main/explore/detail/windows/desktop) — change `./types`→`./core/types` etc.
   (from `skins/*` later it will be `../../core/types`).
2. `core/supabase.ts`: move lines 15–17 (env + `createClient`), export
   `supabase`, `supabaseUrl`, `supabaseAnonKey`.
3. `core/constants.ts`: move `apiUrl` (14), `JOB_FILTERS` (19),
   `CLAUDE_PLUGIN_INSTALL_COMMAND`/`CODEX_MCP_INSTALL_COMMAND` (20–21), and
   `remixRecipe` (1264–1286). Export all.
4. **Verify:** `npm run typecheck -w @harnesshub/registry-web` → clean.
**Commit:** `refactor(web): move neutral modules into core/`.

### Task 0.3 — `core/url.ts` (pure deep-link functions) — TDD

**Files:** Create `src/core/url.ts`, expand `src/core/url.test.ts`.

**Step 1 — write failing tests** for each pure fn (move from main.tsx 1209–1262):
```ts
import { parseHarnessHash, parseStorefrontHash, parseCheckoutLocation,
  keyForCheckout, refFromLocation } from "./url";
test("parseHarnessHash reads owner/name", () =>
  expect(parseHarnessHash("#/h/acme/deep-research")).toEqual({owner:"acme",name:"deep-research"}));
test("parseStorefrontHash strips @ and lowercases", () =>
  expect(parseStorefrontHash("#/@Neo")).toEqual({handle:"neo"}));
test("parseCheckoutLocation reads query", () =>
  expect(parseCheckoutLocation("/checkout","?owner=a&repo=b&version=1")).toMatchObject({owner:"a",repo:"b",version:"1"}));
test("keyForCheckout encodes", () =>
  expect(keyForCheckout({owner:"a",repo:"b",version:"1"})).toBe("a/b/1"));
test("refFromLocation finds ref in search or hash", () =>
  expect(refFromLocation("?ref=xyz","")).toBe("xyz"));
```
**Step 2 — run:** `npm run test -w @harnesshub/registry-web` → FAIL (no module).
**Step 3 — implement:** copy the 8 pure fns from main.tsx 1209–1262 into
`core/url.ts`; make them take explicit `hash`/`search`/`pathname` args instead of
touching `window` (so they are testable). Keep `setHarnessHash` writing
`history.replaceState`.
**Step 4 — run:** tests PASS.
**Step 5 — commit:** `refactor(web): extract pure deep-link url helpers + tests`.

### Task 0.4 — `core/useClipboard.ts`

**Files:** Create `src/core/useClipboard.ts`.
Extract 308–353 (`copyText`, `writeClipboard`, `copyWithSelection`, `markCopied`)
+ `copyFallback` state (98). Return `{ copyText, copiedTag, copyFallback,
dismissFallback }`. `flashMsg` stays out (belongs to skin toast) — accept an
optional `onFlash?(msg)` callback.
**Test:** unit-test `copiedTag` toggling with a fake timer.
**Verify:** typecheck. **Commit:** `refactor(web): extract useClipboard`.

### Task 0.5 — `core/useAuth.ts`

**Files:** Create `src/core/useAuth.ts`.
Move state 64–74 (session/logon/authStatus/authBusy/myHandle/myStorefront), effects
110–115 (bootstrap) and 167–211 (load-user-stars, load-my-storefront), handlers
769–830 (`signIn`/`resendConfirmation`/`signUp`/`logOff`) + `requireUser` (372).
Return `{ session, user, accessToken, configured, logon, openLogon, closeLogon,
authStatus, authBusy, signIn, signUp, resendConfirmation, logOff, requireUser }`
plus expose `myHandle`/`myStorefront` setters for `useStorefront` to consume (or
keep storefront bits here and have `useStorefront` read them — decide in 0.9).
Note: the star-map side of effect 167–191 is social state; have `useAuth` expose
`session` and let `useSocial` own the star fetch keyed on it (Task 0.7).
**Verify:** typecheck. **Commit:** `refactor(web): extract useAuth`.

### Task 0.6 — `core/useRegistry.ts`

**Files:** Create `src/core/useRegistry.ts`.
Move state 41–53, effects 117–165 (registry+resources) and 160–165 (leaderboard),
`loadDetail` (453–461), `orgHeadersForOwner` (463–467, needs org slug/token — pass
in as args or read from `useOrgWorkspace`), and the derived block 271–304
(`items`, `visibleResources`, `jobs`, `totals`, `topItem`, `leader`). Return all
of it + `cacheItem(item)` (the `setKnownItems` merge) + `refresh()`.
**Test:** unit-test the derived `jobs`/`totals` given a small `allItems` fixture.
**Verify:** typecheck + test. **Commit:** `refactor(web): extract useRegistry`.

### Task 0.7 — `core/useSocial.ts`

**Files:** Create `src/core/useSocial.ts`.
Move state 56–61, handlers `toggleStar` (622–645), `remixHarness` (647–695),
`runSample` (697–705), `addThreadPost` (707–733), `recordHarnessEvent` (355–370),
and the star-map fetch from effect 167–191 (keyed on `session`). It depends on
`useAuth.requireUser`/`accessToken`, `useRegistry.cacheItem`/`refresh`,
`useClipboard.copyText` (remix fallback), and `useAppNav.openHarness` (remix
success) — accept these as params (composed in `store.tsx`). Return
`{ starred, remixed, remotePosts, drafts, setDraft, kinds, setKind, tryStates,
toggleStar, remixHarness, runSample, addThreadPost, recordHarnessEvent,
threadFor(item, detail) }` where `threadFor` merges `detail.thread` + optimistic
`remotePosts` and marks own posts (logic from renderWinBody 914–951).
**Test:** `toggleStar` optimistic-then-rollback with a mocked `fetch`.
**Verify:** typecheck + test. **Commit:** `refactor(web): extract useSocial`.

### Task 0.8 — `core/usePublish.ts`

**Files:** Create `src/core/usePublish.ts`.
Move 77–80 + `submitImport` (735–765). On success it currently calls
`closeWin("publish")` — replace with `nav.close` of the publish surface (passed
in). Return `{ importName, setImportName, importMarkdown, setImportMarkdown,
importStatus, importBusy, submitImport }`.
**Verify:** typecheck. **Commit:** `refactor(web): extract usePublish`.

### Task 0.9 — `core/useStorefront.ts`

**Files:** Create `src/core/useStorefront.ts`.
Move `storefronts` (48), editor fields 68–74, `loadStorefront` (469–482),
`saveMyStorefront` (560–602), and the `myStorefront`/`myHandle` load from effect
193–211. Depends on `useAuth` (accessToken/session) + `useRegistry.cacheItem`.
Return caches + editor fields/setters + `loadStorefront`/`saveMyStorefront`.
**Verify:** typecheck. **Commit:** `refactor(web): extract useStorefront`.

### Task 0.10 — `core/useOrgWorkspace.ts`

**Files:** Create `src/core/useOrgWorkspace.ts`.
Move 83–87 + `loadOrgWorkspace` (484–510) + `orgHeadersForOwner` (463–467, shared
w/ registry — export from here, inject into `useRegistry.loadDetail`). Return
`{ networkOrg, setNetworkOrg, networkToken, setNetworkToken, networkStatus,
networkBusy, orgWorkspace, loadOrgWorkspace, orgHeadersForOwner }`.
**Verify:** typecheck. **Commit:** `refactor(web): extract useOrgWorkspace`.

### Task 0.11 — `core/useAppNav.ts` (surface stack + intents + deep-link)

**Files:** Create `src/core/useAppNav.ts`.
Implement the surface-stack model (see §navigation model). State: `surfaces:
Surface[]`, `activeId`. Implement push-or-reuse `openHarness/openResource/
openInstall/openCheckout/openPublish/openCli/openReview/openLeaderboard/
openStorefront/openProfile/openNetwork/openShare`, plus `close/focus/setTab`.
The **data** side of the old `open*` (loadDetail/cache/hash) is called here or in
the relevant hook; the intent push replaces `openWin`. Fold the deep-link effect
(218–267) here: parse via `core/url.ts` → dispatch intent, with `handledHash`
dedup (102/106) and the URL-reset on close (419–440). Return the state + intent
fns + `deepLinkInit()`.
**Test:** pushing `openHarness` twice for the same key reuses one surface; `close`
removes it and resets the hash.
**Verify:** typecheck + test. **Commit:** `feat(web/core): add skin-neutral useAppNav surface stack`.

### Task 0.12 — `core/store.tsx` (compose everything)

**Files:** Create `src/core/store.tsx`.
Create `<HarnessStore>` that instantiates all hooks in dependency order (auth →
registry/org → social/publish/storefront → clipboard → appNav wiring them
together) and provides a `useHarness()` accessor returning the merged API. This
is the single object every skin consumes. Wire the cross-hook callbacks
(social→nav.openHarness, publish→nav.close, remix→clipboard.copyText, etc.).
**Test:** render `<HarnessStore>` with a mocked `fetch`, assert `useHarness()`
exposes `items`, `openHarness`, `toggleStar`.
**Verify:** typecheck + test. **Commit:** `feat(web/core): add HarnessStore context`.

### Task 0.13 — Skin registry + provider + switcher (W98 only)

**Files:** Create `src/skins/registry.ts`, `src/skins/SkinProvider.tsx`,
`src/skins/SkinSwitcher.tsx`.
- `registry.ts`: `export const SKINS = [{id:"win98",label:"W98",icon:"🪟",
  mount: lazy(()=>import("./win98"))}]` (modern/fans added in later phases).
- `SkinProvider.tsx`: resolve active id by precedence `?skin=` > `localStorage
  ["oh:skin"]` > `"win98"`; provide `{skin, setSkin(id)}` via context; `setSkin`
  writes localStorage + updates `?skin=`. Render `<Suspense>` + active
  `skin.mount`.
- `SkinSwitcher.tsx`: headless — takes `{skins, active, onPick}` and renders a
  minimal control; each skin will wrap/style it (W98 gets a toolbar rendering).
**Test:** `SkinProvider` resolves `?skin=win98`; `setSkin` persists.
**Verify:** typecheck + test. **Commit:** `feat(web): add skin registry + provider + switcher`.

### Task 0.14 — Move current render into `skins/win98/`

**Files:** Create `src/skins/win98/index.tsx` (+ `wm/` submodules); move
`win98.tsx`, `desktop.tsx`, `explore.tsx`, `detail.tsx`, `windows.tsx`,
`styles.css` under `skins/win98/`; rewrite `src/main.tsx` to be thin.

**Steps:**
1. `git mv` the six render files into `skins/win98/`. Fix relative imports (now
   `../../core/*`).
2. Scope CSS: wrap `styles.css` rules under `.skin-win98` (or import it only from
   the win98 root and add `data-skin="win98"` on its wrapper). Verify no global
   leakage.
3. `skins/win98/index.tsx`: the old `App()` body **minus** everything moved to
   core. It calls `useHarness()` for data/actions and keeps only WM state
   (`wins/stack/focusedId/openCount/startOpen/time` + `WIN_WIDTHS`,
   `winMeta/taskEntries/startEntries/renderWinBody`, clock effect, chrome). Its
   WM subscribes to `useAppNav.surfaces`: when a surface is pushed, `openWin`
   creates the matching `FloatWin` (mapping `Surface.kind`→window); `close`
   removes it. `renderWinBody` reads all props from `useHarness()`.
4. `main.tsx` becomes:
```tsx
import { HarnessStore } from "./core/store";
import { SkinProvider } from "./skins/SkinProvider";
createRoot(root).render(<HarnessStore><SkinProvider/></HarnessStore>);
```
   (keep the `window.__harnessHub98Root` singleton guard.)
5. Render the `SkinSwitcher` in the W98 chrome (toolbar or start area) — styled
   as `Btn`s.
**Verify:** typecheck.
**Commit:** `refactor(web): make win98 a skin over the shared core`.

### Task 0.15 — Parity verification (gate before Phase 1)

**Steps (no code, verification only):**
1. `npm run typecheck -w @harnesshub/registry-web` → clean.
2. `npm run test -w @harnesshub/registry-web` → green.
3. `npm run build -w @harnesshub/registry-web` → succeeds.
4. Start preview; with `preview_screenshot` confirm the desktop/taskbar/explore
   look identical to pre-refactor (compare against a screenshot taken before
   Task 0.1 — take one now if not already).
5. Manually exercise (via preview): open a harness (deep-link `#/h/...`), switch
   detail tabs, star, remix, post thread, publish, logon dialog, install,
   checkout deep-link `/checkout?...`, leaderboard, network org, storefront
   `#/@handle`, `?ref=` capture.
6. `npm run check` (root) → green.
**Commit:** none (verification). If anything regressed, fix before proceeding.

---

# PHASE 1 — Modern skin

Adds `skins/modern/`. Register it in `registry.ts` and the switcher shows 🪟↔🖥.
Each task: build the component on `useHarness()`, verify via preview.

### Task 1.1 — Modern shell + tokens + primitives
Create `skins/modern/index.tsx`, `skins/modern/tokens.css` (`.skin-modern`
variables from §Design additions), load Space Grotesk/Inter/JetBrains fonts,
build the sticky nav (logo, tabs, search w/ `/` hint, Publish button) with the
`SkinSwitcher` styled as a pill group, and Modern primitives (`Btn`, `Tag`,
`HeatBar`, `StatRow`, `IconTile`, `TrustPanel`). Modern renders the **active
surface** from `useAppNav` as a page (+ back). **Verify:** switch to `?skin=
modern`, nav renders, fonts load (`preview_inspect` font-family).

### Task 1.2 — Modern Explore (from handoff, hi-fi)
Hero (status pill, h1, two CTAs), "Browse by outcome" filter chips (bind
`jobFilter`), section header + sort (`sort`), 3-col card grid, CLI strip. Data
from `useHarness().items`. **Verify:** cards populate, filter/sort work,
`preview_screenshot` matches handoff.

### Task 1.3 — Modern HarnessCard + ResourceCard
Per README component spec (icon tile, title, `by @author`, heat badge, promise,
tag chips, `✓ safety`, heat bar, footer stats + `eval 0.NN`). Star interactive
(`toggleStar`). Add resource-catalog tabs + `ResourceCard`. **Verify:** star
toggles + heat nudges; resource tabs switch grids.

### Task 1.4 — Modern Detail page (§A Harness Detail) — DESIGN ADDITION
Two-column route: tabbed left (all 7 tabs) + sticky trust panel right. Consume
`useDetail`/`useSocial.threadFor`/`tryStates`. Handle directory mode.
**Verify:** open from a card, all tabs render, thread post works, Try shows
disclaimer.

### Task 1.5 — Modern Publish + Auth + Share + Leaderboard + Storefront/Profile
Build the playful surfaces (§A) as Modern pages/modals on the existing core
handlers. Auth modal binds the `LogonDialog` contract. **Verify each** via
preview (publish import, sign-in, share copy, leaderboard ranks, profile save).

### Task 1.6 — Modern neutral surfaces (§C): Install/CLI, Checkout, Review, Network
Build the shared neutral components (see Task 1.7 note) in Modern chrome.
Checkout keeps `POST /billing/checkout`. **Verify:** install copies, checkout
session creates, org workspace loads with a token.

### Task 1.7 — Register + phase gate
Add modern to `registry.ts`; switcher shows both. **Verify:** switch W98↔Modern
mid-harness preserves `activeId` (context-preserving); `build` + `check` green.
> Note: build §C components under `skins/shared/neutral/` so Phase 2 reuses them.

---

# PHASE 2 — Fans skin

Adds `skins/fans/`, reusing `skins/shared/neutral/` for serious surfaces.

### Task 2.1 — Fans shell + tokens + landing hero (from handoff)
`skins/fans/index.tsx`, `.skin-fans` tokens, Nunito, sticky white nav with the
`SkinSwitcher` styled as the drawn `🖥/🪟/💙` segment, hero (h1 + sign-up card +
floating creator collage + stats bar + how-it-works + footer). Sign-up card
binds auth. **Verify:** landing matches handoff (`preview_screenshot`).

### Task 2.2 — Fans creators feed + cards (Explore parity)
Below the hero, full catalog: filter chips + sort + resource tabs + Fans
`HarnessCard` ("creator" card w/ Subscribe `$0/mo`). **Verify:** feed populates,
Subscribe = star action.

### Task 2.3 — Fans Detail = "creator profile" (§A) — DESIGN ADDITION
Avatar/handle/Subscribe/stat-row header + segmented tabs + "fan wall" thread.
**Verify:** all tabs, directory mode.

### Task 2.4 — Fans playful surfaces: Share, Leaderboard, Publish, Storefront/Profile
Fans-branded (§A). Storefront = creator page. **Verify** each.

### Task 2.5 — Fans neutral surfaces (§C) via shared components
Render `skins/shared/neutral/` Checkout/Review/Network/Install-CLI/Auth inside
Fans chrome (rounded wrapper), **no parody**. **Verify:** checkout/org serious +
functional.

### Task 2.6 — Register + phase gate
Add fans to `registry.ts`; all three in switcher. **Verify:** three-way switch
preserves context; `build` + `check` green.

---

# PHASE 3 — Parity, deep-link, code-split, polish

### Task 3.1 — `?skin=` deep-link + shareable URLs
Ensure `SkinProvider` honors `?skin=` on load and `setSkin` updates it; combine
with existing `#/h/...` so a shared link opens the right harness in the right
skin. **Test:** `?skin=modern#/h/a/b` opens harness b in modern.

### Task 3.2 — First-visit switcher nudge
One-time pulse/tooltip on the switcher (localStorage `oh:skin-nudge-seen`), per
skin styling. **Verify:** shows once, then suppressed.

### Task 3.3 — Per-skin code-split + fonts
Confirm each skin is a lazy chunk (Task 0.13 setup); load each skin's fonts only
when active (move `<link>`s out of `index.html` into per-skin injectors).
**Verify:** network panel shows W98 visitor doesn't fetch Modern/Fans CSS/fonts.

### Task 3.4 — Directory-mode + resource-catalog parity audit
Verify `contentType==="directory"` link-only behavior in all three skins' Detail/
Install/CLI/Card/Share; verify resource tabs in all three. Fix gaps.

### Task 3.5 — Final QA matrix + `npm run check`
Run the §Verification matrix across all three skins × {explore, detail, star,
remix, thread, publish, auth, install, checkout, review, leaderboard, org,
storefront, share, deep-link}. Screenshot each skin's Explore + Detail.
**Commit/PR:** finish the branch (superpowers:finishing-a-development-branch).

---

## Open decisions (flagged, non-blocking)
1. **Reuse rule (§C):** assumed **shared neutral** components for checkout/org/
   review. Override → expand Tasks 2.4/2.5 into bespoke Fans art.
2. **Collections:** deferred (YAGNI) — add a Phase 4 if prioritized.
3. **Default skin:** W98 (decided). Revisit if Modern should front new visitors.
