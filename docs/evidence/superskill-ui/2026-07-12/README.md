# SuperSkill Daylight UI acceptance — 2026-07-12

Local-only acceptance evidence for the SuperSkill MVP. The API ran against a synthetic,
schema-valid browser fixture with one approved exact release plus quarantined and revoked
detail records. This fixture proves UI states; it is not a production trust attestation and
does not change `data/superskill/index.json` (currently 12 candidates, 0 approved).

## Captures

- `landing-1440.png` — approved showroom landing at 1440x900.
- `landing-390.png` — responsive landing at 390x844.
- `trust-pass-390.png` — exact release trust report at 390x844 (overall warn because
  independent evaluation is explicitly `not_run`).
- `trust-revoked-390.png` — revoked exact release, limitations visible, install blocked.
- `install-claude-1440.png` — Claude Code handoff with exact CLI 0.2.13 commands.
- `install-codex-1440.png` — Codex CLI handoff with exact CLI 0.2.13 commands.

## Browser acceptance

Executed through the bundled Playwright CLI wrapper against `127.0.0.1:5177` and the
local API at `127.0.0.1:8787`.

- Landing, trust shared links and install handoff rendered from the public showroom DTO.
- Viewports 1440x900, 1024x768, 768x1024, 390x844 and 360x800 all reported
  `scrollWidth === clientWidth`.
- A unique task marker remained only in current React tab state and the copy field; it was
  absent from URL, localStorage, sessionStorage, resource URLs and captured request bodies.
- Copying reported `Copied`; it did not report Installed, Detected, Loaded or Invoked.
- Warn, quarantined and revoked states had explicit text/glyph labels; quarantined and
  revoked handoff was blocked.
- `?skin=win98`, `?skin=modern` and `?skin=fans` mounted non-empty legacy surfaces.
- With `prefers-reduced-motion: reduce`, no SuperSkill descendant retained a non-zero
  CSS animation.
- Claude Code and Codex pages contained their exact marketplace/plugin commands and
  `npx --yes onlyharness@0.2.13 doctor --json`.

The production default was intentionally not switched: the handoff requires live approved
showroom data and live public smoke first.
