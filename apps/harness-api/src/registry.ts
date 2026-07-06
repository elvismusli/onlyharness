import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { inspectHarness, validateHarnessDir, type HarnessManifest, type SecurityReport as ManifestSecurityReport } from "@harnesshub/schema";
import { scanHarnessDir, type SecurityReport as StaticSecurityReport } from "./security-scan.js";
import { socialFromCounters, type Counters } from "./social.js";

export const workspaceRoot = path.resolve(process.env.HARNESS_WORKSPACE_ROOT ?? path.join(import.meta.dirname, "../../.."));
export const seedRoot = path.join(workspaceRoot, "seed-harnesses");
export const importRoot = path.join(workspaceRoot, "data/imports");

export const MAX_ARCHIVE_FILE_BYTES = 256 * 1024;

export type RegistryItem = {
  owner: string;
  ownerLabel: string;
  name: string;
  title: string;
  summary: string;
  tags: string[];
  outcome: string;
  runtime: string;
  repoPath: string;
  forgeUrl: string;
  valid: boolean;
  riskScore: number;
  riskTier: string;
  evalStatus: string;
  evalScore: number;
  security: {
    verdict: StaticSecurityReport["verdict"];
    findings: number;
    scanner: StaticSecurityReport["scanner"];
  };
  standard: "conformant" | "partial";
  forks: number;
  stars: number;
  threads: number;
  runs: number;
  heat: number;
  heatDelta: number;
  freshness: string;
  badge: string;
  cliCommand: string;
  updatedAt: string;
};

export type RegistryQuery = {
  q?: string;
  risk?: string;
  eval?: string;
  runtime?: string;
  outcome?: string;
  sort?: string;
};

export function scanRegistry(counters: Map<string, Counters>): RegistryItem[] {
  return [
    ...scanHarnessRoot("harnesses", seedRoot, counters),
    ...scanHarnessRoot("local", importRoot, counters)
  ];
}

export function searchRegistry(query: RegistryQuery, counters: Map<string, Counters>): RegistryItem[] {
  let items = scanRegistry(counters);
  if (query.q) {
    const terms = query.q.toLowerCase().split(/\s+/).filter(Boolean);
    items = items.filter((item) => {
      const haystack = `${item.name} ${item.title} ${item.summary} ${item.outcome} ${item.tags.join(" ")}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }
  if (query.risk && query.risk !== "all") items = items.filter((item) => item.riskTier === query.risk);
  if (query.eval && query.eval !== "all") items = items.filter((item) => item.evalStatus === query.eval);
  if (query.runtime && query.runtime !== "all") items = items.filter((item) => item.runtime === query.runtime);
  if (query.outcome && query.outcome !== "all") items = items.filter((item) => item.outcome === query.outcome);
  return sortRegistry(items, query.sort ?? "trending");
}

export function scanHarnessRoot(owner: string, root: string, counters: Map<string, Counters>): RegistryItem[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => registryItemFromDir(owner, path.join(root, entry.name), counters))
    .filter(Boolean) as RegistryItem[];
}

export function registryItemFromDir(owner: string, repoPath: string, counters: Map<string, Counters>): RegistryItem | undefined {
  const validation = validateHarnessDir(repoPath);
  if (!validation.manifest) return undefined;
  const evalResult = readEvalResult(repoPath);
  const updatedAt = statDate(repoPath);
  const security = securityReportFor(repoPath, validation.security, validation.manifest.permissions.network_allowlist);
  if (security.verdict === "fail") return undefined;
  const social = socialFromCounters(counters.get(`${owner}/${validation.manifest.name}`), {
    riskTier: validation.risk.tier,
    evalScore: evalResult?.score ?? 0,
    updatedAt
  });
  return {
    owner,
    ownerLabel: owner === "harnesses" ? "onlyharness" : "local",
    name: validation.manifest.name,
    title: validation.manifest.title,
    summary: validation.manifest.summary,
    tags: validation.manifest.tags,
    outcome: inferOutcome(validation.manifest.tags),
    runtime: validation.manifest.runtime.primary,
    repoPath,
    forgeUrl: owner === "harnesses" ? `${process.env.GITEA_BASE_URL ?? "http://127.0.0.1:3000"}/${owner}/${validation.manifest.name}` : `file://${repoPath}`,
    valid: validation.valid,
    riskScore: validation.risk.score,
    riskTier: validation.risk.tier,
    evalStatus: evalResult?.status ?? "unknown",
    evalScore: evalResult?.score ?? 0,
    security: {
      verdict: security.verdict,
      findings: security.findings.length,
      scanner: security.scanner
    },
    standard: standardLevel(validation.valid, validation.manifest, security),
    forks: social.forks,
    stars: social.stars,
    threads: social.threads,
    runs: social.runs,
    heat: social.heat,
    heatDelta: social.heatDelta,
    freshness: social.freshness,
    badge: social.badge,
    cliCommand: `hh pull ${owner}/${validation.manifest.name}`,
    updatedAt
  };
}

export function sortRegistry(items: RegistryItem[], sort: string): RegistryItem[] {
  const sorted = [...items];
  if (sort === "stars") return sorted.sort((a, b) => b.stars - a.stars);
  if (sort === "forks") return sorted.sort((a, b) => b.forks - a.forks);
  if (sort === "threads") return sorted.sort((a, b) => b.threads - a.threads);
  if (sort === "new") return sorted.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return sorted.sort((a, b) => b.heat - a.heat);
}

export function socialFromItem(item: RegistryItem) {
  return {
    stars: item.stars,
    forks: item.forks,
    threads: item.threads,
    runs: item.runs,
    heat: item.heat,
    heatDelta: item.heatDelta,
    freshness: item.freshness,
    badge: item.badge,
    cliCommand: item.cliCommand
  };
}

export function resolveHarnessPath(owner: string, repo: string): string | undefined {
  const roots = owner === "local" ? [importRoot] : owner === "harnesses" ? [seedRoot] : [seedRoot, importRoot];
  for (const root of roots) {
    const candidate = path.join(root, repo);
    if (existsSync(path.join(candidate, "harness.yaml"))) return candidate;
  }
  return undefined;
}

export function buildArchive(root: string) {
  const files = listHarnessFiles(root).map((file) => {
    const full = path.join(root, file);
    const size = statSafe(full) ? statSync(full).size : 0;
    if (size > MAX_ARCHIVE_FILE_BYTES) return { path: file, truncated: true, content: "" };
    return { path: file, truncated: false, content: readMaybe(full) };
  });
  return { files };
}

export function registryDetailBasics(root: string) {
  const inspection = inspectHarness(root);
  const evalResult = readEvalResult(root);
  const security = securityReportFor(root, inspection.security, inspection.manifest?.permissions.network_allowlist ?? []);
  const standard = standardLevel(Boolean(inspection.valid), inspection.manifest, security);
  return { inspection, evalResult, security, standard };
}

export function securityReportFor(root: string, manifestSecurity: ManifestSecurityReport | undefined, networkAllowlist: string[]) {
  return scanHarnessDir(root, { manifestSecurity, networkAllowlist });
}

export function standardLevel(
  valid: boolean,
  manifest: HarnessManifest | undefined,
  security: StaticSecurityReport
): "conformant" | "partial" {
  if (!valid || !manifest) return "partial";
  if (security.verdict !== "pass") return "partial";
  if (!manifest.evals.promptfoo_config || !manifest.examples.length) return "partial";
  return "conformant";
}

export function readExample(root: string) {
  return {
    input: readMaybe(path.join(root, "examples/input.md")),
    expected: readMaybe(path.join(root, "examples/expected.md"))
  };
}

export function listHarnessFiles(root: string) {
  const files: string[] = [];
  collectFiles(root, root, files);
  return files.slice(0, 80);
}

export function readEvalResult(root: string) {
  const file = path.join(root, ".harnesshub/results.json");
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

export function readMaybe(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function inferOutcome(tags: string[]): string {
  const set = new Set(tags.map((tag) => tag.toLowerCase()));
  if (set.has("finance") || set.has("payments") || set.has("safety")) return "Finance safety";
  if (set.has("support") || set.has("triage")) return "Support";
  if (set.has("research") || set.has("validation") || set.has("gtm")) return "Research";
  if (set.has("founder") || set.has("decision") || set.has("product") || set.has("strategy")) return "Strategy";
  if (set.has("repo") || set.has("audit") || set.has("runtime")) return "Engineering";
  return "Builder tools";
}

function collectFiles(root: string, dir: string, files: string[]) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".harnesshub" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(root, full, files);
    else files.push(path.relative(root, full));
  }
}

function statDate(root: string): string {
  return new Date(readdirSync(root).reduce((latest, file) => {
    const mtime = statSafe(path.join(root, file));
    return Math.max(latest, mtime);
  }, 0)).toISOString();
}

function statSafe(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}
