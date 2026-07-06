import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";

const HH = new URL("../dist/hh.mjs", import.meta.url).pathname;
const seedHarness = path.resolve(import.meta.dirname, "../../../seed-harnesses/deep-market-researcher");

let server: Server;
let registryUrl = "";
let sawPullToken = false;

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
