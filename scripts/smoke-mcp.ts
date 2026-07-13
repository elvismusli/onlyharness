import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const apiUrl = "http://127.0.0.1:8798";
const paidRoot = path.join(root, "data/imports/mcp-smoke-paid-harness");
const hostedRoot = path.join(root, "data/imports/mcp-smoke-hosted-harness");
const smokeDataRoot = mkdtempSync(path.join(os.tmpdir(), "hh-mcp-smoke-"));
const orgRoot = path.join(smokeDataRoot, "org-harnesses");
const orgsPath = path.join(smokeDataRoot, "orgs.json");
const resourceArchiveRoot = path.join(smokeDataRoot, "resource-archives");
const resourceImportsPath = path.join(smokeDataRoot, "imported-resources.json");
const markdownSmokeName = "mcp-markdown-safe-output-smoke";
const markdownSmokeRoot = path.join(root, "data/imports", markdownSmokeName);
const markdownSmokeVersions = path.join(root, "data/harness-versions/local", markdownSmokeName);

createPaidHarness(paidRoot);
createHostedHarness(hostedRoot);
rmSync(markdownSmokeRoot, { recursive: true, force: true });
rmSync(markdownSmokeVersions, { recursive: true, force: true });
createOrgHarness(path.join(orgRoot, "acme", "mcp-private-harness"));
createOrgStore(orgsPath, "mcp-org-token");

const api = spawn("npm", ["run", "start", "-w", "@harnesshub/api"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    HARNESS_API_PORT: "8798",
    HARNESS_API_HOST: "127.0.0.1",
    HARNESS_WORKSPACE_ROOT: root,
    HARNESS_ORG_ROOT: orgRoot,
    HARNESS_ORGS_PATH: orgsPath,
    HARNESS_ORG_AUDIT_PATH: path.join(smokeDataRoot, "org-audit.jsonl"),
    ORGS_ENABLED: "true",
    HARNESS_EVENTS_PATH: path.join(smokeDataRoot, "events.jsonl"),
    SUPABASE_URL: "",
    SUPABASE_ANON_KEY: "",
    HOSTED_RESOURCE_PUBLISH_ENABLED: "false",
    RESOURCE_ARCHIVE_DIR: resourceArchiveRoot,
    RESOURCE_IMPORTS_PATH: resourceImportsPath,
    PAYMENTS_ENABLED: "true",
    HARNESS_MANUAL_ENTITLEMENTS: "mcp-paid-token=local/mcp-smoke-paid-harness",
    DOCS_URL: path.join(root, "apps/registry-web/public/llms.txt")
  }
});

try {
  await waitForApi(`${apiUrl}/healthz`);

  const initialize = await rpc(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "onlyharness-smoke", version: "0" }
  });
  if (initialize.result?.serverInfo?.name !== "onlyharness" || initialize.result?.serverInfo?.version !== "0.2.13") {
    throw new Error(`MCP initialize failed: ${JSON.stringify(initialize)}`);
  }

  const tools = await rpc(2, "tools/list", {});
  const listedTools = tools.result?.tools ?? [];
  const names = listedTools.map((tool: { name: string }) => tool.name);
  const expectedNames = ["search_harnesses", "harness_detail", "search_resources", "resource_detail", "resource_use_instructions", "pull_instructions", "pull_harness", "search_docs", "publish_markdown_to_harness", "publish_resource_package"];
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error(`MCP tool inventory drifted: ${JSON.stringify(names)}`);
  }
  for (const tool of listedTools as Array<{ name: string; annotations?: Record<string, boolean> }>) {
    const expected = tool.name.startsWith("publish_")
      ? { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
      : { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
    if (JSON.stringify(tool.annotations) !== JSON.stringify(expected)) {
      throw new Error(`MCP tool annotations drifted for ${tool.name}: ${JSON.stringify(tool.annotations)}`);
    }
  }

  const docs = await rpc(21, "tools/call", {
    name: "search_docs",
    arguments: { query: "Harness detail" }
  });
  const docsText = docs.result?.content?.[0]?.text ?? "";
  if (!docsText.includes("\"source\": \"https://onlyharness.com/llms.txt\"") || docsText.includes(root)) {
    throw new Error(`MCP search_docs leaked local docs source: ${JSON.stringify(docs)}`);
  }

  const search = await rpc(3, "tools/call", {
    name: "search_harnesses",
    arguments: { query: "research", limit: 2 }
  });
  const searchText = search.result?.content?.[0]?.text ?? "";
  assertToolSuccess(search, "search_harnesses");
  if (!searchText.includes("deep-market-researcher")) {
    throw new Error(`MCP search_harnesses returned wrong content: ${JSON.stringify(search)}`);
  }
  if (!searchText.includes("\"contextCost\"")) {
    throw new Error(`MCP search_harnesses did not include context cost: ${JSON.stringify(search)}`);
  }

  const resourceSearch = await rpc(31, "tools/call", {
    name: "search_resources",
    arguments: { query: "superpowers", limit: 5 }
  });
  const resourceSearchText = resourceSearch.result?.content?.[0]?.text ?? "";
  if (!resourceSearchText.includes("github:obra/superpowers") || !resourceSearchText.includes("\"sourceCheckedAt\"") || resourceSearchText.includes("\"installVerifiedAt\"")) {
    throw new Error(`MCP search_resources returned wrong provenance: ${JSON.stringify(resourceSearch)}`);
  }
  const resourceSearchAlias = await rpc(311, "tools/call", {
    name: "search_resources",
    arguments: { q: "superpowers", limit: 1 }
  });
  const resourceSearchAliasText = resourceSearchAlias.result?.content?.[0]?.text ?? "";
  if (!resourceSearchAliasText.includes("github:obra/superpowers")) {
    throw new Error(`MCP search_resources q alias ignored query: ${JSON.stringify(resourceSearchAlias)}`);
  }

  const resourceInstructions = await rpc(32, "tools/call", {
    name: "resource_use_instructions",
    arguments: { id: "github:obra/superpowers" }
  });
  const resourceInstructionsText = resourceInstructions.result?.content?.[0]?.text ?? "";
  const hasResourceUsePath = resourceInstructionsText.includes("Use in OnlyHarness");
  const hasResourceAvailability = resourceInstructionsText.includes("hosted resource archive") || resourceInstructionsText.includes("upstream resource listing");
  if (!hasResourceUsePath || !hasResourceAvailability || !resourceInstructionsText.includes("upstream attribution")) {
    throw new Error(`MCP resource_use_instructions returned unsafe guidance: ${JSON.stringify(resourceInstructions)}`);
  }

  const missingResource = await rpc(321, "tools/call", {
    name: "resource_detail",
    arguments: { id: "onlyharness:missing/resource" }
  });
  assertToolError(missingResource, "RESOURCE_NOT_FOUND", 404);

  const detail = await rpc(4, "tools/call", {
    name: "harness_detail",
    arguments: { owner: "harnesses", name: "deep-market-researcher" }
  });
  const detailText = detail.result?.content?.[0]?.text ?? "";
  if (!detailText.includes("\"contextCost\"") || !detailText.includes("\"estimated\"")) {
    throw new Error(`MCP harness_detail did not include context cost: ${JSON.stringify(detail)}`);
  }

  const instructions = await rpc(41, "tools/call", {
    name: "pull_instructions",
    arguments: { owner: "harnesses", name: "deep-market-researcher" }
  });
  const instructionsText = instructions.result?.content?.[0]?.text ?? "";
  if (
    !instructionsText.includes("\"command\": \"npx onlyharness install harnesses/deep-market-researcher\"")
    || !instructionsText.includes("\"localCommand\": \"node packages/harness-cli/dist/hh.mjs install harnesses/deep-market-researcher\"")
    || !instructionsText.includes("\"npmStatus\": \"published\"")
  ) {
    throw new Error(`MCP pull_instructions returned stale CLI guidance: ${JSON.stringify(instructions)}`);
  }

  const pull = await rpc(5, "tools/call", {
    name: "pull_harness",
    arguments: { owner: "harnesses", name: "deep-market-researcher" }
  });
  const pullText = pull.result?.content?.[0]?.text ?? "";
  if (!pullText.includes("\"files\"") || !pullText.includes("harness.yaml")) {
    throw new Error(`MCP pull_harness returned wrong content: ${JSON.stringify(pull)}`);
  }

  const paidDetail = await rpc(51, "tools/call", {
    name: "harness_detail",
    arguments: { owner: "local", name: "mcp-smoke-paid-harness" }
  });
  const paidDetailText = paidDetail.result?.content?.[0]?.text ?? "";
  if (!paidDetailText.includes("\"status\": \"payment_required\"") || !paidDetailText.includes("\"checkout_url\"") || paidDetailText.includes("\"canPull\": true")) {
    throw new Error(`MCP paid detail did not expose payment-required access: ${JSON.stringify(paidDetail)}`);
  }

  const paidInstructions = await rpc(52, "tools/call", {
    name: "pull_instructions",
    arguments: { owner: "local", name: "mcp-smoke-paid-harness" }
  });
  const paidInstructionsText = paidInstructions.result?.content?.[0]?.text ?? "";
  if (!paidInstructionsText.includes("\"status\": \"payment_required\"") || !paidInstructionsText.includes("\"required\": true") || !paidInstructionsText.includes("\"paymentExitCode\": 5")) {
    throw new Error(`MCP paid instructions did not expose payment-required access: ${JSON.stringify(paidInstructions)}`);
  }

  const paidPull = await rpc(6, "tools/call", {
    name: "pull_harness",
    arguments: { owner: "local", name: "mcp-smoke-paid-harness" }
  });
  const paidText = paidPull.result?.content?.[0]?.text ?? "";
  if (!paidText.includes("PAYMENT_REQUIRED") || paidText.includes("\"files\"")) {
    throw new Error(`MCP paid pull did not return payment requirements: ${JSON.stringify(paidPull)}`);
  }
  assertToolError(paidPull, "PAYMENT_REQUIRED", 402);

  const entitledDetail = await rpc(61, "tools/call", {
    name: "harness_detail",
    arguments: { owner: "local", name: "mcp-smoke-paid-harness" }
  }, { Authorization: "Bearer mcp-paid-token" });
  const entitledDetailText = entitledDetail.result?.content?.[0]?.text ?? "";
  if (!entitledDetailText.includes("\"status\": \"entitled\"") || !entitledDetailText.includes("\"canPull\": true") || entitledDetailText.includes("\"required\": true")) {
    throw new Error(`MCP entitled detail did not expose entitled access: ${JSON.stringify(entitledDetail)}`);
  }

  const entitledInstructions = await rpc(62, "tools/call", {
    name: "pull_instructions",
    arguments: { owner: "local", name: "mcp-smoke-paid-harness" }
  }, { Authorization: "Bearer mcp-paid-token" });
  const entitledInstructionsText = entitledInstructions.result?.content?.[0]?.text ?? "";
  if (!entitledInstructionsText.includes("\"status\": \"entitled\"") || !entitledInstructionsText.includes("\"required\": false")) {
    throw new Error(`MCP entitled instructions did not expose entitled access: ${JSON.stringify(entitledInstructions)}`);
  }

  const hostedPull = await rpc(7, "tools/call", {
    name: "pull_harness",
    arguments: { owner: "local", name: "mcp-smoke-hosted-harness" }
  });
  const hostedText = hostedPull.result?.content?.[0]?.text ?? "";
  if (!hostedText.includes("HOSTED_EXECUTION_NOT_AVAILABLE") || hostedText.includes("\"files\"")) {
    throw new Error(`MCP hosted per-call pull should fail closed: ${JSON.stringify(hostedPull)}`);
  }
  assertToolError(hostedPull, "HOSTED_EXECUTION_NOT_AVAILABLE", 409);

  const privateDetail = await rpc(8, "tools/call", {
    name: "harness_detail",
    arguments: { owner: "@acme", name: "mcp-private-harness" }
  });
  const privateDetailText = privateDetail.result?.content?.[0]?.text ?? "";
  if (!privateDetailText.includes("AUTH_REQUIRED") || privateDetailText.includes("\"manifest\"")) {
    throw new Error(`MCP private detail leaked without org token: ${JSON.stringify(privateDetail)}`);
  }
  assertToolError(privateDetail, "AUTH_REQUIRED", 401);

  const privateInstructions = await rpc(9, "tools/call", {
    name: "pull_instructions",
    arguments: { owner: "@acme", name: "mcp-private-harness" }
  });
  const privateInstructionsText = privateInstructions.result?.content?.[0]?.text ?? "";
  if (!privateInstructionsText.includes("AUTH_REQUIRED") || privateInstructionsText.includes("archiveUrl")) {
    throw new Error(`MCP private pull instructions leaked without org token: ${JSON.stringify(privateInstructions)}`);
  }
  assertToolError(privateInstructions, "AUTH_REQUIRED", 401);

  const privatePull = await rpc(10, "tools/call", {
    name: "pull_harness",
    arguments: { owner: "@acme", name: "mcp-private-harness" }
  });
  const privatePullText = privatePull.result?.content?.[0]?.text ?? "";
  if (!privatePullText.includes("AUTH_REQUIRED") || privatePullText.includes("\"files\"")) {
    throw new Error(`MCP private pull leaked without org token: ${JSON.stringify(privatePull)}`);
  }
  assertToolError(privatePull, "AUTH_REQUIRED", 401);

  const authorizedPrivateDetail = await rpc(11, "tools/call", {
    name: "harness_detail",
    arguments: { owner: "@acme", name: "mcp-private-harness" }
  }, { Authorization: "Bearer mcp-org-token" });
  const authorizedPrivateDetailText = authorizedPrivateDetail.result?.content?.[0]?.text ?? "";
  if (!authorizedPrivateDetailText.includes("\"visibility\": \"org\"") || !authorizedPrivateDetailText.includes("\"org\": \"acme\"")) {
    throw new Error(`MCP private detail failed with org token: ${JSON.stringify(authorizedPrivateDetail)}`);
  }

  const publish = await rpc(12, "tools/call", {
    name: "publish_markdown_to_harness",
    arguments: {
      name: "no-auth",
      markdown: "# No Auth\n\nThis should return an authorization error instead of publishing."
    }
  });
  const publishText = publish.result?.content?.[0]?.text ?? "";
  if (!publishText.includes("AUTH_REQUIRED") || !publishText.includes("oauth-protected-resource")) {
    throw new Error(`MCP publish auth guard failed: ${JSON.stringify(publish)}`);
  }
  assertToolError(publish, "AUTH_REQUIRED", 401);

  const publishResource = await rpc(121, "tools/call", {
    name: "publish_resource_package",
    arguments: {
      name: "no-auth-resource",
      resourceType: "command_pack",
      files: [{ path: "README.md", content: "# No Auth Resource\n\nThis should return an authorization error instead of publishing." }]
    }
  });
  const publishResourceText = publishResource.result?.content?.[0]?.text ?? "";
  if (!publishResourceText.includes("oauth-protected-resource") || !publishResourceText.includes("AUTH_REQUIRED")) {
    throw new Error(`MCP resource package publish auth guard failed: ${JSON.stringify(publishResource)}`);
  }
  assertToolError(publishResource, "AUTH_REQUIRED", 401);

  const malformedAnonymousPublish = await rpc(1211, "tools/call", {
    name: "publish_resource_package",
    arguments: {}
  });
  assertToolError(malformedAnonymousPublish, "AUTH_REQUIRED", 401);

  const unknownTool = await rpc(1212, "tools/call", {
    name: "onlyharness_tool_that_does_not_exist",
    arguments: {}
  });
  assertToolError(unknownTool, "TOOL_NOT_FOUND", 404);

  const markdownPublish = await rpc(1213, "tools/call", {
    name: "publish_markdown_to_harness",
    arguments: {
      name: markdownSmokeName,
      markdown: "# MCP markdown output smoke\n\nReturn only public-safe result fields."
    }
  }, { Authorization: "Bearer local:mcp-markdown-publisher" });
  assertToolSuccess(markdownPublish, "publish_markdown_to_harness");
  const markdownWire = JSON.stringify(markdownPublish);
  if (markdownWire.includes('"output"') || /\/app\/|\/Users\/|\/tmp\//.test(markdownWire)) {
    throw new Error(`MCP markdown publish leaked process output or a server path: ${markdownWire}`);
  }
  const leakedMarkdownSources = readdirSync(path.join(root, "data")).filter((entry) => entry.startsWith(`.import-${markdownSmokeName}-`) && entry.endsWith(".source.md"));
  if (leakedMarkdownSources.length) throw new Error(`MCP markdown publish left staging source files: ${leakedMarkdownSources.join(", ")}`);

  const malformedRead = await rpc(1214, "tools/call", {
    name: "resource_detail",
    arguments: {}
  });
  assertToolError(malformedRead, "VALIDATION_FAILED", 422);

  const omittedDefaultArguments = await rpc(1215, "tools/call", {
    name: "search_docs"
  });
  assertToolSuccess(omittedDefaultArguments, "search_docs without arguments");

  const omittedRequiredArguments = await rpc(1216, "tools/call", {
    name: "resource_detail"
  });
  assertToolError(omittedRequiredArguments, "VALIDATION_FAILED", 422);

  const invalidPublishResource = await rpc(122, "tools/call", {
    name: "publish_resource_package",
    arguments: resourcePublishFixture("invalid-auth-resource")
  }, { Authorization: "Bearer invalid-containment-token" });
  assertSafePublishFailure(invalidPublishResource.result?.content?.[0]?.text ?? "", "AUTH_INVALID", "invalid-containment-token");
  assertToolError(invalidPublishResource, "AUTH_INVALID", 401);

  const disabledPublishResource = await rpc(123, "tools/call", {
    name: "publish_resource_package",
    arguments: resourcePublishFixture("disabled-mcp-resource")
  }, { Authorization: "Bearer local:mcp-publisher" });
  assertSafePublishFailure(disabledPublishResource.result?.content?.[0]?.text ?? "", "PUBLISH_DISABLED", "local:mcp-publisher");
  assertToolError(disabledPublishResource, "PUBLISH_DISABLED", 503);

  const anonymousHttpPublish = await httpPublish(resourcePublishFixture("anonymous-http-resource"));
  if (anonymousHttpPublish.status !== 401 || anonymousHttpPublish.body.code !== "AUTH_REQUIRED") {
    throw new Error(`HTTP anonymous resource publish did not fail authentication first: ${JSON.stringify(anonymousHttpPublish)}`);
  }
  assertSafePublishFailure(JSON.stringify(anonymousHttpPublish.body), "AUTH_REQUIRED");

  const invalidHttpPublish = await httpPublish(resourcePublishFixture("invalid-http-resource"), "Bearer invalid-containment-token");
  if (invalidHttpPublish.status !== 401 || invalidHttpPublish.body.code !== "AUTH_INVALID") {
    throw new Error(`HTTP invalid resource publish did not fail authentication first: ${JSON.stringify(invalidHttpPublish)}`);
  }
  assertSafePublishFailure(JSON.stringify(invalidHttpPublish.body), "AUTH_INVALID", "invalid-containment-token");

  const disabledHttpPublish = await httpPublish(resourcePublishFixture("disabled-http-resource"), "Bearer local:http-publisher");
  if (disabledHttpPublish.status !== 503 || disabledHttpPublish.body.code !== "PUBLISH_DISABLED") {
    throw new Error(`HTTP authenticated resource publish did not honor containment: ${JSON.stringify(disabledHttpPublish)}`);
  }
  assertSafePublishFailure(JSON.stringify(disabledHttpPublish.body), "PUBLISH_DISABLED", "local:http-publisher");

  if (existsSync(resourceImportsPath) || (existsSync(resourceArchiveRoot) && readdirSync(resourceArchiveRoot).length > 0)) {
    throw new Error("Containment publish attempts mutated resource metadata or archive storage");
  }

  const protocolFailure = await rpc(999, "onlyharness/unknown-method", {});
  if (!protocolFailure.error || protocolFailure.result || protocolFailure.error.code !== -32601) {
    throw new Error(`MCP protocol failure did not use the JSON-RPC error envelope: ${JSON.stringify(protocolFailure)}`);
  }

  const getResponse = await fetch(`${apiUrl}/mcp`);
  if (getResponse.status !== 405) throw new Error(`Expected GET /mcp 405, got ${getResponse.status}`);

  console.log("MCP smoke passed: initialize, exact annotated tools/list, structured reads/errors, entitlement gates, org-private gates, auth-first hosted publish containment, JSON-RPC protocol error, GET 405");
} finally {
  api.kill("SIGTERM");
  rmSync(paidRoot, { recursive: true, force: true });
  rmSync(hostedRoot, { recursive: true, force: true });
  rmSync(smokeDataRoot, { recursive: true, force: true });
  rmSync(markdownSmokeRoot, { recursive: true, force: true });
  rmSync(markdownSmokeVersions, { recursive: true, force: true });
}

await smokeArchiveStorageFailure();

async function rpc(id: number, method: string, params: unknown, headers: Record<string, string> = {}, baseUrl = apiUrl) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP ${method} HTTP ${response.status}: ${text}`);
  return parseMcpBody(text);
}

async function httpPublish(body: unknown, authorization?: string, baseUrl = apiUrl) {
  const response = await fetch(`${baseUrl}/imports/resource-package`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {})
    },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() as { error?: string; code?: string } };
}

async function smokeArchiveStorageFailure() {
  const storageSmokeRoot = mkdtempSync(path.join(os.tmpdir(), "hh-mcp-storage-smoke-"));
  const unavailableArchiveRoot = path.join(storageSmokeRoot, "archive-root-is-a-file");
  const importsPath = path.join(storageSmokeRoot, "imported-resources.json");
  const baseUrl = "http://127.0.0.1:8797";
  writeFileSync(unavailableArchiveRoot, "not a directory\n");
  const child = spawn("npm", ["run", "start", "-w", "@harnesshub/api"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HARNESS_API_PORT: "8797",
      HARNESS_API_HOST: "127.0.0.1",
      HARNESS_WORKSPACE_ROOT: root,
      SUPABASE_URL: "",
      SUPABASE_ANON_KEY: "",
      HOSTED_RESOURCE_PUBLISH_ENABLED: "true",
      RESOURCE_ARCHIVE_DIR: unavailableArchiveRoot,
      RESOURCE_IMPORTS_PATH: importsPath,
      HARNESS_EVENTS_PATH: path.join(storageSmokeRoot, "events.jsonl")
    }
  });
  try {
    await waitForApi(`${baseUrl}/healthz`);
    const malformed = await rpc(900, "tools/call", {
      name: "publish_resource_package",
      arguments: {}
    }, { Authorization: "Bearer local:storage-validation-publisher" }, baseUrl);
    assertToolError(malformed, "VALIDATION_FAILED", 422);
    const body = resourcePublishFixture("unavailable-archive-resource");
    const http = await httpPublish(body, "Bearer local:storage-http-publisher", baseUrl);
    if (http.status !== 503 || http.body.code !== "ARCHIVE_STORAGE_UNAVAILABLE") {
      throw new Error(`HTTP archive storage failure was not sanitized: ${JSON.stringify(http)}`);
    }
    assertSafePublishFailure(JSON.stringify(http.body), "ARCHIVE_STORAGE_UNAVAILABLE", "storage-http-publisher");

    const mcp = await rpc(901, "tools/call", { name: "publish_resource_package", arguments: body }, { Authorization: "Bearer local:storage-mcp-publisher" }, baseUrl);
    const mcpText = mcp.result?.content?.[0]?.text ?? "";
    assertSafePublishFailure(mcpText, "ARCHIVE_STORAGE_UNAVAILABLE", "storage-mcp-publisher");
    assertToolError(mcp, "ARCHIVE_STORAGE_UNAVAILABLE", 503);
    if (existsSync(importsPath)) throw new Error("Archive storage failure created public resource metadata");
  } finally {
    child.kill("SIGTERM");
    rmSync(storageSmokeRoot, { recursive: true, force: true });
  }
}

function resourcePublishFixture(name: string) {
  return {
    name,
    resourceType: "command_pack",
    files: [{ path: "README.md", content: `# ${name}\n\nContainment smoke fixture that must never be published.` }]
  };
}

function assertSafePublishFailure(text: string, code: string, secretFragment?: string) {
  if (!text.includes(code)) throw new Error(`Expected safe publish failure ${code}: ${text}`);
  for (const forbidden of ["/var/lib", "/app/", "tar:", "stderr", secretFragment].filter(Boolean) as string[]) {
    if (text.includes(forbidden)) throw new Error(`Publish failure leaked forbidden detail ${forbidden}: ${text}`);
  }
}

function assertToolSuccess(response: any, name: string) {
  if (response.result?.isError || response.result?.structuredContent?.code !== "OK" || response.result?.structuredContent?.status !== 200) {
    throw new Error(`MCP ${name} did not return structured success metadata: ${JSON.stringify(response)}`);
  }
}

function assertToolError(response: any, code: string, status: number) {
  const result = response.result;
  if (result?.isError !== true || result?.structuredContent?.code !== code || result?.structuredContent?.status !== status) {
    throw new Error(`MCP tool error contract mismatch for ${code}: ${JSON.stringify(response)}`);
  }
  const wire = JSON.stringify(response);
  for (const forbidden of ["/var/lib/", "/app/", "/Users/", "\"stack\"", "\"stderr\"", "Bearer "]) {
    if (wire.includes(forbidden)) throw new Error(`MCP tool error leaked forbidden detail ${forbidden}: ${wire}`);
  }
}

function createOrgStore(target: string, token: string) {
  writeFileSync(target, JSON.stringify({
    organizations: [
      {
        slug: "acme",
        name: "Acme",
        plan: "team",
        tokens: [
          {
            name: "mcp-smoke",
            hash: `sha256:${createHash("sha256").update(token).digest("hex")}`,
            scopes: ["read", "setup", "publish"],
            expires_at: null
          }
        ],
        bundle: {
          version: "0.1.0",
          harnesses: [{ owner: "@acme", name: "mcp-private-harness", version: "0.1.0" }],
          configs: []
        }
      }
    ]
  }, null, 2));
}

function createOrgHarness(target: string) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.join(target, "agents"), { recursive: true });
  mkdirSync(path.join(target, "evals/cases"), { recursive: true });
  mkdirSync(path.join(target, "examples"), { recursive: true });
  writeFileSync(path.join(target, "harness.yaml"), `schemaVersion: harness.v0.2
name: mcp-private-harness
title: MCP Private Harness
summary: Private org fixture used to verify MCP visibility gates.
version: 0.1.0
license: MIT
visibility: org
org: acme
tags: [smoke, private]
runtime:
  primary: none
  adapters: []
agents:
  - id: operator
    role: operator
    prompt: agents/operator.md
    tools: []
    handoffs: []
workflow:
  entrypoint: operator
  stages:
    - id: run
      agent: operator
tools:
  mcp_servers: []
  function_tools: []
  external_apis: []
permissions:
  network: "false"
  network_allowlist: []
  filesystem: readonly
  shell: false
  browser: false
  credentials: "false"
  external_send: false
  money_movement: false
  user_data: false
  human_approval_required: []
evals:
  promptfoo_config: evals/promptfooconfig.yaml
  command: npx promptfoo@latest eval -c evals/promptfooconfig.yaml
quality_gates:
  min_score: 0.82
  max_regression: 0.03
  max_cost_usd_per_run: 3
  max_risk_score: 39
  required_checks: [schema_valid, eval_passed]
examples:
  - title: Smoke
    input: examples/input.md
    output: examples/expected.md
`);
  writeFileSync(path.join(target, "README.md"), "# MCP Private Harness\n");
  writeFileSync(path.join(target, "agents/operator.md"), "Return a private smoke result.\n");
  writeFileSync(path.join(target, "evals/promptfooconfig.yaml"), "description: mcp private smoke\nprompts: []\nproviders: []\n");
  writeFileSync(path.join(target, "evals/cases/smoke.yaml"), "title: Smoke\nscore: 0.9\n");
  writeFileSync(path.join(target, "examples/input.md"), "input\n");
  writeFileSync(path.join(target, "examples/expected.md"), "expected\n");
}

function parseMcpBody(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const data = trimmed
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, ""))
    .join("\n");
  if (!data) throw new Error(`No MCP data frame found: ${text}`);
  return JSON.parse(data);
}

async function waitForApi(url: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(`API did not become ready: ${url}`);
}

function createPaidHarness(target: string) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.join(target, "agents"), { recursive: true });
  mkdirSync(path.join(target, "evals/cases"), { recursive: true });
  mkdirSync(path.join(target, "examples"), { recursive: true });
  mkdirSync(path.join(target, ".harnesshub"), { recursive: true });
  writeFileSync(path.join(target, "harness.yaml"), `schemaVersion: harness.v0.2
name: mcp-smoke-paid-harness
title: MCP Smoke Paid Harness
summary: Local paid fixture used to verify MCP entitlement gates.
version: 0.1.0
license: MIT
pricing:
  model: one_time
  amount_usd: 7
  currency: USD
tags: [smoke, paid]
runtime:
  primary: none
  adapters: []
agents:
  - id: operator
    role: operator
    prompt: agents/operator.md
    tools: []
    handoffs: []
workflow:
  entrypoint: operator
  stages:
    - id: run
      agent: operator
tools:
  mcp_servers: []
  function_tools: []
  external_apis: []
permissions:
  network: "false"
  network_allowlist: []
  filesystem: readonly
  shell: false
  browser: false
  credentials: "false"
  external_send: false
  money_movement: false
  user_data: false
  human_approval_required: []
evals:
  promptfoo_config: evals/promptfooconfig.yaml
  command: npx promptfoo@latest eval -c evals/promptfooconfig.yaml
quality_gates:
  min_score: 0.82
  max_regression: 0.03
  max_cost_usd_per_run: 3
  max_risk_score: 39
  required_checks: [schema_valid, eval_passed]
examples:
  - title: Smoke
    input: examples/input.md
    output: examples/expected.md
`);
  writeFileSync(path.join(target, "README.md"), "# MCP Smoke Paid Harness\n");
  writeFileSync(path.join(target, "agents/operator.md"), "Return a short smoke result.\n");
  writeFileSync(path.join(target, "evals/promptfooconfig.yaml"), "description: mcp paid smoke\nprompts: []\nproviders: []\n");
  writeFileSync(path.join(target, "evals/cases/smoke.yaml"), "title: Smoke\nscore: 0.9\n");
  writeFileSync(path.join(target, "examples/input.md"), "input\n");
  writeFileSync(path.join(target, "examples/expected.md"), "expected\n");
  writeFileSync(path.join(target, ".harnesshub/results.json"), JSON.stringify({
    runner: "harnesshub-local-eval",
    status: "passed",
    score: 0.9,
    verified: true,
    verification_status: "declared_case_scores",
    cost_usd: 0.03,
    duration_ms: 250,
    cases: [{ id: "smoke", title: "Smoke", score: 0.9, passed: true, verification_status: "declared_score" }]
  }, null, 2));
}

function createHostedHarness(target: string) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.join(target, "agents"), { recursive: true });
  mkdirSync(path.join(target, "evals/cases"), { recursive: true });
  mkdirSync(path.join(target, "examples"), { recursive: true });
  mkdirSync(path.join(target, ".harnesshub"), { recursive: true });
  writeFileSync(path.join(target, "harness.yaml"), `schemaVersion: harness.v0.2
name: mcp-smoke-hosted-harness
title: MCP Smoke Hosted Harness
summary: Local per-call fixture used to verify MCP hosted execution guards.
version: 0.1.0
license: MIT
pricing:
  model: per_call
  amount_usd: 2
  currency: USD
tags: [smoke, hosted]
runtime:
  primary: none
  adapters: []
agents:
  - id: operator
    role: operator
    prompt: agents/operator.md
    tools: []
    handoffs: []
workflow:
  entrypoint: operator
  stages:
    - id: run
      agent: operator
tools:
  mcp_servers: []
  function_tools: []
  external_apis: []
permissions:
  network: "false"
  network_allowlist: []
  filesystem: readonly
  shell: false
  browser: false
  credentials: "false"
  external_send: false
  money_movement: false
  user_data: false
  human_approval_required: []
evals:
  promptfoo_config: evals/promptfooconfig.yaml
  command: npx promptfoo@latest eval -c evals/promptfooconfig.yaml
quality_gates:
  min_score: 0.82
  max_regression: 0.03
  max_cost_usd_per_run: 3
  max_risk_score: 39
  required_checks: [schema_valid, eval_passed]
examples:
  - title: Smoke
    input: examples/input.md
    output: examples/expected.md
`);
  writeFileSync(path.join(target, "README.md"), "# MCP Smoke Hosted Harness\n");
  writeFileSync(path.join(target, "agents/operator.md"), "Return a short hosted MCP smoke result.\n");
  writeFileSync(path.join(target, "evals/promptfooconfig.yaml"), "description: mcp hosted smoke\nprompts: []\nproviders: []\n");
  writeFileSync(path.join(target, "evals/cases/smoke.yaml"), "title: Smoke\nscore: 0.9\n");
  writeFileSync(path.join(target, "examples/input.md"), "input\n");
  writeFileSync(path.join(target, "examples/expected.md"), "expected\n");
  writeFileSync(path.join(target, ".harnesshub/results.json"), JSON.stringify({
    runner: "harnesshub-local-eval",
    status: "passed",
    score: 0.9,
    verified: true,
    verification_status: "declared_case_scores",
    cost_usd: 0.03,
    duration_ms: 250,
    cases: [{ id: "smoke", title: "Smoke", score: 0.9, passed: true, verification_status: "declared_score" }]
  }, null, 2));
}
