import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "vitest";

/*
 * Foundation contract guard (regression-only, not a behavioural test).
 * The SuperSkill skin must render the sanctioned "Daylight v1.0" identity from
 * docs/plans/2026-07-12-superskill-mvp-developer-handoff-daylight.md — ultramarine
 * action accent, warm ivory surface, Archivo + JetBrains Mono + Spectral, and the
 * spec radii. This locks the tokens so the teal/Schibsted/IBM Plex drift cannot
 * silently return. It asserts source-of-truth values, never per-component styling.
 */

// Resolve skin sources robustly whether cwd is the package dir or the repo root.
function loadSkinSource(name: string): string {
  for (const base of ["src/skins/superskill", "apps/registry-web/src/skins/superskill"]) {
    const candidate = resolve(process.cwd(), base, name);
    if (existsSync(candidate)) return readFileSync(candidate, "utf8");
  }
  throw new Error(`foundation.contract: cannot locate ${name} from ${process.cwd()}`);
}
const tokens = loadSkinSource("tokens.css");
const index = loadSkinSource("index.tsx");

const CANONICAL: Record<string, string> = {
  "--ss-paper": "#f7f6f1",
  "--ss-surface": "#fffdf8",
  "--ss-sunken": "#f4f2ea",
  "--ss-ink": "#16150f",
  "--ss-muted": "#6f6d64",
  "--ss-faint": "#8a877b",
  "--ss-border": "#ddd9ca",
  "--ss-border-soft": "#eeeadd",
  "--ss-action": "#2f45ff",
  "--ss-action-ink": "#1e30d8",
  "--ss-pass": "#1d8a4a",
  "--ss-warn": "#a4620a",
  "--ss-fail": "#b4271f",
  "--ss-r-inset": "12px",
  "--ss-r-card": "18px",
  "--ss-r-hero": "22px",
};

test.each(Object.entries(CANONICAL))("token %s equals the Daylight canonical value %s", (name, value) => {
  const re = new RegExp(`${name.replace(/[-]/g, "\\-")}:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  expect(tokens).toMatch(re);
});

test("no teal accent literals survive anywhere in the tokens", () => {
  expect(tokens).not.toMatch(/#0f736e/i); // teal action
  expect(tokens).not.toMatch(/#0b5a56/i); // teal action-ink
  expect(tokens).not.toMatch(/rgba\(\s*15\s*,\s*115\s*,\s*110/i); // hardcoded teal glows
});

test("action-tinted hover shadow uses ultramarine, not teal", () => {
  expect(tokens).toMatch(/--ss-shadow-hover:[^;]*rgba\(\s*47\s*,\s*69\s*,\s*255/);
});

test("the skin ships the Daylight font families and not the drifted ones", () => {
  expect(tokens).toMatch(/"Archivo"/);
  expect(tokens).toMatch(/"JetBrains Mono"/);
  expect(tokens).toMatch(/"Spectral"/); // editorial accent italic
  expect(tokens).not.toMatch(/Schibsted Grotesk/);
  expect(tokens).not.toMatch(/IBM Plex Mono/);
  // The runtime font <link> must actually request them.
  expect(index).toMatch(/family=Archivo/);
  expect(index).toMatch(/family=JetBrains\+Mono/);
  expect(index).toMatch(/family=Spectral/);
  expect(index).not.toMatch(/Schibsted\+Grotesk/);
});
