import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSeeds } from "./create-seeds.js";

test("seed generation is deterministic and produces the complete Stage A set", () => {
  const first = mkdtempSync(path.join(os.tmpdir(), "onlyharness-seeds-a-"));
  const second = mkdtempSync(path.join(os.tmpdir(), "onlyharness-seeds-b-"));

  createSeeds(first);
  createSeeds(second);

  const firstFiles = readTree(first);
  const secondFiles = readTree(second);
  assert.equal(readdirSync(first, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length, 12);
  assert.deepEqual(firstFiles, secondFiles);
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
