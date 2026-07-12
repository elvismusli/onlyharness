import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const checker = path.join(root, "scripts/check-superskill-showroom-response.mjs");
const index = JSON.parse(readFileSync(path.join(root, "data/superskill/index.json"), "utf8"));
const selected = {
  items: index.capabilities.map((capability: Record<string, unknown>) => ({
    capability,
    status: "selected_unreviewed",
    managedHandoff: { status: "blocked", reason: "review_required" }
  })),
  total: index.capabilities.length,
  generatedAt: index.generatedAt
};

test("showroom release checker requires the exact 12 selected candidates and zero approved", () => {
  assert.equal(run("selected", selected).status, 0);
  assert.equal(run("approved", { items: [], total: 0, generatedAt: index.generatedAt }).status, 0);

  assert.notEqual(run("selected", { ...selected, items: selected.items.slice(1), total: selected.total - 1 }).status, 0);
  assert.notEqual(run("selected", { ...selected, items: selected.items.map((item: Record<string, unknown>, position: number) => position === 0 ? { ...item, managedHandoff: { status: "available" } } : item) }).status, 0);
  assert.notEqual(run("approved", { items: [selected.items[0]], total: 1, generatedAt: index.generatedAt }).status, 0);
});

function run(mode: "approved" | "selected", value: unknown) {
  return spawnSync(process.execPath, [checker, mode], { cwd: root, input: JSON.stringify(value), encoding: "utf8" });
}
