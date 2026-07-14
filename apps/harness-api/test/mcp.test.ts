import assert from "node:assert/strict";
import test from "node:test";
import { mcpCall, mcpResult, mcpToolCallPreflight, resourceInstructions } from "../src/mcp.js";
import type { Resource } from "../src/resources.js";

test("MCP logical not-found result is a structured tool error", () => {
  const result = mcpResult({ error: "Resource not found", status: 404, id: "missing" });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, "RESOURCE_NOT_FOUND");
  assert.equal(result.structuredContent.status, 404);
  assert.equal(result.structuredContent.id, "missing");
  assert.match(String(result.structuredContent.next), /Search the registry/);
});

test("MCP distinguishes missing credentials from supplied invalid credentials", () => {
  const missing = mcpResult({ error: "Sign in required", status: 401 }, false);
  const expired = mcpResult({ error: "Invalid or expired session", status: 401 }, true);
  assert.equal(missing.structuredContent.code, "AUTH_REQUIRED");
  assert.equal(expired.structuredContent.code, "AUTH_INVALID");
  assert.equal(missing.isError, true);
  assert.equal(expired.isError, true);
});

test("MCP failures preserve stable domain codes without exposing diagnostics", () => {
  const result = mcpResult({
    error: "tar failed at /var/lib/onlyharness/resource-archives/private.tar.gz",
    status: 503,
    code: "ARCHIVE_STORAGE_UNAVAILABLE",
    stderr: "permission denied /app/data/private bearer secret-token",
    stack: "Error at /Users/example/server.ts:1",
    archivePath: "/var/lib/onlyharness/resource-archives/private.tar.gz",
    diagnostic: { refreshToken: "nested-secret-token", safeCode: "RETRY_LATER" }
  });
  const wire = JSON.stringify(result);
  assert.equal(result.structuredContent.code, "ARCHIVE_STORAGE_UNAVAILABLE");
  assert.equal(result.isError, true);
  assert.doesNotMatch(wire, /\/var\/lib|\/app|\/Users|secret-token|stderr|stack|archivePath|refreshToken/);
  assert.match(wire, /RETRY_LATER/);
});

test("MCP handler exceptions become INTERNAL_ERROR tool results", async () => {
  const result = await mcpCall(() => {
    throw new Error("Bearer must-not-leak at /tmp/internal");
  });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, "INTERNAL_ERROR");
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak|\/tmp\/internal/);
});

test("MCP success keeps existing top-level fields and adds machine metadata", () => {
  const result = mcpResult({ items: [{ id: "one" }] });
  assert.equal("isError" in result, false);
  assert.equal(result.structuredContent.code, "OK");
  assert.equal(result.structuredContent.status, 200);
  assert.deepEqual(result.structuredContent.items, [{ id: "one" }]);
});

test("MCP success preserves exact archive file content", () => {
  const content = "Run the local fixture from /tmp/example without changing this text.\n";
  const result = mcpResult({ files: [{ path: "prompts/system.md", content }] });
  assert.equal(result.structuredContent.files[0].content, content);
  assert.match(result.content[0].text, /\/tmp\/example/);
});

test("MCP transport preflight returns stable validation and unknown-tool errors", () => {
  const malformed = mcpToolCallPreflight("publish_resource_package", {});
  assert.equal(malformed?.isError, true);
  assert.equal(malformed?.structuredContent.code, "VALIDATION_FAILED");
  assert.equal(malformed?.structuredContent.status, 422);

  const unknown = mcpToolCallPreflight("missing_tool", {});
  assert.equal(unknown?.isError, true);
  assert.equal(unknown?.structuredContent.code, "TOOL_NOT_FOUND");
  assert.equal(unknown?.structuredContent.status, 404);

  const malformedRead = mcpToolCallPreflight("resource_detail", {});
  assert.equal(malformedRead?.isError, true);
  assert.equal(malformedRead?.structuredContent.code, "VALIDATION_FAILED");
  assert.equal(malformedRead?.structuredContent.status, 422);
});

test("hosted skill instructions route explicit consent to the native client root", () => {
  const resource = {
    id: "onlyharness:packages/clean-user-skill",
    resourceType: "skill",
    installability: "importable",
    trust: { sourceChecked: true, securityScan: "not_scanned", riskTier: "UNKNOWN" },
    licenseStatus: "unknown",
    actions: [
      { id: "open_onlyharness", label: "Use in SuperSkill", url: "https://superskill.sh/#/superskill/resources/onlyharness%3Apackages%2Fclean-user-skill" },
      { id: "download_archive", label: "Download archive", url: "https://superskill.sh/api/resources/onlyharness%3Apackages%2Fclean-user-skill/releases/0.1.1/archive" }
    ]
  } as Resource;
  const instructions = resourceInstructions(resource).join("\n");
  assert.match(instructions, /not a managed approval/);
  assert.match(instructions, /explicit install consent/);
  assert.match(instructions, /onlyharness@0\.3\.0 resources install .* --target codex --allow-unreviewed --json/);
  assert.match(instructions, /onlyharness@0\.3\.0 resources install .* --target claude-code --allow-unreviewed --json/);
});

test("failed hosted skill scan exposes no download or install instruction", () => {
  const resource = {
    id: "onlyharness:packages/blocked-skill",
    resourceType: "skill",
    installability: "importable",
    trust: { sourceChecked: true, securityScan: "fail", riskTier: "CRITICAL" },
    licenseStatus: "unknown",
    actions: [{ id: "download_archive", label: "Download archive", url: "https://superskill.sh/api/resources/onlyharness%3Apackages%2Fblocked-skill/releases/0.1.0/archive" }]
  } as Resource;
  const instructions = resourceInstructions(resource, { version: "0.1.0", artifactDigest: "a".repeat(64), archiveSize: 123, trust: "unreviewed" }).join("\n");
  assert.match(instructions, /Download and installation are blocked/);
  assert.doesNotMatch(instructions, /resources install|Download hosted resource archive/);
});
