import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseGitHubUrl, popularityScore, type LicenseStatus, type ResourceCatalog, type SeedResource, type SourceCheckStatus } from "./resource-catalog-shared.js";

export type GitHubRepoSnapshot = {
  ok: boolean;
  status?: number;
  stars?: number;
  forks?: number;
  pushedAt?: string;
  archived?: boolean;
  licenseName?: string;
  licenseStatus?: LicenseStatus;
};

const root = path.resolve(import.meta.dirname, "..");
const defaultCatalogPath = path.join(root, "data/resources/verified-2026-07.json");

export function refreshCatalogWithSnapshots(catalog: ResourceCatalog, snapshots: Record<string, GitHubRepoSnapshot>, now = new Date()): ResourceCatalog {
  return {
    ...catalog,
    generatedAt: now.toISOString(),
    resources: catalog.resources.map((resource) => {
      if (resource.sourcePlatform !== "github") return markStale(resource, now);
      const snapshot = snapshots[resource.id];
      return snapshot ? applyGitHubSnapshot(resource, snapshot, now) : markStale(resource, now);
    })
  };
}

export function applyGitHubSnapshot(resource: SeedResource, snapshot: GitHubRepoSnapshot, now = new Date()): SeedResource {
  const next: SeedResource = structuredClone(resource);
  if (!snapshot.ok) {
    next.sourceCheckStatus = "unavailable";
    return withScore(next, now);
  }
  next.lastSeenAt = isoDate(now);
  next.sourceCheckStatus = snapshot.archived ? "archived" : "active";
  next.upstreamPopularity = {
    ...next.upstreamPopularity,
    ...(snapshot.stars !== undefined ? { githubStarsCurrent: snapshot.stars } : {}),
    ...(snapshot.forks !== undefined ? { githubForks: snapshot.forks } : {}),
    sourceLabel: "GitHub stars"
  };
  if (snapshot.licenseName) next.licenseName = snapshot.licenseName;
  if (snapshot.licenseStatus) next.licenseStatus = snapshot.licenseStatus;
  return withScore(next, now);
}

export function markStale(resource: SeedResource, now = new Date()): SeedResource {
  const next: SeedResource = structuredClone(resource);
  if (next.sourceCheckStatus === "active" && ageDays(next.lastSeenAt, now) > 90) {
    next.sourceCheckStatus = "stale";
  }
  return withScore(next, now);
}

async function main() {
  const input = argValue("--input") ?? defaultCatalogPath;
  const output = argValue("--output") ?? input;
  const now = argValue("--now") ? new Date(String(argValue("--now"))) : new Date();
  const catalog = JSON.parse(readFileSync(input, "utf8")) as ResourceCatalog;
  const snapshots: Record<string, GitHubRepoSnapshot> = {};
  for (const resource of catalog.resources) {
    if (resource.sourcePlatform !== "github") continue;
    snapshots[resource.id] = await fetchGitHubSnapshot(resource);
  }
  const refreshed = refreshCatalogWithSnapshots(catalog, snapshots, now);
  writeFileSync(output, `${JSON.stringify(refreshed, null, 2)}\n`);
  console.log(`Refreshed ${refreshed.resources.length} resources into ${output}`);
}

async function fetchGitHubSnapshot(resource: SeedResource): Promise<GitHubRepoSnapshot> {
  const { owner, repo } = parseGitHubUrl(resource.canonicalUrl);
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "onlyharness-resource-refresh"
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers });
  if (!response.ok) return { ok: false, status: response.status };
  const data = await response.json() as {
    stargazers_count?: number;
    forks_count?: number;
    pushed_at?: string;
    archived?: boolean;
    license?: { spdx_id?: string; name?: string } | null;
  };
  const licenseName = data.license?.spdx_id && data.license.spdx_id !== "NOASSERTION" ? data.license.spdx_id : data.license?.name;
  return {
    ok: true,
    stars: numberOrUndefined(data.stargazers_count),
    forks: numberOrUndefined(data.forks_count),
    pushedAt: typeof data.pushed_at === "string" ? data.pushed_at : undefined,
    archived: Boolean(data.archived),
    licenseName,
    licenseStatus: licenseName ? licenseStatusFor(licenseName) : undefined
  };
}

function withScore(resource: SeedResource, now: Date): SeedResource {
  const breakdown = popularityScore(resource, now);
  return {
    ...resource,
    popularityScore: breakdown.total,
    popularityBreakdown: {
      upstreamScore: round2(breakdown.upstreamScore),
      onlyHarnessScore: round2(breakdown.onlyHarnessScore),
      freshnessBoost: breakdown.freshnessBoost,
      riskPenalty: breakdown.riskPenalty
    }
  };
}

function licenseStatusFor(license: string): LicenseStatus {
  const normalized = license.toLowerCase();
  if (/mit|apache|bsd|isc|mpl|unlicense|cc0/.test(normalized)) return "permissive";
  if (/gpl|agpl|lgpl|copyleft/.test(normalized)) return "copyleft";
  return "manual_review";
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function ageDays(date: string, now: Date): number {
  const parsed = Date.parse(date);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now.getTime() - parsed) / 86_400_000));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const isMain = process.argv[1] ? import.meta.url === new URL(process.argv[1], "file:").href : false;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
