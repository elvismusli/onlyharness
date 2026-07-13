import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { EXPECTED_RESOURCE_COUNT, hasCyrillic, parseCatalogMarkdown, readJsonFile } from "./resource-catalog-shared.js";

const root = path.resolve(import.meta.dirname, "..");
const catalogPath = path.join(root, "docs/research/verified-catalog-2026-07.md");
const denylistPath = path.join(root, "docs/research/catalog-denylist.json");
const generatedPath = path.join(root, "data/resources/verified-2026-07.json");
const summaryPath = path.join(root, "data/resources/summary-en.json");

test("resource seed matches source catalog and denylist", () => {
  const rows = parseCatalogMarkdown(readFileSync(catalogPath, "utf8"));
  const denylist = readJsonFile<{ repos: Array<{ repo: string; url: string }> }>(denylistPath);
  const generated = readJsonFile<{ resources: Array<{ id: string; canonicalUrl: string }> }>(generatedPath);

  assert.equal(rows.length, EXPECTED_RESOURCE_COUNT);
  assert.equal(generated.resources.length, EXPECTED_RESOURCE_COUNT);
  for (const denied of denylist.repos) {
    assert.ok(!generated.resources.some((resource) => resource.canonicalUrl === denied.url || resource.id.toLowerCase().endsWith(denied.repo.toLowerCase())));
  }
});

test("resource seed has stable ids, English summaries and expected key categories", () => {
  const summaries = readJsonFile<Record<string, string>>(summaryPath);
  const generated = readJsonFile<{
    resources: Array<{
      id: string;
      summary: string;
      resourceType: string;
      installability: string;
      sourceCheckedAt: string;
      sourceCheckStatus: string;
      canonicalUrl: string;
      mirror?: { status?: string; url?: string };
      actions: Array<{ id: string; label: string; url?: string }>;
    }>;
  }>(generatedPath);

  assert.equal(new Set(generated.resources.map((resource) => resource.id)).size, generated.resources.length);
  assert.equal(Object.keys(summaries).length, EXPECTED_RESOURCE_COUNT);
  assert.ok(Object.values(summaries).every((summary) => !/onlyharness/i.test(summary)), "source summaries must use the SuperSkill human brand");
  assert.ok(generated.resources.every((resource) => !hasCyrillic(resource.summary)));
  assert.ok(generated.resources.every((resource) => !/onlyharness/i.test(resource.summary)), "public resource summaries must not expose the legacy human brand");
  assert.ok(generated.resources.every((resource) => resource.installability === "open_only"));
  assert.ok(generated.resources.every((resource) => resource.sourceCheckedAt === "2026-07-05"));
  assert.ok(generated.resources.every((resource) => resource.sourceCheckStatus === "active"));
  assert.ok(generated.resources.every((resource) => resource.actions.some((action) => action.id === "open_onlyharness" && action.url?.startsWith("https://superskill.sh/#/superskill/resources/"))));
  assert.ok(generated.resources.every((resource) => resource.actions.some((action) => action.id === "open_upstream")));
  assert.ok(generated.resources.every((resource) => !resource.actions.some((action) => action.id === "download_archive")), "upstream catalog entries must remain open-only even when a legacy mirror file exists");
  assert.ok(generated.resources.every((resource) => !resource.actions.some((action) => action.id === "convert_to_harness")));
  assert.equal(generated.resources.filter((resource) => resource.resourceType === "mcp_server").length, 24);
  assert.equal(generated.resources.find((resource) => resource.id === "github:obra/superpowers")?.resourceType, "skill");
  assert.equal(generated.resources.find((resource) => resource.id === "github:punkpeye/awesome-mcp-servers")?.resourceType, "directory");
});

test("resource archive inventory is portable and never stands in for missing files", () => {
  const inventoryText = readFileSync(path.join(root, "data/resources/archives/archives.json"), "utf8");
  assert.doesNotMatch(inventoryText, /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)/);
  const inventory = JSON.parse(inventoryText) as { archives?: Array<{ storageKey?: string; sha256?: string }> };
  for (const archive of inventory.archives ?? []) {
    assert.match(archive.storageKey ?? "", /^[A-Za-z0-9_-]+\.tar\.gz$/);
    assert.match(archive.sha256 ?? "", /^sha256:[a-f0-9]{64}$/);
  }
});
