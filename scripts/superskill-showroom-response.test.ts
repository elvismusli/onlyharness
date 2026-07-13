import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const checker = path.join(root, "scripts/check-superskill-showroom-response.mjs");
const checkedInCurated = JSON.parse(readFileSync(path.join(root, "data/superskill/curated.json"), "utf8"));
const checkedInIndex = JSON.parse(readFileSync(path.join(root, "data/superskill/index.json"), "utf8"));

test("showroom release checker derives the current 0 approved and 12 selected expectations from checked-in truth", () => {
  const responses = responsesFor(checkedInIndex);
  assert.equal(responses.approved.total, 0);
  assert.equal(responses.selected.total, 12);
  assertPasses("approved", responses.approved);
  assertPasses("selected", responses.selected);
});

test("showroom release checker accepts a simulated exact 1 approved and 11 selected split", () => {
  withCatalogFixture(({ curated, index, paths }) => {
    approve(curated, index, "deep-market-researcher");
    writeCatalog(paths, curated, index);
    const responses = responsesFor(index);
    assert.equal(responses.approved.total, 1);
    assert.equal(responses.selected.total, 11);
    assertPasses("approved", responses.approved, paths);
    assertPasses("selected", responses.selected, paths);
  });
});

test("showroom release checker rejects fake approval plus extra and missing items", () => {
  const responses = responsesFor(checkedInIndex);
  const fakeApproval = approvedItem(checkedInIndex.capabilities[0]);
  assertFails("approved", { items: [fakeApproval], total: 1 }, undefined, /IDs do not match|exactly 0/);
  assertFails("selected", {
    ...responses.selected,
    items: [...responses.selected.items, responses.selected.items[0]],
    total: responses.selected.total + 1
  }, undefined, /exactly 12|duplicate/);
  assertFails("selected", {
    ...responses.selected,
    items: responses.selected.items.slice(1),
    total: responses.selected.total - 1
  }, undefined, /exactly 12|missing/);
});

test("showroom release checker rejects status, digest, and handoff mismatches", () => {
  withCatalogFixture(({ curated, index, paths }) => {
    approve(curated, index, "deep-market-researcher");
    writeCatalog(paths, curated, index);
    const responses = responsesFor(index);

    assertFails("approved", mutateFirst(responses.approved, (item) => ({
      ...item,
      capability: { ...item.capability, trust: { ...item.capability.trust, status: "candidate" } }
    })), paths, /trust status/);
    assertFails("approved", mutateFirst(responses.approved, (item) => ({
      ...item,
      capability: { ...item.capability, release: { ...item.capability.release, artifactDigest: `sha256:${"f".repeat(64)}` } }
    })), paths, /artifact digest/);
    assertFails("approved", mutateFirst(responses.approved, (item) => ({ ...item, clientHandoff: { status: "blocked", reason: "stale_or_ineligible_evidence" } })), paths, /available exact-release handoff/);
    assertFails("selected", mutateFirst(responses.selected, (item) => ({ ...item, managedHandoff: { status: "available" } })), paths, /block managed handoff/);
  });
});

test("showroom release checker fails closed when curated and generated truth drift", () => {
  withCatalogFixture(({ curated, index, paths }) => {
    index.capabilities[0].release.artifactDigest = `sha256:${"e".repeat(64)}`;
    writeCatalog(paths, curated, index);
    const result = run("selected", responsesFor(index).selected, paths);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Checked-in artifact digest mismatch/);
  });
});

type CatalogPaths = { curated: string; index: string };

function responsesFor(index: any) {
  const approved = index.capabilities.filter((capability: any) => capability.trust.status === "approved").map(approvedItem);
  const selected = index.capabilities.filter((capability: any) => capability.trust.status === "candidate").map((capability: any) => ({
    capability,
    status: "selected_unreviewed",
    managedHandoff: { status: "blocked", reason: "review_required" }
  }));
  return {
    approved: { items: approved, total: approved.length, generatedAt: index.generatedAt },
    selected: { items: selected, total: selected.length, generatedAt: index.generatedAt }
  };
}

function approvedItem(capability: any) {
  return { capability, clientHandoff: { status: "available" } };
}

function approve(curated: any, index: any, id: string) {
  const resource = curated.resources.find((item: any) => item.id === id);
  const capability = index.capabilities.find((item: any) => item.id === id);
  assert.ok(resource && capability);
  resource.status = "approved";
  capability.trust.status = "approved";
}

function mutateFirst(response: any, mutate: (item: any) => any) {
  return { ...response, items: response.items.map((item: any, position: number) => position === 0 ? mutate(item) : item) };
}

function withCatalogFixture(runFixture: (fixture: { curated: any; index: any; paths: CatalogPaths }) => void) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "superskill-showroom-checker-"));
  const paths = { curated: path.join(directory, "curated.json"), index: path.join(directory, "index.json") };
  const curated = structuredClone(checkedInCurated);
  const index = structuredClone(checkedInIndex);
  try {
    runFixture({ curated, index, paths });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function writeCatalog(paths: CatalogPaths, curated: unknown, index: unknown) {
  writeFileSync(paths.curated, JSON.stringify(curated));
  writeFileSync(paths.index, JSON.stringify(index));
}

function assertPasses(mode: "approved" | "selected", value: unknown, paths?: CatalogPaths) {
  const result = run(mode, value, paths);
  assert.equal(result.status, 0, result.stderr);
}

function assertFails(mode: "approved" | "selected", value: unknown, paths?: CatalogPaths, message?: RegExp) {
  const result = run(mode, value, paths);
  assert.notEqual(result.status, 0);
  if (message) assert.match(result.stderr, message);
}

function run(mode: "approved" | "selected", value: unknown, paths?: CatalogPaths) {
  return spawnSync(process.execPath, [checker, mode], {
    cwd: root,
    input: JSON.stringify(value),
    encoding: "utf8",
    env: {
      ...process.env,
      ...(paths ? { SUPERSKILL_CURATED_PATH: paths.curated, SUPERSKILL_INDEX_PATH: paths.index } : {})
    }
  });
}
