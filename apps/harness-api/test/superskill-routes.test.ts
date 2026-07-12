import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { ManagedCatalog } from "../src/capabilities.js";
import { registerSuperskillRoutes, superskillAuthFromHeader } from "../src/routes/superskill.js";
import { approvedCapability, managedIndex } from "./superskill-fixture.js";

const token = "fixture-internal-alpha-token";
const tokenHash = createHash("sha256").update(token).digest("hex");

async function fixtureServer(now = new Date("2026-07-12T00:00:00.000Z"), withRevocation = false) {
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

test("protected recommendation auth matrix is 401, 403, 200", async () => {
  const { app } = await fixtureServer();
  const body = { task: "competitor research source-backed comparison", context: { client: "codex", os: "darwin", arch: "arm64", installedManagedRefs: [] } };
  const missing = await app.inject({ method: "POST", url: "/recommendations", payload: body });
  assert.equal(missing.statusCode, 401);
  assert.equal(missing.json().code, "SUPERSKILL_AUTH_REQUIRED");
  const denied = await app.inject({ method: "POST", url: "/recommendations", headers: { authorization: "Bearer denied" }, payload: body });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().code, "INTERNAL_ALPHA_DENIED");
  const allowed = await app.inject({ method: "POST", url: "/recommendations", headers: { authorization: `Bearer ${token}` }, payload: body });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.json().selected.capability.id, "market-research");
  await app.close();
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
