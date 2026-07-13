#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const curatedPath = path.resolve(process.env.SUPERSKILL_CURATED_PATH ?? path.join(root, "data/superskill/curated.json"));
const indexPath = path.resolve(process.env.SUPERSKILL_INDEX_PATH ?? path.join(root, "data/superskill/index.json"));

const mode = process.argv[2];
if (mode !== "approved" && mode !== "selected") fail("Usage: check-superskill-showroom-response.mjs approved|selected");

const expected = loadExpectations();
let body = "";
for await (const chunk of process.stdin) body += chunk;

let value;
try {
  value = JSON.parse(body);
} catch {
  fail("Showroom response is not valid JSON");
}

if (!Array.isArray(value.items) || !Number.isInteger(value.total)) fail("Showroom response is missing items or total");

const expectedItems = mode === "approved" ? expected.approved : expected.selected;
assertExactSet(value, expectedItems, mode);

for (const item of value.items) {
  const capability = item?.capability;
  const expectation = expectedItems.get(capability?.id);
  if (!expectation) fail(`${label(mode)} showroom contains unexpected capability ${capability?.id ?? "unknown"}`);
  if (capability?.trust?.status !== expectation.status) {
    fail(`${label(mode)} showroom item ${expectation.id} has trust status ${capability?.trust?.status ?? "missing"}; expected ${expectation.status}`);
  }
  if (capability?.release?.ref !== expectation.ref || capability?.release?.version !== expectation.version) {
    fail(`${label(mode)} showroom item ${expectation.id} does not match expected exact release ${expectation.ref}@${expectation.version}`);
  }
  if (capability?.release?.artifactDigest !== expectation.artifactDigest) {
    fail(`${label(mode)} showroom item ${expectation.id} has an unexpected artifact digest`);
  }

  if (mode === "approved") {
    if (item?.clientHandoff?.status !== "available") {
      fail(`Approved showroom item ${expectation.id} does not expose an available exact-release handoff`);
    }
    continue;
  }

  if (item.status !== "selected_unreviewed") {
    fail(`Selected showroom item ${expectation.id} is not marked selected_unreviewed`);
  }
  if (item?.managedHandoff?.status !== "blocked" || item?.managedHandoff?.reason !== "review_required") {
    fail(`Selected showroom item ${expectation.id} does not block managed handoff for review_required`);
  }
}

function loadExpectations() {
  const curated = readJson(curatedPath, "curated catalog");
  const index = readJson(indexPath, "generated managed index");
  if (!Array.isArray(curated?.resources)) fail("Checked-in curated catalog is missing resources");
  if (!Array.isArray(index?.capabilities)) fail("Checked-in generated managed index is missing capabilities");

  const curatedById = uniqueById(curated.resources, "curated catalog");
  const indexById = uniqueById(index.capabilities, "generated managed index");
  assertSameIds(curatedById, indexById);

  const approved = new Map();
  const selected = new Map();
  for (const [id, resource] of curatedById) {
    const capability = indexById.get(id);
    const status = capability?.trust?.status;
    if (!["candidate", "approved", "quarantined", "revoked"].includes(status)) {
      fail(`Checked-in catalog has unsupported status for ${id}: ${status ?? "missing"}`);
    }
    if (resource.status !== status) {
      fail(`Checked-in catalog status mismatch for ${id}: curated=${resource.status ?? "missing"}, index=${status ?? "missing"}`);
    }
    if (resource.ref !== capability?.release?.ref || resource.version !== capability?.release?.version) {
      fail(`Checked-in exact release mismatch for ${id}`);
    }
    if (resource.expectedDigest !== capability?.release?.artifactDigest) {
      fail(`Checked-in artifact digest mismatch for ${id}`);
    }

    const expectation = {
      id,
      status,
      ref: resource.ref,
      version: resource.version,
      artifactDigest: resource.expectedDigest
    };
    if (status === "approved") approved.set(id, expectation);
    else if (status === "candidate") selected.set(id, expectation);
  }
  return { approved, selected };
}

function assertExactSet(value, expectedItems, mode) {
  const actualIds = value.items.map((item) => item?.capability?.id);
  const expectedIds = [...expectedItems.keys()].sort();
  if (value.total !== expectedIds.length || value.items.length !== expectedIds.length) {
    fail(`${label(mode)} showroom must contain exactly ${expectedIds.length} items; got total=${value.total}, items=${value.items.length}`);
  }
  if (new Set(actualIds).size !== actualIds.length) fail(`${label(mode)} showroom contains duplicate capability IDs`);
  const sortedActualIds = [...actualIds].sort();
  if (JSON.stringify(sortedActualIds) !== JSON.stringify(expectedIds)) {
    const missing = expectedIds.filter((id) => !actualIds.includes(id));
    const extra = actualIds.filter((id) => !expectedItems.has(id));
    fail(`${label(mode)} showroom IDs do not match checked-in catalog (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})`);
  }
}

function assertSameIds(curatedById, indexById) {
  const curatedIds = [...curatedById.keys()].sort();
  const indexIds = [...indexById.keys()].sort();
  if (JSON.stringify(curatedIds) !== JSON.stringify(indexIds)) {
    fail("Checked-in curated catalog and generated managed index have different capability IDs");
  }
}

function uniqueById(items, source) {
  const byId = new Map();
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !item.id) fail(`${source} contains an item without an ID`);
    if (byId.has(item.id)) fail(`${source} contains duplicate capability ID ${item.id}`);
    byId.set(item.id, item);
  }
  return byId;
}

function readJson(file, source) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Cannot read ${source} at ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function label(mode) {
  return mode === "approved" ? "Approved" : "Selected";
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
