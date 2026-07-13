import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  assertExactClientVersion,
  assertClientToolIsolation,
  assertLocalPostgresUrl,
  assertLocalSupabaseUrl,
  assertRawArtifactsSafe,
  assertSanitizedEvidence,
  buildStrictClientEnv,
  canonicalRoot,
  CompatibilityProbeError,
  measureInvalidPluginPreflight,
  parseClaudeMcpToolCalls,
  parseCodexMcpToolCalls,
  resolveExplicitFallback,
  scanRawArtifacts,
  snapshotTree,
  validateProbePluginConfig
} from "./superskill-mcp-compatibility-probe-core.js";

test("exact client pins and local-only Supabase fail closed", () => {
  assert.doesNotThrow(() => assertExactClientVersion("codex", "codex-cli 0.144.3"));
  assert.doesNotThrow(() => assertExactClientVersion("claude-code", "2.1.112 (Claude Code)"));
  assert.throws(() => assertExactClientVersion("codex", "codex-cli 0.144.4"), hasCode("PROBE_CLIENT_VERSION_MISMATCH"));
  assert.equal(assertLocalSupabaseUrl("http://127.0.0.1:55321").hostname, "127.0.0.1");
  assert.throws(() => assertLocalSupabaseUrl("https://example.test"), hasCode("PROBE_LOCAL_SUPABASE_REQUIRED"));
  assert.equal(assertLocalPostgresUrl("postgresql://postgres:postgres@127.0.0.1:55322/postgres").hostname, "127.0.0.1");
  assert.throws(() => assertLocalPostgresUrl("postgresql://example.test/db"), hasCode("PROBE_LOCAL_DATABASE_REQUIRED"));
});

test("canonical roots require exact URI and fallback rejects traversal, off-root and symlinks", () => {
  const root = mkdtempSync(path.join(tmpdir(), "superskill-compat-root-"));
  const outside = mkdtempSync(path.join(tmpdir(), "superskill-compat-outside-"));
  mkdirSync(path.join(root, "nested"));
  symlinkSync(outside, path.join(root, "escape"));
  const canonical = canonicalRoot(root);
  const exact = resolveExplicitFallback(root, ".");
  assert.equal(exact.uri, canonical.uri);
  assert.equal(exact.exactExpectedRoot, true);
  assert.equal(resolveExplicitFallback(root, "nested").exactExpectedRoot, false);
  assert.throws(() => resolveExplicitFallback(root, "../"), hasCode("PROBE_ROOT_OUTSIDE_WORKSPACE"));
  assert.throws(() => resolveExplicitFallback(root, outside), hasCode("PROBE_ROOT_OUTSIDE_WORKSPACE"));
  assert.throws(() => resolveExplicitFallback(root, "escape"), hasCode("PROBE_ROOT_OUTSIDE_WORKSPACE"));
});

test("snapshot covers full workspace and server state without following symlinks", () => {
  const root = mkdtempSync(path.join(tmpdir(), "superskill-compat-snapshot-"));
  const state = path.join(root, "state");
  mkdirSync(state);
  const before = snapshotTree(root);
  writeFileSync(path.join(state, "unexpected"), "x");
  assert.notEqual(snapshotTree(root), before);
});

test("client-specific plugin preflight rejects invalid schema before server state exists", () => {
  const remoteUrl = "http://127.0.0.1:48787/mcp";
  const codex = {
    mcp_servers: {
      superskill_remote_probe: { type: "http", url: remoteUrl, bearer_token_env_var: "SUPERSKILL_ACCESS_TOKEN" },
      superskill_local_probe: {
        command: "node",
        args: ["probe-server.mjs"],
        cwd: ".",
        env_vars: [
          "SUPERSKILL_ACCESS_TOKEN",
          "SUPERSKILL_PROBE_API_URL",
          "SUPERSKILL_PROBE_CLIENT",
          "SUPERSKILL_PROBE_ROOT",
          "SUPERSKILL_PROBE_STATE_ROOT"
        ]
      }
    }
  };
  const claude = {
    mcpServers: {
      superskill_remote_probe: { type: "http", url: remoteUrl, headers: { Authorization: "Bearer ${SUPERSKILL_ACCESS_TOKEN}" } },
      superskill_local_probe: {
        command: "node",
        args: ["${CLAUDE_PLUGIN_ROOT}/probe-server.mjs"],
        env: {
          SUPERSKILL_ACCESS_TOKEN: "${SUPERSKILL_ACCESS_TOKEN}",
          SUPERSKILL_PROBE_API_URL: "${SUPERSKILL_PROBE_API_URL}",
          SUPERSKILL_PROBE_CLIENT: "${SUPERSKILL_PROBE_CLIENT}",
          SUPERSKILL_PROBE_ROOT: "${SUPERSKILL_PROBE_ROOT}",
          SUPERSKILL_PROBE_STATE_ROOT: "${SUPERSKILL_PROBE_STATE_ROOT}"
        }
      }
    }
  };
  assert.doesNotThrow(() => validateProbePluginConfig("codex", codex));
  assert.doesNotThrow(() => validateProbePluginConfig("claude-code", claude));
  assert.throws(() => validateProbePluginConfig("codex", { mcp_servers: { superskill_remote_probe: codex.mcp_servers.superskill_remote_probe } }), hasCode("PROBE_PLUGIN_SCHEMA_INVALID"));
  assert.throws(() => validateProbePluginConfig("claude-code", codex), hasCode("PROBE_PLUGIN_SCHEMA_INVALID"));
  let starts = 0;
  const measured = measureInvalidPluginPreflight("codex", { mcpServers: {} }, () => { starts += 1; });
  assert.deepEqual(measured, { code: "PROBE_PLUGIN_SCHEMA_INVALID", serverStartCount: 0 });
  assert.equal(starts, 0);
});

test("client environment is a strict allowlist and excludes privileged source secrets", () => {
  const env = buildStrictClientEnv({
    PATH: "/bin",
    SUPABASE_SERVICE_ROLE_KEY: "service-secret",
    SUPABASE_ANON_KEY: "anon-secret",
    SUPERSKILL_SUBJECT_SALT: "subject-secret",
    UNRELATED_SECRET: "unrelated-secret"
  }, {
    HOME: "/isolated",
    SUPERSKILL_ACCESS_TOKEN: "managed-access",
    SUPERSKILL_PROBE_API_URL: "http://127.0.0.1:8787/",
    SUPERSKILL_PROBE_CLIENT: "codex",
    SUPERSKILL_PROBE_ROOT: "/workspace",
    SUPERSKILL_PROBE_STATE_ROOT: "/state"
  });
  assert.deepEqual(Object.keys(env).sort(), [
    "HOME",
    "PATH",
    "SUPERSKILL_ACCESS_TOKEN",
    "SUPERSKILL_PROBE_API_URL",
    "SUPERSKILL_PROBE_CLIENT",
    "SUPERSKILL_PROBE_ROOT",
    "SUPERSKILL_PROBE_STATE_ROOT"
  ]);
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(env.UNRELATED_SECRET, undefined);
  assert.throws(() => buildStrictClientEnv({}, { NOT_ALLOWED: "x" }), hasCode("PROBE_CLIENT_ENV_INVALID"));
});

test("structural client parsers bind exact call ids, servers, tools and typed results", () => {
  const codex = [
    codexCall("c1", "plugin:superskill-compatibility-probe:superskill_remote_probe", "publish_resource_package", { ok: false, code: "PUBLISH_DISABLED" }),
    codexCall("c2", "superskill_local_probe", "recommend_probe", { ok: true, code: "PROBE_NO_SAFE_MATCH", decision: "no_safe_match" }),
    codexCall("c3", "superskill_local_probe", "root_probe", { ok: true, code: "PROBE_ROOT_OK", mode: "roots_list", canonicalMatch: true }),
    codexCall("c4", "superskill_local_probe", "denied_mutation", { ok: false, code: "MUTATION_DENIED", workspaceDiffCount: 0, stateDiffCount: 0 })
  ].join("\n");
  const codexCalls = parseCodexMcpToolCalls(codex);
  assert.equal(codexCalls.length, 4);
  assert.equal(codexCalls[3].workspaceDiffCount, 0);
  assert.equal(codexCalls[3].stateDiffCount, 0);
  assert.match(codexCalls[0].callIdDigest, /^sha256:[a-f0-9]{64}$/);
  assert.doesNotThrow(() => assertClientToolIsolation("codex", codex));

  const claudeRecords = [
    claudeUse("u1", "superskill_remote_probe", "publish_resource_package"),
    claudeResult("u1", { ok: false, code: "PUBLISH_DISABLED" }),
    claudeUse("u2", "superskill_local_probe", "recommend_probe"),
    claudeResult("u2", { ok: true, code: "PROBE_NO_SAFE_MATCH", decision: "no_safe_match" }),
    claudeUse("u3", "superskill_local_probe", "root_probe"),
    claudeResult("u3", { ok: true, code: "PROBE_ROOT_OK", mode: "explicit_fallback", canonicalMatch: true }),
    claudeUse("u4", "superskill_local_probe", "denied_mutation"),
    claudeResult("u4", { ok: false, code: "MUTATION_DENIED", workspaceDiffCount: 0, stateDiffCount: 0 })
  ].map((record) => JSON.stringify(record)).join("\n");
  const claudeCalls = parseClaudeMcpToolCalls(claudeRecords);
  assert.equal(claudeCalls.length, 4);
  assert.equal(claudeCalls[2].canonicalMatch, true);
  assert.doesNotThrow(() => assertClientToolIsolation("claude-code", claudeRecords));
  assert.throws(() => assertClientToolIsolation("claude-code", JSON.stringify({ type: "tool_use", id: "x", name: "Bash" })), hasCode("PROBE_FORBIDDEN_CLIENT_TOOL"));
  assert.throws(() => assertClientToolIsolation("codex", JSON.stringify({ type: "item.completed", item: { id: "x", type: "command_execution" } })), hasCode("PROBE_FORBIDDEN_CLIENT_TOOL"));
});

test("raw artifact scan computes leak state and fails on secrets, identities and machine paths", () => {
  const safe = scanRawArtifacts({ artifacts: [JSON.stringify({ code: "PUBLISH_DISABLED" })], credentialFragments: ["secret-token"], identityFragments: ["qa@example.invalid"] });
  assert.deepEqual(safe, {
    artifactCount: 1,
    credentialMaterialAbsent: true,
    providerIdentityAbsent: true,
    rawMachineLocationAbsent: true,
    taskTextAbsent: true
  });
  assert.doesNotThrow(() => assertRawArtifactsSafe(safe));
  const unsafe = scanRawArtifacts({
    artifacts: ["Bearer secret-token qa@example.invalid file:///Users/test/work"],
    credentialFragments: ["secret-token"],
    identityFragments: ["qa@example.invalid"]
  });
  assert.throws(() => assertRawArtifactsSafe(unsafe), hasCode("PROBE_RAW_OUTPUT_UNSAFE"));
});

test("durable evidence guard rejects credentials, paths, prompts and provider identifiers", () => {
  assert.doesNotThrow(() => assertSanitizedEvidence({ status: "blocked", code: "PROBE_LOCAL_SUPABASE_UNAVAILABLE", diffCount: 0 }));
  assert.throws(() => assertSanitizedEvidence({ path: "/tmp/x" }), hasCode("PROBE_EVIDENCE_UNSAFE"));
  assert.throws(() => assertSanitizedEvidence({ authorization: "Bearer secret" }), hasCode("PROBE_EVIDENCE_UNSAFE"));
  assert.throws(() => assertSanitizedEvidence({ prompt: "call a tool" }), hasCode("PROBE_EVIDENCE_UNSAFE"));
});

test("standalone stdio probe performs authenticated recommend, exact root and zero-diff denied mutation", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "superskill-compat-stdio-"));
  const state = path.join(root, "state");
  mkdirSync(state);
  writeFileSync(path.join(root, "fixture.txt"), "immutable");
  const server = createServer(async (request, response) => {
    if (request.url === "/recommendations") {
      const authenticated = request.headers.authorization === "Bearer local-fixture-token";
      response.writeHead(authenticated ? 200 : 401, { "content-type": "application/json" });
      response.end(JSON.stringify(authenticated ? { decision: "no_safe_match" } : { code: "SUPERSKILL_AUTH_REQUIRED" }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/`;
  const serverScript = fileURLToPath(new URL("./fixtures/superskill-mcp-compat-probe-server.mjs", import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverScript],
    cwd: root,
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "",
      SUPERSKILL_ACCESS_TOKEN: "local-fixture-token",
      SUPERSKILL_PROBE_API_URL: base,
      SUPERSKILL_PROBE_CLIENT: "codex",
      SUPERSKILL_PROBE_ROOT: root,
      SUPERSKILL_PROBE_STATE_ROOT: state
    }
  });
  const client = new Client({ name: "compatibility-probe-test", version: "1.0.0" }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: [{ uri: canonicalRoot(root).uri, name: "workspace" }] }));
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["denied_mutation", "recommend_probe", "root_probe"]);
    const recommend = await client.callTool({ name: "recommend_probe", arguments: { client: "codex" } });
    assert.equal((recommend.structuredContent as { decision?: string }).decision, "no_safe_match");
    const roots = await client.callTool({ name: "root_probe", arguments: { explicitFallback: "." } });
    assert.equal((roots.structuredContent as { canonicalMatch?: boolean }).canonicalMatch, true);
    const beforeWorkspace = snapshotTree(root);
    const beforeState = snapshotTree(state);
    const denied = await client.callTool({ name: "denied_mutation", arguments: {} });
    assert.equal(denied.isError, true);
    assert.equal((denied.structuredContent as { code?: string }).code, "MUTATION_DENIED");
    assert.equal(snapshotTree(root), beforeWorkspace);
    assert.equal(snapshotTree(state), beforeState);
  } finally {
    await client.close();
  }

  const anonymousTransport = new StdioClientTransport({
    command: process.execPath,
    args: [serverScript],
    cwd: root,
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "",
      SUPERSKILL_PROBE_API_URL: base,
      SUPERSKILL_PROBE_CLIENT: "codex",
      SUPERSKILL_PROBE_ROOT: root,
      SUPERSKILL_PROBE_STATE_ROOT: state
    }
  });
  const anonymousClient = new Client({ name: "compatibility-probe-anonymous-test", version: "1.0.0" }, { capabilities: { roots: {} } });
  anonymousClient.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: [] }));
  try {
    await anonymousClient.connect(anonymousTransport);
    const result = await anonymousClient.callTool({ name: "recommend_probe", arguments: { client: "codex" } });
    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as { code?: string }).code, "SUPERSKILL_AUTH_REQUIRED");
  } finally {
    await anonymousClient.close();
    server.close();
  }
});

function codexCall(id: string, server: string, tool: string, result: Record<string, unknown>): string {
  return JSON.stringify({ type: "mcp_tool_call_end", call_id: id, server, tool, result: { structuredContent: result } });
}

function claudeUse(id: string, server: string, tool: string): Record<string, unknown> {
  return {
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id, name: `mcp__plugin_superskill-compatibility-probe_${server}__${tool}`, input: {} }]
    }
  };
}

function claudeResult(id: string, result: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: JSON.stringify(result) }] }]
    }
  };
}

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof CompatibilityProbeError && error.code === code;
}
