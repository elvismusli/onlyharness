import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { FastifyInstance, FastifyReply } from "fastify";
import { Resvg } from "@resvg/resvg-js";

const SITE_ORIGIN = "https://superskill.sh";
const RESOURCE_KEY = /^[A-Za-z0-9_-]{2,512}$/;
const CAPABILITY_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const INVITE_ID = /^[A-Za-z0-9_-]{8,100}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const BIDI_AND_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const HAS_BIDI_OR_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const IMAGE_CACHE_LIMIT = 128;
const IMAGE_QUEUE_LIMIT = 24;
const shareFontPath = (name: string) => fileURLToPath(new URL(`../assets/fonts/${name}`, import.meta.url));
const SHARE_FONTS = {
  schibsted: { family: "Schibsted Grotesk", path: shareFontPath("SchibstedGrotesk-wght.ttf") },
  ibmRegular: { family: "IBM Plex Mono", path: shareFontPath("IBMPlexMono-Regular.ttf") },
  ibmBold: { family: "IBM Plex Mono", path: shareFontPath("IBMPlexMono-Bold.ttf") },
  arabic: { family: "Noto Sans Arabic", path: shareFontPath("NotoSansArabic-wdth-wght.ttf") },
  devanagari: { family: "Noto Sans Devanagari", path: shareFontPath("NotoSansDevanagari-wdth-wght.ttf") },
  hebrew: { family: "Noto Sans Hebrew", path: shareFontPath("NotoSansHebrew-wdth-wght.ttf") },
  korean: { family: "Noto Sans KR", path: shareFontPath("NotoSansKR-wght.ttf") },
  cjk: { family: "Noto Sans SC", path: shareFontPath("NotoSansSC-wght.ttf") },
  thai: { family: "Noto Sans Thai", path: shareFontPath("NotoSansThai-wdth-wght.ttf") }
};
type ShareFontDefinition = (typeof SHARE_FONTS)[keyof typeof SHARE_FONTS];
const SHARE_BASE_FONT_FILES = [SHARE_FONTS.schibsted.path, SHARE_FONTS.ibmRegular.path, SHARE_FONTS.ibmBold.path];
const shareFontCoverage = new Map<string, Set<number>>();
const SHARE_BODY_FONT_FAMILY = "Schibsted Grotesk, Noto Sans SC, Noto Sans KR, Noto Sans Arabic, Noto Sans Hebrew, Noto Sans Devanagari, Noto Sans Thai, IBM Plex Mono";
const SHARE_MONO_FONT_FAMILY = "IBM Plex Mono, Noto Sans SC, Noto Sans KR, Noto Sans Arabic, Noto Sans Hebrew, Noto Sans Devanagari, Noto Sans Thai";
const IMAGE_WORKER_SOURCE = `
  const { parentPort } = require("node:worker_threads");
  const { Resvg } = require("@resvg/resvg-js");
  parentPort.on("message", ({ key, svg, fontFiles }) => {
    try {
      const png = new Resvg(svg, {
        fitTo: { mode: "width", value: 1200 },
        font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Schibsted Grotesk" }
      }).render().asPng();
      parentPort.postMessage({ key, png });
    } catch {
      parentPort.postMessage({ key, error: "render_failed" });
    }
  });
`;

type ImageJob = {
  key: string;
  svg: string;
  fontFiles: string[];
  resolve: (png: Buffer) => void;
  reject: (error: Error) => void;
};

const imageCache = new Map<string, Buffer>();
const imageInFlight = new Map<string, Promise<Buffer>>();
const imageQueue: ImageJob[] = [];
let imageWorker: Worker | undefined;
let activeImageJob: ImageJob | undefined;

export type SharePreviewKind = "resource" | "capability" | "workspace";

export type SharePreviewModel = {
  kind: SharePreviewKind;
  title: string;
  summary: string;
  eyebrow: string;
  badge: string;
  facts: string[];
  canonicalPath: string;
  imagePath: string;
  redirectHash: string;
  immutable?: boolean;
  noIndex?: boolean;
  workspaceSlug?: string;
};

export type SharePreviewFailure = {
  ok: false;
  status: 404 | 410 | 503;
  code: "SHARE_NOT_FOUND" | "SHARE_EXPIRED" | "SHARE_UNAVAILABLE";
};

export type SharePreviewResult = { ok: true; value: SharePreviewModel } | SharePreviewFailure;

export type SharePreviewResolvers = {
  resource: (id: string, version?: string) => Promise<SharePreviewResult>;
  capability: (id: string) => Promise<SharePreviewResult>;
  workspace: (inviteId: string) => Promise<SharePreviewResult>;
};

export async function registerSharePreviewRoutes(app: FastifyInstance, resolvers: SharePreviewResolvers): Promise<void> {
  app.get("/r/:key/:version", async (request, reply) => {
    const { key, version } = request.params as { key: string; version: string };
    const id = decodeResourceShareKey(key);
    if (!id || !VERSION.test(version)) return sendShareFailure(reply, notFound());
    return sendSharePage(reply, await resolvers.resource(id, version));
  });

  app.get("/r/:key", async (request, reply) => {
    const { key } = request.params as { key: string };
    const id = decodeResourceShareKey(key);
    if (!id) return sendShareFailure(reply, notFound());
    return sendSharePage(reply, await resolvers.resource(id));
  });

  app.get("/c/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!CAPABILITY_ID.test(id)) return sendShareFailure(reply, notFound());
    return sendSharePage(reply, await resolvers.capability(id));
  });

  app.get("/w/:inviteId", async (request, reply) => {
    const { inviteId } = request.params as { inviteId: string };
    if (!INVITE_ID.test(inviteId)) return sendShareFailure(reply, notFound(), true);
    const result = await resolvers.workspace(inviteId);
    if (!result.ok) return sendShareFailure(reply, result, true);
    return sendSharePage(reply, result);
  });

  app.get("/og/r/:key", async (request, reply) => {
    const { key } = request.params as { key: string };
    const { version } = request.query as { version?: string };
    const id = decodeResourceShareKey(key);
    if (!id || (version && !VERSION.test(version))) return sendShareImageFailure(reply, notFound());
    return sendShareImage(reply, await resolvers.resource(id, version));
  });

  app.get("/og/c/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!CAPABILITY_ID.test(id)) return sendShareImageFailure(reply, notFound());
    return sendShareImage(reply, await resolvers.capability(id));
  });

  app.get("/og/w/:inviteId", async (request, reply) => {
    const { inviteId } = request.params as { inviteId: string };
    if (!INVITE_ID.test(inviteId)) return sendShareImageFailure(reply, notFound());
    return sendShareImage(reply, await resolvers.workspace(inviteId));
  });
}

export function encodeResourceShareKey(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}

export function decodeResourceShareKey(key: string): string | undefined {
  if (!RESOURCE_KEY.test(key)) return undefined;
  try {
    const value = Buffer.from(key, "base64url").toString("utf8");
    if (!value || value.length > 320 || encodeResourceShareKey(value) !== key || HAS_BIDI_OR_CONTROLS.test(value)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

export function renderShareHtml(model: SharePreviewModel): string {
  const title = safeText(model.title, 96);
  const summary = safeText(model.summary, 220);
  const siteTitle = `${title} — SuperSkill`;
  const canonical = `${SITE_ORIGIN}${model.canonicalPath}`;
  const image = `${SITE_ORIGIN}${model.imagePath}`;
  const redirect = `${SITE_ORIGIN}/${model.redirectHash}`;
  const robots = model.noIndex ? "noindex,nofollow,noarchive" : "index,follow,max-image-preview:large";
  const workspaceBootstrap = model.kind === "workspace" && model.workspaceSlug
    ? `const invite=new URLSearchParams(location.hash.slice(1)).get("invite");const target=${JSON.stringify(`${SITE_ORIGIN}/#/superskill/workspaces?workspace=${encodeURIComponent(model.workspaceSlug ?? "")}`)}+(invite?"&invite="+encodeURIComponent(invite):"");location.replace(target);`
    : `location.replace(${JSON.stringify(redirect)});`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(siteTitle)}</title>
  <meta name="description" content="${escapeHtml(summary)}">
  <meta name="robots" content="${robots}">
  <meta name="theme-color" content="#f6f4ef">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="SuperSkill">
  <meta property="og:title" content="${escapeHtml(siteTitle)}">
  <meta property="og:description" content="${escapeHtml(summary)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(image)}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${escapeHtml(`${title} on SuperSkill`)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(siteTitle)}">
  <meta name="twitter:description" content="${escapeHtml(summary)}">
  <meta name="twitter:image" content="${escapeHtml(image)}">
  <style>${sharePageStyles()}</style>
</head>
<body>
  <main>
    ${brandMarkSvg(52)}
    <p class="eyebrow">${escapeHtml(model.eyebrow)}</p>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(summary)}</p>
    <a href="${escapeHtml(redirect)}">Open in SuperSkill</a>
  </main>
  <script>${workspaceBootstrap}</script>
</body>
</html>`;
}

export function renderShareSvg(model: SharePreviewModel): string {
  const titleLines = wrapText(safePreviewText(model.title, 96), 28, 2);
  const summaryLines = wrapText(safePreviewText(model.summary, 220), 72, 2);
  const facts = model.facts.map((fact) => safePreviewText(fact, 42)).filter(Boolean).slice(0, 3);
  const badge = safePreviewText(model.badge, 30);
  const badgeWidth = Math.max(118, badge.length * 11 + 34);
  const factsStart = badgeWidth + 58;
  const titleY = 236;
  const summaryY = titleY + titleLines.length * 72 + 26;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(954 84) rotate(132) scale(440 380)" gradientUnits="userSpaceOnUse"><stop stop-color="#cce9e6"/><stop offset="1" stop-color="#f6f4ef" stop-opacity="0"/></radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="12" stdDeviation="20" flood-color="#0f736e" flood-opacity=".12"/></filter>
  </defs>
  <rect width="1200" height="630" fill="#f6f4ef"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <path d="M873 62c118 18 211 95 258 208-80-33-161-35-241 6-80 40-132 111-162 219-51-72-64-150-40-234 31-108 91-174 185-199Z" fill="#fff" stroke="#e7e3db" stroke-width="2" filter="url(#shadow)"/>
  <path d="M788 426c91-80 187-118 292-114" fill="none" stroke="#0f736e" stroke-width="3" stroke-linecap="round" stroke-dasharray="9 14" opacity=".38"/>
  <circle cx="792" cy="424" r="9" fill="#0f736e"/><circle cx="1081" cy="312" r="9" fill="#0f736e"/>
  <g transform="translate(64 54)">${brandMarkSvg(56, true)}</g>
  <text x="136" y="91" fill="#1a1917" font-family="${SHARE_BODY_FONT_FAMILY}" font-size="30" font-weight="800" letter-spacing="-1">SuperSkill</text>
  <text x="1136" y="89" text-anchor="end" fill="#6b6862" font-family="${SHARE_MONO_FONT_FAMILY}" font-size="18" font-weight="700">superskill.sh</text>
  <text x="64" y="154" fill="#0f736e" font-family="${SHARE_MONO_FONT_FAMILY}" font-size="16" font-weight="700" letter-spacing="1.4">${escapeXml(safePreviewText(model.eyebrow, 70).toUpperCase())}</text>
  ${titleLines.map((line, index) => renderPreviewTextRuns(line, { x: 64, y: titleY + index * 72, fill: "#1a1917", fontSize: 64, fontWeight: 800, letterSpacing: -2, mode: "body" })).join("")}
  ${summaryLines.map((line, index) => renderPreviewTextRuns(line, { x: 64, y: summaryY + index * 33, fill: "#6b6862", fontSize: 24, fontWeight: 400, letterSpacing: 0, mode: "body" })).join("")}
  <g transform="translate(64 539)">
    <rect width="${badgeWidth}" height="38" rx="19" fill="#e6f0ef" stroke="#0f736e"/>
    <text x="17" y="25" fill="#0b5a56" font-family="${SHARE_MONO_FONT_FAMILY}" font-size="14" font-weight="700">${escapeXml(badge.toUpperCase())}</text>
    ${facts.map((fact, index) => `<text x="${factsStart + index * 245}" y="25" fill="#6b6862" font-family="${SHARE_MONO_FONT_FAMILY}" font-size="14" font-weight="700">${escapeXml(fact)}</text>`).join("")}
  </g>
</svg>`;
}

export function renderSharePng(model: SharePreviewModel): Buffer {
  return Buffer.from(new Resvg(renderShareSvg(model), resvgOptions(shareFontFilesForModel(model))).render().asPng());
}

export function renderSharePngAsync(model: SharePreviewModel): Promise<Buffer> {
  const svg = renderShareSvg(model);
  const key = createHash("sha256").update(svg).digest("hex");
  const cached = imageCache.get(key);
  if (cached) {
    imageCache.delete(key);
    imageCache.set(key, cached);
    return Promise.resolve(cached);
  }
  const existing = imageInFlight.get(key);
  if (existing) return existing;
  if (imageQueue.length + (activeImageJob ? 1 : 0) >= IMAGE_QUEUE_LIMIT) {
    return Promise.reject(new Error("Share image renderer is busy"));
  }
  const pending = new Promise<Buffer>((resolve, reject) => {
    imageQueue.push({ key, svg, fontFiles: shareFontFilesForModel(model), resolve, reject });
    dispatchImageJob();
  });
  imageInFlight.set(key, pending);
  return pending;
}

export function safeText(value: string, maxLength: number): string {
  const clean = value.normalize("NFKC").replace(BIDI_AND_CONTROLS, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

export function safePreviewText(value: string, maxLength: number): string {
  let clean = "";
  let replacing = false;
  for (const character of safeText(value, maxLength)) {
    if (previewFontDefinition(character.codePointAt(0) ?? 0, "body")) {
      clean += character;
      replacing = false;
    } else if (!replacing) {
      clean += "?";
      replacing = true;
    }
  }
  return clean;
}

function renderPreviewTextRuns(value: string, style: { x: number; y: number; fill: string; fontSize: number; fontWeight: number; letterSpacing: number; mode: "body" | "mono" }): string {
  const rtlFont = rtlPreviewFont(value);
  if (rtlFont) {
    const rtlValue = [...value].map((character) => /\s/u.test(character) || previewFontSupports(rtlFont, character.codePointAt(0) ?? 0) ? character : "?").join("");
    return `<text x="${style.x.toFixed(2)}" y="${style.y}" fill="${style.fill}" font-family="${rtlFont.family}" font-size="${style.fontSize}" font-weight="${style.fontWeight}" letter-spacing="${style.letterSpacing}" direction="rtl" unicode-bidi="plaintext">${escapeXml(rtlValue)}</text>`;
  }
  const spans: Array<{ family: string; text: string }> = [];
  for (const character of value) {
    const family = previewFontDefinition(character.codePointAt(0) ?? 0, style.mode)?.family ?? (style.mode === "mono" ? SHARE_FONTS.ibmRegular.family : SHARE_FONTS.schibsted.family);
    const previous = spans.at(-1);
    if (previous?.family === family) previous.text += character;
    else spans.push({ family, text: character });
  }
  let x = style.x;
  return spans.map(({ family, text }) => {
    const element = `<text x="${x.toFixed(2)}" y="${style.y}" fill="${style.fill}" font-family="${family}" font-size="${style.fontSize}" font-weight="${style.fontWeight}" letter-spacing="${style.letterSpacing}">${escapeXml(text)}</text>`;
    x += estimatePreviewTextWidth(text, style.fontSize, style.letterSpacing);
    return element;
  }).join("");
}

function rtlPreviewFont(value: string): ShareFontDefinition | undefined {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint >= 0x0590 && codePoint <= 0x05ff && previewFontSupports(SHARE_FONTS.hebrew, codePoint)) return SHARE_FONTS.hebrew;
    if (((codePoint >= 0x0600 && codePoint <= 0x06ff) || (codePoint >= 0x0750 && codePoint <= 0x077f) || (codePoint >= 0x08a0 && codePoint <= 0x08ff)) && previewFontSupports(SHARE_FONTS.arabic, codePoint)) return SHARE_FONTS.arabic;
  }
  return undefined;
}

function previewFontDefinition(codePoint: number, mode: "body" | "mono"): ShareFontDefinition | undefined {
  const base = mode === "mono" ? [SHARE_FONTS.ibmRegular, SHARE_FONTS.schibsted] : [SHARE_FONTS.schibsted, SHARE_FONTS.ibmRegular];
  let preferred: ShareFontDefinition[];
  if (codePoint >= 0x0590 && codePoint <= 0x05ff) preferred = [SHARE_FONTS.hebrew, ...base];
  else if ((codePoint >= 0x0600 && codePoint <= 0x06ff) || (codePoint >= 0x0750 && codePoint <= 0x077f) || (codePoint >= 0x08a0 && codePoint <= 0x08ff)) preferred = [SHARE_FONTS.arabic, ...base];
  else if (codePoint >= 0x0900 && codePoint <= 0x097f) preferred = [SHARE_FONTS.devanagari, ...base];
  else if (codePoint >= 0x0e00 && codePoint <= 0x0e7f) preferred = [SHARE_FONTS.thai, ...base];
  else if ((codePoint >= 0x1100 && codePoint <= 0x11ff) || (codePoint >= 0xac00 && codePoint <= 0xd7af)) preferred = [SHARE_FONTS.korean, SHARE_FONTS.cjk, ...base];
  else if ((codePoint >= 0x2e80 && codePoint <= 0x30ff)
    || (codePoint >= 0x31f0 && codePoint <= 0x31ff)
    || (codePoint >= 0x3400 && codePoint <= 0x9fff)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0x20000 && codePoint <= 0x2fa1f)) preferred = [SHARE_FONTS.cjk, SHARE_FONTS.korean, ...base];
  else if (codePoint >= 0x0370 && codePoint <= 0x052f) preferred = [SHARE_FONTS.ibmRegular, SHARE_FONTS.cjk, ...base];
  else preferred = [...base, SHARE_FONTS.cjk, SHARE_FONTS.korean, SHARE_FONTS.arabic, SHARE_FONTS.hebrew, SHARE_FONTS.devanagari, SHARE_FONTS.thai];
  return preferred.find((font, index) => preferred.findIndex((candidate) => candidate.path === font.path) === index && previewFontSupports(font, codePoint));
}

function previewFontSupports(font: ShareFontDefinition, codePoint: number): boolean {
  let coverage = shareFontCoverage.get(font.path);
  if (!coverage) {
    coverage = readPreviewFontCoverage(font.path);
    shareFontCoverage.set(font.path, coverage);
  }
  return coverage.has(codePoint);
}

function readPreviewFontCoverage(file: string): Set<number> {
  const font = readFileSync(file);
  const tableCount = font.readUInt16BE(4);
  let cmapOffset: number | undefined;
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16;
    if (font.subarray(record, record + 4).toString("ascii") === "cmap") {
      cmapOffset = font.readUInt32BE(record + 8);
      break;
    }
  }
  if (cmapOffset === undefined) throw new Error(`Share preview font has no cmap: ${file}`);
  const coverage = new Set<number>();
  const subtableCount = font.readUInt16BE(cmapOffset + 2);
  const seenSubtables = new Set<number>();
  for (let index = 0; index < subtableCount; index += 1) {
    const record = cmapOffset + 4 + index * 8;
    const subtable = cmapOffset + font.readUInt32BE(record + 4);
    if (seenSubtables.has(subtable)) continue;
    seenSubtables.add(subtable);
    const format = font.readUInt16BE(subtable);
    if (format === 12) addFormat12Coverage(font, subtable, coverage);
    else if (format === 4) addFormat4Coverage(font, subtable, coverage);
  }
  return coverage;
}

function addFormat12Coverage(font: Buffer, offset: number, coverage: Set<number>): void {
  const groupCount = font.readUInt32BE(offset + 12);
  for (let index = 0; index < groupCount; index += 1) {
    const group = offset + 16 + index * 12;
    const start = font.readUInt32BE(group);
    const end = font.readUInt32BE(group + 4);
    const startGlyph = font.readUInt32BE(group + 8);
    for (let codePoint = start + (startGlyph === 0 ? 1 : 0); codePoint <= end; codePoint += 1) coverage.add(codePoint);
  }
}

function addFormat4Coverage(font: Buffer, offset: number, coverage: Set<number>): void {
  const segmentCount = font.readUInt16BE(offset + 6) / 2;
  const endCodes = offset + 14;
  const startCodes = endCodes + segmentCount * 2 + 2;
  const deltas = startCodes + segmentCount * 2;
  const rangeOffsets = deltas + segmentCount * 2;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = font.readUInt16BE(startCodes + index * 2);
    const end = font.readUInt16BE(endCodes + index * 2);
    const delta = font.readUInt16BE(deltas + index * 2);
    const rangeOffsetPosition = rangeOffsets + index * 2;
    const rangeOffset = font.readUInt16BE(rangeOffsetPosition);
    for (let codePoint = start; codePoint <= end && codePoint !== 0xffff; codePoint += 1) {
      let glyph = (codePoint + delta) & 0xffff;
      if (rangeOffset !== 0) {
        const glyphPosition = rangeOffsetPosition + rangeOffset + (codePoint - start) * 2;
        glyph = glyphPosition + 2 <= font.length ? font.readUInt16BE(glyphPosition) : 0;
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) coverage.add(codePoint);
    }
  }
}

function shareFontFilesForModel(model: SharePreviewModel): string[] {
  const files = new Set(SHARE_BASE_FONT_FILES);
  const text = [model.title, model.summary, model.eyebrow, model.badge, ...model.facts].join(" ");
  for (const character of safePreviewText(text, 500)) {
    const font = previewFontDefinition(character.codePointAt(0) ?? 0, "body");
    if (font) files.add(font.path);
  }
  return [...files];
}

function resvgOptions(fontFiles: string[]) {
  return {
    fitTo: { mode: "width" as const, value: 1200 },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Schibsted Grotesk" }
  };
}

function estimatePreviewTextWidth(value: string, fontSize: number, letterSpacing: number): number {
  let units = 0;
  let characters = 0;
  for (const character of value) {
    characters += 1;
    const codePoint = character.codePointAt(0) ?? 0;
    if (/\s/u.test(character)) units += .32;
    else if ((codePoint >= 0x2e80 && codePoint <= 0x9fff) || (codePoint >= 0xac00 && codePoint <= 0xd7af) || codePoint >= 0x20000) units += 1;
    else if ((codePoint >= 0x0590 && codePoint <= 0x0e7f)) units += .68;
    else if (codePoint < 0x80 && /[.,:;!|·'"()\[\]{}\-]/u.test(character)) units += .34;
    else if (codePoint < 0x80 && /[A-Z0-9]/u.test(character)) units += .62;
    else units += .56;
  }
  return units * fontSize + Math.max(0, characters - 1) * letterSpacing;
}

function sendSharePage(reply: FastifyReply, result: SharePreviewResult) {
  if (!result.ok) return sendShareFailure(reply, result, result.status === 410);
  reply
    .header("content-type", "text/html; charset=utf-8")
    .header("cache-control", result.value.kind === "workspace" ? "private, no-store" : result.value.immutable ? "public, max-age=31536000, immutable" : "public, max-age=300, stale-while-revalidate=3600")
    .header("x-content-type-options", "nosniff")
    .header("content-security-policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  return reply.send(renderShareHtml(result.value));
}

async function sendShareImage(reply: FastifyReply, result: SharePreviewResult) {
  if (!result.ok) return sendShareImageFailure(reply, result);
  let png: Buffer;
  try {
    png = await renderSharePngAsync(result.value);
  } catch {
    return reply.code(503).header("cache-control", "no-store").header("x-content-type-options", "nosniff").send();
  }
  reply
    .header("content-type", "image/png")
    .header("cache-control", result.value.kind === "workspace" ? "private, no-store" : result.value.immutable ? "public, max-age=31536000, immutable" : "public, max-age=300, stale-while-revalidate=3600")
    .header("x-content-type-options", "nosniff");
  return reply.send(png);
}

function sendShareFailure(reply: FastifyReply, failure: SharePreviewFailure, noIndex = false) {
  const unavailable = failure.status === 503;
  const expired = failure.status === 410;
  const title = unavailable ? "Preview temporarily unavailable" : expired ? "Workspace invite unavailable" : "Share link not found";
  const summary = unavailable ? "SuperSkill could not safely resolve this preview. Retry later." : expired ? "This private workspace invite is expired, revoked, or already used." : "This SuperSkill share link does not exist.";
  const model: SharePreviewModel = {
    kind: "workspace",
    title,
    summary,
    eyebrow: "SUPERSKILL · SAFE SHARE",
    badge: expired ? "INVITE CLOSED" : "NOT AVAILABLE",
    facts: [],
    canonicalPath: "/",
    imagePath: "/og.png",
    redirectHash: "#/superskill",
    noIndex: noIndex || expired
  };
  reply
    .code(failure.status)
    .header("content-type", "text/html; charset=utf-8")
    .header("cache-control", "no-store")
    .header("x-content-type-options", "nosniff")
    .header("content-security-policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  return reply.send(renderShareHtml(model));
}

async function sendShareImageFailure(reply: FastifyReply, failure: SharePreviewFailure) {
  const model: SharePreviewModel = {
    kind: "workspace",
    title: failure.status === 410 ? "Workspace invite unavailable" : "Share preview unavailable",
    summary: "Open SuperSkill to continue safely.",
    eyebrow: "SUPERSKILL · SAFE SHARE",
    badge: "NOT AVAILABLE",
    facts: [],
    canonicalPath: "/",
    imagePath: "/og.png",
    redirectHash: "#/superskill",
    noIndex: true
  };
  let png: Buffer;
  try {
    png = await renderSharePngAsync(model);
  } catch {
    return reply.code(503).header("cache-control", "no-store").header("x-content-type-options", "nosniff").send();
  }
  reply.code(failure.status).header("content-type", "image/png").header("cache-control", "no-store").header("x-content-type-options", "nosniff");
  return reply.send(png);
}

function dispatchImageJob(): void {
  if (activeImageJob || imageQueue.length === 0) return;
  activeImageJob = imageQueue.shift();
  if (!activeImageJob) return;
  const worker = ensureImageWorker();
  worker.ref();
  worker.postMessage({ key: activeImageJob.key, svg: activeImageJob.svg, fontFiles: activeImageJob.fontFiles });
}

function ensureImageWorker(): Worker {
  if (imageWorker) return imageWorker;
  const worker = new Worker(IMAGE_WORKER_SOURCE, { eval: true });
  worker.on("message", (message: { key?: unknown; png?: Uint8Array; error?: unknown }) => {
    const job = activeImageJob;
    if (!job || message.key !== job.key || !(message.png instanceof Uint8Array) || message.error) {
      failImageWorker(new Error("Share image worker returned an invalid result"));
      return;
    }
    const png = Buffer.from(message.png);
    activeImageJob = undefined;
    imageInFlight.delete(job.key);
    imageCache.set(job.key, png);
    while (imageCache.size > IMAGE_CACHE_LIMIT) {
      const oldest = imageCache.keys().next().value as string | undefined;
      if (!oldest) break;
      imageCache.delete(oldest);
    }
    job.resolve(png);
    dispatchImageJob();
    if (!activeImageJob) worker.unref();
  });
  worker.on("error", () => failImageWorker(new Error("Share image worker failed")));
  worker.on("exit", (code) => {
    if (imageWorker !== worker) return;
    imageWorker = undefined;
    if (code !== 0 || activeImageJob) failQueuedImageJobs(new Error("Share image worker stopped"));
  });
  imageWorker = worker;
  return worker;
}

function failImageWorker(error: Error): void {
  const worker = imageWorker;
  imageWorker = undefined;
  if (worker) {
    worker.removeAllListeners();
    void worker.terminate();
  }
  failQueuedImageJobs(error);
}

function failQueuedImageJobs(error: Error): void {
  const jobs = [...(activeImageJob ? [activeImageJob] : []), ...imageQueue.splice(0)];
  activeImageJob = undefined;
  for (const job of jobs) {
    imageInFlight.delete(job.key);
    job.reject(error);
  }
}

function notFound(): SharePreviewFailure {
  return { ok: false, status: 404, code: "SHARE_NOT_FOUND" };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function escapeXml(value: string): string {
  return escapeHtml(value);
}

function wrapText(value: string, maxCharacters: number, maxLines: number): string[] {
  const words = value.split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const chunks = word.length > maxCharacters ? word.match(new RegExp(`.{1,${maxCharacters}}`, "g")) ?? [word] : [word];
    for (const chunk of chunks) {
      const next = current ? `${current} ${chunk}` : chunk;
      if (next.length <= maxCharacters) {
        current = next;
      } else {
        if (current) lines.push(current);
        current = chunk;
      }
      if (lines.length === maxLines) break;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (!lines.length) lines.push("SuperSkill");
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) lines[maxLines - 1] = `${lines[maxLines - 1]!.slice(0, Math.max(1, maxCharacters - 1)).trimEnd()}…`;
  return lines.slice(0, maxLines);
}

function brandMarkSvg(size: number, nested = false): string {
  const body = `<rect width="${size}" height="${size}" rx="${Math.round(size * .22)}" fill="#0f736e"/><path d="M${size * .25} ${size * .3}h${size * .3}c${size * .12} 0 ${size * .2} ${size * .07} ${size * .2} ${size * .17}s-${size * .08} ${size * .17}-${size * .2} ${size * .17}h-${size * .1}c-${size * .12} 0-${size * .2} ${size * .07}-${size * .2} ${size * .17}s${size * .08} ${size * .17} ${size * .2} ${size * .17}h${size * .3}" fill="none" stroke="#fff" stroke-width="${Math.max(4, size * .095)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return nested ? body : `<svg aria-hidden="true" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

function sharePageStyles(): string {
  return `*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#f6f4ef;color:#1a1917;font-family:Arial,sans-serif}body{display:grid;place-items:center;padding:32px}main{width:min(760px,100%);border:1px solid #e7e3db;border-radius:20px;padding:38px;background:#fff;box-shadow:0 20px 50px rgba(26,25,23,.08)}.eyebrow{margin:28px 0 8px;color:#0f736e;font:700 12px monospace;letter-spacing:.08em;text-transform:uppercase}h1{margin:0;font-size:clamp(38px,8vw,72px);line-height:.98;letter-spacing:-.04em}main>p:not(.eyebrow){color:#6b6862;font-size:19px;line-height:1.45}a{display:inline-flex;margin-top:14px;border-radius:8px;padding:12px 18px;background:#0f736e;color:#fff;text-decoration:none;font-weight:800}`;
}
