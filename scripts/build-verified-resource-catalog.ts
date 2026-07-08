import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildResourceCatalog,
  buildSummaryTemplate,
  EXPECTED_RESOURCE_COUNT,
  hasCyrillic,
  parseCatalogMarkdown,
  readJsonFile
} from "./resource-catalog-shared.js";

const root = path.resolve(import.meta.dirname, "..");
const catalogPath = path.join(root, "docs/research/verified-catalog-2026-07.md");
const denylistPath = path.join(root, "docs/research/catalog-denylist.json");
const dataDir = path.join(root, "data/resources");
const summaryPath = path.join(dataDir, "summary-en.json");
const outputPath = path.join(dataDir, "verified-2026-07.json");

const writeSummaryTemplate = process.argv.includes("--write-summary-template");

mkdirSync(dataDir, { recursive: true });

const markdown = readFileSync(catalogPath, "utf8");
const denylist = readJsonFile<{ repos?: Array<{ repo?: string; url?: string }> }>(denylistPath);

if (writeSummaryTemplate || !existsSync(summaryPath)) {
  const rows = parseCatalogMarkdown(markdown);
  if (rows.length !== EXPECTED_RESOURCE_COUNT) {
    throw new Error(`Expected ${EXPECTED_RESOURCE_COUNT} catalog rows, got ${rows.length}`);
  }
  const next = buildSummaryTemplate(rows);
  writeFileSync(summaryPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Wrote ${summaryPath}`);
  if (writeSummaryTemplate) process.exit(0);
}

const summaryMap = readJsonFile<Record<string, string>>(summaryPath);
for (const [id, summary] of Object.entries(summaryMap)) {
  if (hasCyrillic(summary)) throw new Error(`English summary contains Cyrillic text: ${id}`);
}

const catalog = buildResourceCatalog({
  catalogPath: "docs/research/verified-catalog-2026-07.md",
  catalogMarkdown: markdown,
  summaryMap,
  denylist,
  generatedAt: "2026-07-05T00:00:00.000Z"
});

writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${catalog.resources.length} resources to ${outputPath}`);
