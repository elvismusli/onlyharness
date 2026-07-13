import { z } from "zod";
import type { Resource } from "./resources.js";

const boundedText = (max: number) => z.string().min(1).max(max).refine((value) => !/[\0\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
const timestamp = z.string().max(64).refine((value) => Number.isFinite(Date.parse(value)));
const publicUrl = z.string().max(2048).refine((value) => {
  try {
    const parsed = new URL(value);
    const sensitiveQuery = [...parsed.searchParams.keys()].some((key) => /^(?:access[_-]?token|refresh[_-]?token|authorization|password|secret|api[_-]?key|private[_-]?key)$/i.test(key));
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password && !sensitiveQuery;
  } catch {
    return false;
  }
});
const finiteScore = z.number().finite().min(-1_000_000_000).max(1_000_000_000);
const nonNegativeMetric = z.number().finite().min(0).max(1_000_000_000_000);
const nonNegativeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const sourcePlatform = z.enum([
  "github", "claude_plugin_marketplace", "anthropic_official", "github_copilot", "cursor", "skillsmp", "agensi",
  "tonsofskills", "smithery", "glama", "pulsemcp", "mcp_so", "mcp_market", "agentic_market", "promptbase",
  "gumroad", "whop", "vendor_official", "manual"
]);
const sourceCheckMethod = z.enum(["github_api", "marketplace_api", "manual_research"]);
const resourceType = z.enum([
  "harness", "skill", "plugin", "workflow", "mcp_server", "service_endpoint", "agent_team", "subagent_pack",
  "command_pack", "config", "guide", "framework", "agent_runtime", "directory"
]);
const worksWith = z.enum(["claude-code", "codex", "cursor", "mcp", "cli", "github"]);

const resourceActionSchema = z.discriminatedUnion("id", [
  z.object({ id: z.literal("open_onlyharness"), label: boundedText(160), url: publicUrl }).strict(),
  z.object({ id: z.literal("open_mirror"), label: boundedText(160), url: publicUrl }).strict(),
  z.object({ id: z.literal("open_upstream"), label: boundedText(160), url: publicUrl }).strict(),
  z.object({ id: z.literal("download_archive"), label: boundedText(160), url: publicUrl }).strict(),
  z.object({ id: z.literal("copy_mcp_config"), label: boundedText(160), command: boundedText(4096).optional() }).strict(),
  z.object({ id: z.literal("install"), label: boundedText(160), command: boundedText(4096), target: boundedText(160) }).strict(),
  z.object({ id: z.literal("import_github"), label: boundedText(160), command: boundedText(4096) }).strict(),
  z.object({ id: z.literal("claim"), label: boundedText(160), proofRequired: z.literal(true) }).strict()
]);

const resourceMirrorSchema = z.object({
  platform: z.literal("github"),
  owner: boundedText(160),
  repo: boundedText(160),
  fullName: boundedText(321),
  url: publicUrl,
  cloneUrl: publicUrl.optional(),
  defaultBranch: boundedText(255).optional(),
  defaultBranchOnly: z.boolean(),
  fork: z.boolean(),
  sourceUrl: publicUrl,
  status: z.enum(["ready", "pending", "failed"]),
  syncedAt: timestamp.optional(),
  error: boundedText(1000).optional()
}).strict();

export const runtimeResourceSchema = z.object({
  id: boundedText(256),
  identity: z.object({
    scheme: z.enum(["github", "onlyharness", "marketplace", "manual"]),
    key: boundedText(512),
    subpath: boundedText(512).optional()
  }).strict(),
  sourceCatalogId: boundedText(256).optional(),
  title: boundedText(240),
  summary: boundedText(4000),
  summaryOriginal: boundedText(4000).optional(),
  resourceType,
  sourcePlatform,
  canonicalUrl: publicUrl,
  mirror: resourceMirrorSchema.optional(),
  upstreamId: boundedText(512),
  upstreamOwner: boundedText(256),
  upstreamRepo: boundedText(256).optional(),
  creatorName: boundedText(256).optional(),
  licenseStatus: z.enum(["permissive", "copyleft", "proprietary", "unknown", "blocked", "manual_review"]),
  licenseName: boundedText(256).optional(),
  sourceCheckedAt: timestamp,
  sourceCheckMethod,
  sourceCheckStatus: z.enum(["active", "stale", "archived", "unavailable"]),
  lastSeenAt: timestamp,
  installability: z.enum(["open_only", "importable", "installable", "verified"]),
  tags: z.array(boundedText(100)).min(1).max(64).refine((items) => new Set(items).size === items.length),
  worksWith: z.array(worksWith).min(1).max(6).refine((items) => new Set(items).size === items.length),
  upstreamPopularity: z.object({
    githubStarsSnapshot: nonNegativeInteger.optional(),
    githubStarsCurrent: nonNegativeInteger.optional(),
    githubForks: nonNegativeInteger.optional(),
    marketplaceInstalls: nonNegativeInteger.optional(),
    marketplaceRating: nonNegativeMetric.optional(),
    sourceLabel: boundedText(500)
  }).strict(),
  onlyHarnessSignals: z.object({
    stars: nonNegativeInteger,
    opens: nonNegativeInteger,
    imports: nonNegativeInteger,
    installs: nonNegativeInteger,
    threads: nonNegativeInteger,
    passedGates: nonNegativeInteger
  }).strict(),
  popularityScore: finiteScore,
  popularityBreakdown: z.object({
    upstreamScore: finiteScore,
    onlyHarnessScore: finiteScore,
    freshnessBoost: finiteScore,
    riskPenalty: finiteScore
  }).strict(),
  trust: z.object({
    sourceChecked: z.boolean(),
    securityScan: z.enum(["pass", "warn", "fail", "not_scanned"]).optional(),
    installVerifiedAt: timestamp.optional(),
    gateVerifiedAt: timestamp.optional(),
    riskTier: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"]).optional()
  }).strict(),
  workspaceApproval: z.object({
    workspaceSlug: boundedText(100),
    workspaceName: boundedText(240),
    collectionSlug: boundedText(100),
    sourceResourceId: boundedText(256),
    approvalState: z.enum(["pending_review", "approved", "approved_with_warning", "blocked", "blocked_by_scan", "deprecated"]),
    approvedBy: boundedText(256).optional(),
    approvedAt: timestamp.optional(),
    note: boundedText(2000).optional(),
    riskSnapshot: z.unknown().optional()
  }).strict().optional(),
  actions: z.array(resourceActionSchema).min(1).max(16).refine((actions) => new Set(actions.map((action) => action.id)).size === actions.length),
  source: z.object({
    platform: sourcePlatform,
    url: publicUrl,
    checkedAt: timestamp,
    checkedBy: sourceCheckMethod,
    originalSection: boundedText(512).optional(),
    catalogRank: nonNegativeInteger.optional()
  }).strict().optional()
}).strict();

export function parseRuntimeResource(value: unknown): Resource | undefined {
  if (containsSensitiveResourceData(value)) return undefined;
  const parsed = runtimeResourceSchema.safeParse(value);
  return parsed.success ? parsed.data as Resource : undefined;
}

function containsSensitiveResourceData(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === "string") {
    return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)
      || /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/i.test(value)
      || /\b(?:sk|ghp|github_pat|xox[baprs])-?[A-Za-z0-9_-]{12,}\b/i.test(value);
  }
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsSensitiveResourceData(item, seen));
  for (const [key, nested] of Object.entries(value)) {
    if (/^(?:__proto__|prototype|constructor|authorization|cookie|set-cookie|password|passwd|secret|token|access[_-]?token|refresh[_-]?token|service[_-]?role[_-]?key|api[_-]?key|private[_-]?key|email)$/i.test(key)) return true;
    if (containsSensitiveResourceData(nested, seen)) return true;
  }
  return false;
}
