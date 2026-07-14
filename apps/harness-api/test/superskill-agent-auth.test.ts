import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Fastify from "fastify";

import {
  AGENT_ACCESS_TOKEN_PREFIX,
  AGENT_BIND_COOKIE_LOCAL,
  AGENT_REFRESH_TOKEN_PREFIX,
  createAgentAuthService,
  createInMemoryAgentAuthStore,
  registerAgentAuthRoutes
} from "../src/superskill/agent-auth.js";
import type { DeviceAuthGrantResolver, DeviceAuthIdentityResolver } from "../src/superskill/device-auth.js";
import { createSupabaseSuperskillAccessResolver, superskillUserSubject } from "../src/superskill/access.js";
import { createAgentMutationService, createInMemoryAgentMutationStore } from "../src/superskill/agent-idempotency.js";

const userId = "11111111-1111-4111-8111-111111111111";
const subjectSalt = "fixture-agent-auth-subject-salt-at-least-32-bytes";
const tokenPepper = "fixture-agent-auth-token-pepper-at-least-32-bytes";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("agent-first browser approval issues opaque rotating credentials and reuses no proof", async (t) => {
  let now = new Date("2026-07-14T00:00:00.000Z");
  const grants: Array<{ userId: string; expiresAt: Date }> = [];
  const identityResolver: DeviceAuthIdentityResolver = async ({ authorization }) => authorization === "Bearer browser-session"
    ? { ok: true, user: { id: userId, emailConfirmedAt: "2026-07-01T00:00:00.000Z" } }
    : { ok: false, status: 401, code: "DEVICE_AUTH_INVALID" };
  const grantResolver: DeviceAuthGrantResolver = async (input) => { grants.push(input); return { ok: true }; };
  const service = createAgentAuthService({
    enabled: true,
    publicUrl: "http://127.0.0.1:5177",
    subjectSalt,
    tokenPepper,
    now: () => now,
    random: deterministicRandom(),
    store: createInMemoryAgentAuthStore(),
    pollIntervalSeconds: 1,
    accessTtlSeconds: 600,
    sessionTtlSeconds: 30 * 24 * 60 * 60
  });
  const app = Fastify({ logger: false });
  await registerAgentAuthRoutes(app, service, { identityResolver, grantResolver, subjectSalt });
  t.after(() => app.close());

  const start = await app.inject({
    method: "POST",
    url: "/auth/agent/start",
    payload: { client: "codex", scopes: ["workspaces:write", "superskill:managed", "resources:publish"] }
  });
  assert.equal(start.statusCode, 201);
  assert.equal(start.headers["cache-control"], "no-store");
  const started = start.json() as Record<string, unknown>;
  assert.match(String(started.request_id), /^ohrq_[A-Za-z0-9_-]{43}$/);
  assert.match(String(started.device_proof), /^ohdp_[A-Za-z0-9_-]{43}$/);
  assert.equal(started.browser_url, started.verification_uri);
  const browserUrl = new URL(String(started.browser_url));
  assert.equal(browserUrl.origin, "http://127.0.0.1:5177");
  assert.ok(!`${browserUrl.origin}${browserUrl.pathname}${browserUrl.search}`.includes("ohbp_"));
  const fragment = new URLSearchParams(browserUrl.hash.split("?")[1]);
  assert.equal(fragment.get("request"), started.request_id);
  assert.match(fragment.get("proof") ?? "", /^ohbp_[A-Za-z0-9_-]{43}$/);

  const pending = await app.inject({
    method: "POST", url: "/auth/agent/token",
    payload: { request_id: started.request_id, device_proof: started.device_proof }
  });
  assert.equal(pending.statusCode, 202);
  assert.equal(pending.json().code, "AUTHORIZATION_PENDING");

  const bind = await app.inject({
    method: "POST", url: "/auth/agent/browser-bind",
    payload: { request_id: started.request_id, browser_proof: fragment.get("proof") }
  });
  assert.equal(bind.statusCode, 200);
  const cookie = String(bind.headers["set-cookie"]).split(";")[0];
  assert.match(cookie, new RegExp(`^${AGENT_BIND_COOKIE_LOCAL}=ohbb_`));
  assert.match(String(bind.headers["set-cookie"]), /Path=\//);
  assert.ok(!String(bind.headers["set-cookie"]).includes(" Secure;"), "non-production loopback cookies must be usable over HTTP");
  const bindReplay = await app.inject({
    method: "POST", url: "/auth/agent/browser-bind",
    payload: { request_id: started.request_id, browser_proof: fragment.get("proof") }
  });
  assert.equal(bindReplay.statusCode, 400);

  const context = await app.inject({ method: "GET", url: `/auth/agent/context?request_id=${started.request_id}`, headers: { cookie } });
  assert.equal(context.statusCode, 200);
  assert.deepEqual(context.json().request.scopes, ["resources:publish", "superskill:managed", "workspaces:write"]);
  assert.equal(context.json().request.client_name, "Codex");

  const noIdentity = await app.inject({
    method: "POST", url: "/auth/agent/decision", headers: { cookie },
    payload: { request_id: started.request_id, decision: "approve" }
  });
  assert.equal(noIdentity.statusCode, 401);

  const approved = await app.inject({
    method: "POST", url: "/auth/agent/decision",
    headers: { cookie, authorization: "Bearer browser-session" },
    payload: { request_id: started.request_id, decision: "approve" }
  });
  assert.equal(approved.statusCode, 200);
  assert.deepEqual(approved.json(), { approved: true });
  assert.equal(grants.length, 1);
  assert.equal(grants[0].userId, userId);

  const exchanged = await app.inject({
    method: "POST", url: "/auth/agent/token",
    payload: { request_id: started.request_id, device_proof: started.device_proof }
  });
  assert.equal(exchanged.statusCode, 200);
  const tokens = exchanged.json() as Record<string, unknown>;
  assert.match(String(tokens.access_token), new RegExp(`^${AGENT_ACCESS_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`));
  assert.match(String(tokens.refresh_token), new RegExp(`^${AGENT_REFRESH_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`));
  assert.equal(tokens.expires_in, 600);
  assert.equal(tokens.session_expires_in, 30 * 24 * 60 * 60);
  assert.equal(tokens.scope, "resources:publish superskill:managed workspaces:write");
  const resolved = await service.resolveAccessToken(String(tokens.access_token), ["resources:publish"]);
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.principal.userId, userId);
    assert.equal(resolved.principal.clientId, "codex");
    assert.match(resolved.principal.sessionId, /^[a-f0-9]{32}$/);
    assert.deepEqual(resolved.principal.scopes, ["resources:publish", "superskill:managed", "workspaces:write"]);
    assert.equal(resolved.principal.expiresAt.toISOString(), "2026-07-14T00:10:00.000Z");
  }
  const insufficient = await service.resolveAccessToken(String(tokens.access_token), ["workspaces:read"]);
  assert.deepEqual(insufficient, { ok: false, kind: "forbidden" });

  now = new Date(now.getTime() + 1_000);
  const refreshed = await app.inject({ method: "POST", url: "/auth/agent/refresh", payload: { refresh_token: tokens.refresh_token } });
  assert.equal(refreshed.statusCode, 200);
  const next = refreshed.json() as Record<string, unknown>;
  assert.notEqual(next.refresh_token, tokens.refresh_token);
  assert.notEqual(next.access_token, tokens.access_token);

  const reuse = await app.inject({ method: "POST", url: "/auth/agent/refresh", payload: { refresh_token: tokens.refresh_token } });
  assert.equal(reuse.statusCode, 401);
  assert.equal(reuse.json().code, "AGENT_REFRESH_REUSED");
  assert.deepEqual(await service.resolveAccessToken(String(next.access_token)), { ok: false, kind: "invalid" });

  const exchangeReplay = await app.inject({
    method: "POST", url: "/auth/agent/token",
    payload: { request_id: started.request_id, device_proof: started.device_proof }
  });
  assert.equal(exchangeReplay.statusCode, 400, "consumed device proof is replaced by a digest tombstone");
});

test("deny needs only the one-time browser binding and never creates grant or tokens", async (t) => {
  let identityCalls = 0;
  let grantCalls = 0;
  const service = createAgentAuthService({
    enabled: true, publicUrl: "https://superskill.sh", subjectSalt, tokenPepper,
    random: deterministicRandom(), store: createInMemoryAgentAuthStore()
  });
  const app = Fastify({ logger: false });
  await registerAgentAuthRoutes(app, service, {
    subjectSalt,
    identityResolver: async () => { identityCalls += 1; return { ok: false, status: 401, code: "DEVICE_AUTH_INVALID" }; },
    grantResolver: async () => { grantCalls += 1; return { ok: true }; }
  });
  t.after(() => app.close());
  const started = (await app.inject({ method: "POST", url: "/auth/agent/start", payload: { client: "claude-code", scopes: ["workspaces:read"] } })).json();
  const proof = new URLSearchParams(new URL(started.browser_url).hash.split("?")[1]).get("proof");
  const bound = await app.inject({ method: "POST", url: "/auth/agent/browser-bind", payload: { request_id: started.request_id, browser_proof: proof } });
  const cookie = String(bound.headers["set-cookie"]).split(";")[0];
  const denied = await app.inject({
    method: "POST", url: "/auth/agent/decision", headers: { cookie },
    payload: { request_id: started.request_id, decision: "deny" }
  });
  assert.equal(denied.statusCode, 200);
  assert.deepEqual(denied.json(), { denied: true });
  assert.equal(identityCalls, 0);
  assert.equal(grantCalls, 0);
  const token = await app.inject({ method: "POST", url: "/auth/agent/token", payload: { request_id: started.request_id, device_proof: started.device_proof } });
  assert.equal(token.statusCode, 403);
  assert.equal(token.json().code, "AGENT_AUTH_DENIED");
});

test("scope step-up accumulates prior consent and logout closes every session for the user and client", async () => {
  const service = createAgentAuthService({
    enabled: true,
    publicUrl: "https://superskill.sh",
    subjectSalt,
    tokenPepper,
    random: deterministicRandom(),
    store: createInMemoryAgentAuthStore()
  });
  const authorize = async (scopes: Array<"resources:publish" | "workspaces:read">) => {
    const started = await service.start({ client: "codex", scopes });
    assert.equal(started.ok, true);
    if (!started.ok) throw new Error("start failed");
    const proof = new URLSearchParams(new URL(started.browserUrl).hash.split("?")[1]).get("proof");
    assert.ok(proof);
    const bound = await service.bindBrowser({ requestId: started.requestId, browserProof: proof });
    assert.equal(bound.ok, true);
    if (!bound.ok) throw new Error("bind failed");
    assert.deepEqual(await service.decide({ requestId: started.requestId, binding: bound.binding, decision: "approve", userId }), { ok: true });
    const tokens = await service.token({ requestId: started.requestId, deviceProof: started.deviceProof });
    assert.equal(tokens.ok, true);
    if (!tokens.ok) throw new Error("token failed");
    return tokens;
  };

  const first = await authorize(["resources:publish"]);
  assert.deepEqual(first.scopes, ["resources:publish"]);
  const steppedUp = await authorize(["workspaces:read"]);
  assert.deepEqual(steppedUp.scopes, ["resources:publish", "workspaces:read"]);
  assert.equal((await service.resolveAccessToken(steppedUp.accessToken, ["resources:publish", "workspaces:read"])).ok, true);
  assert.equal(await service.revoke({ refreshToken: steppedUp.refreshToken }), "revoked");
  assert.deepEqual(await service.resolveAccessToken(first.accessToken), { ok: false, kind: "invalid" });
  assert.deepEqual(await service.resolveAccessToken(steppedUp.accessToken), { ok: false, kind: "invalid" });
  assert.deepEqual(await service.refresh(first.refreshToken), { ok: false, kind: "expired" });
});

test("agent auth start is bounded per IP even when user-agent rotates", async (t) => {
  const service = createAgentAuthService({ enabled: true, subjectSalt, tokenPepper, random: deterministicRandom(), store: createInMemoryAgentAuthStore() });
  const app = Fastify({ logger: false });
  await registerAgentAuthRoutes(app, service, {
    subjectSalt,
    identityResolver: async () => ({ ok: false, status: 401, code: "DEVICE_AUTH_INVALID" }),
    grantResolver: async () => ({ ok: true })
  });
  t.after(() => app.close());
  let response;
  for (let index = 0; index < 21; index += 1) {
    response = await app.inject({ method: "POST", url: "/auth/agent/start", headers: { "user-agent": `rotating-${index}` }, payload: { client: "cli", scopes: ["superskill:managed"] } });
  }
  assert.equal(response?.statusCode, 429);
  assert.equal(response?.json().code, "AGENT_AUTH_RATE_LIMITED");
  assert.ok(Number(response?.headers["retry-after"]) >= 1);
});

test("managed routes live-check agent user confirmation, ban state, and active grant", async () => {
  const subject = superskillUserSubject(userId, subjectSalt);
  let banned = false;
  const requests: string[] = [];
  const resolver = createSupabaseSuperskillAccessResolver({
    supabaseUrl: "https://supabase.fixture",
    anonKey: "anon-key",
    serviceRoleKey: "service-role-key",
    subjectSalt,
    agentTokenResolver: async () => ({
      ok: true,
      principal: { userId, subject, scopes: ["superskill:managed"] }
    }),
    fetchImpl: async (input) => {
      const url = input.toString();
      requests.push(url);
      if (url.includes("/auth/v1/admin/users/")) {
        return responseFor(url, 200, {
          id: userId,
          email_confirmed_at: "2026-07-01T00:00:00.000Z",
          banned_until: banned ? "2026-08-01T00:00:00.000Z" : null
        });
      }
      return responseFor(url, 200, [{
        user_id: userId,
        subject,
        scope: "superskill:managed",
        cohort: "self-service",
        status: "active",
        expires_at: "2026-08-01T00:00:00.000Z",
        revoked_at: null
      }]);
    }
  });
  const accepted = await resolver({ authorization: `Bearer ${AGENT_ACCESS_TOKEN_PREFIX}${"a".repeat(43)}`, requiredScope: "superskill:managed", now: new Date("2026-07-14T00:00:00.000Z") });
  assert.equal(accepted.ok, true);
  assert.equal(requests.filter((url) => url.includes("/auth/v1/admin/users/")).length, 1);
  assert.equal(requests.filter((url) => url.includes("superskill_access_grants")).length, 1);

  requests.length = 0;
  banned = true;
  const rejected = await resolver({ authorization: `Bearer ${AGENT_ACCESS_TOKEN_PREFIX}${"b".repeat(43)}`, requiredScope: "superskill:managed", now: new Date("2026-07-14T00:00:00.000Z") });
  assert.deepEqual(rejected, { ok: false, status: 403, code: "SUPERSKILL_ACCESS_DENIED" });
  assert.equal(requests.some((url) => url.includes("superskill_access_grants")), false);
});

test("agent auth migration is service-only and exposes atomic replay guards", () => {
  const migration = readFileSync(path.join(repoRoot, "supabase/migrations/20260714170000_agent_first_auth.sql"), "utf8");
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /revoke all on public\.agent_auth_requests[^;]+service_role;/s);
  assert.match(migration, /agent_auth_rotate_refresh/);
  assert.match(migration, /agent_auth_sweep/);
  assert.match(migration, /delete from public\.agent_auth_sessions/);
  assert.match(migration, /t\.consumed_at is not null/);
  assert.match(migration, /status = 'revoked'/);
  assert.doesNotMatch(migration, /browser_hash = 'consumed'/);
  assert.match(migration, /p_consumed_browser_hash/);
  assert.match(migration, /agent_mutation_claim/);
  assert.match(migration, /payload_hash <> p_payload_hash/);
  assert.match(migration, /response_body jsonb/);
  assert.equal((migration.match(/u\.email_confirmed_at is not null/g) ?? []).length, 2);
  assert.equal((migration.match(/u\.banned_until is null or u\.banned_until <= p_now/g) ?? []).length, 2);
});

test("agent mutation idempotency replays canonical payloads and rejects key reuse with changed input", async () => {
  const service = createAgentMutationService({ pepper: tokenPepper, store: createInMemoryAgentMutationStore() });
  const input = {
    key: "workspace-create-key-0001",
    userId,
    route: "/workspaces",
    payload: { name: "Alpha", slug: "alpha", nested: { b: 2, a: 1 } }
  };
  const first = await service.begin(input);
  assert.equal(first.kind, "claimed");
  if (first.kind !== "claimed") return;
  const concurrent = await service.begin({ ...input, payload: { nested: { a: 1, b: 2 }, slug: "alpha", name: "Alpha" } });
  assert.deepEqual(concurrent, { kind: "in_progress" });
  const response = { workspace: { slug: "alpha", name: "Alpha" }, replay: false };
  assert.equal(await service.complete({ ...first, userId, route: input.route, status: 201, body: response }), true);
  const replay = await service.begin({ ...input, payload: { slug: "alpha", name: "Alpha", nested: { a: 1, b: 2 } } });
  assert.deepEqual(replay, { kind: "replay", response: { status: 201, body: response } });
  const conflict = await service.begin({ ...input, payload: { ...input.payload, name: "Changed" } });
  assert.deepEqual(conflict, { kind: "conflict" });
});

test("agent mutation receipt outage leaves a durable no-reexecute tombstone across time and service restart", async () => {
  let now = new Date("2026-07-14T00:00:00.000Z");
  const base = createInMemoryAgentMutationStore();
  let completeCalls = 0;
  const service = createAgentMutationService({
    pepper: tokenPepper,
    now: () => now,
    store: {
      claim: (input) => base.claim(input),
      complete: async () => { completeCalls += 1; return false; }
    }
  });
  const input = { key: "recoverable-mutation-key-001", userId, route: "/workspaces", payload: { slug: "recoverable" } };
  const first = await service.begin(input);
  assert.equal(first.kind, "claimed");
  if (first.kind !== "claimed") return;
  assert.equal(await service.complete({ ...first, userId, route: input.route, status: 201, body: { workspace: { slug: "recoverable" } } }), false);
  assert.equal(completeCalls, 3);
  assert.deepEqual(await service.begin(input), { kind: "in_progress" });
  now = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000);
  assert.deepEqual(await service.begin(input), { kind: "in_progress" });
  const restarted = createAgentMutationService({ pepper: tokenPepper, now: () => now, store: base });
  assert.deepEqual(await restarted.begin(input), { kind: "in_progress" });
  assert.deepEqual(await restarted.begin({ ...input, payload: { slug: "changed" } }), { kind: "conflict" });
});

test("agent mutation complete accepts an identical durable receipt after its first response is lost", async () => {
  const base = createInMemoryAgentMutationStore();
  let calls = 0;
  const service = createAgentMutationService({
    pepper: tokenPepper,
    store: {
      claim: (input) => base.claim(input),
      complete: async (input) => {
        calls += 1;
        const stored = await base.complete(input);
        return calls === 1 ? false : stored;
      }
    }
  });
  const input = { key: "lost-complete-response-key-001", userId, route: "/workspaces", payload: { slug: "durable" } };
  const first = await service.begin(input);
  assert.equal(first.kind, "claimed");
  if (first.kind !== "claimed") return;
  const body = { workspace: { slug: "durable" } };
  assert.equal(await service.complete({ ...first, userId, route: input.route, status: 201, body }), true);
  assert.equal(calls, 2);
  assert.deepEqual(await service.begin(input), { kind: "replay", response: { status: 201, body } });
});

test("server wires credentialed CORS and header/body idempotency checks", () => {
  const server = readFileSync(path.join(repoRoot, "apps/harness-api/src/server.ts"), "utf8");
  assert.match(server, /app\.register\(cors, \{\s*credentials: true,/);
  assert.match(server, /Idempotency-Key header conflicts with body idempotencyKey/);
  assert.match(server, /claimAgentMutation\(request, reply, user, "\/workspaces", body\)/);
  assert.match(server, /claimAgentMutation\(request, reply, agentUser, route, body\)/);
  assert.match(server, /const route = "\/imports\/markdown-to-harness"/);
  assert.match(server, /requiredScopes\.includes\("resource:publish"\)\) agentScopes\.push\("resources:publish"\)/);
  assert.match(server, /const methodMutates = request\.method !== "GET" && request\.method !== "HEAD"/);
  assert.match(server, /const mutating = methodMutates && scopeMutates/);
  assert.match(server, /IDEMPOTENCY_COMMIT_FAILED/);
  assert.match(server, /IDEMPOTENCY_INDETERMINATE/);
  assert.match(server, /if \(!agentScopes\?\.length\) \{\s*return \{ status: 403, error: "Agent sessions are not accepted for this account route", code: "FORBIDDEN" \};/s);
  assert.match(server, /requireUser\(request, reply, \["resources:publish"\]\)/);
  assert.match(server, /requireUser\(request, reply, \["workspaces:write"\]\)/);
  assert.match(server, /clientId: agent\.principal\.clientId/);
  assert.match(server, /sessionId: agent\.principal\.sessionId/);
  assert.match(server, /scopes: agent\.principal\.scopes/);
  assert.match(server, /expiresAt: agent\.principal\.expiresAt/);
});

function deterministicRandom() {
  let counter = 1;
  return (bytes: number) => {
    const output = Buffer.alloc(bytes);
    for (let index = 0; index < bytes; index += 1) output[index] = (counter + index * 17) % 256;
    counter += 1;
    return output;
  };
}

function responseFor(url: string, status: number, body: unknown): Response {
  const response = new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  Object.defineProperty(response, "url", { value: url });
  return response;
}
