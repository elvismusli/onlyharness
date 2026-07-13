import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import { createSeeds } from "./create-seeds.js";

const sourceReleases = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../data/superskill/source-releases.json"), "utf8")) as {
  resources: Array<{ id: string; version: string; includeCiWorkflow: boolean }>;
};

test("seed generation is deterministic and produces the complete Stage A set", () => {
  const first = mkdtempSync(path.join(os.tmpdir(), "onlyharness-seeds-a-"));
  const second = mkdtempSync(path.join(os.tmpdir(), "onlyharness-seeds-b-"));

  createSeeds(first);
  createSeeds(second);

  const firstFiles = readTree(first);
  const secondFiles = readTree(second);
  assert.equal(readdirSync(first, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length, 12);
  assert.deepEqual(firstFiles, secondFiles);
  assert.equal(sourceReleases.resources.length, 12);
  for (const release of sourceReleases.resources) {
    const manifest = YAML.parse(firstFiles[`${release.id}/harness.yaml`]) as { version?: unknown };
    assert.equal(manifest.version, release.version, `${release.id} manifest must match source release state`);
    assert.equal(
      existsSync(path.join(first, release.id, ".gitea/workflows/harness-ci.yml")),
      release.includeCiWorkflow,
      `${release.id} workflow presence must match source release state`
    );
  }
  assert.deepEqual(firstFiles, readTree(path.resolve(import.meta.dirname, "../seed-harnesses")));
});

function readTree(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) result[path.relative(root, full).split(path.sep).join("/")] = readFileSync(full, "utf8");
    }
  };
  visit(root);
  return result;
}
