import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import path from "node:path";

const HH = new URL("../dist/hh.mjs", import.meta.url).pathname;
const seedHarness = path.resolve(import.meta.dirname, "../../../seed-harnesses/deep-market-researcher");

let server: Server;
let registryUrl = "";

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
