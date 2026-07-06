import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const root = path.resolve(import.meta.dirname, "..");
const catalogPath = path.join(root, "docs/research/verified-catalog-2026-07.md");
const denylistPath = path.join(root, "docs/research/catalog-denylist.json");

test("verified catalog excludes leaked prompt repositories from numbered entries", () => {
  const catalog = readFileSync(catalogPath, "utf8");
  const denylist = JSON.parse(readFileSync(denylistPath, "utf8")) as { repos: Array<{ repo: string; url: string }> };
  const entries = catalog.split(/\r?\n/).filter((line) => /^\| \d+ \| /.test(line));

  assert.equal(entries.length, 253);
  assert.match(catalog, /\*\*253 позиции\*\*/);
  assert.match(catalog, /leaked\/system-prompt dumps/);
  for (const denied of denylist.repos) {
    assert.ok(!entries.some((line) => line.includes(denied.url) || line.includes(denied.repo)), `${denied.repo} must stay out of catalog entries`);
  }
});

test("directory shelf counts match cleaned catalog counts", () => {
  const verified = readDirectoryManifest("verified-agent-catalog-2026-07");
  const awesome = readDirectoryManifest("awesome-agent-directories");

  assert.equal(verified.content.directory.item_count, 253);
  assert.match(verified.summary, /253 verified/);
  assert.equal(awesome.content.directory.item_count, 22);
  assert.match(awesome.content.directory.notes, /leaked-prompt exclusions/);
});

function readDirectoryManifest(slug: string) {
  const file = path.join(root, "data/directories", slug, "harness.yaml");
  return YAML.parse(readFileSync(file, "utf8")) as {
    summary: string;
    content: { directory: { item_count: number; notes: string } };
  };
}
