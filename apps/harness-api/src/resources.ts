import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RegistryItem } from "./registry.js";
import { workspaceRoot } from "./registry.js";
import { readActiveReleaseResourcesSync, resourceArchivePathForRead } from "./resource-releases.js";

export type ResourceType =
  | "harness"
  | "skill"
  | "plugin"
  | "workflow"
  | "mcp_server"
  | "service_endpoint"
  | "agent_team"
  | "subagent_pack"
  | "command_pack"
  | "config"
  | "guide"
  | "framework"
  | "agent_runtime"
  | "directory";

export type SourcePlatform =
  | "github"
  | "claude_plugin_marketplace"
  | "anthropic_official"
  | "github_copilot"
  | "cursor"
  | "skillsmp"
  | "agensi"
  | "tonsofskills"
  | "smithery"
  | "glama"
  | "pulsemcp"
  | "mcp_so"
  | "mcp_market"
  | "agentic_market"
  | "promptbase"
  | "gumroad"
  | "whop"
  | "vendor_official"
  | "manual";

export type Installability = "open_only" | "importable" | "installable" | "verified";
export type LicenseStatus = "permissive" | "copyleft" | "proprietary" | "unknown" | "blocked" | "manual_review";
export type SourceCheckStatus = "active" | "stale" | "archived" | "unavailable";

export type ResourceMirror = {
  platform: "github";
  owner: string;
  repo: string;
  fullName: string;
  url: string;
  cloneUrl?: string;
  defaultBranch?: string;
  defaultBranchOnly: boolean;
  fork: boolean;
  sourceUrl: string;
  status: "ready" | "pending" | "failed";
  syncedAt?: string;
  error?: string;
};

export type Resource = {
  id: string;
  identity: {
    scheme: "github" | "onlyharness" | "marketplace" | "manual";
    key: string;
    subpath?: string;
  };
  sourceCatalogId?: string;
  title: string;
  summary: string;
  summaryOriginal?: string;
  resourceType: ResourceType;
  sourcePlatform: SourcePlatform;
  canonicalUrl: string;
  mirror?: ResourceMirror;
  upstreamId: string;
  upstreamOwner: string;
  upstreamRepo?: string;
  creatorName?: string;
  licenseStatus: LicenseStatus;
  licenseName?: string;
  sourceCheckedAt: string;
  sourceCheckMethod: "github_api" | "marketplace_api" | "manual_research";
  sourceCheckStatus: SourceCheckStatus;
  lastSeenAt: string;
  installability: Installability;
  tags: string[];
  worksWith: Array<"claude-code" | "codex" | "cursor" | "mcp" | "cli" | "github">;
  upstreamPopularity: {
    githubStarsSnapshot?: number;
    githubStarsCurrent?: number;
    githubForks?: number;
    marketplaceInstalls?: number;
    marketplaceRating?: number;
    sourceLabel: string;
  };
  onlyHarnessSignals: {
    stars: number;
    opens: number;
    imports: number;
    installs: number;
    threads: number;
    passedGates: number;
  };
  popularityScore: number;
  popularityBreakdown: {
    upstreamScore: number;
    onlyHarnessScore: number;
    freshnessBoost: number;
    riskPenalty: number;
  };
  trust: {
    sourceChecked: boolean;
    securityScan?: "pass" | "warn" | "fail" | "not_scanned";
    installVerifiedAt?: string;
    gateVerifiedAt?: string;
    riskTier?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
  };
  workspaceApproval?: {
    workspaceSlug: string;
    workspaceName: string;
    collectionSlug: string;
    sourceResourceId: string;
    approvalState: "pending_review" | "approved" | "approved_with_warning" | "blocked" | "blocked_by_scan" | "deprecated";
    approvedBy?: string;
    approvedAt?: string;
    note?: string;
    riskSnapshot?: unknown;
  };
  actions: ResourceAction[];
  source?: {
    platform: SourcePlatform;
    url: string;
    checkedAt: string;
    checkedBy: "github_api" | "marketplace_api" | "manual_research";
    originalSection?: string;
    catalogRank?: number;
  };
};

export type ResourceAction =
  | { id: "open_onlyharness"; label: string; url: string }
  | { id: "open_mirror"; label: string; url: string }
  | { id: "open_upstream"; label: string; url: string }
  | { id: "download_archive"; label: string; url: string }
  | { id: "copy_mcp_config"; label: string; command?: string }
  | { id: "install"; label: string; command: string; target: string }
  | { id: "import_github"; label: string; command: string }
  | { id: "claim"; label: string; proofRequired: true };

export type ResourceQuery = {
  q?: string;
  type?: string;
  source?: string;
  installability?: string;
  worksWith?: string;
  license?: string;
  sort?: "popular" | "github-stars" | "new" | "source-checked" | "onlyharness";
  limit?: string | number;
};

type ResourceCatalogFile = {
  generatedAt: string;
  source: {
    catalog: string;
    sourceCheckedAt: string;
    externalSeedCount: number;
  };
  resources: Resource[];
};

export type ResourceSearchResult = {
  resources: Resource[];
  items: Resource[];
  counts: {
    externalSeed: number;
    internal: number;
    total: number;
  };
};

const catalogPath = path.join(workspaceRoot, "data/resources/verified-2026-07.json");
const importedCatalogPath = path.resolve(process.env.RESOURCE_IMPORTS_PATH ?? path.join(workspaceRoot, "data/resources/imported.json"));
const archiveRoot = process.env.RESOURCE_ARCHIVE_DIR
  ? path.resolve(process.env.RESOURCE_ARCHIVE_DIR)
  : path.join(workspaceRoot, "data/resources/archives");
let catalogCache: { mtimeMs: number; catalog: ResourceCatalogFile } | undefined;
let importedCatalogCache: { mtimeMs: number; catalog: ResourceCatalogFile } | undefined;

export function readResourceCatalog(): ResourceCatalogFile {
  const seed = readSeedResourceCatalog();
  const imported = readImportedResourceCatalog();
  const activeReleases = readActiveReleaseResourcesSync();
  if (!imported.resources.length && !activeReleases.length) return seed;
  const resources = dedupeResources([...activeReleases, ...imported.resources, ...seed.resources]);
  return {
    generatedAt: maxIso(seed.generatedAt, imported.generatedAt),
    source: {
      catalog: `${seed.source.catalog}+${path.relative(workspaceRoot, importedCatalogPath)}`,
      sourceCheckedAt: maxIso(seed.source.sourceCheckedAt, imported.source.sourceCheckedAt),
      externalSeedCount: seed.source.externalSeedCount + imported.resources.length + activeReleases.length
    },
    resources
  };
}

export function upsertImportedResource(resource: Resource): ResourceCatalogFile {
  const existing = readImportedResourceCatalog();
  const resources = [resource, ...existing.resources.filter((item) => item.id !== resource.id)];
  const now = new Date().toISOString();
  const catalog: ResourceCatalogFile = {
    generatedAt: now,
    source: {
      catalog: path.relative(workspaceRoot, importedCatalogPath),
      sourceCheckedAt: now,
      externalSeedCount: resources.length
    },
    resources
  };
  mkdirSync(path.dirname(importedCatalogPath), { recursive: true });
  writeFileSync(importedCatalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  importedCatalogCache = { mtimeMs: statSync(importedCatalogPath).mtimeMs, catalog };
  return catalog;
}

export function resourceArchiveRoot(): string {
  mkdirSync(archiveRoot, { recursive: true });
  return archiveRoot;
}

function readSeedResourceCatalog(): ResourceCatalogFile {
  if (!existsSync(catalogPath)) {
    return {
      generatedAt: new Date(0).toISOString(),
      source: { catalog: "data/resources/verified-2026-07.json", sourceCheckedAt: "", externalSeedCount: 0 },
      resources: []
    };
  }
  const mtimeMs = statSync(catalogPath).mtimeMs;
  if (catalogCache && catalogCache.mtimeMs === mtimeMs) return catalogCache.catalog;
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as ResourceCatalogFile;
  catalogCache = { mtimeMs, catalog };
  return catalog;
}

function readImportedResourceCatalog(): ResourceCatalogFile {
  if (!existsSync(importedCatalogPath)) {
    return {
      generatedAt: new Date(0).toISOString(),
      source: { catalog: path.relative(workspaceRoot, importedCatalogPath), sourceCheckedAt: "", externalSeedCount: 0 },
      resources: []
    };
  }
  const mtimeMs = statSync(importedCatalogPath).mtimeMs;
  if (importedCatalogCache && importedCatalogCache.mtimeMs === mtimeMs) return importedCatalogCache.catalog;
  const catalog = JSON.parse(readFileSync(importedCatalogPath, "utf8")) as ResourceCatalogFile;
  importedCatalogCache = { mtimeMs, catalog };
  return catalog;
}

export function searchResources(query: ResourceQuery, registryItems: RegistryItem[]): ResourceSearchResult {
  const external = readResourceCatalog().resources.map(withRuntimeArchiveAction);
  const internal = resourcesFromRegistryCatalog(registryItems).map(withRuntimeArchiveAction);
  let resources = dedupeResources([...external, ...internal]);

  if (query.q) {
    const terms = query.q.toLowerCase().split(/\s+/).filter(Boolean);
    resources = resources.filter((resource) => {
      const haystack = [
        resource.id,
        resource.title,
        resource.summary,
        resource.summaryOriginal ?? "",
        resource.resourceType,
        resource.sourcePlatform,
        resource.upstreamId,
        resource.upstreamOwner,
        resource.upstreamRepo ?? "",
        resource.tags.join(" "),
        resource.worksWith.join(" ")
      ].join(" ").toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }
  if (query.type && query.type !== "all") resources = resources.filter((resource) => resource.resourceType === query.type);
  if (query.source && query.source !== "all") resources = resources.filter((resource) => resource.sourcePlatform === query.source);
  if (query.installability && query.installability !== "all") resources = resources.filter((resource) => resource.installability === query.installability);
  if (query.worksWith && query.worksWith !== "all") resources = resources.filter((resource) => resource.worksWith.includes(query.worksWith as Resource["worksWith"][number]));
  if (query.license && query.license !== "all") resources = resources.filter((resource) => resource.licenseStatus === query.license);

  resources = sortResources(resources, query.sort ?? "popular");
  const limit = Number(query.limit ?? 50);
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 200)) : 50;
  const sliced = resources.slice(0, boundedLimit);
  return {
    resources: sliced,
    items: sliced,
    counts: {
      externalSeed: external.length,
      internal: internal.length,
      total: resources.length
    }
  };
}

export function resourceDetail(id: string, registryItems: RegistryItem[]): Resource | undefined {
  const decoded = decodeURIComponent(id);
  const external = readResourceCatalog().resources;
  const internal = resourcesFromRegistryCatalog(registryItems);
  const resource = dedupeResources([...external, ...internal]).find((candidate) => candidate.id === decoded);
  return resource ? withRuntimeArchiveAction(resource) : undefined;
}

function withRuntimeArchiveAction(resource: Resource): Resource {
  const openActions = resource.actions.filter((action) => action.id === "open_onlyharness" || action.id === "open_mirror" || action.id === "open_upstream");
  const existingDownload = resource.actions.find((action) => action.id === "download_archive");
  const otherActions = resource.actions.filter((action) => action.id !== "open_onlyharness" && action.id !== "open_mirror" && action.id !== "open_upstream" && action.id !== "download_archive");
  const archive = resourceArchivePathForRead(resource.id);
  const actions: ResourceAction[] = archive
    ? [...openActions, existingDownload ?? { id: "download_archive", label: "Download from SuperSkill", url: `https://superskill.sh/api/resources/${encodeURIComponent(resource.id)}/archive` }, ...otherActions]
    : [...openActions, ...otherActions];
  return actions.length === resource.actions.length && actions.every((action, index) => action === resource.actions[index])
    ? resource
    : { ...resource, actions };
}

export function resourceArchivePath(id: string, version?: string): string | undefined {
  return resourceArchivePathForRead(id, version);
}

export function resourceArchiveKey(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}

export function resourceArchiveFileName(resource: Resource): string {
  const name = resource.title.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "") || "resource";
  return `onlyharness-${name}.tar.gz`;
}

export function resourcesFromRegistryCatalog(items: RegistryItem[]): Resource[] {
  return items.map((item) => {
    const isDirectory = item.contentType === "directory";
    const sourceCheckedAt = item.updatedAt.slice(0, 10);
    const worksWith = worksWithFromRegistryItem(item);
    const onlyHarnessSignals = {
      stars: item.stars,
      opens: 0,
      imports: 0,
      installs: item.installConfirms,
      threads: item.threads,
      passedGates: item.runs
    };
    const base: Omit<Resource, "popularityScore" | "popularityBreakdown"> = {
      id: onlyHarnessResourceId(item.owner, item.name),
      identity: { scheme: "onlyharness", key: `${item.owner}/${item.name}` },
      title: item.title,
      summary: item.summary,
      resourceType: isDirectory ? "directory" : "harness",
      sourcePlatform: "manual",
      canonicalUrl: item.forgeUrl ?? `https://superskill.sh/#/h/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.name)}`,
      upstreamId: `${item.owner}/${item.name}`,
      upstreamOwner: item.owner,
      upstreamRepo: item.name,
      creatorName: item.ownerLabel,
      licenseStatus: "unknown",
      sourceCheckedAt,
      sourceCheckMethod: "manual_research",
      sourceCheckStatus: "active",
      lastSeenAt: sourceCheckedAt,
      installability: isDirectory ? "open_only" : item.nativeInstallAvailable ? "installable" : "importable",
      tags: item.tags,
      worksWith,
      upstreamPopularity: { sourceLabel: "SuperSkill registry" },
      onlyHarnessSignals,
      trust: {
        sourceChecked: true,
        securityScan: item.security.verdict,
        riskTier: riskTier(item.riskTier)
      },
      actions: isDirectory && item.directory?.url
        ? [
          { id: "open_upstream", label: "Open directory", url: item.directory.url }
        ]
        : [
          { id: "open_upstream", label: "Inspect source", url: item.forgeUrl ?? `https://superskill.sh/#/h/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.name)}` }
        ],
      source: {
        platform: "manual",
        url: item.forgeUrl ?? `https://superskill.sh/#/h/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.name)}`,
        checkedAt: sourceCheckedAt,
        checkedBy: "manual_research"
      }
    };
    const breakdown = popularityScore(base);
    return {
      ...base,
      popularityScore: breakdown.total,
      popularityBreakdown: {
        upstreamScore: round2(breakdown.upstreamScore),
        onlyHarnessScore: round2(breakdown.onlyHarnessScore),
        freshnessBoost: breakdown.freshnessBoost,
        riskPenalty: breakdown.riskPenalty
      }
    };
  });
}

export function popularityScore(resource: Pick<Resource, "upstreamPopularity" | "onlyHarnessSignals" | "sourceCheckStatus" | "lastSeenAt" | "licenseStatus">, now = new Date()) {
  const upstreamScore =
    Math.min(Math.log1p(resource.upstreamPopularity.githubStarsCurrent ?? resource.upstreamPopularity.githubStarsSnapshot ?? 0), 12) * 4 +
    Math.min(Math.log1p(resource.upstreamPopularity.marketplaceInstalls ?? 0), 12) * 3;
  const onlyHarnessScore =
    resource.onlyHarnessSignals.stars * 2 +
    resource.onlyHarnessSignals.opens * 0.1 +
    resource.onlyHarnessSignals.imports * 3 +
    resource.onlyHarnessSignals.installs * 5 +
    resource.onlyHarnessSignals.passedGates * 8 +
    resource.onlyHarnessSignals.threads * 1.5;
  const age = ageDays(resource.lastSeenAt, now);
  const freshnessBoost =
    resource.sourceCheckStatus === "active" && age <= 30 ? 5 :
    resource.sourceCheckStatus === "active" && age <= 90 ? 2 :
    0;
  const riskPenalty =
    resource.sourceCheckStatus === "unavailable" ? 100 :
    resource.sourceCheckStatus === "archived" ? 25 :
    resource.licenseStatus === "blocked" ? 100 :
    resource.licenseStatus === "unknown" ? 3 :
    0;
  return {
    upstreamScore,
    onlyHarnessScore,
    freshnessBoost,
    riskPenalty,
    total: Math.round(upstreamScore + onlyHarnessScore + freshnessBoost - riskPenalty)
  };
}

function onlyHarnessResourceId(owner: string, name: string): string {
  return `onlyharness:${owner}/${name}`;
}

function dedupeResources(resources: Resource[]): Resource[] {
  const seen = new Set<string>();
  const result: Resource[] = [];
  for (const resource of resources) {
    if (seen.has(resource.id)) continue;
    seen.add(resource.id);
    result.push(resource);
  }
  return result;
}

function sortResources(resources: Resource[], sort: NonNullable<ResourceQuery["sort"]>): Resource[] {
  const sorted = [...resources];
  if (sort === "github-stars") {
    return sorted.sort((a, b) => (b.upstreamPopularity.githubStarsCurrent ?? b.upstreamPopularity.githubStarsSnapshot ?? 0) - (a.upstreamPopularity.githubStarsCurrent ?? a.upstreamPopularity.githubStarsSnapshot ?? 0));
  }
  if (sort === "new") return sorted.sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  if (sort === "source-checked") return sorted.sort((a, b) => Date.parse(b.sourceCheckedAt) - Date.parse(a.sourceCheckedAt));
  if (sort === "onlyharness") {
    return sorted.sort((a, b) => b.popularityBreakdown.onlyHarnessScore - a.popularityBreakdown.onlyHarnessScore || b.popularityScore - a.popularityScore);
  }
  return sorted.sort((a, b) => b.popularityScore - a.popularityScore || Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
}

function worksWithFromRegistryItem(item: RegistryItem): Resource["worksWith"] {
  const mapped = new Set<Resource["worksWith"][number]>();
  for (const target of item.compatibility?.targets ?? []) {
    if (target.id === "claude-code") mapped.add("claude-code");
    if (target.id === "codex") mapped.add("codex");
    if (target.id === "cursor") mapped.add("cursor");
    if (target.id === "mcp") mapped.add("mcp");
    if (target.id === "cli") mapped.add("cli");
    if (target.id === "github") mapped.add("github");
  }
  if (!mapped.size && item.contentType !== "directory") {
    mapped.add("claude-code");
    mapped.add("codex");
    mapped.add("cursor");
    mapped.add("cli");
  }
  if (item.contentType === "directory") mapped.add("github");
  return [...mapped];
}

function riskTier(value: string): Resource["trust"]["riskTier"] {
  return ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(value) ? value as Resource["trust"]["riskTier"] : "UNKNOWN";
}

function ageDays(date: string, now: Date): number {
  const parsed = Date.parse(date);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now.getTime() - parsed) / 86_400_000));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function maxIso(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}
