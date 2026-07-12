import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { revokeDigest } from "./superskill-revoke.js";

test("revoke dry-run is side-effect free and apply is idempotent", () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "superskill-revoke-")), "revocations.jsonl");
  const input = {
    path: file,
    digest: `sha256:${"a".repeat(64)}`,
    capabilityId: "market-research",
    ref: "harnesses/deep-market-researcher",
    version: "0.2.0",
    reason: "security advisory",
    actor: "OnlyHarness security",
    now: new Date("2026-07-12T00:00:00.000Z")
  };
  assert.equal(revokeDigest({ ...input, apply: false }).appended, false);
  assert.equal(revokeDigest({ ...input, apply: true }).appended, true);
  assert.equal(revokeDigest({ ...input, apply: true }).appended, false);
  assert.equal(readFileSync(file, "utf8").trim().split("\n").length, 1);
});

test("same digest under another alias appends a global block alias", () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "superskill-alias-")), "revocations.jsonl");
  const common = {
    path: file,
    digest: `sha256:${"b".repeat(64)}`,
    version: "0.2.0",
    reason: "digest compromised",
    actor: "OnlyHarness security",
    now: new Date("2026-07-12T00:00:00.000Z"),
    apply: true
  };
  assert.equal(revokeDigest({ ...common, capabilityId: "one", ref: "harnesses/one" }).appended, true);
  assert.equal(revokeDigest({ ...common, capabilityId: "two", ref: "harnesses/two" }).appended, true);
  assert.equal(readFileSync(file, "utf8").trim().split("\n").length, 2);
});

test("a process that does not own the revoke lock never removes it", () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "superskill-foreign-lock-")), "revocations.jsonl");
  writeFileSync(`${file}.lock`, "foreign owner\n", { mode: 0o600 });
  assert.throws(() => revokeDigest({
    path: file,
    digest: `sha256:${"c".repeat(64)}`,
    capabilityId: "locked",
    ref: "harnesses/locked",
    version: "0.2.0",
    reason: "security advisory",
    actor: "OnlyHarness security",
    apply: true
  }), /Revoke store is busy/);
  assert.equal(existsSync(`${file}.lock`), true);
});

test("concurrent revoke processes append one idempotent tombstone without corruption", async () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "superskill-process-race-")), "revocations.jsonl");
  const args = [
    "tsx", "scripts/superskill-revoke.ts",
    "--digest", `sha256:${"d".repeat(64)}`,
    "--capability", "race",
    "--ref", "harnesses/race",
    "--version", "0.2.0",
    "--reason", "security advisory",
    "--actor", "OnlyHarness security",
    "--apply"
  ];
  const run = () => new Promise<number | null>((resolve) => {
    const child = spawn("npx", args, { cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, SUPERSKILL_REVOCATIONS_PATH: file }, stdio: "ignore" });
    child.on("exit", resolve);
  });
  const statuses = await Promise.all([run(), run()]);
  assert.ok(statuses.every((status) => status === 0), `statuses: ${statuses.join(",")}`);
  assert.equal(readFileSync(file, "utf8").trim().split("\n").length, 1);
  assert.equal(existsSync(`${file}.lock`), false);
});
