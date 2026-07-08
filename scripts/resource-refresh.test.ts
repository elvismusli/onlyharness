import test from "node:test";
import assert from "node:assert/strict";
import { applyGitHubSnapshot, markStale, refreshCatalogWithSnapshots } from "./refresh-resource-catalog.js";
import type { ResourceCatalog, SeedResource } from "./resource-catalog-shared.js";

test("refresh applies active GitHub snapshot without mutating source snapshot", () => {
  const resource = fixtureResource();
  const refreshed = applyGitHubSnapshot(resource, {
    ok: true,
    stars: 1200,
    forks: 44,
    archived: false,
    licenseName: "MIT",
    licenseStatus: "permissive"
  }, new Date("2026-07-20T00:00:00.000Z"));

  assert.equal(refreshed.sourceCheckStatus, "active");
  assert.equal(refreshed.lastSeenAt, "2026-07-20");
  assert.equal(refreshed.sourceCheckedAt, "2026-07-05");
  assert.equal(refreshed.upstreamPopularity.githubStarsSnapshot, 1000);
  assert.equal(refreshed.upstreamPopularity.githubStarsCurrent, 1200);
  assert.equal(refreshed.licenseStatus, "permissive");
});

test("refresh marks archived and unavailable resources", () => {
  const archived = applyGitHubSnapshot(fixtureResource(), { ok: true, archived: true }, new Date("2026-07-20T00:00:00.000Z"));
  const unavailable = applyGitHubSnapshot(fixtureResource(), { ok: false, status: 404 }, new Date("2026-07-20T00:00:00.000Z"));

  assert.equal(archived.sourceCheckStatus, "archived");
  assert.equal(unavailable.sourceCheckStatus, "unavailable");
  assert.ok(unavailable.popularityBreakdown.riskPenalty >= 100);
});

test("refresh marks missing old snapshots stale", () => {
  const stale = markStale(fixtureResource({ lastSeenAt: "2026-07-05" }), new Date("2026-11-01T00:00:00.000Z"));
  assert.equal(stale.sourceCheckStatus, "stale");
});

test("catalog refresh is repeatable with fixture snapshots", () => {
  const catalog: ResourceCatalog = {
    generatedAt: "2026-07-05T00:00:00.000Z",
    source: { catalog: "fixture", sourceCheckedAt: "2026-07-05", externalSeedCount: 2 },
    resources: [
      fixtureResource({ id: "github:acme/active", canonicalUrl: "https://github.com/acme/active" }),
      fixtureResource({ id: "github:acme/missing", canonicalUrl: "https://github.com/acme/missing" })
    ]
  };
  const refreshed = refreshCatalogWithSnapshots(catalog, {
    "github:acme/active": { ok: true, stars: 50, archived: false },
    "github:acme/missing": { ok: false, status: 404 }
  }, new Date("2026-07-20T00:00:00.000Z"));

  assert.equal(refreshed.resources[0].sourceCheckStatus, "active");
  assert.equal(refreshed.resources[1].sourceCheckStatus, "unavailable");
  assert.equal(refreshed.resources[0].lastSeenAt, "2026-07-20");
});

function fixtureResource(overrides: Partial<SeedResource> = {}): SeedResource {
  const base: SeedResource = {
    id: "github:acme/resource",
    identity: { scheme: "github", key: "acme/resource" },
    sourceCatalogId: "fixture:1",
    title: "resource",
    summary: "Source-checked fixture resource.",
    summaryOriginal: "fixture",
    resourceType: "skill",
    sourcePlatform: "github",
    canonicalUrl: "https://github.com/acme/resource",
    upstreamId: "acme/resource",
    upstreamOwner: "acme",
    upstreamRepo: "resource",
    creatorName: "acme",
    licenseStatus: "unknown",
    sourceCheckedAt: "2026-07-05",
    sourceCheckMethod: "github_api",
    sourceCheckStatus: "active",
    lastSeenAt: "2026-07-05",
    installability: "open_only",
    tags: ["skill"],
    worksWith: ["github"],
    upstreamPopularity: {
      githubStarsSnapshot: 1000,
      githubStarsCurrent: 1000,
      sourceLabel: "GitHub stars snapshot"
    },
    onlyHarnessSignals: {
      stars: 0,
      opens: 0,
      imports: 0,
      installs: 0,
      threads: 0,
      passedGates: 0
    },
    popularityScore: 30,
    popularityBreakdown: {
      upstreamScore: 28,
      onlyHarnessScore: 0,
      freshnessBoost: 5,
      riskPenalty: 3
    },
    trust: {
      sourceChecked: true,
      securityScan: "not_scanned",
      riskTier: "UNKNOWN"
    },
    actions: [
      { id: "open_upstream", label: "Open upstream", url: "https://github.com/acme/resource" }
    ],
    source: {
      platform: "github",
      url: "https://github.com/acme/resource",
      checkedAt: "2026-07-05",
      checkedBy: "github_api",
      catalogRank: 1
    }
  };
  return { ...base, ...overrides };
}
