import assert from "node:assert/strict";
import test from "node:test";
import { classifyLegacyArchive, inventoryMode } from "./inventory-resource-archives.js";

test("resource archive inventory is read-only unless reconciliation is explicitly requested", () => {
  assert.deepEqual(inventoryMode([]), { readOnly: true, reconcile: false });
  assert.deepEqual(inventoryMode(["--reconcile"]), { readOnly: false, reconcile: true });
});

test("github legacy mirrors are retired instead of entering hosted release ownership", () => {
  assert.deepEqual(classifyLegacyArchive("github:obra/superpowers"), {
    classification: "external_legacy_mirror",
    migrationAction: "retire_not_migrate",
    migrationReady: false,
    missing: ["retirement approval after open-only catalog and traffic verification"]
  });
});

test("only canonical hosted packages can become reviewed migration candidates", () => {
  assert.deepEqual(classifyLegacyArchive("onlyharness:packages/private-skill"), {
    classification: "hosted_package_candidate",
    migrationAction: "review_hosted_package_manifest",
    migrationReady: false,
    missing: ["version", "canonical ownerSubject", "reviewed artifactDigest manifest"]
  });
  assert.equal(classifyLegacyArchive("unexpected-id").classification, "unknown_legacy_archive");
  assert.equal(classifyLegacyArchive(undefined).migrationAction, "quarantine_and_review");
});
