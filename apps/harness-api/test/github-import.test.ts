import test from "node:test";
import assert from "node:assert/strict";
import { classifyDetectedFiles, GitHubImportError, parseGitHubResourceTarget, validateArchiveEntries } from "../src/github-import.js";

test("parseGitHubResourceTarget accepts canonical GitHub repo URLs and safe paths", () => {
  const target = parseGitHubResourceTarget("https://github.com/acme/agent-skills/tree/main/skills/researcher", "skills/researcher");

  assert.equal(target.owner, "acme");
  assert.equal(target.repo, "agent-skills");
  assert.equal(target.path, "skills/researcher");
  assert.equal(target.url, "https://github.com/acme/agent-skills");
});

test("parseGitHubResourceTarget rejects SSRF and traversal inputs", () => {
  assertGitHubImportError(() => parseGitHubResourceTarget("http://github.com/acme/repo"), "UNSAFE_GITHUB_URL");
  assertGitHubImportError(() => parseGitHubResourceTarget("https://localhost/acme/repo"), "UNSAFE_GITHUB_URL");
  assertGitHubImportError(() => parseGitHubResourceTarget("https://127.0.0.1/acme/repo"), "UNSAFE_GITHUB_URL");
  assertGitHubImportError(() => parseGitHubResourceTarget("https://github.com/acme/repo", "../secrets"), "UNSAFE_PATH");
  assertGitHubImportError(() => parseGitHubResourceTarget("https://token@github.com/acme/repo"), "UNSAFE_GITHUB_URL");
});

test("archive guardrails reject symlinks, traversal and zip-bomb-shaped payloads", () => {
  assert.doesNotThrow(() => validateArchiveEntries([{ path: "skills/researcher/SKILL.md", size: 1024, type: "file" }]));
  assertGitHubImportError(() => validateArchiveEntries([{ path: "../secret", size: 1, type: "file" }]), "UNSAFE_PATH");
  assertGitHubImportError(() => validateArchiveEntries([{ path: "safe/link", size: 1, type: "symlink" }]), "UNSAFE_ARCHIVE_ENTRY");
  assertGitHubImportError(() => validateArchiveEntries([{ path: "big.bin", size: 9 * 1024 * 1024, type: "file" }]), "ARCHIVE_TOO_LARGE");
});

test("classifyDetectedFiles identifies common agent resource layouts", () => {
  assert.equal(classifyDetectedFiles(["harness.yaml"]), "harness_candidate");
  assert.equal(classifyDetectedFiles(["skills/researcher/SKILL.md"]), "skill");
  assert.equal(classifyDetectedFiles([".claude-plugin/plugin.json"]), "plugin");
  assert.equal(classifyDetectedFiles(["servers/browser-mcp/server.json"]), "mcp_server");
  assert.equal(classifyDetectedFiles(["commands/review.md"]), "command_pack");
  assert.equal(classifyDetectedFiles(["README.md"]), "workflow");
});

function assertGitHubImportError(fn: () => unknown, code: string) {
  assert.throws(fn, (error) => error instanceof GitHubImportError && error.code === code);
}
