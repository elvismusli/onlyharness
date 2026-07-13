import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import Fastify from "fastify";

import { createSupabaseSuperskillAccessResolver, SUPERSKILL_MANAGED_SCOPE, superskillUserSubject } from "../src/superskill/access.js";
import {
  createSupabaseDeviceGrantResolver,
  createSuperskillDeviceAuthService,
  registerSuperskillDeviceAuthRoutes,
  type DeviceAuthGrantResolver,
  type DeviceAuthIdentityResolver
} from "../src/superskill/device-auth.js";
import { issueSuperskillDeviceToken, verifySuperskillDeviceToken } from "../src/superskill/device-token.js";

const subjectSalt = "fixture-device-subject-salt-at-least-32-bytes";
const userId = "11111111-1111-4111-8111-111111111111";
const confirmedAt = "2026-07-01T00:00:00.000Z";

test("device flow requires confirmed browser approval and returns a one-time short-lived bearer", async (t) => {
  let now = new Date("2026-07-14T00:00:00.000Z");
  const grants: Array<{ userId: string; subject: string; expiresAt: Date }> = [];
  const identityResolver: DeviceAuthIdentityResolver = async ({ authorization }) => authorization === "Bearer browser-session"
    ? { ok: true, user: { id: userId, emailConfirmedAt: confirmedAt } }
    : { ok: false, status: 401, code: "DEVICE_AUTH_INVALID" };
  const grantResolver: DeviceAuthGrantResolver = async (input) => {
    grants.push(input);
    return { ok: true };
  };
  const app = Fastify({ logger: false });
  await registerSuperskillDeviceAuthRoutes(app, {
    subjectSalt,
    publicUrl: "https://superskill.sh",
    identityResolver,
    grantResolver,
    now: () => now,
    random: deterministicRandom(),
    pollIntervalSeconds: 1
  });
  t.after(() => app.close());

  const start = await app.inject({ method: "POST", url: "/auth/device/start", payload: { client: "codex" } });
  assert.equal(start.statusCode, 201);
  assert.equal(start.headers["cache-control"], "no-store");
  const started = start.json() as { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number };
  assert.match(started.device_code, /^ohdc_[A-Za-z0-9_-]{43}$/);
  assert.match(started.user_code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(started.verification_uri, "https://superskill.sh/#/superskill/account");
  assert.ok(!started.verification_uri.includes(started.user_code));
  assert.ok(!started.verification_uri.includes(started.device_code));

  const pending = await app.inject({ method: "POST", url: "/auth/device/token", payload: { device_code: started.device_code } });
  assert.equal(pending.statusCode, 202);
  assert.deepEqual(pending.json(), { error: "Waiting for browser approval", code: "AUTHORIZATION_PENDING", retry_after: 1 });

  const denied = await app.inject({ method: "POST", url: "/auth/device/approve", payload: { user_code: started.user_code } });
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.json().code, "DEVICE_AUTH_INVALID");
  assert.equal(grants.length, 0);

  const approved = await app.inject({
    method: "POST",
    url: "/auth/device/approve",
    headers: { authorization: "Bearer browser-session" },
    payload: { user_code: started.user_code.toLowerCase().replace("-", " ") }
  });
  assert.equal(approved.statusCode, 200);
  assert.deepEqual(approved.json(), { approved: true, expires_in: 1_800 });
  assert.equal(grants.length, 1);
  assert.equal(grants[0].userId, userId);
  assert.equal(grants[0].subject, superskillUserSubject(userId, subjectSalt));
  assert.equal(grants[0].expiresAt.toISOString(), "2026-07-14T00:30:00.000Z");

  const replayApproval = await app.inject({
    method: "POST",
    url: "/auth/device/approve",
    headers: { authorization: "Bearer browser-session" },
    payload: { user_code: started.user_code }
  });
  assert.equal(replayApproval.statusCode, 409);
  assert.equal(replayApproval.json().code, "DEVICE_CODE_USED");

  now = new Date(now.getTime() + 1_000);
  const exchanged = await app.inject({ method: "POST", url: "/auth/device/token", payload: { device_code: started.device_code } });
  assert.equal(exchanged.statusCode, 200);
  const token = exchanged.json() as { access_token: string; token_type: string; expires_in: number; scope: string };
  assert.match(token.access_token, /^ohdt_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  assert.equal(token.token_type, "Bearer");
  assert.equal(token.scope, SUPERSKILL_MANAGED_SCOPE);
  assert.equal(token.expires_in, 1_799);
  assert.equal(verifySuperskillDeviceToken(token.access_token, subjectSalt, now)?.userId, userId);

  const replay = await app.inject({ method: "POST", url: "/auth/device/token", payload: { device_code: started.device_code } });
  assert.equal(replay.statusCode, 409);
  assert.equal(replay.json().code, "DEVICE_CODE_USED");
});

test("unconfirmed browser identity is rejected before grant issuance", async (t) => {
  let grants = 0;
  const app = Fastify({ logger: false });
  await registerSuperskillDeviceAuthRoutes(app, {
    subjectSalt,
    publicUrl: "https://superskill.sh",
    identityResolver: async () => ({ ok: false, status: 403, code: "DEVICE_AUTH_EMAIL_UNCONFIRMED" }),
    grantResolver: async () => {
      grants += 1;
      return { ok: true };
    },
    random: deterministicRandom()
  });
  t.after(() => app.close());
  const started = (await app.inject({ method: "POST", url: "/auth/device/start" })).json() as { user_code: string };
  const response = await app.inject({
    method: "POST",
    url: "/auth/device/approve",
    headers: { authorization: "Bearer unconfirmed" },
    payload: { user_code: started.user_code }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().code, "DEVICE_AUTH_EMAIL_UNCONFIRMED");
  assert.equal(grants, 0);
});

test("device sessions expire, reject rapid polling, and rate-limit starts", async () => {
  let now = new Date("2026-07-14T00:00:00.000Z");
  const service = createSuperskillDeviceAuthService({
    subjectSalt,
    publicUrl: "https://superskill.sh",
    identityResolver: async () => ({ ok: true, user: { id: userId, emailConfirmedAt: confirmedAt } }),
    grantResolver: async () => ({ ok: true }),
    now: () => now,
    random: deterministicRandom(),
    sessionTtlSeconds: 120,
    pollIntervalSeconds: 2
  });
  const first = service.start("client-a");
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(service.token({ clientKey: "client-a", deviceCode: first.deviceCode }).status, 202);
  const rapid = service.token({ clientKey: "client-a", deviceCode: first.deviceCode });
  assert.deepEqual(rapid, { ok: false, status: 429, code: "DEVICE_AUTH_SLOW_DOWN", retryAfter: 2 });
  now = new Date(now.getTime() + 121_000);
  const expired = service.token({ clientKey: "client-a", deviceCode: first.deviceCode });
  assert.deepEqual(expired, { ok: false, status: 410, code: "DEVICE_CODE_EXPIRED" });

  now = new Date("2026-07-14T01:00:00.000Z");
  let limited: ReturnType<typeof service.start> | undefined;
  for (let index = 0; index < 21; index += 1) limited = service.start("same-client");
  assert.equal(limited?.ok, false);
  if (!limited?.ok) assert.equal(limited.code, "DEVICE_AUTH_RATE_LIMITED");
});

test("device bearer is live-checked against the Supabase user and managed grant", async () => {
  const now = new Date("2026-07-14T00:01:00.000Z");
  const token = issueSuperskillDeviceToken({
    userId,
    subjectSalt,
    issuedAt: new Date("2026-07-14T00:00:00.000Z"),
    expiresAt: new Date("2026-07-14T00:30:00.000Z"),
    tokenId: "token-id-abcdefghijkl"
  });
  assert.ok(token);
  const requests: Array<{ url: string; authorization?: string }> = [];
  const resolver = createSupabaseSuperskillAccessResolver({
    supabaseUrl: "https://supabase.fixture",
    anonKey: "anon-key",
    serviceRoleKey: "service-role-key",
    subjectSalt,
    fetchImpl: async (input, init) => {
      const url = input.toString();
      requests.push({ url, authorization: new Headers(init?.headers).get("authorization") ?? undefined });
      if (url.includes("/auth/v1/admin/users/")) {
        return responseFor(url, 200, { id: userId, email_confirmed_at: confirmedAt });
      }
      return responseFor(url, 200, [{
        user_id: userId,
        subject: superskillUserSubject(userId, subjectSalt),
        scope: SUPERSKILL_MANAGED_SCOPE,
        cohort: "self-service",
        status: "active",
        expires_at: "2026-07-14T00:30:00.000Z",
        revoked_at: null
      }]);
    }
  });
  const result = await resolver({ authorization: `Bearer ${token}`, requiredScope: SUPERSKILL_MANAGED_SCOPE, now });
  assert.equal(result.ok, true);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/auth\/v1\/admin\/users\//);
  assert.equal(requests[0].authorization, "Bearer service-role-key");
  assert.ok(!requests.some((request) => request.url.endsWith("/auth/v1/user")));

  requests.length = 0;
  const tampered = `${token!.slice(0, -1)}${token!.endsWith("a") ? "b" : "a"}`;
  const rejected = await resolver({ authorization: `Bearer ${tampered}`, requiredScope: SUPERSKILL_MANAGED_SCOPE, now });
  assert.deepEqual(rejected, { ok: false, status: 401, code: "SUPERSKILL_AUTH_INVALID" });
  assert.equal(requests.length, 0);
});

test("self-service grant preserves stronger active access and otherwise uses the audited operator RPC", async () => {
  const subject = superskillUserSubject(userId, subjectSalt);
  const expiresAt = new Date("2026-07-14T00:30:00.000Z");
  const requests: Array<{ url: string; method: string; body?: string; authorization?: string }> = [];
  let existingRows: unknown[] = [{
    user_id: userId,
    subject,
    scope: SUPERSKILL_MANAGED_SCOPE,
    status: "active",
    expires_at: "2026-07-14T01:00:00.000Z",
    revoked_at: null
  }];
  const resolver = createSupabaseDeviceGrantResolver({
    subjectSalt,
    supabaseUrl: "https://supabase.fixture",
    serviceRoleKey: "service-role-key",
    fetchImpl: async (input, init) => {
      const url = input.toString();
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
        authorization: new Headers(init?.headers).get("authorization") ?? undefined
      });
      return url.includes("/rpc/") ? responseFor(url, 200, { status: "active" }) : responseFor(url, 200, existingRows);
    }
  });

  assert.deepEqual(await resolver({ userId, subject, expiresAt }), { ok: true });
  assert.equal(requests.length, 1, "a stronger active operator grant must not be overwritten");
  assert.equal(requests[0].authorization, "Bearer service-role-key");

  requests.length = 0;
  existingRows = [];
  assert.deepEqual(await resolver({ userId, subject, expiresAt }), { ok: true });
  assert.equal(requests.length, 2);
  assert.match(requests[1].url, /\/rest\/v1\/rpc\/upsert_superskill_access_grant$/);
  assert.equal(requests[1].method, "POST");
  const rpcBody = JSON.parse(requests[1].body ?? "{}") as Record<string, unknown>;
  assert.deepEqual(rpcBody, {
    p_subject: subject,
    p_user_id: userId,
    p_scope: SUPERSKILL_MANAGED_SCOPE,
    p_cohort: "self-service",
    p_expires_at: expiresAt.toISOString(),
    p_actor: "self-service:device-auth"
  });
  assert.ok(!requests[1].body?.includes("ohdc_"));
  assert.ok(!requests[1].body?.includes("@"));

  requests.length = 0;
  existingRows = [{
    user_id: userId,
    subject,
    scope: SUPERSKILL_MANAGED_SCOPE,
    status: "revoked",
    expires_at: "2026-07-14T01:00:00.000Z",
    revoked_at: "2026-07-14T00:00:00.000Z"
  }];
  assert.deepEqual(await resolver({ userId, subject, expiresAt }), { ok: false, kind: "denied" });
  assert.equal(requests.length, 1);
});

function deterministicRandom(): (bytes: number) => Buffer {
  let count = 0;
  return (bytes) => {
    count += 1;
    const chunks: Buffer[] = [];
    let index = 0;
    while (Buffer.concat(chunks).length < bytes) {
      chunks.push(createHash("sha256").update(`device-auth-fixture:${count}:${index}`).digest());
      index += 1;
    }
    return Buffer.concat(chunks).subarray(0, bytes);
  };
}

function responseFor(url: string, status: number, payload: unknown): Response {
  const response = new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  Object.defineProperty(response, "url", { value: url });
  return response;
}
