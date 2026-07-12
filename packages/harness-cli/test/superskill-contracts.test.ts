import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalArtifactDigest } from "@harnesshub/capability-schema/node";
import { computeArtifactDigest, normalizeManagedPath } from "../src/lib/artifact.js";
import { validateTask } from "../src/lib/superskill-client.js";
import { resolveProjectState } from "../src/lib/activation-store.js";
import { SuperSkillCliError } from "../src/lib/superskill-types.js";
import { managedBlockReason } from "../src/commands/activation.js";

test("CLI artifact wrapper is byte-identical to the shared implementation", () => {
  const files = [{ path: "b.md", content: "B\r\n" }, { path: "a.md", content: "\ufeffA" }];
  assert.equal(computeArtifactDigest(files), canonicalArtifactDigest(files));
  assert.equal(computeArtifactDigest([...files].reverse()), canonicalArtifactDigest(files));
  for (const invalid of ["../x", "/x", "a\\b", "a//b", "e\u0301.md"]) assert.throws(() => normalizeManagedPath(invalid), SuperSkillCliError);
});

test("task validation normalizes whitespace and rejects secret-like values locally", () => {
  assert.equal(validateTask("  market   research  "), "market research");
  assert.throws(() => validateTask("token=abcdefghijklmnopqrstuvwxyz"), (error: unknown) => error instanceof SuperSkillCliError && error.reasonCode === "TASK_INVALID");
  assert.throws(() => validateTask("sk-abcdefghijklmnopqrstuvwxyz"), (error: unknown) => error instanceof SuperSkillCliError && error.reasonCode === "TASK_INVALID");
  assert.throws(() => validateTask("review /Users/alice/private/repo"), (error: unknown) => error instanceof SuperSkillCliError && error.reasonCode === "TASK_INVALID");
});

test("project state root rejects a .onlyharness symlink without touching its target", () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-state-symlink-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "superskill-state-outside-"));
  try {
    symlinkSync(outside, path.join(project, ".onlyharness"), "dir");
    assert.throws(
      () => resolveProjectState(project),
      (error: unknown) => error instanceof SuperSkillCliError && error.reasonCode === "MANAGED_FILE_CHANGED"
    );
    assert.deepEqual(readdirSync(outside), []);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("managed eligibility block is never mislabeled as quarantine", () => {
  assert.equal(managedBlockReason("CAPABILITY_REVOKED"), "CAPABILITY_REVOKED");
  assert.equal(managedBlockReason("CAPABILITY_QUARANTINED"), "CAPABILITY_QUARANTINED");
  assert.equal(managedBlockReason("PERMISSION_BLOCKED"), "PERMISSION_BLOCKED");
  assert.equal(managedBlockReason(undefined), "PERMISSION_BLOCKED");
});
