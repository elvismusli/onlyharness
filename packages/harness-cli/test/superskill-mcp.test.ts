import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer, type Server as HttpServer } from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { canonicalArtifactDigest } from "@harnesshub/capability-schema/node";
import type { ManagedCapability } from "@harnesshub/capability-schema/browser";
import { computeDecisionDigest } from "../src/lib/superskill-client.js";

const seed = path.resolve(import.meta.dirname, "../../../seed-harnesses/deep-market-researcher");
const files = collectFiles(seed);
const artifactDigest = canonicalArtifactDigest(files);
const version = readFileSync(path.join(seed, "harness.yaml"), "utf8").match(/^version:\s*(\S+)\s*$/m)?.[1];
if (!version) throw new Error("fixture version missing");
const expiresAt = "2099-01-01T00:00:00.000Z";
const capability: ManagedCapability = {
  id: "market-research",
  type: "instruction_harness",
  title: "Deep Market Researcher",
  summary: "Reviewed market research workflow.",
  jobs: [{ id: "market-research", intents: ["market research"], outcomes: ["source-backed comparison"], exclusions: ["send outreach"] }],
  release: { ref: "harnesses/deep-market-researcher", version, artifactDigest, immutable: true, publishedAt: "2026-07-01T00:00:00.000Z", delivery: "free_archive" },
  source: { owner: "SuperSkill", url: "https://superskill.sh", license: "MIT" },
  compatibility: [
    { client: "claude-code", status: "verified", verifiedAt: "2026-07-01T00:00:00.000Z" },
    { client: "codex", status: "verified", verifiedAt: "2026-07-01T00:00:00.000Z" }
  ],
  permissions: {
    network: "allowlist",
    networkAllowlist: ["example.com"],
    filesystem: "readonly",
    shell: false,
    browser: true,
    credentials: "false",
    externalSend: false,
    moneyMovement: false,
    userData: false,
    humanApprovalRequired: []
  },
  contextCost: { approxTokens: 1000, files: files.length, bytes: files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0), status: "estimated" },
  trust: {
    status: "approved",
    riskScore: 12,
    riskTier: "LOW",
    checks: [{ id: "artifact_digest", status: "pass", evidenceLevel: "static_checked", checkedAt: "2026-07-01T00:00:00.000Z", summary: "Exact digest matched." }],
    limitations: ["Public web sources may be incomplete."],
    reviewedAt: "2026-07-01T00:00:00.000Z"
  }
};

let api: HttpServer;
let registry = "";
let unsafeArchive = false;
let releaseRevoked = false;
let stallExactRelease = false;
let lastIdempotencyKey = "";
let markdownPublishCalls = 0;
let lastWorkspaceIdempotencyKey = "";
let lastWorkspacePublishIdempotencyKey = "";
let requestedAuthScopes = ["superskill:managed"];
const requestBodies: string[] = [];

before(async () => {
  api = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      if (body) requestBodies.push(body);
      if (request.url === "/auth/agent/start" && request.method === "POST") {
        requestedAuthScopes = (JSON.parse(body) as { scopes?: string[] }).scopes ?? [];
        const browserUrl = `${registry}/#/superskill/connect?request=ohrq_${"r".repeat(43)}&proof=ohbp_${"b".repeat(43)}`;
        response.statusCode = 201;
        response.end(JSON.stringify({
          request_id: `ohrq_${"r".repeat(43)}`,
          device_proof: `ohdp_${"d".repeat(43)}`,
          browser_url: browserUrl,
          verification_uri: browserUrl,
          expires_in: 600,
          interval: 1
        }));
        return;
      }
      if (request.url === "/auth/agent/token" && request.method === "POST") {
        response.end(JSON.stringify({
          access_token: `ohat_${"a".repeat(43)}`,
          refresh_token: `ohrt_${"f".repeat(43)}`,
          token_type: "Bearer",
          expires_in: 600,
          session_expires_in: 30 * 24 * 60 * 60,
          scope: requestedAuthScopes.join(" ")
        }));
        return;
      }
      if (request.headers.authorization !== "Bearer mcp-fixture-secret" && request.headers.authorization !== `Bearer ohat_${"a".repeat(43)}`) {
        response.statusCode = 401;
        response.end(JSON.stringify({ code: "SUPERSKILL_AUTH_REQUIRED" }));
        return;
      }
      if (request.url === "/recommendations" && request.method === "POST") {
        const client = (JSON.parse(body) as { context: { client: "codex" | "claude-code" } }).context.client;
        response.end(JSON.stringify({
          recommendationId: "rec_mcpfixture123",
          decisionDigest: computeDecisionDigest(capability, client, expiresAt, "rec_mcpfixture123"),
          decision: "recommend",
          confidence: 0.95,
          selected: {
            capability,
            score: 95,
            why: [{ code: "INTENT_EXACT", text: "Exact reviewed match.", points: 50 }],
            limitations: capability.trust.limitations,
            permissionDelta: { status: "known", added: ["browser"], unchanged: [] },
            consent: "required"
          },
          alternatives: [],
          expiresAt
        }));
        return;
      }
      if (request.url === "/superskill/handoff/decision" && request.method === "POST") {
        const client = (JSON.parse(body) as { client: "codex" | "claude-code" }).client;
        response.end(JSON.stringify({
          recommendationId: "rec_mcphandoff123",
          decisionDigest: computeDecisionDigest(capability, client, expiresAt, "rec_mcphandoff123"),
          decision: "recommend",
          confidence: 1,
          selected: {
            capability,
            score: 100,
            why: [{ code: "CLIENT_VERIFIED", text: "Exact handoff remains approved.", points: 100 }],
            limitations: capability.trust.limitations,
            permissionDelta: { status: "partial", added: ["browser"], unchanged: [], unknownBecause: "Local unmanaged baseline is unknown." },
            consent: "required"
          },
          alternatives: [],
          expiresAt
        }));
        return;
      }
      if (request.url === `/capabilities/${capability.id}/releases/${version}`) {
        if (stallExactRelease) return;
        response.end(JSON.stringify(releaseRevoked
          ? { capability: { ...capability, trust: { ...capability.trust, status: "revoked" } }, activationAllowed: false, blockCode: "CAPABILITY_REVOKED" }
          : { capability, activationAllowed: true, archive: { url: `${registry}/capabilities/${capability.id}/releases/${version}/archive`, artifactDigest } }));
        return;
      }
      if (request.url === `/capabilities/${capability.id}/releases/${version}/archive`) {
        const archiveFiles = unsafeArchive ? [{ path: "../escape.md", content: "unsafe", truncated: false }] : files;
        response.end(JSON.stringify({ owner: "harnesses", repo: "deep-market-researcher", version, snapshot: true, artifactDigest, totalFileCount: archiveFiles.length, archiveTruncated: false, files: archiveFiles }));
        return;
      }
      if (request.url === "/events") {
        response.end(JSON.stringify({ recorded: true }));
        return;
      }
      if (request.url === "/imports/markdown-to-harness" && request.method === "POST") {
        markdownPublishCalls += 1;
        lastIdempotencyKey = String(request.headers["idempotency-key"] ?? "");
        response.statusCode = 201;
        response.end(JSON.stringify({ item: { name: "same-task", title: "Same task" }, snapshotVersion: "1" }));
        return;
      }
      if (request.url === "/workspaces" && request.method === "POST") {
        lastWorkspaceIdempotencyKey = String(request.headers["idempotency-key"] ?? "");
        response.statusCode = 201;
        response.end(JSON.stringify({ workspace: { slug: "acme", name: "Acme" }, replay: false }));
        return;
      }
      if (request.url === "/workspaces/acme/imports/resource-package" && request.method === "POST") {
        lastWorkspacePublishIdempotencyKey = String(request.headers["idempotency-key"] ?? "");
        response.statusCode = 201;
        response.end(JSON.stringify({ resource: { id: "@acme/team-workflow", name: "team-workflow" }, replay: false }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ code: "CAPABILITY_NOT_FOUND" }));
    });
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const address = api.address();
  if (!address || typeof address === "string") throw new Error("fixture API did not bind");
  registry = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
});

test("real stdio MCP exposes the agent-first auth/account surface and runs the consent-bound Codex lifecycle without path leaks", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-mcp-project-"));
  const home = mkdtempSync(path.join(os.tmpdir(), "superskill-mcp-home-"));
  execFileSync("git", ["init", "-q"], { cwd: project });
  const exclude = path.join(project, ".git", "info", "exclude");
  const excludeBefore = readFileSync(exclude, "utf8");
  const { client, transport } = createMcpClient(project, home, true);
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), [
      "auth_status",
      "auth_start",
      "auth_wait",
      "auth_logout",
      "activation_doctor",
      "recommend",
      "activation_start",
      "activation_mark_loaded",
      "activation_mark_invoked",
      "activation_finish",
      "activation_keep",
      "activation_remove",
      "publish_markdown_to_harness",
      "publish_resource_package",
      "workspace_create",
      "workspace_get",
      "workspace_publish_resource",
      "workspace_install"
    ]);

    const doctor = await client.callTool({ name: "activation_doctor", arguments: { client: "codex" } });
    assert.equal(structured(doctor).ok, true);
    assert.equal(existsSync(path.join(project, ".onlyharness")), false, "doctor must not initialize state");
    assert.equal(readFileSync(exclude, "utf8"), excludeBefore, "doctor must not touch git exclude");

    const taskSummary = "compare reviewed market research sources";
    const recommended = await client.callTool({ name: "recommend", arguments: { client: "codex", taskSummary, routingConsent: true } });
    const recommendation = structured(recommended).recommendation as { recommendationId: string; decisionDigest: string; expiresAt: string };
    assert.equal(existsSync(path.join(project, ".onlyharness")), false, "recommend must not initialize state");

    const bad = await client.callTool({ name: "activation_start", arguments: startArgs(recommendation, `sha256:${"0".repeat(64)}`, "req_mcp_bad_digest") });
    assert.equal(bad.isError, true);
    assert.equal(structured(bad).code, "ARTIFACT_DIGEST_MISMATCH");
    assert.equal(existsSync(path.join(project, ".onlyharness")), false, "metadata digest mismatch must fail before state write");

    unsafeArchive = true;
    const unsafe = await client.callTool({ name: "activation_start", arguments: startArgs(recommendation, artifactDigest, "req_mcp_unsafe_path") });
    unsafeArchive = false;
    assert.equal(unsafe.isError, true);
    assert.equal(existsSync(path.join(project, ".onlyharness")), false, "unsafe archive must fail before state write");
    assert.equal(existsSync(path.join(project, "escape.md")), false);

    const started = await client.callTool({ name: "activation_start", arguments: startArgs(recommendation, artifactDigest, "req_mcp_lifecycle") });
    const start = structured(started);
    const activationId = start.activationId as string;
    assert.equal(start.code, "ACTIVATION_READY");
    assert.equal(existsSync(path.join(project, ".agents", "skills")), false, "temporary start must not write Codex native skills");
    assert.equal(existsSync(path.join(project, ".claude", "skills")), false);
    assert.equal(JSON.stringify(started).includes(project), false, "MCP result must not expose root");
    assert.equal(JSON.stringify(started).includes("mcp-fixture-secret"), false);
    assert.equal(JSON.stringify(started).includes(taskSummary), false);

    const plan = start.plan as { files: Array<{ path: string; resourceUri: string }> };
    assert.ok(plan.files.length > 0);
    assert.ok(plan.files.every((file) => !path.isAbsolute(file.path) && file.resourceUri.startsWith(`superskill://activation/${activationId}/resource/`)));
    const resource = await client.readResource({ uri: plan.files[0]!.resourceUri });
    assert.equal(resource.contents[0]?.uri, plan.files[0]!.resourceUri);
    assert.match((resource.contents[0] as { text: string }).text, /source-backed|market/i);
    const cachedResourcePath = path.join(project, ".onlyharness", "cache", "sha256", artifactDigest.slice("sha256:".length), plan.files[0]!.path);
    const cachedResourceOriginal = readFileSync(cachedResourcePath, "utf8");
    chmodSync(cachedResourcePath, 0o600);
    writeFileSync(cachedResourcePath, `${cachedResourceOriginal}\npost-start tamper\n`);
    await assert.rejects(() => client.readResource({ uri: plan.files[0]!.resourceUri }), /ACTIVATION_STATE_CORRUPT/);
    const changedReplay = await client.callTool({ name: "activation_start", arguments: startArgs(recommendation, artifactDigest, "req_mcp_lifecycle") });
    assert.equal(changedReplay.isError, true);
    assert.equal(structured(changedReplay).code, "MANAGED_FILE_CHANGED");
    writeFileSync(cachedResourcePath, cachedResourceOriginal);
    chmodSync(cachedResourcePath, 0o400);

    const replay = structured(await client.callTool({ name: "activation_start", arguments: startArgs(recommendation, artifactDigest, "req_mcp_lifecycle") }));
    assert.equal(replay.activationId, activationId);

    const skipped = await client.callTool({ name: "activation_mark_invoked", arguments: { activationId } });
    assert.equal(skipped.isError, true);
    assert.equal(structured(skipped).code, "ACTIVATION_INVALID_TRANSITION");
    assert.equal(structured(await client.callTool({ name: "activation_mark_loaded", arguments: { activationId } })).code, "ACTIVATION_LOADED");
    assert.equal(structured(await client.callTool({ name: "activation_mark_invoked", arguments: { activationId } })).code, "ACTIVATION_INVOKED");
    assert.equal(structured(await client.callTool({ name: "activation_finish", arguments: { activationId, outcome: "success", evidence: "agent_reported" } })).code, "ACTIVATION_OUTCOME_RECORDED");

    const noKeep = await client.callTool({ name: "activation_keep", arguments: { activationId, keepConsent: false } });
    assert.equal(noKeep.isError, true);
    assert.equal(structured(noKeep).code, "CONSENT_REQUIRED");
    const activationFile = path.join(project, ".onlyharness", "activations", `${activationId}.json`);
    const beforeCancelledKeep = readFileSync(activationFile, "utf8");
    stallExactRelease = true;
    const keepController = new AbortController();
    const cancelledKeep = client.callTool(
      { name: "activation_keep", arguments: { activationId, keepConsent: true } },
      undefined,
      { signal: keepController.signal, timeout: 2_000 }
    );
    setTimeout(() => keepController.abort(), 30);
    await assert.rejects(() => cancelledKeep, /abort|cancel/i);
    await new Promise((resolve) => setTimeout(resolve, 80));
    stallExactRelease = false;
    assert.equal(readFileSync(activationFile, "utf8"), beforeCancelledKeep, "cancelled keep must not mutate activation state");
    assert.equal(existsSync(path.join(project, ".agents", "skills")), false, "cancelled keep must not write Codex native skills");
    assert.equal(existsSync(path.join(project, ".claude", "skills")), false, "cancelled keep must not write Claude native skills");
    const kept = structured(await client.callTool({ name: "activation_keep", arguments: { activationId, keepConsent: true } }));
    assert.equal(kept.code, "ACTIVATION_PINNED");
    assert.ok(readdirSync(path.join(project, ".agents", "skills")).includes("superskill-market-research"));
    assert.equal(existsSync(path.join(project, ".claude", "skills")), false);

    const pinnedStarted = structured(await client.callTool({ name: "activation_start", arguments: {
      client: "codex",
      pinnedActivationId: activationId,
      activationRequestId: "req_mcp_pinned_reuse",
      activationConsent: true
    } }));
    assert.equal(pinnedStarted.code, "ACTIVATION_READY");
    const pinnedPlan = pinnedStarted.plan as { files: Array<{ path: string; resourceUri: string }> };
    assert.ok(pinnedPlan.files.length > 1, "pinned MCP plan must expose SKILL.md and reviewed references");
    assert.ok(pinnedPlan.files.every((file) => file.resourceUri.startsWith("superskill://activation/")));
    const pinnedRoot = path.join(project, ".agents", "skills", "superskill-market-research");
    const pinnedTamper = path.join(pinnedRoot, pinnedPlan.files.find((file) => file.path !== "SKILL.md")!.path);
    const pinnedOriginal = readFileSync(pinnedTamper, "utf8");
    chmodSync(pinnedTamper, 0o600);
    writeFileSync(pinnedTamper, `${pinnedOriginal}\ntamper\n`);
    const changedPinned = await client.callTool({ name: "activation_start", arguments: {
      client: "codex",
      pinnedActivationId: activationId,
      activationRequestId: "req_mcp_pinned_tamper",
      activationConsent: true
    } });
    assert.equal(changedPinned.isError, true);
    assert.equal(structured(changedPinned).code, "MANAGED_FILE_CHANGED");
    writeFileSync(pinnedTamper, pinnedOriginal);
    chmodSync(pinnedTamper, 0o400);
    releaseRevoked = true;
    const revokedReplay = await client.callTool({ name: "activation_start", arguments: {
      client: "codex",
      pinnedActivationId: activationId,
      activationRequestId: "req_mcp_pinned_reuse",
      activationConsent: true
    } });
    releaseRevoked = false;
    assert.equal(revokedReplay.isError, true);
    assert.equal(structured(revokedReplay).code, "CAPABILITY_REVOKED");

    const noRemove = await client.callTool({ name: "activation_remove", arguments: { activationId, removeConsent: false } });
    assert.equal(noRemove.isError, true);
    assert.equal(structured(noRemove).code, "CONSENT_REQUIRED");
    const removed = structured(await client.callTool({ name: "activation_remove", arguments: { activationId, removeConsent: true } }));
    assert.equal(removed.code, "ACTIVATION_REMOVED");
    assert.equal(existsSync(path.join(project, ".agents", "skills", "superskill-market-research")), false);

    const remoteBodies = requestBodies.join("\n");
    assert.equal(remoteBodies.includes(project), false, "project root must never be sent remotely");
    assert.equal(remoteBodies.includes("mcp-fixture-secret"), false, "credential must stay in Authorization only");
  } finally {
    unsafeArchive = false;
    releaseRevoked = false;
    stallExactRelease = false;
    await client.close();
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("local MCP browser auth automatically continues the pending publish without serializing proofs or credentials", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-mcp-auth-"));
  const home = mkdtempSync(path.join(os.tmpdir(), "superskill-mcp-auth-home-"));
  const { client, transport } = createMcpClient(project, home, false, {
    HH_TOKEN: "",
    HH_SUPERSKILL_TOKEN: "",
    HH_SUPERSKILL_AUTH_DISABLE_KEYCHAIN: "1",
    HH_SUPERSKILL_AUTH_TEST_BROWSER_OPENED: "1"
  });
  try {
    await client.connect(transport);
    const publishArgs = {
      client: "codex",
      name: "same-task",
      markdown: "# Same task\n\nPublish after browser authorization without changing this payload.",
      idempotencyKey: "req_same_task_auth_001"
    };
    const beforeAuth = await client.callTool({ name: "publish_markdown_to_harness", arguments: publishArgs });
    assert.equal(beforeAuth.isError, true);
    assert.equal(structured(beforeAuth).code, "SUPERSKILL_AUTH_REQUIRED");
    const started = await client.callTool({ name: "auth_start", arguments: { client: "codex", scopes: ["resources:publish"] } });
    assert.equal(structured(started).code, "AUTH_PENDING");
    assert.deepEqual(requestedAuthScopes, ["resources:publish"], "creator publishing must not request the managed operator grant");
    assertNoAuthSecrets(started);
    const authorized = await client.callTool({ name: "auth_wait", arguments: { client: "codex", maxWaitSeconds: 2 } });
    assert.equal(structured(authorized).code, "AUTH_AUTHORIZED");
    assert.equal(structured(authorized).persistence, "memory");
    const continuation = structured(authorized).continuation as { tool: string; result: Record<string, unknown> };
    assert.equal(continuation.tool, "publish_markdown_to_harness");
    assert.equal(continuation.result.code, "MARKDOWN_PUBLISHED");
    assert.match(String(structured(authorized).next), /Do not submit it again/);
    assertNoAuthSecrets(authorized);
    assert.equal(lastIdempotencyKey, publishArgs.idempotencyKey);
    assert.equal(markdownPublishCalls, 1, "the broker must replay the pending mutation exactly once");
  } finally {
    await client.close();
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("browser-open failure preserves the exact protected invocation for safe auth_wait continuation", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-mcp-auth-fallback-"));
  const home = mkdtempSync(path.join(os.tmpdir(), "superskill-mcp-auth-fallback-home-"));
  markdownPublishCalls = 0;
  const { client, transport } = createMcpClient(project, home, false, {
    HH_TOKEN: "",
    HH_SUPERSKILL_TOKEN: "",
    HH_SUPERSKILL_AUTH_DISABLE_KEYCHAIN: "1",
    HH_SUPERSKILL_AUTH_TEST_BROWSER_OPENED: "0"
  });
  try {
    await client.connect(transport);
    const publishArgs = {
      client: "codex",
      name: "fallback-same-task",
      markdown: "# Fallback same task\n\nKeep this exact protected invocation while browser opening is unavailable.",
      idempotencyKey: "req_fallback_same_task_001"
    };
    const beforeAuth = await client.callTool({ name: "publish_markdown_to_harness", arguments: publishArgs });
    assert.equal(structured(beforeAuth).code, "SUPERSKILL_AUTH_REQUIRED");

    const unavailable = await client.callTool({ name: "auth_start", arguments: { client: "codex", scopes: ["resources:publish"] } });
    assert.equal(unavailable.isError, true);
    assert.equal(structured(unavailable).code, "AUTH_BROWSER_UNAVAILABLE");
    assert.match(String(structured(unavailable).next), /auth login --no-browser/);
    assert.match(String(structured(unavailable).next), /remains pending locally/);
    assertNoAuthSecrets(unavailable);

    const resumed = await client.callTool({ name: "auth_wait", arguments: { client: "codex", maxWaitSeconds: 2 } });
    assert.equal(structured(resumed).code, "AUTH_AUTHORIZED");
    const continuation = structured(resumed).continuation as { tool: string; result: Record<string, unknown> };
    assert.equal(continuation.tool, "publish_markdown_to_harness");
    assert.equal(continuation.result.code, "MARKDOWN_PUBLISHED");
    assert.equal(lastIdempotencyKey, publishArgs.idempotencyKey);
    assert.equal(markdownPublishCalls, 1, "browser fallback may replay the protected mutation only once");
    assertNoAuthSecrets(resumed);
  } finally {
    await client.close();
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("local MCP retains exact workspace idempotency keys across automatic auth and scope step-up", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-mcp-workspace-auth-"));
  const home = mkdtempSync(path.join(os.tmpdir(), "superskill-mcp-workspace-auth-home-"));
  const { client, transport } = createMcpClient(project, home, false, {
    HH_TOKEN: "",
    HH_SUPERSKILL_TOKEN: "",
    HH_SUPERSKILL_AUTH_DISABLE_KEYCHAIN: "1",
    HH_SUPERSKILL_AUTH_TEST_BROWSER_OPENED: "1"
  });
  try {
    await client.connect(transport);
    const createArgs = { client: "codex", slug: "acme", name: "Acme", idempotencyKey: "req_workspace_create_001" };
    const createBeforeAuth = await client.callTool({ name: "workspace_create", arguments: createArgs });
    assert.equal(structured(createBeforeAuth).code, "SUPERSKILL_AUTH_REQUIRED");
    await client.callTool({ name: "auth_start", arguments: { client: "codex", scopes: ["workspaces:write"] } });
    const createAuthorized = structured(await client.callTool({ name: "auth_wait", arguments: { client: "codex", maxWaitSeconds: 2 } }));
    assert.equal((createAuthorized.continuation as { result: { code: string } }).result.code, "WORKSPACE_READY");
    assert.equal(lastWorkspaceIdempotencyKey, createArgs.idempotencyKey);

    const publishArgs = {
      client: "codex",
      workspace: "acme",
      name: "team-workflow",
      files: [{ path: "workflow.md", content: "# Team workflow\n\nUse this reviewed workspace workflow." }],
      idempotencyKey: "req_workspace_publish_001"
    };
    const publishBeforeStepUp = await client.callTool({ name: "workspace_publish_resource", arguments: publishArgs });
    assert.equal(structured(publishBeforeStepUp).code, "AUTH_SCOPE_REQUIRED");
    await client.callTool({ name: "auth_start", arguments: { client: "codex", scopes: ["resources:publish", "workspaces:write"] } });
    const publishAuthorized = structured(await client.callTool({ name: "auth_wait", arguments: { client: "codex", maxWaitSeconds: 2 } }));
    assert.equal((publishAuthorized.continuation as { result: { code: string } }).result.code, "WORKSPACE_RESOURCE_PUBLISHED");
    assert.equal(lastWorkspacePublishIdempotencyKey, publishArgs.idempotencyKey);
    assertNoAuthSecrets(publishAuthorized);
  } finally {
    await client.close();
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("JSON-RPC cancellation and managed timeout leave no activation state", async () => {
  for (const mode of ["cancel", "timeout"] as const) {
    const project = mkdtempSync(path.join(os.tmpdir(), `superskill-mcp-${mode}-`));
    const home = mkdtempSync(path.join(os.tmpdir(), `superskill-mcp-${mode}-home-`));
    execFileSync("git", ["init", "-q"], { cwd: project });
    const initial = createMcpClient(project, home, true);
    let client = initial.client;
    try {
      await client.connect(initial.transport);
      const recommended = await client.callTool({ name: "recommend", arguments: { client: "codex", taskSummary: "compare reviewed market research sources", routingConsent: true } });
      assert.notEqual(recommended.isError, true, `recommendation setup failed: ${JSON.stringify(structured(recommended))}`);
      const recommendation = structured(recommended).recommendation as { recommendationId: string; decisionDigest: string; expiresAt: string };
      if (mode === "timeout") {
        await client.close();
        const timed = createMcpClient(project, home, true, { HH_SUPERSKILL_TEST_TIMEOUT_MS: "150" });
        client = timed.client;
        await client.connect(timed.transport);
      }
      stallExactRelease = true;
      if (mode === "cancel") {
        const controller = new AbortController();
        const pending = client.callTool(
          { name: "activation_start", arguments: startArgs(recommendation, artifactDigest, "req_mcp_cancelled") },
          undefined,
          { signal: controller.signal, timeout: 2_000 }
        );
        setTimeout(() => controller.abort(), 30);
        await assert.rejects(() => pending, /abort|cancel/i);
      } else {
        const timedOut = await client.callTool({ name: "activation_start", arguments: startArgs(recommendation, artifactDigest, "req_mcp_timeout") });
        assert.equal(timedOut.isError, true);
        assert.equal(structured(timedOut).code, "REQUEST_TIMEOUT");
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(existsSync(path.join(project, ".onlyharness")), false, `${mode} must not initialize managed state`);
    } finally {
      stallExactRelease = false;
      await client.close();
      rmSync(project, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }
});

test("pending exact handoff is disclosed, acknowledged after MCP ready, and explicitly dismissible", async () => {
  for (const action of ["activate", "dismiss"] as const) {
    const project = mkdtempSync(path.join(os.tmpdir(), `superskill-mcp-handoff-${action}-`));
    const home = mkdtempSync(path.join(os.tmpdir(), `superskill-mcp-handoff-${action}-home-`));
    execFileSync("git", ["init", "-q"], { cwd: project });
    const handoffFile = path.join(project, ".onlyharness", "superskill-handoff.json");
    mkdirSync(path.dirname(handoffFile), { recursive: true });
    writeFileSync(handoffFile, `${JSON.stringify({
      schemaVersion: "superskill.handoff.v1",
      status: "pending_explicit_activation_consent",
      capability: { id: capability.id, version, artifactDigest },
      canonicalUrl: `https://superskill.sh/api/superskill/install/${capability.id}/${version}/${artifactDigest.slice("sha256:".length)}`
    }, null, 2)}\n`);
    const { client, transport } = createMcpClient(project, home, true);
    try {
      await client.connect(transport);
      if (action === "dismiss") {
        const dismissed = structured(await client.callTool({ name: "recommend", arguments: { client: "codex", pendingHandoffAction: "dismiss", handoffDismissConsent: true } }));
        assert.equal(dismissed.code, "EXACT_HANDOFF_DISMISSED");
        assert.equal(existsSync(handoffFile), false);
        continue;
      }
      const disclosed = structured(await client.callTool({ name: "recommend", arguments: { client: "codex", pendingHandoffAction: "disclose", routingConsent: true } }));
      assert.equal(disclosed.code, "EXACT_HANDOFF_READY");
      assert.equal(existsSync(handoffFile), true, "disclosure must be read-only");
      const recommendation = disclosed.recommendation as { recommendationId: string; decisionDigest: string; expiresAt: string };
      const started = structured(await client.callTool({ name: "activation_start", arguments: startArgs(recommendation, artifactDigest, "req_mcp_handoff_ready") }));
      assert.equal(started.code, "ACTIVATION_READY");
      assert.equal(existsSync(handoffFile), false, "exact handoff is acknowledged only after ready");
    } finally {
      await client.close();
      rmSync(project, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }
});

test("stdio MCP requires one file root or an explicit local-only fallback without initializing state", async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "superskill-mcp-fallback-"));
  const home = mkdtempSync(path.join(os.tmpdir(), "superskill-mcp-fallback-home-"));
  const { client, transport } = createMcpClient(project, home, false);
  try {
    await client.connect(transport);
    const denied = await client.callTool({ name: "activation_doctor", arguments: { client: "codex" } });
    assert.equal(denied.isError, true);
    assert.equal(structured(denied).code, "WORKSPACE_ROOT_REQUIRED");
    const fallback = await client.callTool({ name: "activation_doctor", arguments: { client: "codex", workspaceRoot: project } });
    assert.equal(structured(fallback).ok, true);
    assert.equal(JSON.stringify(fallback).includes(project), false);
    assert.equal(existsSync(path.join(project, ".onlyharness")), false);
  } finally {
    await client.close();
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

function createMcpClient(project: string, home: string, exposeRoot: boolean, envOverrides: Record<string, string> = {}): { client: Client; transport: StdioClientTransport } {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve(import.meta.dirname, "../dist/hh.mjs"), "mcp", "superskill"],
    cwd: project,
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: home,
      HH_REGISTRY_URL: registry,
      HH_TOKEN: "mcp-fixture-secret",
      SUPERSKILL_DEVICE_AUTH_ENABLED: "1",
      HH_SUPERSKILL_ALLOW_INSECURE_TEST_REGISTRY: "1",
      HH_SUPERSKILL_DOCTOR_SKIP_NPM_VIEW: "1",
      HH_SUPERSKILL_TELEMETRY: "off",
      HH_SUPERSKILL_AUTH_DISABLE_KEYCHAIN: "1",
      NO_COLOR: "1",
      ...envOverrides
    }
  });
  const client = new Client({ name: "superskill-mcp-contract-test", version: "1.0.0" }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, async () => ({
    roots: exposeRoot ? [{ uri: pathToFileURL(realProject(project)).href, name: "workspace" }] : []
  }));
  return { client, transport };
}

function startArgs(recommendation: { recommendationId: string; decisionDigest: string; expiresAt: string }, digest: string, requestId: string): Record<string, unknown> {
  return {
    client: "codex",
    capabilityId: capability.id,
    version,
    artifactDigest: digest,
    recommendationId: recommendation.recommendationId,
    decisionDigest: recommendation.decisionDigest,
    recommendationExpiresAt: recommendation.expiresAt,
    activationRequestId: requestId,
    activationConsent: true
  };
}

function structured(result: CallToolResult): Record<string, unknown> {
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

function assertNoAuthSecrets(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of ["proof=", "ohdp_", "ohbp_", "ohat_", "ohrt_", "HH_TOKEN", "HH_SUPERSKILL_TOKEN"]) {
    assert.equal(serialized.includes(secret), false, `MCP result leaked ${secret}`);
  }
}

function collectFiles(root: string): Array<{ path: string; content: string; truncated: false }> {
  const result: Array<{ path: string; content: string; truncated: false }> = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) result.push({ path: path.relative(root, file).split(path.sep).join("/"), content: readFileSync(file, "utf8"), truncated: false });
    }
  };
  visit(root);
  return result;
}

function realProject(project: string): string {
  return execFileSync("pwd", ["-P"], { cwd: project, encoding: "utf8" }).trim();
}
