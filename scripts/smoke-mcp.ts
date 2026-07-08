import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const apiUrl = "http://127.0.0.1:8798";
const paidRoot = path.join(root, "data/imports/mcp-smoke-paid-harness");
const hostedRoot = path.join(root, "data/imports/mcp-smoke-hosted-harness");
const smokeDataRoot = mkdtempSync(path.join(os.tmpdir(), "hh-mcp-smoke-"));
const orgRoot = path.join(smokeDataRoot, "org-harnesses");
const orgsPath = path.join(smokeDataRoot, "orgs.json");

createPaidHarness(paidRoot);
createHostedHarness(hostedRoot);
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
  if (initialize.result?.serverInfo?.name !== "onlyharness" || initialize.result?.serverInfo?.version !== "0.2.8") {
    throw new Error(`MCP initialize failed: ${JSON.stringify(initialize)}`);
  }

  const tools = await rpc(2, "tools/list", {});
  const names = tools.result?.tools?.map((tool: { name: string }) => tool.name) ?? [];
  for (const expected of ["search_harnesses", "harness_detail", "pull_instructions", "pull_harness", "search_docs", "publish_markdown_to_harness", "publish_resource_package", "search_resources", "resource_detail", "resource_use_instructions"]) {
    if (!names.includes(expected)) throw new Error(`MCP tool missing: ${expected}`);
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

  const privateDetail = await rpc(8, "tools/call", {
    name: "harness_detail",
    arguments: { owner: "@acme", name: "mcp-private-harness" }
  });
  const privateDetailText = privateDetail.result?.content?.[0]?.text ?? "";
  if (!privateDetailText.includes("Org token required") || privateDetailText.includes("\"manifest\"")) {
    throw new Error(`MCP private detail leaked without org token: ${JSON.stringify(privateDetail)}`);
  }

  const privateInstructions = await rpc(9, "tools/call", {
    name: "pull_instructions",
    arguments: { owner: "@acme", name: "mcp-private-harness" }
  });
  const privateInstructionsText = privateInstructions.result?.content?.[0]?.text ?? "";
  if (!privateInstructionsText.includes("Org token required") || privateInstructionsText.includes("archiveUrl")) {
    throw new Error(`MCP private pull instructions leaked without org token: ${JSON.stringify(privateInstructions)}`);
  }

  const privatePull = await rpc(10, "tools/call", {
    name: "pull_harness",
    arguments: { owner: "@acme", name: "mcp-private-harness" }
  });
  const privatePullText = privatePull.result?.content?.[0]?.text ?? "";
  if (!privatePullText.includes("Org token required") || privatePullText.includes("\"files\"")) {
    throw new Error(`MCP private pull leaked without org token: ${JSON.stringify(privatePull)}`);
  }

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
  if (!publishText.includes("Authorization required") || !publishText.includes("oauth-protected-resource")) {
    throw new Error(`MCP publish auth guard failed: ${JSON.stringify(publish)}`);
  }

  const publishResource = await rpc(121, "tools/call", {
    name: "publish_resource_package",
    arguments: {
      name: "no-auth-resource",
      resourceType: "command_pack",
      files: [{ path: "README.md", content: "# No Auth Resource\n\nThis should return an authorization error instead of publishing." }]
    }
  });
  const publishResourceText = publishResource.result?.content?.[0]?.text ?? "";
  if (!publishResourceText.includes("Authorization required") || !publishResourceText.includes("oauth-protected-resource")) {
    throw new Error(`MCP resource package publish auth guard failed: ${JSON.stringify(publishResource)}`);
  }

  const getResponse = await fetch(`${apiUrl}/mcp`);
  if (getResponse.status !== 405) throw new Error(`Expected GET /mcp 405, got ${getResponse.status}`);

  console.log("MCP smoke passed: initialize, tools/list, search_harnesses, search_resources, resource instructions, search_docs public source, pull_harness, purchase-aware detail/instructions, paid pull gate, hosted per-call guard, org-private gates, publish auth guards, GET 405");
} finally {
  api.kill("SIGTERM");
  rmSync(paidRoot, { recursive: true, force: true });
  rmSync(hostedRoot, { recursive: true, force: true });
  rmSync(smokeDataRoot, { recursive: true, force: true });
}

async function rpc(id: number, method: string, params: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${apiUrl}/mcp`, {
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
