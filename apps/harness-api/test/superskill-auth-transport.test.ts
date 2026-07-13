import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import test from "node:test";
import {
  createSupabaseSuperskillAccessResolver,
  fetchSupabaseAuthIdentity,
  normalizeSupabaseOrigin,
  SUPERSKILL_MANAGED_SCOPE
} from "../src/superskill/access.js";

const anonKey = "fixture-anon-secret-never-forward";
const bearer = "fixture-user-secret-never-forward";
const serviceRoleKey = "fixture-service-secret-never-forward";
const subjectSalt = "fixture-user-subject-salt-at-least-32-bytes";

test("stalled Supabase auth is bounded and maps to stable unavailable failures", async () => {
  const startedAt = Date.now();
  const identity = await fetchSupabaseAuthIdentity({
    supabaseUrl: "https://supabase.fixture",
    anonKey,
    authorization: `Bearer ${bearer}`,
    timeoutMs: 25,
    fetchImpl: async () => await new Promise<Response>(() => undefined)
  });
  const elapsed = Date.now() - startedAt;
  assert.deepEqual(identity, { ok: false, kind: "unavailable" });
  assert.ok(elapsed >= 15 && elapsed < 500, `stalled auth must stop near its deadline, elapsed=${elapsed}ms`);

  const resolver = createSupabaseSuperskillAccessResolver({
    supabaseUrl: "https://supabase.fixture",
    anonKey,
    serviceRoleKey,
    subjectSalt,
    timeoutMs: 25,
    fetchImpl: async () => await new Promise<Response>(() => undefined)
  });
  const result = await resolver({
    authorization: `Bearer ${bearer}`,
    requiredScope: SUPERSKILL_MANAGED_SCOPE,
    now: new Date("2026-07-14T00:00:00.000Z")
  });
  assert.deepEqual(result, { ok: false, status: 503, code: "SUPERSKILL_AUTH_UNAVAILABLE" });
});

test("30x is never followed and Supabase credentials never reach a second origin", async (t) => {
  const leakedHeaders: Array<{ apikey?: string; authorization?: string }> = [];
  const secondOrigin = createServer((request, response) => {
    leakedHeaders.push({
      apikey: header(request.headers.apikey),
      authorization: header(request.headers.authorization)
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }));
  });
  const secondUrl = await listen(secondOrigin);
  t.after(() => close(secondOrigin));

  const configuredOriginRequests: Array<{ apikey?: string; authorization?: string }> = [];
  const configuredOrigin = createServer((request, response) => {
    configuredOriginRequests.push({
      apikey: header(request.headers.apikey),
      authorization: header(request.headers.authorization)
    });
    response.writeHead(302, { location: `${secondUrl}/capture` });
    response.end();
  });
  const supabaseUrl = await listen(configuredOrigin);
  t.after(() => close(configuredOrigin));

  const identity = await fetchSupabaseAuthIdentity({
    supabaseUrl,
    anonKey,
    authorization: `Bearer ${bearer}`,
    timeoutMs: 500
  });
  assert.deepEqual(identity, { ok: false, kind: "unavailable" });
  assert.equal(configuredOriginRequests.length, 1);
  assert.deepEqual(configuredOriginRequests[0], { apikey: anonKey, authorization: `Bearer ${bearer}` });
  assert.deepEqual(leakedHeaders, []);
});

test("grant redirect never forwards the service-role apikey or bearer", async (t) => {
  const leakedHeaders: Array<{ apikey?: string; authorization?: string }> = [];
  const secondOrigin = createServer((request, response) => {
    leakedHeaders.push({
      apikey: header(request.headers.apikey),
      authorization: header(request.headers.authorization)
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end("[]");
  });
  const secondUrl = await listen(secondOrigin);
  t.after(() => close(secondOrigin));

  let authRequests = 0;
  let grantRequests = 0;
  const configuredOrigin = createServer((request, response) => {
    if (request.url === "/auth/v1/user") {
      authRequests += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: "11111111-1111-4111-8111-111111111111",
        email_confirmed_at: "2026-07-01T00:00:00.000Z"
      }));
      return;
    }
    grantRequests += 1;
    response.writeHead(307, { location: `${secondUrl}/capture-service-role` });
    response.end();
  });
  const supabaseUrl = await listen(configuredOrigin);
  t.after(() => close(configuredOrigin));

  const resolver = createSupabaseSuperskillAccessResolver({
    supabaseUrl,
    anonKey,
    serviceRoleKey,
    subjectSalt,
    timeoutMs: 500
  });
  const result = await resolver({
    authorization: `Bearer ${bearer}`,
    requiredScope: SUPERSKILL_MANAGED_SCOPE,
    now: new Date("2026-07-14T00:00:00.000Z")
  });
  assert.deepEqual(result, { ok: false, status: 503, code: "SUPERSKILL_AUTH_UNAVAILABLE" });
  assert.deepEqual({ authRequests, grantRequests }, { authRequests: 1, grantRequests: 1 });
  assert.deepEqual(leakedHeaders, []);
});

test("configured Supabase base is an exact secure origin", () => {
  assert.equal(normalizeSupabaseOrigin("https://project.supabase.co/"), "https://project.supabase.co");
  assert.equal(normalizeSupabaseOrigin("https://project.supabase.co/rest/v1"), undefined);
  assert.equal(normalizeSupabaseOrigin("https://user:secret@project.supabase.co"), undefined);
  assert.equal(normalizeSupabaseOrigin("https://project.supabase.co?redirect=evil"), undefined);
  assert.equal(normalizeSupabaseOrigin("http://project.supabase.co"), undefined);
  assert.equal(normalizeSupabaseOrigin("http://127.0.0.1:54321"), "http://127.0.0.1:54321");
});

test("invalid configured origin fails closed without throwing", async () => {
  let calls = 0;
  const result = await fetchSupabaseAuthIdentity({
    supabaseUrl: "https://attacker@project.supabase.co/redirect",
    anonKey,
    authorization: `Bearer ${bearer}`,
    fetchImpl: async () => {
      calls += 1;
      throw new Error("must not fetch");
    }
  });
  assert.deepEqual(result, { ok: false, kind: "unavailable" });
  assert.equal(calls, 0);
});

test("server user auth delegates to the hardened transport and keeps AUTH_UNAVAILABLE stable", () => {
  const serverSource = readFileSync(path.resolve(import.meta.dirname, "../src/server.ts"), "utf8");
  const start = serverSource.indexOf("async function userFromAuthorization");
  const end = serverSource.indexOf("const publishMarkdownFromMcp", start);
  assert.ok(start >= 0 && end > start);
  const authFunction = serverSource.slice(start, end);
  assert.match(authFunction, /fetchSupabaseAuthIdentity/);
  assert.match(authFunction, /code: "AUTH_UNAVAILABLE"/);
  assert.doesNotMatch(authFunction, /\bfetch\s*\(/);
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
