import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalArtifactDigest, readArtifactFilesFromRoot } from "../src/node.js";

test("artifact digest is stable across file order and byte-sensitive", () => {
  const files = [
    { path: "README.md", content: "hello\r\n" },
    { path: "agents/main.md", content: "\ufeffprompt\n" }
  ];
  const expected = "sha256:d2409cdfdbc1152c8c2cbdb209ba55c929fbd6349ade77dc38f6865ee460046e";
  assert.equal(canonicalArtifactDigest(files), expected);
  assert.equal(canonicalArtifactDigest([...files].reverse()), expected);
  assert.notEqual(canonicalArtifactDigest([{ ...files[0], content: "hello\n" }, files[1]]), expected);
});

test("artifact path and completeness rules fail closed", () => {
  for (const invalid of ["../x", "/abs", "a\\b", "a//b", "a/./b", "e\u0301.md", "\0x"]) {
    assert.throws(() => canonicalArtifactDigest([{ path: invalid, content: "x" }]));
  }
  assert.throws(() => canonicalArtifactDigest([{ path: "a", content: "x" }, { path: "a", content: "y" }]));
  assert.throws(() => canonicalArtifactDigest({ files: [{ path: "a", content: "x" }], totalFileCount: 2 }));
  assert.throws(() => canonicalArtifactDigest({ files: [{ path: "a", content: "x" }], archiveTruncated: true }));
  assert.throws(() => canonicalArtifactDigest(Array.from({ length: 81 }, (_, i) => ({ path: `f${i}`, content: "x" }))));
  assert.throws(() => canonicalArtifactDigest([{ path: "large", content: "x".repeat(256 * 1024 + 1) }]));
  assert.throws(() => canonicalArtifactDigest([{ path: "bad", content: Uint8Array.from([0xff]) }]));
});

test("filesystem helper rejects symlinks before reading", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "superskill-artifact-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "superskill-outside-"));
  mkdirSync(path.join(root, "agents"));
  writeFileSync(path.join(outside, "secret.md"), "secret");
  symlinkSync(path.join(outside, "secret.md"), path.join(root, "agents", "main.md"));
  assert.throws(() => readArtifactFilesFromRoot(root, ["agents/main.md"]), /not a regular file/);
});
