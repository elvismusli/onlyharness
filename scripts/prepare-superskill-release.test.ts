import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  acquireReleaseCutLock,
  buildReleaseCut,
  parseReleaseCutArgs,
  recoverReleaseCutJournal,
  runReleaseCut,
  writeReleaseCutJournal
} from "./prepare-superskill-release.js";

const root = path.resolve(import.meta.dirname, "..");

test("release-cut CLI is explicit, dry-run by default and fail closed", () => {
  assert.deepEqual(parseReleaseCutArgs(["--id", "founder-decision-memo", "--from", "0.2.0", "--to", "0.2.1"]), {
    id: "founder-decision-memo",
    from: "0.2.0",
    to: "0.2.1",
    write: false
  });
  assert.equal(parseReleaseCutArgs(["--id", "founder-decision-memo", "--from", "0.2.0", "--to", "0.2.1", "--write"]).write, true);
  assert.throws(() => parseReleaseCutArgs(["--id", "../escape", "--from", "0.2.0", "--to", "0.2.1"]), /canonical capability id/);
  assert.throws(() => parseReleaseCutArgs(["--id", "fixture", "--from", "0.2.1", "--to", "0.2.0"]), /greater than/);
  assert.throws(() => parseReleaseCutArgs(["--id", "fixture", "--from", "0.2.0", "--to", "0.2.1", "--write", "--write"]), /Duplicate/);
  assert.throws(() => parseReleaseCutArgs(["--id", "fixture", "--from", "0.2.0", "--to", "0.2.1", "--approve"]), /Unknown/);
});

test("release cut removes only executable workflow and produces the expected immutable digest", () => {
  const snapshot = JSON.parse(readFileSync(path.join(root, "data/harness-versions/harnesses/founder-decision-memo/0.2.0.json"), "utf8")) as {
    files: Array<{ path: string; content: string; truncated?: boolean }>;
  };
  const result = buildReleaseCut({ id: "founder-decision-memo" }, "0.2.0", "0.2.1", snapshot.files);
  assert.equal(result.artifactDigest, "sha256:0bc35e1b235de5fb5b4ae5875a8a5cec3ed608e7c062dabe9547dec795958017");
  assert.equal(result.files.length, snapshot.files.length - 1);
  assert.deepEqual(result.removedFiles, [".gitea/workflows/harness-ci.yml"]);
  assert.equal(result.files.some((file) => file.path === ".gitea/workflows/harness-ci.yml"), false);
  assert.equal(result.files.find((file) => file.path === "harness.yaml")?.content.includes("version: 0.2.1"), true);
  assert.notEqual(result.capabilityDiff.status, "fail");
});

test("repeat release cut accepts an already sanitized snapshot without claiming a removal", () => {
  const snapshot = JSON.parse(readFileSync(path.join(root, "data/harness-versions/harnesses/founder-decision-memo/0.2.1.json"), "utf8")) as {
    files: Array<{ path: string; content: string; truncated?: boolean }>;
  };
  const result = buildReleaseCut({ id: "founder-decision-memo" }, "0.2.1", "0.2.2", snapshot.files);
  assert.equal(result.files.length, snapshot.files.length);
  assert.deepEqual(result.removedFiles, []);
  assert.equal(result.files.some((file) => file.path === ".gitea/workflows/harness-ci.yml"), false);
  assert.equal(result.files.find((file) => file.path === "harness.yaml")?.content.includes("version: 0.2.2"), true);
  assert.notEqual(result.capabilityDiff.status, "fail");
});

test("current candidate supports a real repeat release-cut dry-run without writing", () => {
  const target = path.join(root, "data/harness-versions/harnesses/founder-decision-memo/0.2.2.json");
  assert.equal(existsSync(target), false);
  const result = runReleaseCut({ id: "founder-decision-memo", from: "0.2.1", to: "0.2.2", write: false });
  assert.equal(result.write, false);
  assert.deepEqual(result.removedFiles, []);
  assert.equal(result.fileCount, 12);
  assert.equal(existsSync(target), false);
});

test("release cut rejects duplicate workflow, tuple drift and additional executable content", () => {
  const snapshot = JSON.parse(readFileSync(path.join(root, "data/harness-versions/harnesses/founder-decision-memo/0.2.0.json"), "utf8")) as {
    files: Array<{ path: string; content: string; truncated?: boolean }>;
  };
  const workflow = snapshot.files.find((file) => file.path === ".gitea/workflows/harness-ci.yml");
  assert.ok(workflow);
  assert.throws(() => buildReleaseCut({ id: "founder-decision-memo" }, "0.2.0", "0.2.1", [...snapshot.files, workflow]), /at most one/);
  assert.throws(() => buildReleaseCut({ id: "wrong-id" }, "0.2.0", "0.2.1", snapshot.files), /tuple mismatch/);
  assert.throws(() => buildReleaseCut({ id: "founder-decision-memo" }, "0.2.0", "0.2.1", [...snapshot.files, { path: "run.sh", content: "echo unsafe" }]), /instruction-only/);
});

test("release-cut journal restores pre-write bytes after a simulated process crash", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "superskill-release-recovery-"));
  const original = path.join(workspace, "data/original.json");
  const created = path.join(workspace, "data/new.json");
  const journal = path.join(workspace, "data/journal.json");
  mkdirSync(path.dirname(original), { recursive: true });
  writeFileSync(original, "before\n");
  const before = new Map<string, Buffer | undefined>([
    [original, readFileSync(original)],
    [created, undefined]
  ]);
  writeReleaseCutJournal(journal, workspace, before, { id: "fixture", from: "0.2.0", to: "0.2.1" });
  writeFileSync(original, "partial-write\n");
  writeFileSync(created, "partial-new-file\n");

  assert.equal(recoverReleaseCutJournal(journal, workspace), true);
  assert.equal(readFileSync(original, "utf8"), "before\n");
  assert.equal(existsSync(created), false);
  assert.equal(existsSync(journal), false);
  assert.equal(recoverReleaseCutJournal(journal, workspace), false);
});

test("release-cut lock rejects concurrency and recovers a dead owner", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "superskill-release-lock-"));
  const lock = path.join(workspace, "release.lock");
  const release = acquireReleaseCutLock(lock);
  assert.throws(() => acquireReleaseCutLock(lock), /already locked/);
  release();
  assert.equal(existsSync(lock), false);

  writeFileSync(lock, `${JSON.stringify({ schemaVersion: "superskill.release-cut-lock.v1", pid: 2_147_483_647, startedAt: "2026-07-13T00:00:00.000Z" })}\n`);
  const afterStale = acquireReleaseCutLock(lock);
  afterStale();
  assert.equal(existsSync(lock), false);
});
