import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { ManagedCatalog } from "../src/capabilities.js";
import { registerSuperskillRoutes, superskillAuthFromHeader, verifyDecisionConsent } from "../src/routes/superskill.js";
import {
  createSupabaseSuperskillAccessResolver,
  SUPERSKILL_MANAGED_SCOPE,
  superskillUserSubject,
  type SuperskillAccessResolver
} from "../src/superskill/access.js";
import { approvedCapability, managedIndex } from "./superskill-fixture.js";

const token = "fixture-internal-alpha-token";
const tokenHash = createHash("sha256").update(token).digest("hex");
const userToken = "fixture-confirmed-user-token";
const userSubject = `user:${"a".repeat(64)}`;

const confirmedAccessResolver: SuperskillAccessResolver = async ({ authorization, requiredScope }) => authorization === `Bearer ${userToken}`
  ? {
      ok: true,
      principal: {
        subject: userSubject,
        scope: requiredScope,
        cohort: "public-e2e",
        evidence: "confirmed_user",
        publicGoEligible: true
      }
    }
  : { ok: false, status: 401, code: "SUPERSKILL_AUTH_INVALID" };

async function fixtureServer(
  now = new Date("2026-07-12T00:00:00.000Z"),
  withRevocation = false,
  accessResolver: SuperskillAccessResolver = confirmedAccessResolver
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "superskill-routes-"));
  const capability = approvedCapability();
  const indexPath = path.join(root, "index.json");
  writeFileSync(indexPath, JSON.stringify(managedIndex([capability])));
  const revocationsPath = path.join(root, "revocations.jsonl");
  if (withRevocation) writeFileSync(revocationsPath, `${JSON.stringify({
    schemaVersion: "superskill.revoke.v1",
    eventId: "rev_replacement01",
    artifactDigest: capability.release.artifactDigest,
    aliases: [{ capabilityId: capability.id, ref: capability.release.ref, version: capability.release.version }],
    reasonCode: "SECURITY_ADVISORY",
    actorLabel: "OnlyHarness security",
    revokedAt: "2026-07-12T00:00:00.000Z",
    replacement: { ref: "harnesses/replacement", version: "0.3.0", artifactDigest: `sha256:${"c".repeat(64)}` }
  })}\n`);
  const app = Fastify({ logger: false });
  await registerSuperskillRoutes(app, {
    catalog: new ManagedCatalog({ indexPath, ...(withRevocation ? { revocationsPath } : {}) }),
    enabled: true,
    tokenHashes: [tokenHash],
    telemetrySalt: "fixture-salt",
    accessResolver,
    now: () => now,
    archiveBuilder: (selected) => ({
      owner: "harnesses",
      repo: "deep-market-researcher",
      version: selected.release.version,
      snapshot: true,
      artifactDigest: selected.release.artifactDigest,
      totalFileCount: 1,
      archiveTruncated: false,
      files: [{ path: "README.md", content: "fixture", truncated: false }]
    })
  });
  return { app, capability };
}

test("public showroom is cached and has no activation controls", async () => {
  const { app } = await fixtureServer();
  const response = await app.inject({ method: "GET", url: "/showroom/capabilities?limit=12" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "public, max-age=60, stale-while-revalidate=300");
  assert.equal(response.json().items.length, 1);
  assert.equal(JSON.stringify(response.json()).includes("activationAllowed"), false);
  assert.equal(response.json().items[0].clientHandoff.status, "available");
  assert.equal("archive" in response.json().items[0], false);
  await app.close();
});

test("public selected shelf exposes candidates as unreviewed and blocked", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "superskill-selected-routes-"));
  const candidate = approvedCapability({ trust: { status: "candidate" } });
  const indexPath = path.join(root, "index.json");
  writeFileSync(indexPath, JSON.stringify(managedIndex([candidate])));
  const app = Fastify({ logger: false });
  await registerSuperskillRoutes(app, { catalog: new ManagedCatalog({ indexPath }), enabled: false });

  const response = await app.inject({ method: "GET", url: "/showroom/selected?limit=12&job=market-research" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "public, max-age=60, stale-while-revalidate=300");
  assert.equal(response.json().total, 1);
  assert.equal(response.json().items[0].status, "selected_unreviewed");
  assert.deepEqual(response.json().items[0].managedHandoff, { status: "blocked", reason: "review_required" });
  assert.equal(response.json().items[0].capability.trust.status, "candidate");
  assert.equal("archive" in response.json().items[0], false);
  assert.equal("preview" in response.json().items[0], false);
  assert.equal("activationAllowed" in response.json().items[0], false);

  const approvedOnly = await app.inject({ method: "GET", url: "/showroom/capabilities?limit=12" });
  assert.equal(approvedOnly.statusCode, 200);
  assert.equal(approvedOnly.json().items.length, 0);
  const invalidJob = await app.inject({ method: "GET", url: "/showroom/selected?job=../secret" });
  assert.equal(invalidJob.statusCode, 404);
  await app.close();
});

test("protected recommendation accepts confirmed user and marks legacy alpha separately", async () => {
  const { app } = await fixtureServer();
  const body = { task: "competitor research source-backed comparison", context: { client: "codex", os: "darwin", arch: "arm64", installedManagedRefs: [] } };
  const missing = await app.inject({ method: "POST", url: "/recommendations", payload: body });
  assert.equal(missing.statusCode, 401);
  assert.equal(missing.json().code, "SUPERSKILL_AUTH_REQUIRED");
  const denied = await app.inject({ method: "POST", url: "/recommendations", headers: { authorization: "Bearer denied" }, payload: body });
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.json().code, "SUPERSKILL_AUTH_INVALID");
  const userAllowed = await app.inject({ method: "POST", url: "/recommendations", headers: { authorization: `Bearer ${userToken}` }, payload: body });
  assert.equal(userAllowed.statusCode, 200);
  assert.equal(userAllowed.json().selected.capability.id, "market-research");
  assert.equal(userAllowed.headers["x-onlyharness-superskill-auth"], "confirmed-user");
  assert.equal(userAllowed.headers["x-onlyharness-superskill-public-go"], "eligible");
  const legacyAllowed = await app.inject({ method: "POST", url: "/recommendations", headers: { authorization: `Bearer ${token}` }, payload: body });
  assert.equal(legacyAllowed.statusCode, 200);
  assert.equal(legacyAllowed.headers["x-onlyharness-superskill-auth"], "legacy-alpha");
  assert.equal(legacyAllowed.headers["x-onlyharness-superskill-public-go"], "ineligible");
  await app.close();
});

test("exact handoff requires confirmed granted auth and returns client-bound activation consent fields", async () => {
  const { app, capability } = await fixtureServer();
  const body = {
    capability: { id: capability.id, version: capability.release.version, artifactDigest: capability.release.artifactDigest },
    client: "codex"
  };
  const missing = await app.inject({ method: "POST", url: "/superskill/handoff/decision", payload: body });
  assert.equal(missing.statusCode, 401);
  const legacy = await app.inject({ method: "POST", url: "/superskill/handoff/decision", headers: { authorization: `Bearer ${token}` }, payload: body });
  assert.equal(legacy.statusCode, 403);
  assert.equal(legacy.json().code, "SUPERSKILL_CONFIRMED_ACCESS_REQUIRED");
  const allowed = await app.inject({ method: "POST", url: "/superskill/handoff/decision", headers: { authorization: `Bearer ${userToken}` }, payload: body });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers["cache-control"], "no-store");
  assert.equal(allowed.headers["x-onlyharness-superskill-auth"], "confirmed-user");
  assert.equal(allowed.json().decision, "recommend");
  assert.deepEqual(allowed.json().alternatives, []);
  assert.equal(allowed.json().selected.capability.release.artifactDigest, capability.release.artifactDigest);
  assert.deepEqual(allowed.json().selected.capability.permissions, capability.permissions);
  assert.deepEqual(allowed.json().selected.capability.trust.checks, capability.trust.checks);
  assert.deepEqual(allowed.json().selected.limitations, capability.trust.limitations);
  assert.equal(verifyDecisionConsent({
    capability,
    client: "codex",
    recommendationId: allowed.json().recommendationId,
    expiresAt: allowed.json().expiresAt,
    decisionDigest: allowed.json().decisionDigest,
    now: new Date("2026-07-12T00:00:00.000Z")
  }), true);
  assert.equal(verifyDecisionConsent({
    capability,
    client: "claude-code",
    recommendationId: allowed.json().recommendationId,
    expiresAt: allowed.json().expiresAt,
    decisionDigest: allowed.json().decisionDigest,
    now: new Date("2026-07-12T00:00:00.000Z")
  }), false);
  assert.equal(verifyDecisionConsent({
    capability,
    client: "codex",
    recommendationId: "rec_different1234",
    expiresAt: allowed.json().expiresAt,
    decisionDigest: allowed.json().decisionDigest,
    now: new Date("2026-07-12T00:00:00.000Z")
  }), false);
  await app.close();
});

test("exact handoff retries are side-effect free and fail closed for malformed, mismatched, stale and revoked tuples", async () => {
  const { app, capability } = await fixtureServer();
  const headers = { authorization: `Bearer ${userToken}` };
  const body = { capability: { id: capability.id, version: capability.release.version, artifactDigest: capability.release.artifactDigest }, client: "claude-code" };
  const first = await app.inject({ method: "POST", url: "/superskill/handoff/decision", headers, payload: body });
  const second = await app.inject({ method: "POST", url: "/superskill/handoff/decision", headers, payload: body });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.deepEqual(first.json(), second.json());
  const after = await app.inject({ method: "GET", url: `/capabilities/${capability.id}/releases/${capability.release.version}`, headers });
  assert.equal(after.statusCode, 200);
  assert.equal(after.json().activationAllowed, true);

  const mismatch = await app.inject({ method: "POST", url: "/superskill/handoff/decision", headers, payload: { ...body, capability: { ...body.capability, artifactDigest: `sha256:${"f".repeat(64)}` } } });
  assert.equal(mismatch.statusCode, 404);
  const malformed = await app.inject({ method: "POST", url: "/superskill/handoff/decision", headers, payload: { ...body, projectPath: "/Users/private/repo" } });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().code, "HANDOFF_INVALID");
  assert.equal(JSON.stringify(malformed.json()).includes("/Users/private/repo"), false);
  await app.close();

  const staleServer = await fixtureServer(new Date("2099-01-01T00:00:00.000Z"));
  const stale = await staleServer.app.inject({ method: "POST", url: "/superskill/handoff/decision", headers, payload: body });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, "PERMISSION_BLOCKED");
  await staleServer.app.close();

  const revokedServer = await fixtureServer(new Date("2026-07-12T00:00:00.000Z"), true);
  const revoked = await revokedServer.app.inject({ method: "POST", url: "/superskill/handoff/decision", headers, payload: body });
  assert.equal(revoked.statusCode, 409);
  assert.equal(revoked.json().code, "CAPABILITY_REVOKED");
  await revokedServer.app.close();
});

test("managed exact release and archive stay Bearer protected", async () => {
  const { app, capability } = await fixtureServer();
  const base = `/capabilities/${capability.id}/releases/${capability.release.version}`;
  assert.equal((await app.inject({ method: "GET", url: base })).statusCode, 401);
  const detail = await app.inject({ method: "GET", url: base, headers: { authorization: `Bearer ${token}` } });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().activationAllowed, true);
  assert.equal(detail.json().archive.url, `/api${base}/archive`);
  const archive = await app.inject({ method: "GET", url: `${base}/archive`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(archive.statusCode, 200);
  assert.equal(archive.json().artifactDigest, capability.release.artifactDigest);
  assert.equal(archive.json().archiveTruncated, false);
  await app.close();
});

test("exact release and archive fail closed when review evidence expires at request time", async () => {
  const { app, capability } = await fixtureServer(new Date("2099-01-01T00:00:00.000Z"));
  const base = `/capabilities/${capability.id}/releases/${capability.release.version}`;
  const headers = { authorization: `Bearer ${token}` };
  const showroom = await app.inject({ method: "GET", url: "/showroom/capabilities?limit=12" });
  assert.equal(showroom.statusCode, 200);
  assert.equal(showroom.json().items.length, 0);
  const publicDetail = await app.inject({ method: "GET", url: `/showroom/capabilities/${capability.id}` });
  assert.equal(publicDetail.statusCode, 200);
  assert.deepEqual(publicDetail.json().clientHandoff, { status: "blocked", reason: "stale_or_ineligible_evidence" });
  const detail = await app.inject({ method: "GET", url: base, headers });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().activationAllowed, false);
  assert.equal(detail.json().blockCode, "PERMISSION_BLOCKED");
  assert.equal(detail.json().archive, undefined);
  const archive = await app.inject({ method: "GET", url: `${base}/archive`, headers });
  assert.equal(archive.statusCode, 409);
  assert.equal(archive.json().code, "PERMISSION_BLOCKED");
  await app.close();
});

test("revoked exact release returns validated replacement remediation", async () => {
  const { app, capability } = await fixtureServer(new Date("2026-07-12T00:00:00.000Z"), true);
  const response = await app.inject({
    method: "GET",
    url: `/capabilities/${capability.id}/releases/${capability.release.version}`,
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().blockCode, "CAPABILITY_REVOKED");
  assert.deepEqual(response.json().replacement, { ref: "harnesses/replacement", version: "0.3.0", artifactDigest: `sha256:${"c".repeat(64)}` });
  await app.close();
});

test("auth derives stable subject from token and never accepts request subject", () => {
  const first = superskillAuthFromHeader(`Bearer ${token}`, { tokenHashes: [tokenHash], telemetrySalt: "salt-a" });
  const second = superskillAuthFromHeader(`Bearer ${token}`, { tokenHashes: [tokenHash], telemetrySalt: "salt-a" });
  assert.equal(first.ok, true);
  assert.deepEqual(first, second);
  if (first.ok) assert.match(first.subject, /^pilot:[a-f0-9]{32}$/);
});

test("strict recommendation request rejects identity, path and arbitrary metadata", async () => {
  const { app } = await fixtureServer();
  const response = await app.inject({
    method: "POST",
    url: "/recommendations",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      task: "competitor research source-backed comparison",
      subject: "attacker",
      projectPath: "/secret/repo",
      context: { client: "codex", os: "darwin", arch: "arm64", installedManagedRefs: [], metadata: { prompt: "secret" } }
    }
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, "TASK_INVALID");
  await app.close();
});

test("production resolver live-checks confirmed user and operator grant on every request", async () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const subjectSalt = "fixture-user-subject-salt-at-least-32-bytes";
  const expectedSubject = superskillUserSubject(userId, subjectSalt);
  const state = { revoked: false, authCalls: 0, grantCalls: 0 };
  const accessResolver = createSupabaseSuperskillAccessResolver({
    supabaseUrl: "https://supabase.fixture",
    anonKey: "fixture-anon-key",
    serviceRoleKey: "fixture-service-role-key",
    subjectSalt,
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/user")) {
        state.authCalls += 1;
        return jsonResponse({
          id: userId,
          email: "must-not-leak@example.test",
          email_confirmed_at: "2026-07-01T00:00:00.000Z"
        }, 200, url);
      }
      if (url.includes("/rest/v1/superskill_access_grants")) {
        state.grantCalls += 1;
        return jsonResponse([{
          user_id: userId,
          subject: expectedSubject,
          scope: SUPERSKILL_MANAGED_SCOPE,
          cohort: "public-e2e",
          status: state.revoked ? "revoked" : "active",
          expires_at: "2026-08-01T00:00:00.000Z",
          revoked_at: state.revoked ? "2026-07-12T00:00:00.000Z" : null
        }], 200, url);
      }
      return new Response(undefined, { status: 404 });
    }
  });
  const { app } = await fixtureServer(new Date("2026-07-12T00:00:00.000Z"), false, accessResolver);
  const body = { task: "competitor research source-backed comparison", context: { client: "codex", os: "darwin", arch: "arm64", installedManagedRefs: [] } };
  const first = await app.inject({
    method: "POST",
    url: "/recommendations",
    headers: { authorization: `Bearer ${userToken}`, "x-superskill-subject": `user:${"f".repeat(64)}` },
    payload: body
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers["x-onlyharness-superskill-auth"], "confirmed-user");
  assert.equal(JSON.stringify(first.json()).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(first.json()).includes(userToken), false);
  assert.deepEqual({ authCalls: state.authCalls, grantCalls: state.grantCalls }, { authCalls: 1, grantCalls: 1 });

  state.revoked = true;
  const second = await app.inject({ method: "POST", url: "/recommendations", headers: { authorization: `Bearer ${userToken}` }, payload: body });
  assert.equal(second.statusCode, 403);
  assert.equal(second.json().code, "SUPERSKILL_ACCESS_DENIED");
  assert.deepEqual({ authCalls: state.authCalls, grantCalls: state.grantCalls }, { authCalls: 2, grantCalls: 2 });
  await app.close();
});

test("production resolver blocks unconfirmed, expired and out-of-policy users without leaking provider data", async () => {
  const userId = "22222222-2222-4222-8222-222222222222";
  const subjectSalt = "fixture-user-subject-salt-at-least-32-bytes";
  const expectedSubject = superskillUserSubject(userId, subjectSalt);
  const body = { task: "competitor research source-backed comparison", context: { client: "codex", os: "darwin", arch: "arm64", installedManagedRefs: [] } };
  const cases = [
    { name: "unconfirmed", confirmedAt: null, rows: [] as unknown[], code: "SUPERSKILL_EMAIL_UNCONFIRMED" },
    {
      name: "expired",
      confirmedAt: "2026-07-01T00:00:00.000Z",
      rows: [{ user_id: userId, subject: expectedSubject, scope: SUPERSKILL_MANAGED_SCOPE, cohort: "public-e2e", status: "active", expires_at: "2026-07-11T00:00:00.000Z", revoked_at: null }],
      code: "SUPERSKILL_ACCESS_DENIED"
    },
    { name: "out-of-policy", confirmedAt: "2026-07-01T00:00:00.000Z", rows: [] as unknown[], code: "SUPERSKILL_ACCESS_DENIED" }
  ];

  for (const fixture of cases) {
    let grantCalls = 0;
    const accessResolver = createSupabaseSuperskillAccessResolver({
      supabaseUrl: "https://supabase.fixture",
      anonKey: "fixture-anon-key",
      serviceRoleKey: "fixture-service-role-key",
      subjectSalt,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/auth/v1/user")) return jsonResponse({ id: userId, email: "private@example.test", email_confirmed_at: fixture.confirmedAt }, 200, url);
        grantCalls += 1;
        return jsonResponse(fixture.rows, 200, url);
      }
    });
    const { app } = await fixtureServer(new Date("2026-07-12T00:00:00.000Z"), false, accessResolver);
    const response = await app.inject({
      method: "POST",
      url: "/recommendations",
      headers: { authorization: `Bearer ${userToken}`, "x-superskill-scope": SUPERSKILL_MANAGED_SCOPE },
      payload: { ...body, managedScope: SUPERSKILL_MANAGED_SCOPE }
    });
    assert.equal(response.statusCode, 403, fixture.name);
    assert.equal(response.json().code, fixture.code, fixture.name);
    assert.equal(JSON.stringify(response.json()).includes("private@example.test"), false, fixture.name);
    assert.equal(JSON.stringify(response.json()).includes(userToken), false, fixture.name);
    assert.equal(grantCalls, fixture.name === "unconfirmed" ? 0 : 1, fixture.name);
    await app.close();
  }
});

test("production resolver fails closed when auth or grant infrastructure is unavailable", async () => {
  const resolver = createSupabaseSuperskillAccessResolver({
    supabaseUrl: "https://supabase.fixture",
    anonKey: "fixture-anon-key",
    serviceRoleKey: "fixture-service-role-key",
    subjectSalt: "fixture-user-subject-salt-at-least-32-bytes",
    fetchImpl: async () => { throw new Error("provider details must stay private"); }
  });
  const result = await resolver({ authorization: `Bearer ${userToken}`, requiredScope: SUPERSKILL_MANAGED_SCOPE, now: new Date("2026-07-12T00:00:00.000Z") });
  assert.deepEqual(result, { ok: false, status: 503, code: "SUPERSKILL_AUTH_UNAVAILABLE" });
});

function jsonResponse(value: unknown, status = 200, url?: string): Response {
  const response = new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  if (url) Object.defineProperty(response, "url", { value: url });
  return response;
}
