import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontDirectory = path.join(root, "apps/harness-api/assets/fonts");
const fontFiles = [
  "SchibstedGrotesk-wght.ttf",
  "IBMPlexMono-Regular.ttf",
  "IBMPlexMono-Bold.ttf",
  "NotoSansArabic-wdth-wght.ttf",
  "NotoSansDevanagari-wdth-wght.ttf",
  "NotoSansHebrew-wdth-wght.ttf",
  "NotoSansKR-wght.ttf",
  "NotoSansSC-wght.ttf",
  "NotoSansThai-wdth-wght.ttf"
].map((name) => ({ name, data: readFileSync(path.join(fontDirectory, name)) }));
const licenseFiles = [
  "OFL-Schibsted-Grotesk.txt",
  "OFL-IBM-Plex-Mono.txt",
  "OFL-Noto-Sans-Arabic.txt",
  "OFL-Noto-Sans-Devanagari.txt",
  "OFL-Noto-Sans-Hebrew.txt",
  "OFL-Noto-Sans-KR.txt",
  "OFL-Noto-Sans-SC.txt",
  "OFL-Noto-Sans-Thai.txt"
];
for (const name of licenseFiles) {
  const license = readFileSync(path.join(fontDirectory, name), "utf8");
  if (!license.includes("SIL Open Font License")) throw new Error(`Share preview font license is missing or invalid: ${name}`);
}

const requiredGlyphs = new Map([
  ["Latin", "SuperSkill"],
  ["Cyrillic", "Команда навыков"],
  ["Arabic", "مرحبا بالعالم"],
  ["Hebrew", "שלום עולם"],
  ["Devanagari", "नमस्ते दुनिया"],
  ["Thai", "ทักษะทีม"],
  ["Han", "世界技能"],
  ["Hiragana", "あいうえお"],
  ["Hangul", "팀워크 기술"]
]);

const coverage = {};
for (const [script, sample] of requiredGlyphs) {
  const providers = new Set();
  for (const character of new Set([...sample].filter((value) => !/\s/u.test(value)))) {
    const codePoint = character.codePointAt(0);
    const characterProviders = fontFiles.filter(({ data }) => fontHasCodePoint(data, codePoint)).map(({ name }) => name);
    if (!characterProviders.length) throw new Error(`Share preview fonts do not cover ${script} U+${codePoint.toString(16).toUpperCase()}`);
    for (const name of characterProviders) providers.add(name);
  }
  coverage[script] = [...providers];
}

console.log(JSON.stringify({ ok: true, coverage }));

function fontHasCodePoint(font, codePoint) {
  const cmap = findTable(font, "cmap");
  if (!cmap) return false;
  const tableCount = readUInt16(font, cmap + 2);
  for (let index = 0; index < tableCount; index += 1) {
    const record = cmap + 4 + index * 8;
    const subtable = cmap + readUInt32(font, record + 4);
    const format = readUInt16(font, subtable);
    if (format === 12 && format12HasCodePoint(font, subtable, codePoint)) return true;
    if (format === 4 && codePoint <= 0xffff && format4HasCodePoint(font, subtable, codePoint)) return true;
  }
  return false;
}

function findTable(font, tag) {
  const tableCount = readUInt16(font, 4);
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16;
    if (font.subarray(record, record + 4).toString("ascii") === tag) return readUInt32(font, record + 8);
  }
  return undefined;
}

function format12HasCodePoint(font, offset, codePoint) {
  const groupCount = readUInt32(font, offset + 12);
  let low = 0;
  let high = groupCount - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const group = offset + 16 + middle * 12;
    const start = readUInt32(font, group);
    const end = readUInt32(font, group + 4);
    if (codePoint < start) high = middle - 1;
    else if (codePoint > end) low = middle + 1;
    else return readUInt32(font, group + 8) + codePoint - start !== 0;
  }
  return false;
}

function format4HasCodePoint(font, offset, codePoint) {
  const segmentCount = readUInt16(font, offset + 6) / 2;
  const endCodes = offset + 14;
  const startCodes = endCodes + segmentCount * 2 + 2;
  const deltas = startCodes + segmentCount * 2;
  const rangeOffsets = deltas + segmentCount * 2;
  for (let index = 0; index < segmentCount; index += 1) {
    const end = readUInt16(font, endCodes + index * 2);
    if (codePoint > end) continue;
    const start = readUInt16(font, startCodes + index * 2);
    if (codePoint < start) return false;
    const delta = readUInt16(font, deltas + index * 2);
    const rangeOffsetPosition = rangeOffsets + index * 2;
    const rangeOffset = readUInt16(font, rangeOffsetPosition);
    if (rangeOffset === 0) return ((codePoint + delta) & 0xffff) !== 0;
    const glyphPosition = rangeOffsetPosition + rangeOffset + (codePoint - start) * 2;
    const glyph = readUInt16(font, glyphPosition);
    return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
  }
  return false;
}

function readUInt16(buffer, offset) {
  if (offset < 0 || offset + 2 > buffer.length) return 0;
  return buffer.readUInt16BE(offset);
}

function readUInt32(buffer, offset) {
  if (offset < 0 || offset + 4 > buffer.length) return 0;
  return buffer.readUInt32BE(offset);
}
