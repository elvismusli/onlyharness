import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { ManagedCatalog } from "../src/capabilities.js";
import { registerSuperskillRoutes } from "../src/routes/superskill.js";
import { buildSuperSkillBootstrapManifest, type SuperSkillBootstrapContract } from "../src/superskill/bootstrap.js";
import { approvedCapability, managedIndex } from "./superskill-fixture.js";

const contract: SuperSkillBootstrapContract = {
  schemaVersion: "superskill.bootstrap-contract.v1",
  installer: { package: "onlyharness", version: "0.2.17", integrity: "sha512-YWJj", releaseStatus: "published" },
  universalSkill: { name: "superskill", version: "0.2.0", artifactDigest: `sha256:${"b".repeat(64)}` },
  clientAdapters: {
    codex: { path: ".codex/config.toml", contractDigest: `sha256:${"c".repeat(64)}` },
    "claude-code": { path: ".mcp.json", contractDigest: `sha256:${"d".repeat(64)}` }
  }
};

test("public bootstrap exposes one pinned no-script install contract with secure HEAD semantics", async () => {
  const { app } = await server();
  const response = await app.inject({ method: "GET", url: "/superskill/install" });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] ?? "", /^application\/vnd\.superskill\.bootstrap\+json/);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.match(response.headers["content-security-policy"] ?? "", /default-src 'none'/);
  assert.equal(response.headers["cache-control"], "public, max-age=60, stale-while-revalidate=300");
  assert.deepEqual(response.json(), buildSuperSkillBootstrapManifest(contract));
  assert.equal(JSON.stringify(response.json()).includes("script"), false);
  assert.equal(response.json().agent.action, "install_superskill");
  assert.equal(response.json().agent.command, "npx --yes onlyharness@0.2.17 superskill install https://superskill.sh/api/superskill/install --auto");
  assert.doesNotMatch(response.json().agent.command, /curl|wget|\|\s*(?:sh|bash)/);
  const head = await app.inject({ method: "HEAD", url: "/superskill/install" });
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, "");
  await app.close();
});

test("exact capability URL binds id, version and digest and cannot drift", async () => {
  const { app, capability } = await server();
  const digest = capability.release.artifactDigest.slice("sha256:".length);
  const url = `/superskill/install/${capability.id}/${capability.release.version}/${digest}`;
  const response = await app.inject({ method: "GET", url });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.json().canonicalUrl, `https://superskill.sh/api${url}`);
  assert.deepEqual(response.json().capability, {
    id: capability.id,
    version: capability.release.version,
    artifactDigest: capability.release.artifactDigest
  });
  assert.equal(response.json().activation.performed, false);
  assert.equal(response.json().activation.explicitConsentRequired, true);
  const { manifestDigest, ...body } = response.json();
  assert.equal(manifestDigest, `sha256:${createHash("sha256").update(canonicalJson(body)).digest("hex")}`);
  const wrong = await app.inject({ method: "GET", url: `${url.slice(0, -64)}${"f".repeat(64)}` });
  assert.equal(wrong.statusCode, 404);
  await app.close();
});

test("unpublished runtime and selected-unreviewed releases expose no install manifest", async () => {
  const unpublished = { ...contract, installer: { ...contract.installer, integrity: null, releaseStatus: "unpublished" as const } };
  const unpublishedServer = await server({ bootstrapContract: unpublished });
  const blocked = await unpublishedServer.app.inject({ method: "GET", url: "/superskill/install" });
  assert.equal(blocked.statusCode, 503);
  assert.equal(blocked.json().code, "BOOTSTRAP_RELEASE_UNPUBLISHED");
  await unpublishedServer.app.close();

  const candidateServer = await server({ capabilityStatus: "candidate" });
  const candidate = candidateServer.capability;
  const digest = candidate.release.artifactDigest.slice("sha256:".length);
  const response = await candidateServer.app.inject({ method: "GET", url: `/superskill/install/${candidate.id}/${candidate.release.version}/${digest}` });
  assert.equal(response.statusCode, 404);
  assert.equal(JSON.stringify(response.json()).includes("canonicalUrl"), false);
  await candidateServer.app.close();
});

async function server(options: { bootstrapContract?: SuperSkillBootstrapContract; capabilityStatus?: "approved" | "candidate" } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "superskill-bootstrap-api-"));
  const capability = approvedCapability(options.capabilityStatus ? { trust: { status: options.capabilityStatus } } : {});
  const indexPath = path.join(root, "index.json");
  writeFileSync(indexPath, JSON.stringify(managedIndex([capability])));
  const app = Fastify({ logger: false });
  await registerSuperskillRoutes(app, {
    catalog: new ManagedCatalog({ indexPath }),
    bootstrapContract: options.bootstrapContract ?? contract,
    now: () => new Date("2026-07-12T00:00:00.000Z"),
    enabled: false
  });
  return { app, capability };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}
