import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

import { renderShareSvg } from "../apps/harness-api/dist/share-preview.js";
import { assertSharePng } from "./check-share-png.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontDirectory = path.join(root, "apps/harness-api/assets/fonts");
const baseFonts = ["SchibstedGrotesk-wght.ttf", "IBMPlexMono-Regular.ttf", "IBMPlexMono-Bold.ttf"];
const base = {
  kind: "workspace",
  summary: "Private workspace",
  eyebrow: "WORKSPACE",
  badge: "PRIVATE",
  facts: [],
  canonicalPath: "/",
  imagePath: "/",
  redirectHash: "#"
};

const canaries = new Map([
  ["Cyrillic", ["Команда навыков", "IBM Plex Mono", []]],
  ["Arabic", ["مرحبا بالعالم", "Noto Sans Arabic", ["NotoSansArabic-wdth-wght.ttf"]]],
  ["Hebrew", ["שלום עולם", "Noto Sans Hebrew", ["NotoSansHebrew-wdth-wght.ttf"]]],
  ["Devanagari", ["नमस्ते दुनिया", "Noto Sans Devanagari", ["NotoSansDevanagari-wdth-wght.ttf"]]],
  ["Thai", ["ทักษะทีม", "Noto Sans Thai", ["NotoSansThai-wdth-wght.ttf"]]],
  ["Han", ["世界技能", "Noto Sans SC", ["NotoSansSC-wght.ttf"]]],
  ["Hiragana", ["あいうえお", "Noto Sans SC", ["NotoSansSC-wght.ttf"]]],
  ["Hangul", ["팀워크 기술", "Noto Sans KR", ["NotoSansKR-wght.ttf"]]]
]);

const signatures = {};
for (const [script, [title, expectedFamily, extraFonts]] of canaries) {
  const svg = renderShareSvg({ ...base, title });
  if (!svg.includes(`font-family="${expectedFamily}"`)) throw new Error(`${script} share preview did not select ${expectedFamily}`);
  if (["Arabic", "Hebrew"].includes(script) && (!svg.includes('direction="rtl" unicode-bidi="plaintext"') || !svg.includes(title))) {
    throw new Error(`${script} share preview did not preserve one direction-aware logical line`);
  }
  let tofuSvg = svg;
  for (const character of new Set([...title].filter((value) => !/\s/u.test(value)))) tofuSvg = tofuSvg.replaceAll(character, "\uE000");
  if (tofuSvg === svg) throw new Error(`${script} share preview tofu canary was not installed`);

  const fontFiles = [...baseFonts, ...extraFonts].map((name) => path.join(fontDirectory, name));
  const options = { fitTo: { mode: "width", value: 1200 }, font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Schibsted Grotesk" } };
  const png = Buffer.from(new Resvg(svg, options).render().asPng());
  const tofuPng = Buffer.from(new Resvg(tofuSvg, options).render().asPng());
  assertSharePng(png, `${script} share preview`);
  if (png.equals(tofuPng)) throw new Error(`${script} share preview rendered tofu instead of real glyphs`);
  signatures[script] = createHash("sha256").update(png).digest("hex").slice(0, 12);
}

console.log(JSON.stringify({ ok: true, signatures }));
