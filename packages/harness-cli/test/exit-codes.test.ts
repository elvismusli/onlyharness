import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";

const HH = new URL("../dist/hh.mjs", import.meta.url).pathname;
const seedHarness = path.resolve(import.meta.dirname, "../../../seed-harnesses/deep-market-researcher");

let server: Server;
let registryUrl = "";
let sawPullToken = false;
let sawUpdateToken = false;

before(async () => {
  server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");

    if (request.url === "/healthz") {
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.url === "/registry") {
      response.end(JSON.stringify({ items: [{ owner: "harnesses", name: "deep-market-researcher" }] }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/definitely-not-real-xyz/archive")) {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "Harness not found" }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/paid-harness/archive")) {
      response.statusCode = 402;
      response.end(JSON.stringify({
        error: "Payment required",
        code: "PAYMENT_REQUIRED",
        checkout_url: "https://onlyharness.com/checkout?owner=harnesses&repo=paid-harness",
        pricing: { model: "one_time", amount_usd: 9, currency: "USD" }
      }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/token-required/archive")) {
      sawPullToken = request.headers.authorization === "Bearer paid-token";
      response.end(JSON.stringify({
        owner: "harnesses",
        repo: "token-required",
        version: "0.1.0",
        files: [{ path: "README.md", truncated: false, content: "# token-required\n" }]
      }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/deep-market-researcher/archive")) {
      sawUpdateToken = request.headers.authorization === "Bearer update-token";
      response.end(JSON.stringify({
        owner: "harnesses",
        repo: "deep-market-researcher",
        version: "0.2.0",
        files: [
          { path: "harness.yaml", truncated: false, content: updatedHarnessYaml() },
          { path: "README.md", truncated: false, content: "# Deep Market Researcher\n\nUpdated registry version.\n" },
          { path: "agents/web_researcher.md", truncated: false, content: "Updated researcher prompt.\n" },
          { path: "agents/synthesizer.md", truncated: false, content: "Updated synthesizer prompt.\n" },
          { path: "agents/critic.md", truncated: false, content: "Updated critic prompt.\n" },
          { path: "evals/promptfooconfig.yaml", truncated: false, content: "description: updated\nprompts: []\nproviders: []\n" },
          { path: "evals/cases/case-1.yaml", truncated: false, content: "title: Updated\nscore: 0.9\n" },
          { path: "examples/input.md", truncated: false, content: "updated input\n" },
          { path: "examples/expected.md", truncated: false, content: "updated expected\n" }
        ]
      }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/deep-market-researcher/harness")) {
      response.end(JSON.stringify({
        owner: "harnesses",
        repo: "deep-market-researcher",
        manifest: { name: "deep-market-researcher", version: "0.2.0" }
      }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/semver-harness/harness")) {
      response.end(JSON.stringify({
        owner: "harnesses",
        repo: "semver-harness",
        manifest: { name: "semver-harness", version: "0.10.0" }
      }));
      return;
    }

    if (request.url?.startsWith("/repos/harnesses/prerelease-harness/harness")) {
      response.end(JSON.stringify({
        owner: "harnesses",
        repo: "prerelease-harness",
        manifest: { name: "prerelease-harness", version: "0.2.0" }
      }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  registryUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("pull of a missing harness exits 4 and names the next command", async () => {
  const result = await runCli(["pull", "harnesses/definitely-not-real-xyz"], { HH_REGISTRY_URL: registryUrl });

  assert.equal(result.status, 4);
  assert.match(result.stderr, /Next: hh search/);
});

test("pull of a paid harness exits 5 and returns JSON payment guidance", async () => {
  const result = await runCli(["pull", "harnesses/paid-harness", "--json"], { HH_REGISTRY_URL: registryUrl });

  assert.equal(result.status, 5);
  const body = JSON.parse(result.stderr) as { error?: string; code?: number; next?: string };
  assert.match(body.error ?? "", /Payment required/);
  assert.equal(body.code, 5);
  assert.match(body.next ?? "", /checkout/);
});

test("pull sends HH_TOKEN as a bearer token", async () => {
  sawPullToken = false;
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-token-pull-"));
  try {
    const result = await runCli(["pull", "harnesses/token-required", "--out", out], { HH_REGISTRY_URL: registryUrl, HH_TOKEN: "paid-token" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(sawPullToken, true);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("pull writes source metadata for update flows", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-source-pull-"));
  try {
    const result = await runCli(["pull", "harnesses/token-required", "--out", out], { HH_REGISTRY_URL: registryUrl });
    assert.equal(result.status, 0, result.stderr);
    const source = JSON.parse(await readFile(path.join(out, ".harnesshub/source.json"), "utf8")) as { owner?: string; name?: string; version?: string; registry?: string };
    assert.equal(source.owner, "harnesses");
    assert.equal(source.name, "token-required");
    assert.equal(source.version, "0.1.0");
    assert.equal(source.registry, registryUrl);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("doctor --harness reports local harness validity", async () => {
  const result = await runCli(["doctor", "--harness", seedHarness, "--json"], { HH_REGISTRY_URL: registryUrl });

  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout) as { harness?: { valid?: boolean; name?: string; version?: string } };
  assert.equal(body.harness?.valid, true);
  assert.equal(body.harness?.name, "deep-market-researcher");
  assert.equal(body.harness?.version, "0.1.0");
});

test("pin writes pin metadata and outdated exits 3 for newer registry version", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-outdated-"));
  try {
    await cp(seedHarness, out, { recursive: true });
    await mkdir(path.join(out, ".harnesshub"), { recursive: true });
    await writeFile(path.join(out, ".harnesshub/source.json"), JSON.stringify({
      owner: "harnesses",
      name: "deep-market-researcher",
      version: "0.1.0",
      registry: registryUrl,
      pulledAt: new Date().toISOString(),
      files: ["README.md", "obsolete.md"]
    }, null, 2));

    const pin = await runCli(["pin", out, "--json"], { HH_REGISTRY_URL: registryUrl });
    assert.equal(pin.status, 0, pin.stderr);
    const pinBody = JSON.parse(pin.stdout) as { owner?: string; name?: string; version?: string };
    assert.equal(pinBody.owner, "harnesses");
    assert.equal(pinBody.name, "deep-market-researcher");
    assert.equal(pinBody.version, "0.1.0");

    const outdated = await runCli(["outdated", out, "--json"], { HH_REGISTRY_URL: "http://127.0.0.1:1" });
    assert.equal(outdated.status, 3, outdated.stderr);
    const body = JSON.parse(outdated.stdout) as { outdated?: boolean; current?: string; latest?: string };
    assert.equal(body.outdated, true);
    assert.equal(body.current, "0.1.0");
    assert.equal(body.latest, "0.2.0");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("update --diff previews without mutating files", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-update-diff-"));
  try {
    await cp(seedHarness, out, { recursive: true });
    await mkdir(path.join(out, ".harnesshub"), { recursive: true });
    await writeFile(path.join(out, ".harnesshub/source.json"), JSON.stringify({
      owner: "harnesses",
      name: "deep-market-researcher",
      version: "0.1.0",
      registry: registryUrl,
      pulledAt: new Date().toISOString(),
      files: ["README.md"]
    }, null, 2));
    const before = await readFile(path.join(out, "README.md"), "utf8");
    const result = await runCli(["update", out, "--diff", "--json"], { HH_REGISTRY_URL: "http://127.0.0.1:1" });
    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout) as { diff?: { status?: string }; current?: string; latest?: string };
    assert.equal(body.current, "0.1.0");
    assert.equal(body.latest, "0.2.0");
    assert.equal(typeof body.diff?.status, "string");
    const after = await readFile(path.join(out, "README.md"), "utf8");
    assert.equal(after, before);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("update --force sends HH_TOKEN, updates metadata, and removes stale managed files", async () => {
  sawUpdateToken = false;
  const out = await mkdtemp(path.join(os.tmpdir(), "hh-update-force-"));
  try {
    await cp(seedHarness, out, { recursive: true });
    await mkdir(path.join(out, ".harnesshub"), { recursive: true });
    await writeFile(path.join(out, "obsolete.md"), "old managed file\n");
    await writeFile(path.join(out, ".harnesshub/source.json"), JSON.stringify({
      owner: "harnesses",
      name: "deep-market-researcher",
      version: "0.1.0",
      registry: registryUrl,
      pulledAt: new Date().toISOString(),
      files: ["README.md", "obsolete.md"]
    }, null, 2));

    const result = await runCli(["update", out, "--force", "--json"], { HH_REGISTRY_URL: "http://127.0.0.1:1", HH_TOKEN: "update-token" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(sawUpdateToken, true);
    const body = JSON.parse(result.stdout) as { previous?: string; version?: string };
    assert.equal(body.previous, "0.1.0");
    assert.equal(body.version, "0.2.0");
    const source = JSON.parse(await readFile(path.join(out, ".harnesshub/source.json"), "utf8")) as { version?: string; registry?: string; files?: string[] };
    assert.equal(source.version, "0.2.0");
    assert.equal(source.registry, registryUrl);
    assert.ok(source.files?.includes("README.md"));
    await assert.rejects(readFile(path.join(out, "obsolete.md"), "utf8"));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("outdated compares semver numerically and prerelease below stable", async () => {
  const semverDir = await mkdtemp(path.join(os.tmpdir(), "hh-semver-"));
  const prereleaseDir = await mkdtemp(path.join(os.tmpdir(), "hh-prerelease-"));
  try {
    await mkdir(path.join(semverDir, ".harnesshub"), { recursive: true });
    await writeFile(path.join(semverDir, ".harnesshub/source.json"), JSON.stringify({
      owner: "harnesses",
      name: "semver-harness",
      version: "0.2.0",
      registry: registryUrl,
      pulledAt: new Date().toISOString()
    }, null, 2));
    const semver = await runCli(["outdated", semverDir, "--json"], { HH_REGISTRY_URL: "http://127.0.0.1:1" });
    assert.equal(semver.status, 3, semver.stderr);
    assert.equal((JSON.parse(semver.stdout) as { latest?: string; outdated?: boolean }).latest, "0.10.0");

    await mkdir(path.join(prereleaseDir, ".harnesshub"), { recursive: true });
    await writeFile(path.join(prereleaseDir, ".harnesshub/source.json"), JSON.stringify({
      owner: "harnesses",
      name: "prerelease-harness",
      version: "0.2.0-beta.1",
      registry: registryUrl,
      pulledAt: new Date().toISOString()
    }, null, 2));
    const prerelease = await runCli(["outdated", prereleaseDir, "--json"], { HH_REGISTRY_URL: "http://127.0.0.1:1" });
    assert.equal(prerelease.status, 3, prerelease.stderr);
    assert.equal((JSON.parse(prerelease.stdout) as { latest?: string; outdated?: boolean }).outdated, true);
  } finally {
    await rm(semverDir, { recursive: true, force: true });
    await rm(prereleaseDir, { recursive: true, force: true });
  }
});

test("run outside a harness dir exits 4", async () => {
  const result = await runCli(["run", "/tmp"]);

  assert.equal(result.status, 4);
  assert.match(result.stderr, /hh pull/);
});

test("doctor --json returns machine readable status", async () => {
  const result = await runCli(["doctor", "--json"], { HH_REGISTRY_URL: registryUrl });

  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout) as { ok?: boolean; indexed?: number; registry?: string };
  assert.equal(body.ok, true);
  assert.equal(body.indexed, 1);
  assert.equal(body.registry, registryUrl);
});

test("run --json exposes eval status for a pulled harness", async () => {
  const result = await runCli(["run", seedHarness, "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout) as { eval?: { status?: string; score?: number } };
  assert.equal(body.eval?.status, "passed");
  assert.equal(typeof body.eval?.score, "number");
});

function runCli(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [HH, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`hh ${args.join(" ")} timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 10_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
  });
}

function updatedHarnessYaml(): string {
  return `schemaVersion: harness.v0.1
name: deep-market-researcher
title: Deep Market Researcher
summary: Multi-stage research, synthesis, critique and validation pipeline for market questions.
version: 0.2.0
license: MIT
tags: [research, strategy, validation]
runtime:
  primary: openai-agents-sdk
  adapters: []
agents:
  - id: web_researcher
    role: research
    prompt: agents/web_researcher.md
    tools: []
    handoffs: []
  - id: synthesizer
    role: synthesis
    prompt: agents/synthesizer.md
    tools: []
    handoffs: []
  - id: critic
    role: critique
    prompt: agents/critic.md
    tools: []
    handoffs: []
workflow:
  entrypoint: web_researcher
  stages:
    - id: research
      agent: web_researcher
tools:
  mcp_servers: []
  function_tools: []
  external_apis: []
permissions:
  network: allowlist
  network_allowlist: [api.openai.com]
  filesystem: readonly
  shell: false
  browser: false
  credentials: runtime_injected
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
  - title: Updated
    input: examples/input.md
    output: examples/expected.md
`;
}
