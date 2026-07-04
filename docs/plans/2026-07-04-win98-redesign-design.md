# OnlyHarness 98: Win98 redesign + user-flow fixes

Source of truth: `design_handoff_harness_hub_98` (Design System 98, HarnessHub 98, Share Cards 98)
and `docs/HF_STYLE_PRODUCT_CONCEPT_RU.md`. Brand: **OnlyHarness** (onlyharness.com) — the
handoff's Harness.Hub visual language applied 1:1 with the OnlyHarness wordmark.

## Why

The MVP shipped a generic modern dashboard: a signup form as the first block of the homepage,
an inline detail panel you have to scroll to find, nav items that secretly jump to tabs, and
dev-dashboard leftovers (localhost URLs as product copy). The handoff defines a complete
Windows 98 / MS Paint / WordArt design language that is both the visual system and the fix for
the flow: **every surface is a window**, so "open a harness" finally means *opening a window*,
not scrolling to a hidden panel.

## Shell: teal desktop + window manager

- Teal `#008080` desktop, fixed 36px taskbar, Start menu, live clock, tray.
- **Explore is the main window**, always open, centered in flow (like the prototype).
  Its `×` triggers the "You can't close the Wild West" dialog (per handoff).
- Secondary surfaces are **floating windows**: absolutely positioned, cascade offset,
  draggable by title bar, z-order on click, minimize to taskbar. One window per kind
  (one per harness for detail windows).
- Window kinds: `harness` (detail), `publish` (New Harness Wizard), `cli` (MS-DOS Prompt),
  `review` (Maintainer Review), `leaderboard` (Wild West Top 10), `share` (harness_flex.exe).
- Mobile ≤920px: floating windows become full-screen sheets, easter-egg windows hidden,
  dragging disabled.

## User-flow fixes (what was wrong → what we do)

| Was (MVP) | Now |
|---|---|
| Signup form is the first block on the page | Win98 **Log On dialog** (serious tone), opened from Start menu / status bar / any gated action. Status bar shows "Logged on as …" |
| Detail = inline panel below the grid, reached by scroll | Card click opens a **Harness Detail window** with taskbar button |
| Nav "Threads" jumps to a tab of whatever was selected | Threads live where they belong: a tab in each harness window |
| Nav "CLI" opens a view called `settings` | **MS-DOS Prompt window** (`hh.exe`), plus CLI strip on Explore |
| "Maintainers" as top nav for everyone | Maintainer Review window via Harness menu / Start menu — pro path, not primary nav |
| Hero shows a fake "Explore page concept" mockup inside the real explore page | Removed; the app itself is the concept now |
| Localhost URLs listed as product info | Tucked into the CLI window as `hh doctor` output |
| Toasts | Win98 dialogs + status-bar messages |

## Explore window (per prototype, wired to live registry)

Title bar (🌐 Harness.Hub — Explore) → menu bar (File/View/Harness/Community/Help with real
dropdown items: New harness, sort options, Leaderboard, CLI, Log On, About) → Word-style toolbar
(New harness · Fork · Run · CLI · sunken search · paint swatches) → sunken hero with WordArt
logo, subtitle, two CTAs, VT323 marquee ticker fed by real totals → `fieldset` "🔥 Trending this
week" with harness cards → "Browse by outcome" bevel buttons with counts + navy CLI strip with
blinking cursor → status bar: "Ready · N harnesses indexed" / logon state / "Season 4 · Wild West 🤠".

Harness card = mini-window: navy title bar, promise line, cream tag chips, stats plate
(⑂ 💬 eval-green), Harness Heat meter (VT323 orange number + segmented navy bar), actions
`★ 1.8k` (toggle, stays pressed) / `Try` / `⑂`. Card click → detail window.

## Harness Detail window

Header (title, promise, tags, owner/updated) → Win98 **tab control**: Overview | Try | Thread |
Evals | Files → right **trust panel**: stats plates, heat meter + weekly delta, then a plain-tone
box for eval / risk / runtime / gate (no jokes near safety), actions Copy CLI / Fork / Star /
Share / Repo. Thread keeps kinds (question/recipe/result/proposal/bug-risk) with composer.
Share opens `harness_flex.exe` — the share-card window from the handoff at 50% scale.

## Copy rules

Playful in cards, badges, ticker, empty states, mascot, dialogs
("Fork responsibly, cowboy", "make it go BUGAGA", empty search = "No harnesses found on this
frontier. Try another word, partner. 🌵"). Plain and calm around logon, permissions, risk,
eval gates. Numbers use `fmtK` (1834 → 1.8k).

## Easter eggs (all functional where cheap)

Desktop icons (My Harnesses → starred filter; Cooled Forks → empty-bin dialog), Wild West Award
window fed by real leaderboard #1, Paint window whose bars are the top-4 heat values, 🧷 mascot
whose **Yes** opens the Publish wizard, Start → Shut Down dialog, blinking cursors, bobbing
mascot, live clock.

## Tech

- `apps/registry-web/src`: `main.tsx` (entry) · `app.tsx` (state, data, window manager) ·
  `win98.tsx` (primitives) · `windows.tsx` (window contents) · `desktop.tsx` (shell + eggs) ·
  `styles.css` (tokens + components, full rewrite).
- Bevels exactly per handoff (raised/sunken/pressed/thin-inset), **no border-radius anywhere**,
  fonts Pixelify Sans / Tahoma / VT323 (Google Fonts in `index.html`).
- lucide-react dropped from the UI: the system is emoji + text glyphs.
- API (`/registry`, `/leaderboard`, `/repos/:o/:r/harness`, `/imports/markdown-to-harness`) and
  Supabase logic (auth, stars/forks/runs, thread posts) unchanged.
