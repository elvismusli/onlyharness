import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import { apiServerOptions, registerApiObservability } from "../src/observability.js";

const accessToken = `ohat_${"a".repeat(43)}`;
const deviceProof = `ohdp_${"b".repeat(43)}`;
const email = "private-user@example.com";
const wallet = "0x1111111111111111111111111111111111111111";

test("production logger strips request values and redacts structured secrets", async (t) => {
  const lines: string[] = [];
  const app = Fastify(apiServerOptions({
    environment: "test",
    release: "test-release",
    stream: { write: (message) => lines.push(message) }
  }));
  registerApiObservability(app);
  app.post("/probe/:resourceId", async (request) => {
    request.log.info({
      event: "sensitive_probe",
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
      body: request.body,
      email,
      payer: wallet,
      access_token: accessToken
    }, "Sensitive probe");
    return { ok: true };
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: `/probe/private-resource?q=private-query&request_id=${deviceProof}`,
    headers: { authorization: `Bearer ${accessToken}`, cookie: `session=${deviceProof}` },
    payload: { device_proof: deviceProof, email }
  });

  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["x-request-id"]), /^[0-9a-f-]{36}$/);
  const output = lines.join("");
  for (const secret of [accessToken, deviceProof, email, wallet, "private-query", "private-resource"]) {
    assert.ok(!output.includes(secret), `log output leaked ${secret}`);
  }
  const rows = lines.map((line) => JSON.parse(line) as Record<string, any>);
  const probe = rows.find((row) => row.event === "sensitive_probe");
  assert.equal(probe?.authorization, "[REDACTED]");
  assert.equal(probe?.body, "[REDACTED]");
  assert.equal(probe?.payer, "[REDACTED]");
  assert.match(String(probe?.request_id), /^[0-9a-f-]{36}$/);
  const started = rows.find((row) => row.event === "http_request_started");
  assert.equal(started?.http?.route, "/probe/:resourceId");
  const completed = rows.find((row) => row.event === "http_request_completed");
  assert.equal(completed?.http?.route, "/probe/:resourceId");
  assert.equal(completed?.http?.status_code, 200);
  assert.equal(completed?.service, "superskill-api");
  assert.equal(completed?.release, "test-release");
});

test("error serializer retains a stable code and removes credentials from message and stack", async (t) => {
  const lines: string[] = [];
  const app = Fastify(apiServerOptions({
    environment: "test",
    release: "test-release",
    stream: { write: (message) => lines.push(message) }
  }));
  registerApiObservability(app);
  app.get("/failure", async () => {
    const error = new Error(`failed for Bearer ${accessToken}, ${email}, proof=${deviceProof}`) as Error & { code: string };
    error.code = "PROBE_FAILURE";
    throw error;
  });
  t.after(() => app.close());

  assert.equal((await app.inject({ method: "GET", url: "/failure" })).statusCode, 500);
  const output = lines.join("");
  for (const secret of [accessToken, deviceProof, email]) assert.ok(!output.includes(secret));
  const failed = lines.map((line) => JSON.parse(line) as Record<string, any>).find((row) => row.event === "http_request_failed");
  assert.equal(failed?.error_code, "PROBE_FAILURE");
  assert.equal(failed?.err?.code, "PROBE_FAILURE");
  assert.match(String(failed?.err?.message), /\[REDACTED/);
  assert.match(String(failed?.err?.stack), /observability\.test\.ts/);
});

test("trusted private proxy chain yields the client IP but direct spoofed headers do not", async (t) => {
  const app = Fastify(apiServerOptions({ logLevel: "silent", environment: "test", release: "test-release" }));
  app.get("/ip", async (request) => ({ ip: request.ip, ips: request.ips }));
  t.after(() => app.close());

  const proxied = await app.inject({
    method: "GET",
    url: "/ip",
    remoteAddress: "172.20.0.3",
    headers: { "x-forwarded-for": "198.51.100.20, 127.0.0.1" }
  });
  assert.equal(proxied.json().ip, "198.51.100.20");

  const direct = await app.inject({
    method: "GET",
    url: "/ip",
    remoteAddress: "203.0.113.30",
    headers: { "x-forwarded-for": "198.51.100.99" }
  });
  assert.equal(direct.json().ip, "203.0.113.30");
});
