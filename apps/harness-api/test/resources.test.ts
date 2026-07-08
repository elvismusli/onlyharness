import test from "node:test";
import assert from "node:assert/strict";
import * as registry from "../src/registry.js";
import type { RegistryItem } from "../src/registry.js";
import { resourceDetail, searchResources } from "../src/resources.js";

test("resources search exposes 253 external seed resources plus internal registry resources", () => {
  const registryItems = [fixtureDirectoryItem()];
  const result = searchResources({ limit: 300 }, registryItems);

  assert.equal(result.counts.externalSeed, 253);
  assert.equal(result.counts.internal, 1);
});

test("resources search finds a known GitHub seed resource by query", () => {
  const result = searchResources({ q: "superpowers", limit: 10 }, registry.scanRegistry(new Map()));

  assert.ok(result.resources.some((resource) => resource.id === "github:obra/superpowers"));
  assert.equal(result.resources.find((resource) => resource.id === "github:obra/superpowers")?.installability, "open_only");
});

test("resources search can return internal directory shelf resources", () => {
  const result = searchResources({ q: "verified-agent-catalog", limit: 10 }, [fixtureDirectoryItem()]);

  assert.ok(result.resources.some((resource) => resource.id === "onlyharness:directories/verified-agent-catalog-2026-07"));
  assert.equal(result.resources.find((resource) => resource.id === "onlyharness:directories/verified-agent-catalog-2026-07")?.installability, "open_only");
});

test("resources search filters MCP servers and preserves source provenance", () => {
  const result = searchResources({ type: "mcp_server", limit: 100 }, registry.scanRegistry(new Map()));

  assert.equal(result.resources.length, 24);
  assert.ok(result.resources.every((resource) => resource.resourceType === "mcp_server"));
  assert.ok(result.resources.every((resource) => resource.sourcePlatform === "github"));
  assert.ok(result.resources.every((resource) => resource.sourceCheckedAt === "2026-07-05"));
  assert.ok(result.resources.every((resource) => !resource.trust.installVerifiedAt));
});

test("resource detail resolves URL-encoded resource ids", () => {
  const detail = resourceDetail("github%3Aobra%2Fsuperpowers", registry.scanRegistry(new Map()));

  assert.equal(detail?.id, "github:obra/superpowers");
  assert.equal(detail?.installability, "open_only");
  assert.equal(detail?.licenseStatus, "unknown");
  assert.ok(detail?.actions.some((action) => action.id === "open_upstream"));
});

function fixtureDirectoryItem(): RegistryItem {
  return {
    owner: "directories",
    ownerLabel: "directory shelf",
    name: "verified-agent-catalog-2026-07",
    title: "Verified Agent Catalog 2026-07",
    summary: "Link-only directory shelf entry for the verified catalog.",
    tags: ["catalog"],
    job: "Directory discovery",
    outcome: "Directory discovery",
    runtime: "link",
    forgeUrl: "https://onlyharness.com/resources",
    contentType: "directory",
    directory: {
      url: "https://onlyharness.com/resources",
      itemCount: 253,
      category: "catalog",
      notes: "link-only"
    },
    compatibility: { targets: [{ id: "open-link", name: "Open link", status: "available" }] },
    valid: true,
    riskScore: 0,
    riskTier: "LOW",
    evalStatus: "unknown",
    evalScore: 0,
    security: { verdict: "pass", findings: 0, scanner: "fixture" },
    contextCost: { approxTokens: 0, files: 0, bytes: 0, status: "estimated" },
    standard: "partial",
    forks: 0,
    stars: 0,
    threads: 0,
    runs: 0,
    installConfirms: 0,
    signalCount: 0,
    heatQualified: false,
    heat: 0,
    heatDelta: 0,
    freshness: "new",
    badge: "new",
    cliCommand: "open https://onlyharness.com/resources",
    updatedAt: "2026-07-05T00:00:00.000Z"
  };
}
