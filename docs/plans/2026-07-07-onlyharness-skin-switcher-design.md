# OnlyHarness Multi-Skin (theme switcher) — design

Date: 2026-07-07
Status: approved (brainstorm), ready for implementation plan

## 1. Decision

OnlyHarness ships one product with three interchangeable **skins** that the
visitor picks and switches at will:

- 🪟 **W98** — retro Windows-98 desktop / window-manager (the current live UI).
- 🖥 **Modern** ("Normie") — dark developer-hub aesthetic (Linear / Vercel /
  Hugging Face): near-black canvas, warm orange accent, hairline cards.
- 💙 **Fans** — friendly OnlyFans-style parody: sky-blue landing where you
  "subscribe to" and support harnesses like creators.

The data layer and product logic are shared. Only the render/chrome layer
differs per skin. All three skins are **full-featured** (explore, detail,
thread, publish, auth), not landing-only.

Confirmed product decisions:

- **Entry:** no interstitial splash. Visitors land on a default skin; a skin
  switcher is always visible in the nav.
- **Default skin:** **W98** (preserve the current live vibe; it is already
  built, so zero regression risk). New visitors discover Modern/Fans via the
  switcher.
- **Scope:** all three skins reach full parity (phased delivery, see §9).

## 2. Current state

`apps/registry-web/src/` is today **100% the W98 skin**. Everything imports from
`./win98`; `main.tsx` (~1500 lines) fuses three concerns into one `App()`:

1. Data / domain — fetch `/registry` + `/resources`, Supabase auth, social
   state (star / remix / thread), publish, org workspace, checkout. All
   skin-agnostic.
2. App / session logic — query/sort/filter, "which harness is open", detail
   tab, dialogs / flash / copy.
3. W98 chrome — window manager (`FloatWin`, stack, taskbar, start menu, desktop
   icons, mascot).

There is no skin switcher yet. The Modern and Fans designs exist only as HTML
handoff prototypes (`~/Downloads/design_handoff_onlyharness_{modern,fans}`),
high-fidelity, with final tokens.

## 3. Architecture: core + skins

Extract #1 and most of #2 into a skin-agnostic **core**; make the W98 chrome one
of three interchangeable skins.

```
src/
  core/                      skin-agnostic, one for all
    useRegistry()   fetch /registry + /resources, query/sort/filter
    useAuth()       Supabase session, logon, handle, storefront
    useSocial()     star/remix/thread + optimistic updates
    useDetail(key)  lazy-load HarnessDetail
    usePublish() / useOrg() / useCheckout()
    useAppNav()     logical view state: { view, activeKey, tab }
    types.ts · format.ts · compat.ts   (already neutral)
  skins/
    win98/    current render moves here verbatim
    modern/   new — dark dev-hub
    fans/     new — blue landing product
    registry.ts · SkinProvider · SkinSwitcher
```

A skin is a component that reads the core context and renders the full
experience in its own aesthetic. No skin touches data-fetching — only render.
The core hooks are composed into a `HarnessStore` context so any skin consumes
them without prop-drilling.

## 4. Navigation intent (`useAppNav`) + context-preserving switch

The three skins navigate in fundamentally different idioms: W98 = window
manager, Modern = routed pages, Fans = landing sections. So the core stores
navigation not as "windows" but as **plain intent data**:

- actions: `openHarness(key)`, `openPublish()`, `openLeaderboard()`, `close()`…
- state: `{ view: 'explore'|'detail'|'publish'|…, activeKey, tab }`

Each skin interprets the same intent natively (W98 → open a window; Modern →
push a route; Fans → scroll/open a page).

Payoff — **context-preserving skin switch**: viewing harness X in W98 → click
🖥 → still on harness X in Modern. The switcher only swaps the skin component;
`useAppNav` lives in the core, so position survives. One deep-link scheme
(`#/harness/owner/name`) works across all three.

## 5. Skin provider, switcher, default, URL

**`SkinProvider`** resolves the active skin by precedence:

```
?skin=modern (explicit link)  >  localStorage['oh:skin']  >  default (W98)
```

Explicit param = shareable "my favourite look"; saved value = returning visitor
lands in their skin; default = first-time visitor.

**`SkinSwitcher`** is the pill group `🖥 Normie · 🪟 W98 · 💙 Fans` (already drawn
in the Fans handoff). It lives in every skin's nav but is styled natively per
skin (W98 → toolbar buttons; Modern → pill group; Fans → rounded segment). On
click: `setSkin()` → write localStorage → update `?skin=` → swap skin component
instantly; core state (and thus context) persists.

**"Visible on entry" without a splash:** on the first visit only, give the
switcher a subtle one-time pulse / tooltip ("👀 three looks — try one"), then
suppress via a localStorage flag.

**Code-splitting:** each skin is `lazy(() => import('./skins/<skin>'))`. A Modern
visitor never downloads W98/Fans JS/CSS/fonts. Fonts load per active skin
(Pixelify+VT323 · Space Grotesk+Inter+JetBrains Mono · Nunito).

## 6. CSS / font isolation

The three skins have incompatible global CSS (pixel borders vs hairlines vs
rounded shadows). Isolate:

- each skin wrapper sets `data-skin="win98|modern|fans"` + a root class
  `.skin-*`;
- the current `styles.css` (~31 KB) moves under `.skin-win98 { … }` so it can't
  leak;
- Modern and Fans define their own CSS-variable token sets (all hex / radii /
  fonts are captured in the handoffs);
- fonts lazy-load with the active skin.

## 7. Shared data, three vocabularies

Every skin reads the same `RegistryItem`; only the labels/visuals differ. No API
change for v1.

| Core field | 🪟 W98 | 🖥 Modern | 💙 Fans |
|---|---|---|---|
| `title` + `summary` | window card | card title + promise | "creator" + tagline |
| `stars`/`forks`/`threads` | ★/⑂/💬 | footer row | stat row |
| `evalScore` | InfoLine | `eval 0.NN` green | green eval |
| `heat`/`heatDelta` | HeatMeter | gradient heat-bar | 🔥 heat |
| install/star action | Install button | "Explore/Run" | **Subscribe** pill |
| `manifest.pricing` | — | — | `$0/mo` (free default) |

`$/mo` in Fans is cosmetic for v1 (render `$0/mo` = free). Real pricing later via
the existing `manifest.pricing`. No backend work now (YAGNI).

## 8. Screen mapping (all three full-featured)

Each logical `view` from `useAppNav` renders three ways:

| view | 🪟 W98 | 🖥 Modern | 💙 Fans |
|---|---|---|---|
| `explore` | ExploreWindow | Explore page (grid + filter chips + CLI strip) | landing hero + "creators" feed |
| `detail` | floating window | detail route (tabs + trust panel) | "creator profile" page |
| `publish`/`cli`/`leaderboard`/`share` | windows | modals / pages | sections / modals |
| `auth`/`logon` | LogonDialog | skin modal | sign-up card in hero |

`detail.tsx` / `explore.tsx` / `windows.tsx` become **W98-specific** views that
stay in `skins/win98/`. Modern and Fans get their own view components on the
same core hooks and actions.

## 9. Phased delivery

Each phase deploys and reviews independently. Target is full parity; ship in
slices.

| Phase | Work | User sees | Size | Risk |
|---|---|---|---|---|
| **0. Core** | extract data/logic from `main.tsx` into `core/` hooks + `useAppNav`; move current render to `skins/win98/` verbatim; stand up `SkinProvider`/`SkinSwitcher`/`registry` (W98 only) | nothing changes — same W98 | L | ⚠️ regressions |
| **1. Modern** | `skins/modern/`: Explore (nav + hero + chips + grid + CLI strip) and Detail (tabs + trust panel) on core hooks | switcher goes live: 🪟↔🖥 | M–L | low |
| **2. Fans** | `skins/fans/`: landing hero + sign-up + "creators" feed + detail-as-profile | all three in switcher 🪟🖥💙 | M | low |
| **3. Parity + polish** | publish/CLI/leaderboard/share/org in Modern & Fans; deep-link `?skin=`; per-skin code-split; first-visit nudge; final QA | full parity + shareable links | M | low |

**Why Phase 0 first and alone.** It is a pure refactor with zero visual change,
so its acceptance is trivial: "the W98 site looks and works identically"
(verify by before/after screenshot diff). All the danger of breaking existing
behaviour is isolated into one easily-checked phase. After it, adding skins is
safe addition, not open-heart surgery.

## 10. Risks & mitigations

- `main.tsx` (~1500 lines) is fused — extract hooks **behind unchanged W98
  output**; land Phase 0 with no visual delta.
- CSS bleed — scoped `.skin-*` from the first commit.
- Supabase auth is shared — verify logon behaves identically across skins.
- Hash deep-link already exists in `main.tsx` (`handledHash`) — generalise it
  (`#/harness/…` + `?skin=`), do not rewrite.

## 11. Definition of done

- New visitor → W98; the switcher is noticeable on first entry.
- Switching skins is instant and **preserves** the current harness / tab.
- All three skins do explore → detail → star/fork/thread → publish → auth.
- `?skin=` is shareable and honoured on load.
- Each skin ships only its own JS / CSS / fonts (code-split).

## 12. Open items / future

- Real per-harness pricing (`$/mo`) for Fans via `manifest.pricing`.
- Optional: SEO routes per skin (`/modern`, `/fans`) if organic discovery
  matters — currently `?skin=` covers sharing.
- Swap emoji tiles for a real icon set per skin if desired.
