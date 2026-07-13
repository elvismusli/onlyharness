import { readFileSync } from "node:fs";

export const SOURCE_CHECKED_AT = "2026-07-05";
export const EXPECTED_RESOURCE_COUNT = 253;

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

export type ResourceIdentity = {
  scheme: "github" | "onlyharness" | "marketplace" | "manual";
  key: string;
  subpath?: string;
};

export type SeedResource = {
  id: string;
  identity: ResourceIdentity;
  sourceCatalogId: string;
  title: string;
  summary: string;
  summaryOriginal: string;
  resourceType: ResourceType;
  sourcePlatform: SourcePlatform;
  canonicalUrl: string;
  mirror?: ResourceMirror;
  upstreamId: string;
  upstreamOwner: string;
  upstreamRepo: string;
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
    securityScan: "pass" | "warn" | "fail" | "not_scanned";
    installVerifiedAt?: string;
    gateVerifiedAt?: string;
    riskTier: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
  };
  actions: ResourceAction[];
  source: {
    platform: SourcePlatform;
    url: string;
    checkedAt: string;
    checkedBy: "github_api" | "marketplace_api" | "manual_research";
    originalSection: string;
    catalogRank: number;
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

export type ResourceCatalog = {
  generatedAt: string;
  source: {
    catalog: string;
    sourceCheckedAt: string;
    externalSeedCount: number;
  };
  resources: SeedResource[];
};

export type ParsedCatalogRow = {
  rank: number;
  repo: string;
  url: string;
  starsRaw: string;
  stars: number;
  updatedAt: string;
  summaryOriginal: string;
  section: string;
  sectionIndex: number;
};

const CYRILLIC_RE = /[\u0400-\u04FF]/;

export function parseCatalogMarkdown(markdown: string): ParsedCatalogRow[] {
  const rows: ParsedCatalogRow[] = [];
  let section = "";
  let sectionIndex = 0;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(\d+)\.\s+(.+)$/);
    if (heading) {
      sectionIndex = Number(heading[1]);
      section = heading[2].trim();
      continue;
    }
    const row = line.match(/^\|\s*(\d+)\s*\|\s*\[([^\]]+)\]\((https:\/\/github\.com\/[^)]+)\)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|$/);
    if (!row) continue;
    rows.push({
      rank: Number(row[1]),
      repo: row[2].trim(),
      url: row[3].trim(),
      starsRaw: row[4].trim(),
      stars: parseStars(row[4].trim()),
      updatedAt: row[5].trim(),
      summaryOriginal: stripMarkdown(row[6].trim()),
      section,
      sectionIndex
    });
  }
  return rows;
}

export function buildSummaryTemplate(rows: ParsedCatalogRow[]): Record<string, string> {
  return Object.fromEntries(rows.map((row) => {
    const { owner, repo } = parseGitHubUrl(row.url);
    const resourceType = resourceTypeForRow(row);
    const category = englishSectionLabel(row.sectionIndex);
    const typeLabel = resourceType.replace(/_/g, " ");
    return [
      githubResourceId(owner, repo),
      `Source-checked GitHub ${typeLabel} from ${owner}/${repo}, seeded for ${category} discovery in the July 2026 OnlyHarness catalog.`
    ];
  }));
}

export function buildResourceCatalog(input: {
  catalogPath: string;
  catalogMarkdown: string;
  summaryMap: Record<string, string>;
  denylist: { repos?: Array<{ repo?: string; url?: string }> };
  generatedAt?: string;
}): ResourceCatalog {
  const rows = parseCatalogMarkdown(input.catalogMarkdown);
  if (rows.length !== EXPECTED_RESOURCE_COUNT) {
    throw new Error(`Expected ${EXPECTED_RESOURCE_COUNT} catalog rows, got ${rows.length}`);
  }
  assertDenylistAbsent(rows, input.denylist);

  const resources = rows.map((row) => resourceFromRow(row, input.summaryMap));
  assertUnique(resources.map((resource) => resource.id), "resource id");
  assertUnique(resources.map((resource) => `${resource.identity.scheme}:${resource.identity.key}${resource.identity.subpath ? `#${resource.identity.subpath}` : ""}`), "resource identity");

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    source: {
      catalog: input.catalogPath,
      sourceCheckedAt: SOURCE_CHECKED_AT,
      externalSeedCount: resources.length
    },
    resources
  };
}

export function readJsonFile<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function hasCyrillic(value: string): boolean {
  return CYRILLIC_RE.test(value);
}

export function parseStars(raw: string): number {
  const clean = raw.trim().toLowerCase().replace(/,/g, "");
  const multiplier = clean.endsWith("k") ? 1000 : clean.endsWith("m") ? 1_000_000 : 1;
  const value = Number(clean.replace(/[km]$/, ""));
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * multiplier);
}

export function parseGitHubUrl(url: string): { owner: string; repo: string } {
  const parsed = new URL(url);
  if (parsed.hostname !== "github.com") throw new Error(`Expected github.com URL: ${url}`);
  const [owner, repo] = parsed.pathname.split("/").filter(Boolean);
  if (!owner || !repo) throw new Error(`Expected GitHub owner/repo URL: ${url}`);
  return { owner, repo };
}

export function githubResourceId(owner: string, repo: string): string {
  return `github:${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

export function resourceTypeForRow(row: ParsedCatalogRow): ResourceType {
  const haystack = `${row.section} ${row.repo} ${row.summaryOriginal}`.toLowerCase();
  if (row.sectionIndex === 2) return "directory";
  if (row.sectionIndex === 6) return haystack.includes("субагент") || haystack.includes("subagent") ? "subagent_pack" : "agent_team";
  if (row.sectionIndex === 8) return "workflow";
  if (row.sectionIndex === 12) return "mcp_server";
  if (row.sectionIndex === 13) return "agent_runtime";
  if (row.sectionIndex === 15) return "guide";
  if (row.sectionIndex === 7) {
    if (haystack.includes("command") || haystack.includes("команд")) return "command_pack";
    if (haystack.includes("config") || haystack.includes("конфиг") || haystack.includes("rules")) return "config";
    return "plugin";
  }
  if (row.sectionIndex === 1) {
    if (haystack.includes("plugin") || haystack.includes("плагин")) return "plugin";
    if (haystack.includes("skill")) return "skill";
    if (haystack.includes("tutorial") || haystack.includes("cookbook") || haystack.includes("учебник")) return "guide";
    return "framework";
  }
  if ([3, 4, 5].includes(row.sectionIndex)) return "skill";
  if ([9, 10, 14, 16].includes(row.sectionIndex)) return haystack.includes("workflow") || haystack.includes("методолог") ? "workflow" : "framework";
  if (row.sectionIndex === 11) return haystack.includes("hook") || haystack.includes("observ") || haystack.includes("security") ? "config" : "workflow";
  return "framework";
}

export function worksWithForRow(row: ParsedCatalogRow, resourceType: ResourceType): SeedResource["worksWith"] {
  const result = new Set<SeedResource["worksWith"][number]>(["github"]);
  const haystack = `${row.repo} ${row.summaryOriginal} ${row.section}`.toLowerCase();
  if (haystack.includes("claude") || haystack.includes("cc/") || haystack.includes("anthropic")) result.add("claude-code");
  if (haystack.includes("codex")) result.add("codex");
  if (haystack.includes("cursor") || haystack.includes("cursorrules")) result.add("cursor");
  if (resourceType === "mcp_server" || haystack.includes("mcp")) result.add("mcp");
  if (resourceType === "skill" || resourceType === "plugin" || resourceType === "subagent_pack") result.add("claude-code");
  if (resourceType === "plugin") result.add("codex");
  if (resourceType === "config") result.add("cursor");
  if (["agent_runtime", "framework", "workflow", "harness", "command_pack", "config"].includes(resourceType)) result.add("cli");
  return [...result];
}

export function popularityScore(resource: Pick<SeedResource, "upstreamPopularity" | "onlyHarnessSignals" | "sourceCheckStatus" | "lastSeenAt" | "licenseStatus">, now = new Date()): SeedResource["popularityBreakdown"] & { total: number } {
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
  const lastSeenAgeDays = ageDays(resource.lastSeenAt, now);
  const freshnessBoost =
    resource.sourceCheckStatus === "active" && lastSeenAgeDays <= 30 ? 5 :
    resource.sourceCheckStatus === "active" && lastSeenAgeDays <= 90 ? 2 :
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

function resourceFromRow(row: ParsedCatalogRow, summaryMap: Record<string, string>): SeedResource {
  const { owner, repo } = parseGitHubUrl(row.url);
  const id = githubResourceId(owner, repo);
  const summary = summaryMap[id];
  if (!summary) throw new Error(`Missing English summary for ${id}`);
  if (hasCyrillic(summary) || summary.trim() === row.summaryOriginal.trim()) {
    throw new Error(`English summary for ${id} is missing or not translated`);
  }
  const resourceType = resourceTypeForRow(row);
  const licenseStatus: LicenseStatus = "unknown";
  const sourceCheckStatus: SourceCheckStatus = "active";
  const onlyHarnessSignals = { stars: 0, opens: 0, imports: 0, installs: 0, threads: 0, passedGates: 0 };
  const scoreInput = {
    upstreamPopularity: {
      githubStarsSnapshot: row.stars,
      githubStarsCurrent: row.stars,
      sourceLabel: "GitHub stars snapshot"
    },
    onlyHarnessSignals,
    sourceCheckStatus,
    lastSeenAt: SOURCE_CHECKED_AT,
    licenseStatus
  };
  const breakdown = popularityScore(scoreInput, new Date(`${SOURCE_CHECKED_AT}T00:00:00.000Z`));
  return {
    id,
    identity: { scheme: "github", key: `${owner}/${repo}` },
    sourceCatalogId: `verified-2026-07:${row.rank}`,
    title: repo,
    summary,
    summaryOriginal: row.summaryOriginal,
    resourceType,
    sourcePlatform: "github",
    canonicalUrl: row.url,
    upstreamId: `${owner}/${repo}`,
    upstreamOwner: owner,
    upstreamRepo: repo,
    creatorName: owner,
    licenseStatus,
    sourceCheckedAt: SOURCE_CHECKED_AT,
    sourceCheckMethod: "github_api",
    sourceCheckStatus,
    lastSeenAt: SOURCE_CHECKED_AT,
    installability: "open_only",
    tags: tagsForRow(row, resourceType),
    worksWith: worksWithForRow(row, resourceType),
    upstreamPopularity: scoreInput.upstreamPopularity,
    onlyHarnessSignals,
    popularityScore: breakdown.total,
    popularityBreakdown: {
      upstreamScore: round2(breakdown.upstreamScore),
      onlyHarnessScore: round2(breakdown.onlyHarnessScore),
      freshnessBoost: breakdown.freshnessBoost,
      riskPenalty: breakdown.riskPenalty
    },
    trust: {
      sourceChecked: true,
      securityScan: "not_scanned",
      riskTier: "UNKNOWN"
    },
    actions: [
      { id: "open_onlyharness", label: "Use in SuperSkill", url: onlyHarnessResourceUrl(id) },
      { id: "open_upstream", label: "Use upstream", url: row.url },
      { id: "claim", label: "Claim as creator", proofRequired: true }
    ],
    source: {
      platform: "github",
      url: row.url,
      checkedAt: SOURCE_CHECKED_AT,
      checkedBy: "github_api",
      originalSection: row.section,
      catalogRank: row.rank
    }
  };
}

export function onlyHarnessResourceUrl(id: string): string {
  return `https://superskill.sh/#/resources/${encodeURIComponent(id)}`;
}

export function onlyHarnessResourceArchiveUrl(id: string): string {
  return `https://superskill.sh/api/resources/${encodeURIComponent(id)}/archive`;
}

function tagsForRow(row: ParsedCatalogRow, resourceType: ResourceType): string[] {
  const tags = new Set<string>([resourceType, englishSectionLabel(row.sectionIndex).toLowerCase().replace(/\s+/g, "-")]);
  const haystack = `${row.repo} ${row.summaryOriginal} ${row.section}`.toLowerCase();
  if (haystack.includes("claude")) tags.add("claude");
  if (haystack.includes("codex")) tags.add("codex");
  if (haystack.includes("cursor")) tags.add("cursor");
  if (haystack.includes("mcp")) tags.add("mcp");
  if (haystack.includes("security") || haystack.includes("безопас")) tags.add("security");
  if (haystack.includes("workflow") || haystack.includes("воркфлоу")) tags.add("workflow");
  if (haystack.includes("skill")) tags.add("skill");
  return [...tags].slice(0, 8);
}

export function englishSectionLabel(sectionIndex: number): string {
  const labels: Record<number, string> = {
    1: "official resources",
    2: "directories",
    3: "skill frameworks",
    4: "single skills",
    5: "domain skill packs",
    6: "agent teams",
    7: "plugins commands and configs",
    8: "workflow methodologies",
    9: "orchestration",
    10: "memory and context engineering",
    11: "safety and observability",
    12: "MCP servers",
    13: "agent runtimes",
    14: "harness infrastructure",
    15: "guides and learning",
    16: "adjacent frameworks"
  };
  return labels[sectionIndex] ?? "agent resources";
}

function assertDenylistAbsent(rows: ParsedCatalogRow[], denylist: { repos?: Array<{ repo?: string; url?: string }> }) {
  for (const denied of denylist.repos ?? []) {
    if (rows.some((row) => (denied.url && row.url === denied.url) || (denied.repo && row.repo.toLowerCase() === denied.repo.toLowerCase()))) {
      throw new Error(`Denylisted repo is present in resource catalog: ${denied.repo ?? denied.url}`);
    }
  }
}

function assertUnique(values: string[], label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function stripMarkdown(value: string): string {
  return value.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\s+/g, " ").trim();
}

function ageDays(date: string, now: Date): number {
  const parsed = Date.parse(date);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now.getTime() - parsed) / 86_400_000));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
