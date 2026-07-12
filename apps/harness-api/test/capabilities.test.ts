import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ManagedCatalog } from "../src/capabilities.js";
import { approvedCapability, managedIndex } from "./superskill-fixture.js";

test("catalog loads approved list and exact digest-bound preview", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "superskill-catalog-"));
  const previews = path.join(root, "previews");
  mkdirSync(previews);
  const capability = approvedCapability();
  const indexPath = path.join(root, "index.json");
  writeFileSync(indexPath, JSON.stringify(managedIndex([capability])));
  writeFileSync(path.join(previews, `${capability.id}.json`), JSON.stringify({
    schemaVersion: "superskill.showroom-preview.v1",
    capabilityId: capability.id,
    artifactDigest: capability.release.artifactDigest,
    reviewCaseId: "case-1",
    taskLabel: "Compare two synthetic competitors",
    lines: ["Synthetic result line"],
    outcomeLabel: "Source-backed comparison fixture",
    reviewedAt: "2026-07-01T00:00:00.000Z"
  }));
  const catalog = new ManagedCatalog({ indexPath, previewsPath: previews });
  assert.equal(catalog.ready(), true);
  assert.equal(catalog.showroomList(12).items[0]?.preview?.reviewCaseId, "case-1");

  writeFileSync(path.join(previews, `${capability.id}.json`), JSON.stringify({
    schemaVersion: "superskill.showroom-preview.v1",
    capabilityId: capability.id,
    artifactDigest: `sha256:${"b".repeat(64)}`,
    reviewCaseId: "case-1",
    taskLabel: "Synthetic task",
    lines: ["Synthetic result line"],
    outcomeLabel: "Synthetic outcome",
    reviewedAt: "2026-07-01T00:00:00.000Z"
  }));
  assert.equal(catalog.showroomList(12).items[0]?.preview, undefined);
  assert.equal(catalog.showroomList(12, undefined, new Date("2099-01-01T00:00:00.000Z")).items.length, 0);
  assert.deepEqual(catalog.showroomDetail(capability.id, new Date("2099-01-01T00:00:00.000Z"))?.clientHandoff, {
    status: "blocked",
    reason: "stale_or_ineligible_evidence"
  });
});

test("selected shelf returns only current candidate releases with blocked managed handoff", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "superskill-selected-"));
  const approved = approvedCapability();
  const candidate = approvedCapability({
    id: "selected-writer",
    release: {
      ref: "harnesses/selected-writer",
      artifactDigest: `sha256:${"d".repeat(64)}`
    },
    jobs: [{ id: "writing", intents: ["write"], outcomes: ["draft"], exclusions: ["publish"] }],
    trust: { status: "candidate" }
  });
  const indexPath = path.join(root, "index.json");
  writeFileSync(indexPath, JSON.stringify(managedIndex([approved, candidate])));
  const catalog = new ManagedCatalog({ indexPath });

  const selected = catalog.selectedShowroomList(12);
  assert.equal(selected.total, 1);
  assert.equal(selected.items[0]?.capability.id, candidate.id);
  assert.equal(selected.items[0]?.status, "selected_unreviewed");
  assert.deepEqual(selected.items[0]?.managedHandoff, { status: "blocked", reason: "review_required" });
  assert.equal(catalog.selectedShowroomList(12, "market-research").items.length, 0);
  assert.equal(catalog.selectedShowroomList(12, "writing").items.length, 1);
  assert.equal(catalog.showroomList(12).items.some((item) => item.capability.id === candidate.id), false);
});

test("revocation overlay blocks approved list and survives index status", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "superskill-revoke-"));
  const capability = approvedCapability();
  const indexPath = path.join(root, "index.json");
  const revokePath = path.join(root, "revocations.jsonl");
  writeFileSync(indexPath, JSON.stringify(managedIndex([capability])));
  writeFileSync(revokePath, `${JSON.stringify({
    schemaVersion: "superskill.revoke.v1",
    eventId: "rev_abcdefgh",
    artifactDigest: capability.release.artifactDigest,
    aliases: [{ capabilityId: capability.id, ref: capability.release.ref, version: capability.release.version }],
    reasonCode: "SECURITY_ADVISORY",
    actorLabel: "OnlyHarness security",
    revokedAt: "2026-07-12T00:00:00.000Z",
    replacement: { ref: "harnesses/replacement", version: "0.3.0", artifactDigest: `sha256:${"c".repeat(64)}` }
  })}\n`);
  const catalog = new ManagedCatalog({ indexPath, revocationsPath: revokePath });
  assert.equal(catalog.listApproved().length, 0);
  assert.equal(catalog.detail(capability.id)?.trust.status, "revoked");
  assert.deepEqual(catalog.showroomDetail(capability.id)?.clientHandoff, { status: "blocked", reason: "revoked" });
  assert.match(catalog.detail(capability.id)?.trust.limitations.join(" ") ?? "", /harnesses\/replacement@0\.3\.0/);
});

test("invalid index fails only managed catalog", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "superskill-invalid-"));
  const indexPath = path.join(root, "index.json");
  writeFileSync(indexPath, "{}");
  const catalog = new ManagedCatalog({ indexPath });
  assert.equal(catalog.ready(), false);
  assert.throws(() => catalog.listApproved(), /not ready/);
});

test("exact release lookup retains immutable managed history after current advances", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "superskill-history-"));
  const current = approvedCapability({ release: { version: "0.2.1", artifactDigest: `sha256:${"c".repeat(64)}` } });
  const previous = approvedCapability();
  const indexPath = path.join(root, "index.json");
  const historyPath = path.join(root, "history.json");
  writeFileSync(indexPath, JSON.stringify(managedIndex([current])));
  writeFileSync(historyPath, JSON.stringify({ schemaVersion: "superskill.history.v1", generatedAt: "2026-07-01T00:00:00.000Z", capabilities: [previous, current] }));
  const catalog = new ManagedCatalog({ indexPath, historyPath });
  assert.equal(catalog.showroomList(12).items[0]?.capability.release.version, "0.2.1");
  assert.equal(catalog.exact(previous.id, "0.2.0")?.release.artifactDigest, previous.release.artifactDigest);
  assert.equal(catalog.exact(current.id, "0.2.1")?.release.artifactDigest, current.release.artifactDigest);
});
