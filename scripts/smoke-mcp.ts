import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const apiUrl = "http://127.0.0.1:8798";
const paidRoot = path.join(root, "data/imports/mcp-smoke-paid-harness");
const smokeDataRoot = mkdtempSync(path.join(os.tmpdir(), "hh-mcp-smoke-"));
const orgRoot = path.join(smokeDataRoot, "org-harnesses");
const orgsPath = path.join(smokeDataRoot, "orgs.json");

createPaidHarness(paidRoot);
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
  if (initialize.result?.serverInfo?.name !== "onlyharness") {
    throw new Error(`MCP initialize failed: ${JSON.stringify(initialize)}`);
  }

  const tools = await rpc(2, "tools/list", {});
  const names = tools.result?.tools?.map((tool: { name: string }) => tool.name) ?? [];
  for (const expected of ["search_harnesses", "harness_detail", "pull_instructions", "pull_harness", "search_docs", "publish_markdown_to_harness"]) {
    if (!names.includes(expected)) throw new Error(`MCP tool missing: ${expected}`);
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

  const detail = await rpc(4, "tools/call", {
    name: "harness_detail",
    arguments: { owner: "harnesses", name: "deep-market-researcher" }
  });
  const detailText = detail.result?.content?.[0]?.text ?? "";
  if (!detailText.includes("\"contextCost\"") || !detailText.includes("\"estimated\"")) {
    throw new Error(`MCP harness_detail did not include context cost: ${JSON.stringify(detail)}`);
  }

  const pull = await rpc(5, "tools/call", {
    name: "pull_harness",
    arguments: { owner: "harnesses", name: "deep-market-researcher" }
  });
  const pullText = pull.result?.content?.[0]?.text ?? "";
  if (!pullText.includes("\"files\"") || !pullText.includes("harness.yaml")) {
    throw new Error(`MCP pull_harness returned wrong content: ${JSON.stringify(pull)}`);
  }

  const paidPull = await rpc(6, "tools/call", {
    name: "pull_harness",
    arguments: { owner: "local", name: "mcp-smoke-paid-harness" }
  });
  const paidText = paidPull.result?.content?.[0]?.text ?? "";
  if (!paidText.includes("PAYMENT_REQUIRED") || paidText.includes("\"files\"")) {
    throw new Error(`MCP paid pull did not return payment requirements: ${JSON.stringify(paidPull)}`);
  }

  const privateDetail = await rpc(7, "tools/call", {
    name: "harness_detail",
    arguments: { owner: "@acme", name: "mcp-private-harness" }
  });
  const privateDetailText = privateDetail.result?.content?.[0]?.text ?? "";
  if (!privateDetailText.includes("Org token required") || privateDetailText.includes("\"manifest\"")) {
    throw new Error(`MCP private detail leaked without org token: ${JSON.stringify(privateDetail)}`);
  }

  const privateInstructions = await rpc(8, "tools/call", {
    name: "pull_instructions",
    arguments: { owner: "@acme", name: "mcp-private-harness" }
  });
  const privateInstructionsText = privateInstructions.result?.content?.[0]?.text ?? "";
  if (!privateInstructionsText.includes("Org token required") || privateInstructionsText.includes("archiveUrl")) {
    throw new Error(`MCP private pull instructions leaked without org token: ${JSON.stringify(privateInstructions)}`);
  }

  const privatePull = await rpc(9, "tools/call", {
    name: "pull_harness",
    arguments: { owner: "@acme", name: "mcp-private-harness" }
  });
  const privatePullText = privatePull.result?.content?.[0]?.text ?? "";
  if (!privatePullText.includes("Org token required") || privatePullText.includes("\"files\"")) {
    throw new Error(`MCP private pull leaked without org token: ${JSON.stringify(privatePull)}`);
  }

  const authorizedPrivateDetail = await rpc(10, "tools/call", {
    name: "harness_detail",
    arguments: { owner: "@acme", name: "mcp-private-harness" }
  }, { Authorization: "Bearer mcp-org-token" });
  const authorizedPrivateDetailText = authorizedPrivateDetail.result?.content?.[0]?.text ?? "";
  if (!authorizedPrivateDetailText.includes("\"visibility\": \"org\"") || !authorizedPrivateDetailText.includes("\"org\": \"acme\"")) {
    throw new Error(`MCP private detail failed with org token: ${JSON.stringify(authorizedPrivateDetail)}`);
  }

  const publish = await rpc(11, "tools/call", {
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

  const getResponse = await fetch(`${apiUrl}/mcp`);
  if (getResponse.status !== 405) throw new Error(`Expected GET /mcp 405, got ${getResponse.status}`);

  console.log("MCP smoke passed: initialize, tools/list, search_harnesses, pull_harness, paid pull gate, org-private gates, publish auth guard, GET 405");
} finally {
  api.kill("SIGTERM");
  rmSync(paidRoot, { recursive: true, force: true });
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
