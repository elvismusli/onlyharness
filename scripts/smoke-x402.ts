import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const workspace = mkdtempSync(path.join(os.tmpdir(), "hh-x402-smoke-"));
const payTo = "0x000000000000000000000000000000000000dEaD";
const payer = "0x1111111111111111111111111111111111111111";
let stdout = "";
let stderr = "";

createPaidHarness(path.join(workspace, "data/imports/x402-paid-harness"));
const facilitator = await startFakeFacilitator(8803);

const api = spawn("npm", ["run", "start", "-w", "@harnesshub/api"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    HARNESS_API_PORT: "8802",
    HARNESS_API_HOST: "127.0.0.1",
    HARNESS_WORKSPACE_ROOT: workspace,
    HARNESS_PUBLIC_API_URL: "http://127.0.0.1:8802",
    PAYMENTS_ENABLED: "true",
    X402_ENABLED: "true",
    X402_PAY_TO: payTo,
    X402_FACILITATOR_URL: "http://127.0.0.1:8803",
    X402_NETWORK: "eip155:8453",
    X402_ASSET: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    HARNESS_LOCAL_PAYMENTS_PATH: path.join(workspace, "payments.json")
  }
});

api.stdout?.setEncoding("utf8");
api.stderr?.setEncoding("utf8");
api.stdout?.on("data", (chunk) => {
  stdout += chunk;
});
api.stderr?.on("data", (chunk) => {
  stderr += chunk;
});

try {
  await waitForApi("http://127.0.0.1:8802/healthz");
  const response = await fetch("http://127.0.0.1:8802/repos/local/x402-paid-harness/archive?version=0.1.0");
  const paymentHeader = response.headers.get("PAYMENT-REQUIRED");
  const body = await response.json() as {
    code?: string;
    files?: unknown[];
    x402?: {
      enabled?: boolean;
      requirements?: Array<{ amount?: string; payTo?: string; network?: string }>;
      paymentRequired?: unknown;
    };
  };
  if (response.status !== 402 || body.code !== "PAYMENT_REQUIRED" || body.files) {
    throw new Error(`Expected gated paid archive, got ${response.status} ${JSON.stringify(body)}`);
  }
  if (!paymentHeader) throw new Error("Missing PAYMENT-REQUIRED header");
  const paymentRequired = decodeBase64Json(paymentHeader) as {
    x402Version?: number;
    accepts?: Array<{ amount?: string; payTo?: string; network?: string }>;
    resource?: { url?: string; mimeType?: string };
  };
  const requirement = paymentRequired.accepts?.[0];
  if (paymentRequired.x402Version !== 2 || requirement?.payTo !== payTo || requirement.amount !== "9000000" || requirement.network !== "eip155:8453") {
    throw new Error(`Invalid PAYMENT-REQUIRED payload: ${JSON.stringify(paymentRequired)}`);
  }
  if (paymentRequired.resource?.url !== "http://127.0.0.1:8802/repos/local/x402-paid-harness/archive?version=0.1.0") {
    throw new Error(`Invalid x402 resource URL: ${JSON.stringify(paymentRequired.resource)}`);
  }
  if (body.x402?.enabled !== true || body.x402.requirements?.[0]?.payTo !== payTo || !body.x402.paymentRequired) {
    throw new Error(`Invalid x402 JSON body: ${JSON.stringify(body.x402)}`);
  }
  const paidResponse = await fetch("http://127.0.0.1:8802/repos/local/x402-paid-harness/archive?version=0.1.0", {
    headers: {
      "PAYMENT-SIGNATURE": encodePaymentSignature({
        x402Version: 2,
        resource: paymentRequired.resource,
        accepted: requirement,
        payload: { smoke: true }
      })
    }
  });
  const paymentResponseHeader = paidResponse.headers.get("PAYMENT-RESPONSE");
  const archive = await paidResponse.json() as { version?: string; files?: unknown[] };
  if (paidResponse.status !== 200 || archive.version !== "0.1.0" || !archive.files?.length) {
    throw new Error(`x402 paid archive failed: ${paidResponse.status} ${JSON.stringify(archive)}`);
  }
  if (!paymentResponseHeader) throw new Error("x402 paid archive did not include PAYMENT-RESPONSE");
  const paymentState = JSON.parse(await readFile(path.join(workspace, "payments.json"), "utf8")) as {
    purchases?: Array<{ provider?: string; provider_ref?: string; subject_type?: string; subject_id?: string; status?: string }>;
    entitlements?: Array<{ subject_type?: string; subject_id?: string; owner?: string; repo?: string; version?: string }>;
  };
  if (!paymentState.purchases?.some((purchase) => purchase.provider === "x402" && purchase.provider_ref === "x402:eip155:8453:0xsmoketx" && purchase.subject_type === "wallet" && purchase.subject_id === payer && purchase.status === "paid")) {
    throw new Error(`x402 purchase was not persisted: ${JSON.stringify(paymentState)}`);
  }
  if (!paymentState.entitlements?.some((entitlement) => entitlement.subject_type === "wallet" && entitlement.subject_id === payer && entitlement.owner === "local" && entitlement.repo === "x402-paid-harness" && entitlement.version === "0.1.0")) {
    throw new Error(`x402 wallet entitlement was not persisted: ${JSON.stringify(paymentState)}`);
  }
  console.log("x402 smoke passed: 402 requirements, facilitator settlement, PAYMENT-RESPONSE, and wallet entitlement");
} finally {
  api.kill("SIGTERM");
  await new Promise((resolve) => api.once("close", resolve));
  await closeServer(facilitator);
  rmSync(workspace, { recursive: true, force: true });
}

async function waitForApi(url: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`API did not become ready\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

function decodeBase64Json(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

function encodePaymentSignature(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

async function startFakeFacilitator(port: number): Promise<Server> {
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/verify" && request.method === "POST") {
      await readRequestBody(request);
      response.end(JSON.stringify({ isValid: true, payer }));
      return;
    }
    if (request.url === "/settle" && request.method === "POST") {
      await readRequestBody(request);
      response.end(JSON.stringify({
        success: true,
        payer,
        transaction: "0xsmoketx",
        network: "eip155:8453",
        amount: "9000000"
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function readRequestBody(request: NodeJS.ReadableStream): Promise<string> {
  let raw = "";
  request.setEncoding("utf8");
  for await (const chunk of request) raw += chunk;
  return raw;
}

function createPaidHarness(target: string) {
  mkdirSync(path.join(target, "agents"), { recursive: true });
  mkdirSync(path.join(target, "evals/cases"), { recursive: true });
  mkdirSync(path.join(target, "examples"), { recursive: true });
  mkdirSync(path.join(target, ".harnesshub"), { recursive: true });
  writeFileSync(path.join(target, "harness.yaml"), `schemaVersion: harness.v0.1
name: x402-paid-harness
title: x402 Paid Harness
summary: Paid x402 smoke harness.
version: 0.1.0
license: MIT
tags: [paid, x402]
runtime:
  primary: openai-agents-sdk
  adapters: []
pricing:
  model: one_time
  amount_usd: 9
  currency: USD
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
  writeFileSync(path.join(target, "README.md"), "# x402 Paid Harness\n");
  writeFileSync(path.join(target, "agents/operator.md"), "Return a short x402 smoke result.\n");
  writeFileSync(path.join(target, "evals/promptfooconfig.yaml"), "description: x402 paid smoke\nprompts: []\nproviders: []\n");
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
