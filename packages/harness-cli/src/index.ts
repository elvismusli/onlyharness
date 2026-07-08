#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import YAML from "yaml";
import { x402Client, x402HTTPClient, type PaymentRequired, type PaymentRequirements } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import {
  type HarnessManifest,
  inspectHarness,
  riskMarkdown,
  validateHarnessDir
} from "@harnesshub/schema";
import { diffHarnessDirs, semanticDiffMarkdown } from "@harnesshub/semantic-diff";

type OutputFormat = "json" | "markdown" | "text";

const registryUrl = (process.env.HH_REGISTRY_URL ?? "https://onlyharness.com/api").replace(/\/$/, "");
const MAX_PUBLISH_FILES = 120;
const MAX_PUBLISH_FILE_BYTES = 256 * 1024;

type SearchItem = {
  owner: string;
  name: string;
  title: string;
  summary: string;
  tags: string[];
  job?: string;
  outcome?: string;
  stars: number;
  forks: number;
  threads: number;
  evalScore: number;
  evalStatus?: string;
  heat: number;
  heatQualified?: boolean;
  signalCount?: number;
  riskScore?: number;
  riskTier?: string;
  cliCommand?: string;
  contentType?: "harness" | "directory";
  directory?: {
    url?: string;
    itemCount?: number;
  };
  pricing?: PricingInfo;
  contextCost?: {
    approxTokens: number;
    files: number;
  };
  compatibility?: {
    targets?: Array<{ id?: string; name?: string; status?: string }>;
  };
};

type ResourceItem = {
  id: string;
  title: string;
  summary: string;
  resourceType: string;
  sourcePlatform: string;
  canonicalUrl: string;
  mirror?: {
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
  upstreamId: string;
  upstreamOwner: string;
  upstreamRepo?: string;
  licenseStatus: string;
  sourceCheckedAt: string;
  sourceCheckStatus: string;
  lastSeenAt: string;
  installability: "open_only" | "importable" | "installable" | "verified";
  tags: string[];
  worksWith: string[];
  upstreamPopularity?: {
    githubStarsSnapshot?: number;
    githubStarsCurrent?: number;
    sourceLabel?: string;
  };
  onlyHarnessSignals?: {
    stars?: number;
    opens?: number;
    imports?: number;
    installs?: number;
    threads?: number;
    passedGates?: number;
  };
  popularityScore?: number;
  trust?: {
    sourceChecked?: boolean;
    installVerifiedAt?: string;
    gateVerifiedAt?: string;
    riskTier?: string;
  };
  actions?: Array<
    | { id: "open_onlyharness"; label: string; url: string }
    | { id: "open_mirror"; label: string; url: string }
    | { id: "open_upstream"; label: string; url: string }
    | { id: "download_archive"; label: string; url: string }
    | { id: "copy_mcp_config"; label: string; command?: string }
    | { id: "install"; label: string; command: string; target: string }
    | { id: "import_github"; label: string; command: string }
    | { id: "claim"; label: string; proofRequired: true }
  >;
};
type ResourceSearchPayload = {
  resources?: ResourceItem[];
  items?: ResourceItem[];
  counts?: {
    externalSeed: number;
    internal: number;
    total: number;
  };
};
type GitHubImportResult = {
  url?: string;
  path?: string;
  classification?: string;
  detectedFiles?: string[];
  licenseStatus?: string;
  recommendedAction?: string;
  conversionBlocked?: string;
};

type ArchiveFile = { path: string; truncated: boolean; content: string };
type ArchivePayload = { version?: string; files?: ArchiveFile[] };
type PricingInfo = {
  model?: string;
  amount_usd?: number;
  currency?: string;
};
type SuggestDetail = {
  owner?: string;
  repo?: string;
  valid?: boolean;
  manifest?: {
    name?: string;
    title?: string;
    summary?: string;
    version?: string;
    tags?: string[];
    pricing?: PricingInfo;
    compatibility?: {
      targets?: Array<{ id?: string; name?: string; status?: string; notes?: string }>;
    };
  };
  evalResult?: {
    status?: string;
    score?: number;
    cost_usd?: number;
    cases?: unknown[];
    verification_status?: string;
  };
  risk?: {
    score?: number;
    tier?: string;
    reasons?: string[];
    blocking?: string[];
  };
  security?: {
    verdict?: string;
    findings?: unknown[];
    scannedAt?: string;
    scanner?: string;
  };
  contextCost?: Partial<ContextCost>;
  standard?: string;
  verification?: {
    lastVerifiedAt?: string;
  };
  files?: string[];
};
type SuggestionReport = {
  owner: string;
  name: string;
  ref: string;
  title: string;
  summary: string;
  version?: string;
  contentType: "harness" | "directory";
  command: string;
  openUrl?: string;
  trust: {
    eval: string;
    risk: string;
    security: string;
    context: string;
    standard: string;
    payment: string;
    compatibility: string[];
    lastVerifiedAt?: string;
  };
};
type CandidateSummary = {
  rank: number;
  owner: string;
  name: string;
  ref: string;
  title: string;
  summary: string;
  contentType: "harness" | "directory";
  command: string;
  openUrl?: string;
  trust: {
    eval: string;
    risk: string;
    context: string;
    payment: string;
  };
};
type PullHarnessResult = {
  owner: string;
  name: string;
  version: string;
  out: string;
  files: number;
  skipped: number;
};
type SourceMetadata = {
  owner: string;
  name: string;
  version: string;
  registry: string;
  pulledAt: string;
  files?: string[];
};
type PinMetadata = {
  owner: string;
  name: string;
  version: string;
  registry: string;
  pinnedAt: string;
  files?: string[];
};
type PaymentRequiredBody = {
  error?: string;
  code?: string;
  checkout_url?: string;
  payments_enabled?: boolean;
  next?: string;
  pricing?: {
    model?: string;
    amount_usd?: number;
    currency?: string;
  };
  x402?: {
    enabled?: boolean;
    requirements?: PaymentRequirements[];
    paymentRequired?: PaymentRequired;
  };
};
type DirectoryLinkOnlyBody = {
  error?: string;
  code?: "DIRECTORY_LINK_ONLY";
  url?: string;
  next?: string;
};
type HostedExecutionUnavailableBody = {
  error?: string;
  code?: "HOSTED_EXECUTION_NOT_AVAILABLE";
  next?: string;
};
type ContextCost = {
  approxTokens: number;
  files: number;
  bytes: number;
  status: "estimated";
};
type SetupSkillAudit = {
  scope: "home" | "project";
  name: string;
  relativePath: string;
  description: string;
  approxTokens: number;
  markdownFiles: number;
  modifiedAt: string;
  ageDays: number;
  terms: string[];
};
type SetupConflict = {
  left: Pick<SetupSkillAudit, "scope" | "name" | "relativePath">;
  right: Pick<SetupSkillAudit, "scope" | "name" | "relativePath">;
  similarity: number;
  sharedTerms: string[];
};
type SetupAudit = {
  summary: {
    roots: number;
    existingRoots: number;
    skills: number;
    markdownFiles: number;
    approxTokens: number;
    staleSkills: number;
    conflicts: number;
  };
  roots: Array<{ scope: "home" | "project"; exists: boolean; skills: number; markdownFiles: number; approxTokens: number }>;
  skills: Omit<SetupSkillAudit, "terms">[];
  conflicts: SetupConflict[];
  stale: Omit<SetupSkillAudit, "terms" | "description" | "approxTokens" | "markdownFiles">[];
  recommendations: string[];
  shareCard: string;
};
type ExtractDependency = {
  ref: string;
  version?: string;
  optional: boolean;
  reason: string;
};
type ExtractedSkill = {
  name: string;
  title: string;
  out: string;
  source: string;
  markdownFiles: number;
  depends_on: ExtractDependency[];
};
type OrgBundlePayload = {
  organization?: {
    slug: string;
    name: string;
    plan: string;
  };
  bundle?: {
    version: string;
    harnesses: Array<{ owner: string; name: string; version?: string; target?: string }>;
    configs?: Array<{ path: string; content: string }>;
  };
};
type OrgSetupMetadata = {
  organization?: { slug?: string };
  bundleVersion?: string;
};
type OrgImportResult = {
  title: string;
  name: string;
  owner: string;
  snapshotVersion?: string;
  verified?: boolean;
  gate?: PublishGateResult;
};
type ResourcePackageImportResult = {
  resource?: ResourceItem;
  archive?: {
    url?: string;
    fileName?: string;
  };
  hosted?: boolean;
  verified?: boolean;
  next?: string;
};
type PublishGateResult = {
  score: number;
  risk: number;
  cost: number;
  failures: string[];
};
type PublishFilePayload = {
  path: string;
  content: string;
  truncated: false;
};
type PublishEvalResult = {
  status?: string;
  verified?: boolean;
  score?: number;
  cost_usd?: number;
};
type MaterializedPublishSource = {
  path: string;
  cloned: boolean;
  autoEval: boolean;
  cleanup: () => void;
};
type MaterializedResourcePackageSource = {
  path: string;
  cloned: boolean;
  sourceUrl?: string;
  cleanup: () => void;
};
type SyncCandidate = {
  path: string;
  name: string;
  bytes: number;
  markdown: string;
};
type SyncSkipped = {
  path: string;
  reason: string;
};
type SyncReport = {
  org: string;
  source: string;
  cloned: boolean;
  dryRun: boolean;
  imported: Array<{ path: string; name: string; owner: string; title: string; snapshotVersion?: string }>;
  skipped: SyncSkipped[];
};
type BenchmarkRole = "candidate" | "analog";
type BenchmarkSuiteEntry = {
  name?: string;
  label?: string;
  path?: string;
  role?: BenchmarkRole;
  notes?: string;
};
type BenchmarkSuiteFile = {
  category?: string;
  title?: string;
  description?: string;
  min_score?: number;
  harnesses?: BenchmarkSuiteEntry[];
  candidates?: BenchmarkSuiteEntry[];
  analogs?: BenchmarkSuiteEntry[];
};
type BenchmarkRow = {
  rank: number;
  role: BenchmarkRole;
  name: string;
  label: string;
  path: string;
  valid: boolean;
  score: number;
  status: string;
  verified: boolean;
  verificationStatus: string;
  riskScore: number;
  riskTier: string;
  costUsd: number;
  cases: number;
  aboveMinScore: boolean;
  notes?: string;
  errors: string[];
};
type BenchmarkResult = {
  runner: "harnesshub-category-benchmark";
  suite: string;
  category: string;
  title: string;
  description?: string;
  minScore: number;
  status: "passed" | "failed" | "unverified";
  verificationStatus: string;
  generatedAt: string;
  summary: {
    harnesses: number;
    candidates: number;
    analogs: number;
    verified: number;
    invalid: number;
    topCandidate?: Pick<BenchmarkRow, "name" | "label" | "score" | "riskScore">;
    topAnalog?: Pick<BenchmarkRow, "name" | "label" | "score" | "riskScore">;
    candidateDeltaVsAnalog?: number;
  };
  rows: BenchmarkRow[];
  notes: string[];
};
type AdaptTarget = "claude-code" | "codex" | "cursor";
type InstallTarget = "cli" | AdaptTarget;
type McpConfigTarget = "claude-desktop" | "claude-code" | "cursor";
type AdapterResult = {
  target: AdaptTarget;
  harness: string;
  root: string;
  out: string;
  files: string[];
  next: string[];
};
type InstallResult = PullHarnessResult & {
  target: InstallTarget;
  adapter?: AdapterResult;
  next: string[];
};
type GateReceiptPayload = {
  harness: string;
  version: string;
  resultsHash: string;
  verdict: "passed" | "failed";
  at: string;
  gate: {
    score: number;
    risk: number;
    cost: number;
    failures: string[];
  };
};
type GateReceipt = {
  type: "onlyharness.gate_receipt.v1";
  algorithm: "ed25519";
  payload: GateReceiptPayload;
  publicKey: string;
  signature: string;
};
type McpConfigResult = {
  target: McpConfigTarget;
  harness: string;
  root: string;
  out?: string;
  servers: Array<{ id: string; package: string; required: boolean }>;
  config: {
    mcpServers: Record<string, { command: string; args: string[] }>;
  };
};

export const EXIT = {
  OK: 0,
  GENERAL: 1,
  AUTH: 2,
  VALIDATION: 3,
  NOT_FOUND: 4,
  PAYMENT: 5
} as const;

type ExitCode = typeof EXIT[keyof typeof EXIT];

export function failMessage(message: string, next?: string): string {
  return next ? `${message}\nNext: ${next}` : message;
}

function fail(message: string, code: ExitCode, next?: string, json = false): never {
  const output = json
    ? JSON.stringify({ error: message, code, next: next ?? null }, null, 2)
    : failMessage(message, next);
  process.stderr.write(`${output}\n`);
  process.exit(code);
}

const program = new Command();

program
  .name("hh")
  .description("OnlyHarness CLI — find, inspect, install and publish reusable AI-agent resources (onlyharness.com)")
  .version("0.2.3");
program.enablePositionalOptions();

program.command("search")
  .description("search the OnlyHarness registry")
  .argument("<query...>", "search terms")
  .option("--json", "print JSON", false)
  .option("--limit <n>", "max results", "10")
  .action(async (queryParts: string[], options) => {
    const query = queryParts.join(" ");
    const data = await fetchJson(`${registryUrl}/registry?q=${encodeURIComponent(query)}&sort=trending`, { json: options.json }) as { items?: SearchItem[] };
    const items = (data.items ?? []).slice(0, Number(options.limit) || 10);
    if (options.json) return writeStdout(items);
    if (!items.length) return writeStdout("No harnesses found on this frontier. Try another word, partner.\n");
    writeStdout(items.map((item) => [
      `${item.owner}/${item.name} — ${item.title}`,
      `  ${item.summary}`,
      `  job ${item.job ?? item.outcome ?? "unknown"} · ★ ${item.stars} · ⑂ ${item.forks} · 💬 ${item.threads} · eval ${item.evalScore} · context ${contextCostLabel(item.contextCost)} · ${heatLabel(item)} · ${item.tags.map((tag) => `#${tag}`).join(" ")}`,
      `  ${item.cliCommand ?? (item.contentType === "directory" && item.directory?.url ? `open ${item.directory.url}` : `hh install ${item.owner}/${item.name}`)}`
    ].join("\n")).join("\n\n") + "\n");
  });

const resourcesCommand = program.command("resources")
  .description("search and open the mixed agent resource catalog");

resourcesCommand.command("search")
  .description("search skills, plugins, workflows, MCP servers, guides, directories and harnesses")
  .argument("[query...]", "search terms", [])
  .option("--json", "print JSON", false)
  .option("--limit <n>", "max results", "10")
  .option("--type <type>", "resource type filter")
  .option("--works-with <target>", "compatibility filter: claude-code|codex|cursor|mcp|cli|github")
  .option("--source <source>", "source platform filter")
  .option("--installability <status>", "open_only|importable|installable|verified")
  .option("--sort <sort>", "popular|github-stars|new|source-checked|onlyharness", "popular")
  .action(async (queryParts: string[], options) => {
    const params = new URLSearchParams();
    const query = queryParts.join(" ").trim();
    if (query) params.set("q", query);
    params.set("limit", String(boundedPositiveInt(options.limit, 10, 50)));
    params.set("sort", options.sort);
    if (options.type) params.set("type", options.type);
    if (options.worksWith) params.set("worksWith", options.worksWith);
    if (options.source) params.set("source", options.source);
    if (options.installability) params.set("installability", options.installability);
    const data = await fetchJson(`${registryUrl}/resources?${params.toString()}`, { json: options.json }) as ResourceSearchPayload;
    const items = data.resources ?? data.items ?? [];
    if (options.json) return writeStdout({ resources: items, counts: data.counts });
    if (!items.length) return writeStdout("No resources found. Try another query or remove filters.\n");
    writeStdout(items.map(resourceLine).join("\n\n") + "\n");
  });

resourcesCommand.command("detail")
  .description("show resource detail")
  .argument("<id>", "resource id, e.g. github:obra/superpowers")
  .option("--json", "print JSON", false)
  .action(async (id: string, options) => {
    const resource = await fetchResourceDetail(id, options.json);
    if (options.json) return writeStdout(resource);
    writeStdout(resourceDetailText(resource));
  });

resourcesCommand.command("open")
  .description("open a resource URL")
  .argument("<id>", "resource id, e.g. github:obra/superpowers")
  .option("--json", "print JSON", false)
  .action(async (id: string, options) => {
    const resource = await fetchResourceDetail(id, options.json);
    const url = preferredResourceUrl(resource);
    const opened = openUrl(url);
    if (options.json) return writeStdout({ id: resource.id, url, opened });
    writeStdout(opened ? `Opened ${url}\n` : `${url}\n`);
  });

resourcesCommand.command("import")
  .description("classify a GitHub resource before adding it to an OnlyHarness listing")
  .argument("<github-url>", "GitHub repository URL")
  .option("--path <path>", "optional path inside the repository")
  .option("--json", "print JSON", false)
  .action(async (url: string, options) => {
    const response = await fetchRegistryResponse(`${registryUrl}/imports/github-resource`, options.json, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, path: options.path, action: "classify" })
    });
    const data = await readResponseJson(response, `${registryUrl}/imports/github-resource`, options.json);
    if (!response.ok) fail(`GitHub resource import failed (${response.status})`, response.status === 404 ? EXIT.NOT_FOUND : EXIT.VALIDATION, undefined, options.json);
    writeStdout(options.json ? data : githubImportText(data as GitHubImportResult));
  });

resourcesCommand.command("convert")
  .description("deprecated: resources are listed by type; harness-format conversion is not the default path")
  .argument("<id>", "resource id")
  .option("--out <dir>", "output directory")
  .option("--json", "print JSON", false)
  .action((id: string, options) => {
    fail(
      `OnlyHarness does not convert ${id} into harness format by default.`,
      EXIT.VALIDATION,
      "Use hh resources open/detail/import. Package as a harness only when you explicitly need harness-format files.",
      options.json
    );
  });

program.command("suggest")
  .description("select a trusted harness for a task and optionally install it")
  .argument("<query...>", "task or job, e.g. market research")
  .option("--json", "print JSON", false)
  .option("--limit <n>", "candidate count", "5")
  .option("--pick <n>", "1-based candidate to inspect/apply", "1")
  .option("--apply", "install the selected harness into --out or ./<name>", false)
  .option("--target <target>", "when --apply is used, install adapter target cli|claude-code|codex|cursor")
  .option("--out <dir>", "output directory when --apply is used")
  .option("--adapter-out <dir>", "output directory for generated adapter files when --target is used")
  .option("--force", "write into a non-empty output directory when --apply is used", false)
  .option("--token <token>", "access token (defaults to HH_TOKEN/HH_ORG_TOKEN)")
  .option("--pay", "pay x402-enabled 402 archive responses when --apply is used", false)
  .action(async (queryParts: string[], options) => {
    const query = queryParts.join(" ").trim();
    if (!query) fail("Expected a search query.", EXIT.VALIDATION, "hh suggest market research", options.json);
    const applyTarget = options.target ? cleanInstallTarget(options.target) : undefined;
    if (options.target && !applyTarget) fail("Unsupported apply target.", EXIT.VALIDATION, "Use --target cli, claude-code, codex, or cursor.", options.json);
    if (!options.apply && (options.target || options.adapterOut)) {
      fail("--target and --adapter-out require --apply.", EXIT.VALIDATION, `hh suggest ${query} --apply --target codex`, options.json);
    }
    const limit = boundedPositiveInt(options.limit, 5, 25);
    const pick = positiveInt(options.pick, 1);
    const data = await fetchJson(`${registryUrl}/registry?q=${encodeURIComponent(query)}&sort=trending`, { json: options.json }) as { items?: SearchItem[] };
    const candidates = (data.items ?? []).slice(0, limit);
    if (!candidates.length) fail(`No harnesses found for "${query}".`, EXIT.NOT_FOUND, `hh search ${query}`, options.json);
    if (pick > candidates.length) {
      fail(`Candidate ${pick} is not available; only ${candidates.length} result(s) returned.`, EXIT.VALIDATION, `hh suggest ${query} --pick 1`, options.json);
    }
    const candidateSummaries = candidates.map((candidate, index) => buildCandidateSummary(candidate, index + 1));
    const item = candidates[pick - 1];
    const detail = await fetchHarnessDetail(registryUrl, item.owner, item.name, options.json, options.token);
    const suggestion = buildSuggestionReport(item, detail);
    await recordCliRegistryEvent({
      registry: registryUrl,
      kind: "suggested",
      owner: suggestion.owner,
      repo: suggestion.name,
      version: suggestion.version,
      target: options.apply ? "apply" : "inspect",
      client: "hh"
    });

    let applied: PullHarnessResult | InstallResult | undefined;
    if (options.apply) {
      await recordCliRegistryEvent({
        registry: registryUrl,
        kind: "accepted",
        owner: suggestion.owner,
        repo: suggestion.name,
        version: suggestion.version,
        target: "apply",
        client: "hh"
      });
      if (suggestion.contentType === "directory") {
        fail(
          `Directory ${suggestion.ref} is link-only and cannot be applied as a runnable harness.`,
          EXIT.VALIDATION,
          suggestion.openUrl ? `open ${suggestion.openUrl}` : `hh search ${query}`,
          options.json
        );
      }
      assertSuggestionApplyAllowed(suggestion, detail, options.json);
      applied = applyTarget
        ? await installHarness({
          owner: suggestion.owner,
          name: suggestion.name,
          target: applyTarget,
          out: options.out,
          adapterOut: options.adapterOut,
          force: options.force,
          token: options.token,
          pay: options.pay,
          json: options.json
        })
        : await pullHarnessArchive({
          owner: suggestion.owner,
          name: suggestion.name,
          out: options.out,
          force: options.force,
          token: options.token,
          pay: options.pay,
          json: options.json
        });
      await recordCliRegistryEvent({
        registry: registryUrl,
        kind: "applied",
        owner: applied.owner,
        repo: applied.name,
        version: applied.version,
        target: applyTarget ?? "scoped-install",
        client: "hh"
      });
    }

    if (options.json) {
      writeStdout({
        query,
        selected: pick,
        suggestion,
        candidates: candidateSummaries,
        applied
      });
      return;
    }
    writeStdout(suggestionText(query, pick, suggestion, applied, candidateSummaries));
  });

program.command("pull")
  .description("download a harness from the registry into a local directory")
  .argument("<harness>", "owner/name, e.g. harnesses/deep-market-researcher")
  .option("--version <semver>", "pull an immutable archive version instead of the current manifest")
  .option("--out <dir>", "output directory (default ./<name>)")
  .option("--force", "write into a non-empty directory", false)
  .option("--token <token>", "access token (defaults to HH_TOKEN env)")
  .option("--pay", "pay x402-enabled 402 responses with HH_WALLET_KEY/EVM_PRIVATE_KEY", false)
  .option("--json", "print JSON", false)
  .action(async (harness: string, options) => {
    const { owner, name } = parseHarnessRef(harness, "hh pull harnesses/deep-market-researcher", options.json);
    const result = await pullHarnessArchive({
      owner,
      name,
      version: options.version,
      out: options.out,
      force: options.force,
      token: options.token,
      pay: options.pay,
      json: options.json
    });
    if (options.json) {
      writeStdout(result);
      return;
    }
    writeStdout([
      `Pulled ${result.owner}/${result.name}@${result.version} -> ${result.out} (${result.files} files${result.skipped ? `, ${result.skipped} skipped as too large` : ""})`,
      `Next: hh run ${result.out} · hh eval ${result.out} && hh gate --dir ${result.out}`
    ].join("\n") + "\n");
  });

program.command("install")
  .description("install a harness and optionally generate local adapter files")
  .argument("<harness>", "owner/name, e.g. harnesses/deep-market-researcher")
  .option("--target <target>", "cli|claude-code|codex|cursor", "cli")
  .option("--version <semver>", "install an immutable archive version instead of the current manifest")
  .option("--out <dir>", "output directory for the pulled harness (default ./<name>)")
  .option("--adapter-out <dir>", "output directory for generated adapter files")
  .option("--force", "write into non-empty output directories and overwrite generated adapter files", false)
  .option("--token <token>", "access token (defaults to HH_TOKEN env)")
  .option("--pay", "pay x402-enabled 402 responses with HH_WALLET_KEY/EVM_PRIVATE_KEY", false)
  .option("--json", "print JSON", false)
  .action(async (harness: string, options) => {
    const target = cleanInstallTarget(options.target);
    if (!target) fail("Unsupported install target.", EXIT.VALIDATION, "Use --target cli, claude-code, codex, or cursor.", options.json);
    const { owner, name } = parseHarnessRef(harness, "hh install harnesses/deep-market-researcher --target codex", options.json);
    const result = await installHarness({
      owner,
      name,
      target,
      version: options.version,
      out: options.out,
      adapterOut: options.adapterOut,
      force: options.force,
      token: options.token,
      pay: options.pay,
      json: options.json
    });
    writeStdout(options.json ? result : installText(result));
  });

program.command("setup")
  .description("install a team/org bundle into a local workspace")
  .argument("<org>", "org slug, e.g. @acme")
  .option("--out <dir>", "output directory (default ./.harnesshub/orgs/<org>)")
  .option("--token <token>", "org token (defaults to HH_ORG_TOKEN)")
  .option("--force", "write into a non-empty output directory", false)
  .option("--dry-run", "fetch and summarize without writing files", false)
  .option("--json", "print JSON", false)
  .action(async (org: string, options) => {
    const result = await setupOrgBundle({
      org,
      out: options.out,
      token: options.token ?? process.env.HH_ORG_TOKEN,
      force: options.force,
      dryRun: options.dryRun,
      json: options.json
    });
    if (options.dryRun) {
      writeStdout(options.json ? result : `Would install ${result.organization.slug}@${result.bundleVersion}: ${result.harnesses.length} harnesses, ${result.configs.length} configs\n`);
      return;
    }
    writeStdout(options.json ? result : `Installed ${result.organization.slug}@${result.bundleVersion} -> ${result.out}\n`);
  });

program.command("sync")
  .description("sync markdown skills and workflows from a git repo into an org namespace")
  .argument("<git-url>", "git URL or local repository path")
  .requiredOption("--org <slug>", "organization slug")
  .option("--org-token <token>", "org publish token (defaults to HH_ORG_TOKEN)")
  .option("--max-files <n>", "maximum markdown files to import", "50")
  .option("--dry-run", "scan and summarize without importing", false)
  .option("--json", "print JSON", false)
  .action(async (source: string, options) => {
    const orgSlug = cleanSetupOrg(options.org);
    if (!orgSlug) fail("Invalid org slug.", EXIT.VALIDATION, "hh sync <git-url> --org acme --org-token <token>", options.json);
    const token = options.orgToken ?? process.env.HH_ORG_TOKEN;
    if (!token) fail("Org token required.", EXIT.AUTH, "Set HH_ORG_TOKEN or pass --org-token <token>", options.json);
    const maxFiles = Number(options.maxFiles);
    const report = await syncOrgRepo({
      source,
      org: orgSlug,
      token,
      maxFiles: Number.isFinite(maxFiles) && maxFiles > 0 ? Math.floor(maxFiles) : 50,
      dryRun: options.dryRun,
      json: options.json
    });
    if (options.json) {
      writeStdout(report);
      return;
    }
    writeStdout(syncReportText(report));
  });

program.command("run")
  .description("preview the bundled example locally (sample mode: no LLM calls, no credentials, no gate claim)")
  .argument("[dir]", "harness directory", ".")
  .option("--input <file>", "input file", "examples/input.md")
  .option("--json", "print JSON", false)
  .action((dir, options) => {
    const root = path.resolve(dir);
    const validation = validateHarnessDir(root);
    if (!validation.manifest) {
      fail("Not a harness directory: harness.yaml is missing or invalid.", EXIT.NOT_FOUND, "hh install <owner>/<name>", options.json);
    }
    const inputPath = path.resolve(root, options.input);
    const expectedPath = path.join(root, "examples/expected.md");
    const result = runLocalEval(root);
    const payload = {
      mode: "sample",
      title: validation.manifest.title,
      input: existsSync(inputPath) ? inputPath : null,
      expected: existsSync(expectedPath) ? expectedPath : null,
      eval: {
        status: result.status,
        score: result.score,
        minScore: validation.manifest.quality_gates.min_score,
        verified: result.verified,
        verificationStatus: result.verification_status
      },
      next: result.status === "passed" ? [] : [`hh eval ${root} --json`, `hh gate --dir ${root} --json`]
    };
    const text = [
      `Running ${validation.manifest.title} — local sample mode (no LLM calls, no credentials)`,
      `Input: ${existsSync(inputPath) ? inputPath : "none bundled"}`,
      `Expected output: ${existsSync(expectedPath) ? expectedPath : "none bundled"}`,
      `Eval preview: ${result.status} · score ${result.score} · ${result.verification_status} (gate needs ≥ ${validation.manifest.quality_gates.min_score})`,
      `Real runtime entrypoint: ${validation.manifest.entrypoint?.command ?? "not declared"}`,
      ...(result.status === "passed" ? [] : [`Next: hh eval ${root} --json && hh gate --dir ${root} --json`])
    ].join("\n") + "\n";
    writeStdout(options.json ? payload : text);
    process.exit(EXIT.OK);
  });

program.command("publish")
  .description("publish markdown or a verified harness directory to the registry")
  .argument("<file-or-dir>", "source markdown file, harness directory, local repo, or git URL")
  .option("--name <name>", "harness slug")
  .option("--path <path>", "harness directory inside a git repo")
  .option("--token <token>", "access token (defaults to HH_TOKEN env)")
  .option("--org <slug>", "publish into an organization namespace")
  .option("--org-token <token>", "org publish token (defaults to HH_ORG_TOKEN)")
  .option("--json", "print JSON", false)
  .action(async (file: string, options) => {
    const orgSlug = options.org ? cleanSetupOrg(options.org) : undefined;
    if (options.org && !orgSlug) fail("Invalid org slug.", EXIT.VALIDATION, "hh publish workflow.md --org acme --org-token <token>", options.json);
    const token = orgSlug ? options.orgToken ?? process.env.HH_ORG_TOKEN : options.token ?? process.env.HH_TOKEN;
    if (orgSlug && !token) fail("Org token required.", EXIT.AUTH, "Set HH_ORG_TOKEN or pass --org-token <token>", options.json);
    const source = materializePublishSource(file, options.path, options.json);
    try {
      const sourceStats = statSync(source.path);
      if (sourceStats.isDirectory()) {
        const name = options.name ? slugify(options.name) : undefined;
        if (options.name && !name) fail("Invalid harness slug.", EXIT.VALIDATION, "Use --name my-harness", options.json);
        const result = await publishHarnessDir({ org: orgSlug, token, name, root: source.path, json: options.json, autoEval: source.autoEval });
        if (options.json) {
          writeStdout({
            title: result.title,
            name: result.name,
            owner: result.owner,
            url: "https://onlyharness.com",
            snapshotVersion: result.snapshotVersion,
            verified: result.verified,
            gate: result.gate,
            source: source.cloned ? "git" : "local"
          });
          return;
        }
        writeStdout(`Published verified ${result.title} — ${result.owner}/${result.name}${result.snapshotVersion ? `@${result.snapshotVersion}` : ""}\n`);
        return;
      }
      if (options.path) fail("--path can only be used with a git repo or directory source.", EXIT.VALIDATION, "hh publish <git-url> --path harnesses/my-harness", options.json);
      const markdown = readFileSync(source.path, "utf8");
      const name = options.name ?? slugify(path.basename(source.path, path.extname(source.path)));
      const result = orgSlug
        ? await publishOrgMarkdown({ org: orgSlug, token, name, markdown, json: options.json, command: "Publish" })
        : await publishPublicMarkdown({ token, name, markdown, json: options.json });
      const title = result.title;
      if (options.json) {
        writeStdout({ title, name: result.name, owner: result.owner, url: orgSlug ? `https://onlyharness.com/@${orgSlug}/${result.name}` : "https://onlyharness.com" });
        return;
      }
      writeStdout(orgSlug ? `Published ${title} to @${orgSlug}\n` : `Published ${title} — live on https://onlyharness.com\n`);
    } finally {
      source.cleanup();
    }
  });

program.command("publish-resource")
  .description("publish a hosted agent resource package without native harness eval/gate")
  .argument("<dir-or-git-url>", "local directory, local repo, or git URL to package")
  .option("--name <name>", "resource slug")
  .option("--title <title>", "display title")
  .option("--summary <summary>", "short summary")
  .option("--type <type>", "resource type: skill, plugin, workflow, mcp_server, command_pack, config, guide, framework, agent_runtime, subagent_pack, agent_team, service_endpoint, harness")
  .option("--path <path>", "subdirectory inside a git repo or local directory")
  .option("--source-url <url>", "public upstream/source URL for attribution")
  .option("--token <token>", "access token (defaults to HH_TOKEN env)")
  .option("--json", "print JSON", false)
  .action(async (sourceArg: string, options) => {
    const token = options.token ?? process.env.HH_TOKEN;
    const source = materializeResourcePackageSource(sourceArg, options.path, options.json);
    try {
      const files = collectResourcePackageFiles(source.path, options.json);
      const name = options.name ? slugify(options.name) : undefined;
      if (options.name && !name) fail("Invalid resource slug.", EXIT.VALIDATION, "Use --name my-agent-resource", options.json);
      const result = await publishResourcePackage({
        token,
        name,
        title: options.title,
        summary: options.summary,
        resourceType: options.type,
        sourceUrl: options.sourceUrl ?? source.sourceUrl,
        files,
        json: options.json
      });
      if (options.json) {
        writeStdout({
          id: result.resource?.id,
          title: result.resource?.title,
          name: result.resource?.upstreamRepo ?? name,
          resourceType: result.resource?.resourceType,
          archiveUrl: result.archive?.url,
          hosted: result.hosted === true,
          verified: result.verified === true,
          source: source.cloned ? "git" : "local",
          next: result.next
        });
        return;
      }
      writeStdout(`Published resource package ${result.resource?.title ?? options.title ?? name ?? path.basename(source.path)} — ${result.archive?.url ?? "archive unavailable"}\n`);
      if (result.next) writeStdout(`${result.next}\n`);
    } finally {
      source.cleanup();
    }
  });

program.command("adapt")
  .description("generate local adapter files for an installed harness")
  .argument("[dir]", "harness directory", ".")
  .requiredOption("--target <target>", "claude-code|codex|cursor")
  .option("--out <dir>", "output directory (default target-specific path)")
  .option("--force", "overwrite existing generated files", false)
  .option("--json", "print JSON", false)
  .action((dir: string, options) => {
    const target = cleanAdaptTarget(options.target);
    if (!target) fail("Unsupported adapter target.", EXIT.VALIDATION, "Use --target claude-code, codex, or cursor.", options.json);
    const result = adaptHarness({
      root: path.resolve(dir),
      target,
      out: options.out,
      force: options.force,
      json: options.json
    });
    writeStdout(options.json ? result : adapterText(result));
  });

program.command("mcp-config")
  .description("generate MCP client config from a harness manifest")
  .argument("[dir]", "harness directory", ".")
  .option("--target <target>", "claude-desktop|claude-code|cursor", "claude-desktop")
  .option("--out <path>", "write JSON config to a file")
  .option("--json", "print JSON payload", false)
  .action((dir: string, options) => {
    const target = cleanMcpConfigTarget(options.target);
    if (!target) fail("Unsupported MCP config target.", EXIT.VALIDATION, "Use --target claude-desktop, claude-code, or cursor.", options.json);
    const result = mcpConfigForHarness({
      root: path.resolve(dir),
      target,
      out: options.out,
      json: options.json
    });
    if (options.json) writeStdout(result);
    else writeStdout(options.out ? `Wrote ${result.out}\n` : `${JSON.stringify(result.config, null, 2)}\n`);
  });

program.command("doctor")
  .description("check registry connectivity and local setup")
  .option("--harness [dir]", "also inspect a harness directory (default .)")
  .option("--json", "print JSON", false)
  .action(async (options) => {
    let registryOk = false;
    let indexed: number | string = "-";
    try {
      const health = await fetchJson(`${registryUrl}/healthz`, { json: options.json }) as { ok?: boolean };
      registryOk = Boolean(health.ok);
      const registry = await fetchJson(`${registryUrl}/registry`, { json: options.json }) as { items?: unknown[] };
      indexed = (registry.items ?? []).length;
    } catch {
      registryOk = false;
    }
    const payload = {
      registry: registryUrl,
      ok: registryOk,
      indexed,
      node: process.version,
      tokenSet: Boolean(process.env.HH_TOKEN),
      harness: harnessDoctorPayload(options.harness)
    };
    if (!registryOk) {
      fail(`Registry unreachable: ${registryUrl}`, EXIT.GENERAL, `check HH_REGISTRY_URL (current: ${registryUrl})`, options.json);
    }
    if (options.json) {
      writeStdout(payload);
      process.exit(payload.harness && !payload.harness.valid ? EXIT.VALIDATION : EXIT.OK);
    }
    const lines = [
      "OnlyHarness doctor",
      `  registry .......... ${registryUrl} ${registryOk ? "[OK]" : "[UNREACHABLE]"}`,
      `  harnesses indexed . ${indexed}`,
      `  node .............. ${process.version}`,
      `  token ............. ${process.env.HH_TOKEN ? "HH_TOKEN set" : "not set (only needed for hh publish / publish-resource)"}`
    ];
    if (payload.harness) {
      lines.push(
        `  harness ........... ${payload.harness.valid ? `${payload.harness.name}@${payload.harness.version} [OK]` : "[INVALID]"}`,
        `  source ............ ${payload.harness.source ? `${payload.harness.source.owner}/${payload.harness.source.name}@${payload.harness.source.version}` : "not pulled from registry"}`
      );
    }
    writeStdout(lines.join("\n") + "\n");
    process.exit(payload.harness && !payload.harness.valid ? EXIT.VALIDATION : EXIT.OK);
  });

program.command("audit-setup")
  .description("audit local Claude skills for context cost, stale triggers and overlapping descriptions")
  .option("--home-dir <dir>", "home directory to scan (default: current OS home)")
  .option("--project-dir <dir>", "project directory to scan (default: current working directory)")
  .option("--stale-days <n>", "mark skills stale after this many days", "90")
  .option("--json", "print JSON", false)
  .option("--out <path>", "write report to a file")
  .action((options) => {
    const staleDays = Math.max(1, Number(options.staleDays) || 90);
    const audit = auditClaudeSetup({
      homeDir: path.resolve(options.homeDir ?? os.homedir()),
      projectDir: path.resolve(options.projectDir ?? process.cwd()),
      staleDays
    });
    const output = options.json ? `${JSON.stringify(audit, null, 2)}\n` : setupAuditText(audit);
    if (options.out) {
      writeOutput(output, options.out);
      writeStdout(options.json ? { out: path.resolve(options.out), summary: audit.summary } : `Wrote ${path.resolve(options.out)}\n`);
      return;
    }
    writeStdout(output);
  });

program.command("benchmark")
  .description("run a local category benchmark suite across candidate and analog harnesses")
  .argument("<suite>", "benchmark suite YAML")
  .option("--json", "print JSON", false)
  .option("--out <path>", "write report to a file")
  .action((suite: string, options) => {
    const result = runBenchmarkSuite(path.resolve(suite), options.json);
    const output = options.json ? `${JSON.stringify(result, null, 2)}\n` : benchmarkText(result);
    writeOutput(output, options.out);
    process.exit(result.status === "passed" ? EXIT.OK : EXIT.VALIDATION);
  });

program.command("pin")
  .description("pin a pulled harness to its current registry version")
  .argument("[dir]", "harness directory", ".")
  .option("--owner <owner>", "registry owner when source metadata is missing")
  .option("--version <version>", "version to pin (defaults to source or manifest version)")
  .option("--json", "print JSON", false)
  .action((dir, options) => {
    const root = path.resolve(dir);
    const source = readSourceMetadata(root);
    const validation = validateHarnessDir(root);
    if (!validation.manifest) {
      fail("Cannot pin: harness.yaml is missing or invalid.", EXIT.NOT_FOUND, "hh install <owner>/<name>", options.json);
    }
    const owner = options.owner ?? source?.owner;
    if (!owner) {
      fail("Cannot pin: registry owner is unknown.", EXIT.VALIDATION, "hh pin --owner <owner>", options.json);
    }
    const pin: PinMetadata = {
      owner,
      name: validation.manifest.name,
      version: options.version ?? source?.version ?? validation.manifest.version,
      registry: source?.registry ?? registryUrl,
      pinnedAt: new Date().toISOString(),
      files: source?.files
    };
    writeJsonFile(path.join(root, ".harnesshub/pin.json"), pin);
    writeStdout(options.json ? pin : `Pinned ${pin.owner}/${pin.name}@${pin.version}\n`);
  });

program.command("outdated")
  .description("check whether a pulled harness has a newer registry version")
  .argument("[dir]", "harness directory", ".")
  .option("--json", "print JSON", false)
  .action(async (dir, options) => {
    const root = path.resolve(dir);
    const ref = resolveRemoteRef(root, options.json);
    const latest = await fetchHarnessManifest(ref.registry, ref.owner, ref.name, options.json);
    const current = ref.version;
    const latestVersion = latest.version;
    const payload = {
      owner: ref.owner,
      name: ref.name,
      current,
      latest: latestVersion,
      outdated: compareVersions(current, latestVersion) < 0
    };
    if (options.json) {
      writeStdout(payload);
      process.exit(payload.outdated ? EXIT.VALIDATION : EXIT.OK);
    }
    writeStdout(payload.outdated
      ? `${ref.owner}/${ref.name} is outdated: ${current} -> ${latestVersion}\nNext: hh update ${root} --diff\n`
      : `${ref.owner}/${ref.name} is up to date at ${current}\n`);
    process.exit(payload.outdated ? EXIT.VALIDATION : EXIT.OK);
  });

program.command("update")
  .description("preview or apply the latest registry archive for a pulled harness")
  .argument("[dir]", "harness directory", ".")
  .option("--diff", "show semantic diff without writing files", false)
  .option("--force", "apply update to the existing directory", false)
  .option("--format <format>", "json|markdown|text", "text")
  .option("--json", "print JSON status", false)
  .action(async (dir, options) => {
    const root = path.resolve(dir);
    const ref = resolveRemoteRef(root, options.json);
    const latest = await fetchHarnessManifest(ref.registry, ref.owner, ref.name, options.json);
    if (compareVersions(ref.version, latest.version) === 0) {
      const payload = { owner: ref.owner, name: ref.name, current: ref.version, latest: latest.version, changed: false };
      writeStdout(options.json ? payload : `${ref.owner}/${ref.name} is already at ${ref.version}\n`);
      return;
    }
    const archive = await fetchArchive(ref.registry, ref.owner, ref.name, latest.version, options.json);
    const tmp = mkdtempSync(path.join(os.tmpdir(), "hh-update-"));
    try {
      writeArchiveFiles(tmp, archive.files ?? []);
      const diff = diffHarnessDirs(root, tmp);
      if (options.diff) {
        writeStdout(options.json ? { owner: ref.owner, name: ref.name, current: ref.version, latest: latest.version, diff } : formatDiff(diff, options.format));
        return;
      }
      if (!options.force) {
        fail("Refusing to overwrite harness files without --force.", EXIT.VALIDATION, `hh update ${root} --diff`, options.json);
      }
      removeManagedFiles(root, ref.files);
      const { written, skipped, paths } = writeArchiveFiles(root, archive.files ?? []);
      writeSourceMetadata(root, { owner: ref.owner, name: ref.name, version: latest.version, registry: ref.registry, pulledAt: new Date().toISOString(), files: paths });
      const pin = readPinMetadata(root);
      if (pin) writeJsonFile(path.join(root, ".harnesshub/pin.json"), { ...pin, version: latest.version, pinnedAt: new Date().toISOString() });
      writeStdout(options.json
        ? { owner: ref.owner, name: ref.name, previous: ref.version, version: latest.version, written, skipped }
        : `Updated ${ref.owner}/${ref.name}: ${ref.version} -> ${latest.version} (${written} files${skipped ? `, ${skipped} skipped` : ""})\n`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

program.command("validate")
  .argument("[dir]", "harness directory", ".")
  .option("--strict", "fail on warnings too", false)
  .option("--json", "print JSON", false)
  .action((dir, options) => {
    const result = validateHarnessDir(path.resolve(dir));
    writeStdout(options.json ? result : validationText(result));
    const failed = !result.valid || (options.strict && result.issues.length > 0);
    process.exit(failed ? EXIT.VALIDATION : EXIT.OK);
  });

program.command("inspect")
  .argument("[dir]", "harness directory", ".")
  .option("--json", "print JSON", false)
  .action((dir, options) => {
    const root = path.resolve(dir);
    const result = inspectHarness(root);
    const payload = { ...result, contextCost: estimateContextCost(root) };
    writeStdout(options.json ? payload : inspectText(payload));
    process.exit(result.valid ? EXIT.OK : EXIT.VALIDATION);
  });

program.command("risk")
  .argument("[dir]", "harness directory", ".")
  .option("--format <format>", "json|markdown|text", "text")
  .option("--out <path>", "write output file")
  .action((dir, options) => {
    const validation = validateHarnessDir(path.resolve(dir));
    const output = formatRisk(validation.risk, options.format);
    writeOutput(output, options.out);
    process.exit(validation.risk.blocking.length ? EXIT.VALIDATION : EXIT.OK);
  });

program.command("diff")
  .argument("[range]", "git range such as main...HEAD")
  .option("--base-dir <path>", "base harness directory")
  .option("--head-dir <path>", "head harness directory", ".")
  .option("--format <format>", "json|markdown|text", "text")
  .option("--out <path>", "write output file")
  .action((range, options) => {
    const { baseDir, headDir, cleanup } = resolveDiffDirs(range, options.baseDir, options.headDir);
    try {
      const diff = diffHarnessDirs(baseDir, headDir);
      const output = formatDiff(diff, options.format);
      writeOutput(output, options.out);
      process.exit(diff.status === "failed" ? EXIT.VALIDATION : EXIT.OK);
    } finally {
      cleanup();
    }
  });

program.command("eval")
  .argument("[dir]", "harness directory", ".")
  .option("--ci", "CI mode", false)
  .option("--json", "print result JSON", false)
  .action(async (dir, options) => {
    const root = path.resolve(dir);
    const result = runLocalEval(root);
    mkdirSync(path.join(root, ".harnesshub"), { recursive: true });
    writeFileSync(path.join(root, ".harnesshub/results.json"), JSON.stringify(result, null, 2));
    writeFileSync(path.join(root, ".harnesshub/report.html"), htmlReport(result));
    writeFileSync(path.join(root, ".harnesshub/results.junit.xml"), junitReport(result));
    if (result.status === "passed") await recordCliVerificationEvent(root, "eval");
    writeStdout(options.json ? result : evalText(result));
    process.exit(result.status === "passed" ? EXIT.OK : EXIT.VALIDATION);
  });

program.command("gate")
  .option("--results <path>", "results JSON path", ".harnesshub/results.json")
  .option("--dir <path>", "harness directory", ".")
  .option("--receipt [path]", "write a signed gate receipt (default .harnesshub/gate-receipt.json)")
  .option("--json", "print JSON", false)
  .action(async (options) => {
    const root = path.resolve(options.dir);
    const validation = validateHarnessDir(root);
    if (!validation.manifest) {
      fail("Gate failed: invalid harness manifest", EXIT.VALIDATION, "hh validate --strict", options.json);
    }
    let result: { score?: number; cost_usd?: number };
    let resultsRaw = "";
    try {
      resultsRaw = readFileSync(path.resolve(root, options.results), "utf8");
      result = JSON.parse(resultsRaw);
    } catch {
      fail("Gate failed: results JSON missing or invalid", EXIT.VALIDATION, `hh eval ${root}`, options.json);
    }
    const score = Number(result.score ?? 0);
    const cost = Number(result.cost_usd ?? 0);
    const failures: string[] = [];
    if (score < validation.manifest.quality_gates.min_score) {
      failures.push(`score ${score} below ${validation.manifest.quality_gates.min_score}`);
    }
    if (cost > validation.manifest.quality_gates.max_cost_usd_per_run) {
      failures.push(`cost ${cost} above ${validation.manifest.quality_gates.max_cost_usd_per_run}`);
    }
    if (validation.risk.score > validation.manifest.quality_gates.max_risk_score) {
      failures.push(`risk ${validation.risk.score} above ${validation.manifest.quality_gates.max_risk_score}`);
    }
    failures.push(...validation.risk.blocking);
    const receipt = options.receipt !== undefined
      ? writeGateReceipt({
        root,
        manifest: validation.manifest,
        resultsRaw,
        score,
        risk: validation.risk.score,
        cost,
        failures,
        out: typeof options.receipt === "string" ? options.receipt : undefined
      })
      : undefined;
    const payload = { passed: failures.length === 0, score, risk: validation.risk.score, cost, failures, ...(receipt ? { receipt } : {}) };
    if (failures.length) {
      if (options.json) fail(`Gate failed: ${failures.join("; ")}`, EXIT.VALIDATION, "hh eval && hh gate --dir .", true);
      writeStdout(`Gate failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
      process.exit(EXIT.VALIDATION);
    }
    await recordCliVerificationEvent(root, "gate");
    writeStdout(options.json ? payload : `Gate passed: score ${score}, risk ${validation.risk.score}, cost $${cost}\n`);
  });

program.command("annotate-pr")
  .option("--provider <provider>", "provider", "local")
  .option("--repo <repo>", "owner/repo", "local/local")
  .option("--pr <number>", "PR number", "1")
  .option("--dir <path>", "harness directory", ".")
  .option("--json", "print JSON", false)
  .action((options) => {
    const root = path.resolve(options.dir);
    const riskPath = path.join(root, ".harnesshub/risk.md");
    const diffPath = path.join(root, ".harnesshub/semantic-diff.md");
    const resultPath = path.join(root, ".harnesshub/results.json");
    const parts = [
      `# Harness Review for ${options.repo} PR #${options.pr}`,
      "",
      existsSync(riskPath) ? readFileSync(riskPath, "utf8") : "Risk report missing.",
      existsSync(diffPath) ? readFileSync(diffPath, "utf8") : "Semantic diff missing.",
      existsSync(resultPath) ? `\nEval result:\n\n\`\`\`json\n${readFileSync(resultPath, "utf8")}\n\`\`\`\n` : "Eval result missing."
    ];
    mkdirSync(path.join(root, ".harnesshub"), { recursive: true });
    const out = path.join(root, ".harnesshub/pr-comment.md");
    writeFileSync(out, redact(parts.join("\n\n")));
    writeStdout(options.json ? { path: out, provider: options.provider, repo: options.repo, pr: Number(options.pr) } : `Wrote ${out}\n`);
  });

program.command("extract")
  .description("extract a local Claude skill into a reviewable OnlyHarness harness scaffold")
  .argument("<skill>", "skill name, skill directory, or SKILL.md")
  .option("--out <dir>", "output directory (default ./<slug>)")
  .option("--name <name>", "harness slug")
  .option("--title <title>", "harness title")
  .option("--home-dir <dir>", "home directory to search when skill is a name")
  .option("--project-dir <dir>", "project directory to search when skill is a name")
  .option("--license <license>", "declared license for extracted content", "UNSPECIFIED")
  .option("--force", "write into a non-empty output directory", false)
  .option("--dry-run", "resolve and summarize without writing files", false)
  .option("--json", "print JSON", false)
  .action((skill: string, options) => {
    const result = extractSkillHarness({
      skillQuery: skill,
      out: options.out ? path.resolve(options.out) : undefined,
      name: options.name,
      title: options.title,
      homeDir: path.resolve(options.homeDir ?? os.homedir()),
      projectDir: path.resolve(options.projectDir ?? process.cwd()),
      license: options.license,
      force: options.force,
      dryRun: options.dryRun,
      json: options.json
    });
    if (options.dryRun) {
      writeStdout(options.json ? result : `Would extract ${result.source} -> ${result.out}\n`);
      return;
    }
    writeStdout(options.json ? result : `Extracted ${result.source} -> ${result.out}\nNext: hh validate ${result.out} --strict && hh inspect ${result.out}\n`);
  });

program.command("import-md")
  .argument("<file>", "source markdown file")
  .option("--out <dir>", "output directory")
  .option("--name <name>", "harness slug")
  .option("--json", "print JSON", false)
  .action((file, options) => {
    const sourcePath = path.resolve(file);
    const text = readFileSync(sourcePath, "utf8");
    const name = options.name ?? slugify(path.basename(file, path.extname(file)));
    const out = path.resolve(options.out ?? name);
    createHarnessFromMarkdown(text, out, name, sourcePath);
    writeStdout(options.json ? { name, source: sourcePath, out } : `Imported ${sourcePath} -> ${out}\n`);
  });

program.command("init")
  .option("--name <name>", "harness slug", "new-harness")
  .option("--template <template>", "template name", "basic")
  .option("--out <dir>", "output directory")
  .option("--json", "print JSON", false)
  .action((options) => {
    const out = path.resolve(options.out ?? options.name);
    createHarnessFromMarkdown(`# ${options.name}\n\nDescribe the harness workflow here.`, out, options.name, "generated");
    writeStdout(options.json ? { name: options.name, template: options.template, out } : `Created ${out}\n`);
  });

program.command("pack")
  .argument("[dir]", "harness directory", ".")
  .option("--out <path>", "output tarball path", "dist/harness.tgz")
  .option("--json", "print JSON", false)
  .action((dir, options) => {
    const root = path.resolve(dir);
    const out = path.resolve(options.out);
    mkdirSync(path.dirname(out), { recursive: true });
    const result = spawnSync("tar", ["-czf", out, "-C", root, "."], {
      stdio: options.json ? "pipe" : "inherit",
      encoding: "utf8"
    });
    if (result.status !== 0) {
      fail(`Pack failed: ${result.stderr || result.stdout || "tar exited with an error"}`, EXIT.GENERAL, undefined, options.json);
    }
    writeStdout(options.json ? { out, files: "tar.gz" } : `Packed ${out}\n`);
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit((error as { exitCode?: number }).exitCode ?? EXIT.GENERAL);
});

function resourceLine(resource: ResourceItem): string {
  const githubStars = resource.upstreamPopularity?.githubStarsCurrent ?? resource.upstreamPopularity?.githubStarsSnapshot;
  const stars = githubStars !== undefined ? `GitHub ★ ${compactNumber(githubStars)}` : `OnlyHarness ★ ${resource.onlyHarnessSignals?.stars ?? 0}`;
  const worksWith = resource.worksWith.length ? ` · works with ${resource.worksWith.join(", ")}` : "";
  const command = resource.actions?.find((action) => action.id === "install" && "command" in action)?.command;
  const open = preferredResourceUrl(resource);
  const useLine = command ?? `use in OnlyHarness ${open}`;
  return [
    `${resource.id} — ${resource.title}`,
    `  ${resource.summary}`,
    `  type ${resource.resourceType} · source ${resource.sourcePlatform} · ${stars} · source checked ${resource.sourceCheckedAt}`,
    `  availability ${availabilityLabel(resource)} · license ${resource.licenseStatus}${worksWith}`,
    `  ${useLine}`
  ].join("\n");
}

function resourceDetailText(resource: ResourceItem): string {
  const actions = (resource.actions ?? []).map((action) => {
    if (action.id === "open_onlyharness" && "url" in action) return `- ${action.label || "Use in OnlyHarness"}: ${action.url}`;
    if (action.id === "download_archive" && "url" in action) return `- ${action.label || "Download from OnlyHarness"}: ${action.url}`;
    if (action.id === "open_mirror" && "url" in action) return `- ${action.label || "Use via OnlyHarness"}: ${action.url}`;
    if (action.id === "open_upstream" && "url" in action) return `- ${action.label || "Use upstream"}: ${action.url}`;
    if (action.id === "install" && "command" in action) return `- Install: ${action.command}`;
    if (action.id === "copy_mcp_config" && "command" in action && action.command) return `- Copy MCP config: ${action.command}`;
    if (action.id === "claim") return "- Claim as creator: proof required";
    return `- ${action.label}`;
  });
  return [
    `${resource.id} — ${resource.title}`,
    resource.summary,
    "",
    `Type: ${resource.resourceType}`,
    `Source: ${resource.sourcePlatform} · ${resource.canonicalUrl}`,
    `Popularity: ${resource.upstreamPopularity?.githubStarsCurrent ?? resource.upstreamPopularity?.githubStarsSnapshot ?? 0} GitHub stars · score ${resource.popularityScore ?? 0}`,
    `Trust: source checked ${resource.sourceCheckedAt}; verified install ${resource.trust?.installVerifiedAt ?? "no"}`,
    `Availability: ${availabilityLabel(resource)}`,
    `License: ${resource.licenseStatus}`,
    "Actions:",
    ...(actions.length ? actions : ["- No action available"]),
    ""
  ].join("\n");
}

function availabilityLabel(resource: ResourceItem): string {
  if (resource.actions?.some((action) => action.id === "open_onlyharness")) return "OnlyHarness listing";
  if (resource.installability === "verified") return "verified install";
  if (resource.installability === "installable") return resource.resourceType === "harness" ? "native install" : "installable";
  if (resource.installability === "importable") return "ready to add";
  return "upstream listing";
}

function preferredResourceUrl(resource: ResourceItem): string {
  return resource.actions?.find((action) => action.id === "open_onlyharness" && "url" in action)?.url
    ?? resource.actions?.find((action) => action.id === "open_mirror" && "url" in action)?.url
    ?? resource.actions?.find((action) => action.id === "open_upstream" && "url" in action)?.url
    ?? resource.canonicalUrl;
}

async function fetchResourceDetail(id: string, json = false): Promise<ResourceItem> {
  const url = `${registryUrl}/resources/${encodeURIComponent(id)}`;
  const response = await fetchRegistryResponse(url, json);
  if (response.status === 404) fail(`Resource ${id} not found.`, EXIT.NOT_FOUND, `hh resources search ${id.replace(/^github:/, "").replace("/", " ")}`, json);
  if (!response.ok) fail(`Registry request failed: ${url} -> ${response.status}`, EXIT.GENERAL, undefined, json);
  return readResponseJson(response, url, json) as Promise<ResourceItem>;
}

function openUrl(url: string): boolean {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const result = spawnSync(command, args, { stdio: "ignore" });
  return result.status === 0;
}

function githubImportText(result: GitHubImportResult): string {
  return [
    `Classification: ${result.classification ?? "unknown"}`,
    `License: ${result.licenseStatus ?? "unknown"}`,
    `Recommended action: ${result.recommendedAction ?? "review"}`,
    ...(result.detectedFiles?.length ? ["Detected files:", ...result.detectedFiles.map((file) => `- ${file}`)] : []),
    ...(result.conversionBlocked ? [`Packaging blocked: ${result.conversionBlocked}`] : []),
    ""
  ].join("\n");
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${roundCompact(value / 1_000_000)}m`;
  if (value >= 1_000) return `${roundCompact(value / 1_000)}k`;
  return String(value);
}

function roundCompact(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
}

async function fetchJson(url: string, options: { json?: boolean } = {}): Promise<unknown> {
  const response = await fetchRegistryResponse(url, options.json);
  if (!response.ok) fail(`Registry request failed: ${url} -> ${response.status}`, response.status === 404 ? EXIT.NOT_FOUND : EXIT.GENERAL, undefined, options.json);
  return readResponseJson(response, url, options.json);
}

async function fetchRegistryResponse(url: string, json = false, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    fail(`Registry request failed: ${url}: ${errorMessage(error)}`, EXIT.GENERAL, undefined, json);
  }
}

async function readResponseJson(response: Response, url: string, json = false): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    fail(`Registry returned invalid JSON: ${url}: ${errorMessage(error)}`, EXIT.GENERAL, undefined, json);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function priceLabel(body: PaymentRequiredBody): string {
  const amount = body.pricing?.amount_usd;
  const currency = body.pricing?.currency ?? "USD";
  if (typeof amount === "number" && Number.isFinite(amount)) return `${amount} ${currency}`;
  return body.pricing?.model ?? "";
}

function paymentNext(body: PaymentRequiredBody): string | undefined {
  if (body.payments_enabled === false) return body.next;
  return body.checkout_url ? `Open ${body.checkout_url}, then retry with HH_TOKEN` : body.next;
}

async function retryWithX402Payment(input: {
  url: string;
  init: RequestInit | undefined;
  response: Response;
  body: PaymentRequiredBody;
  json: boolean;
}): Promise<Response> {
  let paymentRequired: PaymentRequired;
  const client = new x402Client();
  const httpClient = new x402HTTPClient(client);
  try {
    paymentRequired = httpClient.getPaymentRequiredResponse(
      (name) => input.response.headers.get(name),
      input.body.x402?.paymentRequired
    );
  } catch {
    fail(
      "Registry did not offer usable x402 payment requirements.",
      EXIT.PAYMENT,
      paymentNext(input.body) ?? "Use checkout/manual entitlement, or retry when X402_ENABLED and X402_PAY_TO are configured server-side.",
      input.json
    );
  }
  if (!input.body.x402?.enabled || !paymentRequired.accepts.length) {
    fail(
      "Registry did not offer x402 payment requirements.",
      EXIT.PAYMENT,
      paymentNext(input.body) ?? "Use checkout/manual entitlement, or retry when x402 is enabled for this registry.",
      input.json
    );
  }
  const maxUsd = maxPayUsd(input.json);
  const amountUsd = x402UsdAmount(input.body, paymentRequired);
  if (amountUsd !== undefined && amountUsd > maxUsd) {
    fail(
      `x402 payment ${formatUsd(amountUsd)} exceeds HH_MAX_PAY_USD ${formatUsd(maxUsd)}.`,
      EXIT.PAYMENT,
      "Raise HH_MAX_PAY_USD only if you intentionally approve this spend.",
      input.json
    );
  }
  const privateKey = walletPrivateKey(input.json);
  const signer = privateKeyToAccount(privateKey);
  registerExactEvmScheme(client, { signer });
  let paymentHeaders: Record<string, string>;
  let paymentPayload: Awaited<ReturnType<x402HTTPClient["createPaymentPayload"]>>;
  try {
    paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
    paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
  } catch (error) {
    fail(
      `x402 payment signing failed: ${errorMessage(error)}`,
      EXIT.PAYMENT,
      "Check HH_WALLET_KEY/EVM_PRIVATE_KEY, wallet balance, allowance, and registry payment requirements.",
      input.json
    );
  }
  const paidResponse = await fetchRegistryResponse(input.url, input.json, {
    ...input.init,
    headers: mergeHeaders(input.init?.headers, paymentHeaders)
  });
  await httpClient.processPaymentResult(paymentPayload, (name) => paidResponse.headers.get(name), paidResponse.status).catch(() => undefined);
  if (paidResponse.status === 402) {
    const body = await readResponseJson(paidResponse, input.url, input.json).catch(() => input.body) as PaymentRequiredBody;
    fail(
      "x402 payment was not accepted by the registry.",
      EXIT.PAYMENT,
      paymentNext(body) ?? "Check wallet balance/allowance or use checkout/manual entitlement.",
      input.json
    );
  }
  return paidResponse;
}

function maxPayUsd(json: boolean): number {
  const value = Number(process.env.HH_MAX_PAY_USD ?? 20);
  if (!Number.isFinite(value) || value <= 0) {
    fail("HH_MAX_PAY_USD must be a positive number.", EXIT.PAYMENT, "Set HH_MAX_PAY_USD=20 or another explicit cap.", json);
  }
  return value;
}

function walletPrivateKey(json: boolean): `0x${string}` {
  const raw = process.env.HH_WALLET_KEY ?? process.env.EVM_PRIVATE_KEY;
  if (!raw) {
    fail(
      "HH_WALLET_KEY or EVM_PRIVATE_KEY is required for x402 payment.",
      EXIT.PAYMENT,
      "Set HH_WALLET_KEY to an EVM private key and HH_MAX_PAY_USD to your spend cap.",
      json
    );
  }
  const normalized = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    fail(
      "HH_WALLET_KEY/EVM_PRIVATE_KEY must be a 32-byte hex private key.",
      EXIT.PAYMENT,
      "Use a dedicated low-balance agent wallet, not a primary wallet.",
      json
    );
  }
  return normalized as `0x${string}`;
}

function x402UsdAmount(body: PaymentRequiredBody, paymentRequired: PaymentRequired): number | undefined {
  const amounts = [
    body.pricing?.currency && body.pricing.currency !== "USD" ? undefined : finiteUsd(body.pricing?.amount_usd),
    ...paymentRequired.accepts.map((requirement) => atomicUsdcToUsd(requirement.amount))
  ].filter((value): value is number => value !== undefined);
  if (!amounts.length) return undefined;
  return Math.max(...amounts);
}

function finiteUsd(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function atomicUsdcToUsd(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const atomic = BigInt(value);
  if (atomic > BigInt(Number.MAX_SAFE_INTEGER)) return Number.POSITIVE_INFINITY;
  return Number(atomic) / 1_000_000;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(value >= 10 ? 2 : 4).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function mergeHeaders(base: HeadersInit | undefined, extra: Record<string, string>): Headers {
  const headers = new Headers(base);
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return headers;
}

function contextCostLabel(cost: { approxTokens?: number; files?: number } | undefined): string {
  if (!cost || typeof cost.approxTokens !== "number" || typeof cost.files !== "number") return "unknown";
  const tokens = cost.approxTokens >= 1000 ? `${(cost.approxTokens / 1000).toFixed(1)}k` : String(cost.approxTokens);
  return `~${tokens}/${cost.files} files`;
}

function heatLabel(item: Pick<SearchItem, "heat" | "heatQualified" | "signalCount">): string {
  if (!item.heatQualified) return `heat collecting signals (${item.signalCount ?? 0})`;
  return `heat ${item.heat}`;
}

function writeArchiveFiles(out: string, files: ArchiveFile[]): { written: number; skipped: number; paths: string[] } {
  mkdirSync(out, { recursive: true });
  let written = 0;
  let skipped = 0;
  const paths: string[] = [];
  for (const file of files) {
    const target = path.resolve(out, file.path);
    if (target !== out && !target.startsWith(out + path.sep)) continue;
    if (file.truncated) {
      skipped += 1;
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.content);
    written += 1;
    paths.push(path.normalize(file.path));
  }
  return { written, skipped, paths };
}

function harnessDoctorPayload(value: string | boolean | undefined) {
  if (value === undefined || value === false) return undefined;
  const root = path.resolve(value === true ? "." : value);
  const result = validateHarnessDir(root);
  const source = readSourceMetadata(root);
  return {
    dir: root,
    valid: result.valid,
    name: result.manifest?.name ?? null,
    version: result.manifest?.version ?? null,
    risk: result.risk.score,
    issues: result.issues.length,
    contextCost: estimateContextCost(root),
    source
  };
}

async function fetchHarnessManifest(registryBase: string, owner: string, name: string, json = false): Promise<{ version: string }> {
  const url = `${registryBase.replace(/\/$/, "")}/repos/${owner}/${name}/harness`;
  const response = await fetchRegistryResponse(url, json);
  if (response.status === 404) fail(`Harness ${owner}/${name} not found.`, EXIT.NOT_FOUND, `hh search ${name.replaceAll("-", " ")}`, json);
  if (!response.ok) fail(`Registry request failed: ${url} -> ${response.status}`, EXIT.GENERAL, undefined, json);
  const data = await readResponseJson(response, url, json) as { manifest?: { version?: string } };
  const version = data.manifest?.version;
  if (!version) fail(`Registry detail for ${owner}/${name} did not include a version.`, EXIT.GENERAL, undefined, json);
  return { version };
}

async function fetchArchive(registryBase: string, owner: string, name: string, version: string | undefined, json = false, tokenOverride?: string): Promise<ArchivePayload> {
  const token = tokenOverride ?? process.env.HH_TOKEN;
  const url = `${registryBase.replace(/\/$/, "")}/repos/${owner}/${name}/archive${version ? `?version=${encodeURIComponent(version)}` : ""}`;
  const response = await fetchRegistryResponse(url, json, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  if (response.status === 404) fail(`Harness ${owner}/${name}${version ? `@${version}` : ""} not found.`, EXIT.NOT_FOUND, `hh outdated`, json);
  if (response.status === 402) {
    const body = await readResponseJson(response, url, json).catch(() => ({})) as PaymentRequiredBody;
    fail(
      `Payment required for ${owner}/${name}${version ? `@${version}` : ""}${priceLabel(body) ? ` (${priceLabel(body)})` : ""}`,
      EXIT.PAYMENT,
      paymentNext(body),
      json
    );
  }
  if (response.status === 409) {
    const body = await readResponseJson(response, url, json).catch(() => ({})) as DirectoryLinkOnlyBody | HostedExecutionUnavailableBody;
    if (body.code === "DIRECTORY_LINK_ONLY") {
      fail(
        `Directory ${owner}/${name}${version ? `@${version}` : ""} is link-only and cannot be pulled as a runnable harness.`,
        EXIT.VALIDATION,
        body.next ?? (body.url ? `open ${body.url}` : `hh search ${name}`),
        json
      );
    }
    if (body.code === "HOSTED_EXECUTION_NOT_AVAILABLE") {
      fail(
        `Hosted execution for ${owner}/${name}${version ? `@${version}` : ""} is not available yet.`,
        EXIT.VALIDATION,
        body.next ?? "Use hh search to choose a file-based harness.",
        json
      );
    }
  }
  if (!response.ok) fail(`Registry request failed: ${url} -> ${response.status}`, EXIT.GENERAL, undefined, json);
  return readResponseJson(response, url, json) as Promise<ArchivePayload>;
}

async function fetchHarnessDetail(registryBase: string, owner: string, name: string, json = false, tokenOverride?: string): Promise<SuggestDetail> {
  const url = `${registryBase.replace(/\/$/, "")}/repos/${owner}/${name}/harness`;
  const token = tokenOverride ?? (owner.startsWith("@") ? process.env.HH_ORG_TOKEN : process.env.HH_TOKEN);
  const response = await fetchRegistryResponse(url, json, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  if (response.status === 404) fail(`Harness ${owner}/${name} not found.`, EXIT.NOT_FOUND, `hh search ${name.replaceAll("-", " ")}`, json);
  if (response.status === 401 || response.status === 403) {
    const body = await readResponseJson(response, url, json).catch(() => ({})) as { error?: string };
    fail(
      `Detail failed (${response.status}): ${body.error ?? "authorization required"}`,
      EXIT.AUTH,
      owner.startsWith("@") ? "Set HH_ORG_TOKEN or pass --token <org-token>." : "Set HH_TOKEN or use a public harness.",
      json
    );
  }
  if (!response.ok) fail(`Registry request failed: ${url} -> ${response.status}`, EXIT.GENERAL, undefined, json);
  return readResponseJson(response, url, json) as Promise<SuggestDetail>;
}

async function pullHarnessArchive(input: {
  owner: string;
  name: string;
  version?: string;
  out?: string;
  force: boolean;
  token?: string;
  pay: boolean;
  json: boolean;
  command?: "pull" | "install";
}): Promise<PullHarnessResult> {
  const ref = `${input.owner}/${input.name}${input.version ? `@${input.version}` : ""}`;
  const archiveUrl = `${registryUrl}/repos/${input.owner}/${input.name}/archive${input.version ? `?version=${encodeURIComponent(input.version)}` : ""}`;
  const token = input.token ?? (input.owner.startsWith("@") ? process.env.HH_ORG_TOKEN : process.env.HH_TOKEN);
  const archiveInit = token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
  let response = await fetchRegistryResponse(archiveUrl, input.json, archiveInit);
  if (response.status === 404) {
    fail(`Harness ${ref} not found.`, EXIT.NOT_FOUND, `hh search ${input.name.replaceAll("-", " ")}`, input.json);
  }
  if (response.status === 401 || response.status === 403) {
    const body = await readResponseJson(response, archiveUrl, input.json).catch(() => ({})) as { error?: string };
    fail(
      `Pull failed (${response.status}): ${body.error ?? "authorization required"}`,
      EXIT.AUTH,
      input.owner.startsWith("@") ? "Set HH_ORG_TOKEN or pass --token <org-token>." : "Log on at https://onlyharness.com, then export HH_TOKEN=<access token> and retry",
      input.json
    );
  }
  if (response.status === 402) {
    const body = await readResponseJson(response, archiveUrl, input.json).catch(() => ({})) as PaymentRequiredBody;
    if (input.pay) {
      response = await retryWithX402Payment({ url: archiveUrl, init: archiveInit, response, body, json: input.json });
    } else {
      const price = priceLabel(body);
      fail(
        `Payment required for ${ref}${price ? ` (${price})` : ""}`,
        EXIT.PAYMENT,
        paymentNext(body),
        input.json
      );
    }
  }
  if (response.status === 409) {
    const body = await readResponseJson(response, archiveUrl, input.json).catch(() => ({})) as DirectoryLinkOnlyBody | HostedExecutionUnavailableBody;
    if (body.code === "DIRECTORY_LINK_ONLY") {
      fail(
        `Directory ${ref} is link-only and cannot be pulled as a runnable harness.`,
        EXIT.VALIDATION,
        body.next ?? (body.url ? `open ${body.url}` : `hh search ${input.name}`),
        input.json
      );
    }
    if (body.code === "HOSTED_EXECUTION_NOT_AVAILABLE") {
      fail(
        `Hosted execution for ${ref} is not available yet.`,
        EXIT.VALIDATION,
        body.next ?? "Use hh search to choose a file-based harness.",
        input.json
      );
    }
  }
  if (!response.ok) {
    fail(`Registry request failed: ${archiveUrl} -> ${response.status}`, EXIT.GENERAL, undefined, input.json);
  }
  const data = await readResponseJson(response, archiveUrl, input.json) as ArchivePayload;
  const out = path.resolve(input.out ?? input.name);
  if (existsSync(out) && readdirSync(out).length > 0 && !input.force) {
    fail(`${out} exists and is not empty.`, EXIT.VALIDATION, `hh ${input.command ?? "pull"} ${input.owner}/${input.name}${input.version ? ` --version ${input.version}` : ""} --force`, input.json);
  }
  const { written, skipped, paths } = writeArchiveFiles(out, data.files ?? []);
  if (!written) fail(`No files received for ${ref}`, EXIT.GENERAL, `hh search ${input.name.replaceAll("-", " ")}`, input.json);
  const version = data.version ?? readHarnessVersion(out) ?? "unknown";
  writeSourceMetadata(out, { owner: input.owner, name: input.name, version, registry: registryUrl, pulledAt: new Date().toISOString(), files: paths });
  return { owner: input.owner, name: input.name, version, out, files: written, skipped };
}

async function installHarness(input: {
  owner: string;
  name: string;
  target: InstallTarget;
  version?: string;
  out?: string;
  adapterOut?: string;
  force: boolean;
  token?: string;
  pay: boolean;
  json: boolean;
}): Promise<InstallResult> {
  if (input.target !== "cli") {
    preflightAdapterWrite({
      target: input.target,
      harnessName: input.name,
      out: input.adapterOut,
      force: input.force,
      json: input.json
    });
  }
  const pulled = await pullHarnessArchive({
    owner: input.owner,
    name: input.name,
    version: input.version,
    out: input.out,
    force: input.force,
    token: input.token,
    pay: input.pay,
    json: input.json,
    command: "install"
  });
  const adapter = input.target === "cli"
    ? undefined
    : adaptHarness({
      root: pulled.out,
      target: input.target,
      out: input.adapterOut,
      force: input.force,
      json: input.json
    });
  await recordCliRegistryEvent({
    registry: registryUrl,
    kind: "install",
    owner: pulled.owner,
    repo: pulled.name,
    version: pulled.version,
    target: input.target,
    client: input.target === "claude-code" ? "claude-code" : "hh",
    token: input.target === "claude-code"
      ? input.token ?? (pulled.owner.startsWith("@") ? process.env.HH_ORG_TOKEN : process.env.HH_TOKEN)
      : undefined
  });
  return {
    ...pulled,
    target: input.target,
    ...(adapter ? { adapter } : {}),
    next: installNextSteps(pulled.out, input.target)
  };
}

function parseHarnessRef(ref: string, next: string, json: boolean): { owner: string; name: string } {
  const parts = ref.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    fail("Expected <owner>/<name>, e.g. harnesses/deep-market-researcher", EXIT.VALIDATION, next, json);
  }
  return { owner: parts[0], name: parts[1] };
}

function cleanInstallTarget(value: string | undefined): InstallTarget | undefined {
  return value === "cli" || value === "claude-code" || value === "codex" || value === "cursor" ? value : undefined;
}

function installNextSteps(out: string, target: InstallTarget): string[] {
  const quoted = shellQuote(displayPath(out));
  const steps = [`hh run ${quoted} --json`, `hh eval ${quoted} --json`, `hh gate --dir ${quoted} --json`];
  if (target === "claude-code") return [`hh mcp-config ${quoted} --target claude-code --out .mcp.json`, ...steps];
  return steps;
}

function installText(result: InstallResult): string {
  const lines = [
    `Installed ${result.owner}/${result.name}@${result.version} -> ${displayPath(result.out)} (${result.files} files${result.skipped ? `, ${result.skipped} skipped as too large` : ""})`
  ];
  if (result.adapter) {
    lines.push(`Adapter ${result.adapter.target} -> ${displayPath(result.adapter.out)}`);
    lines.push(...result.adapter.files.map((file) => `- ${displayPath(file)}`));
  }
  lines.push("Next:", ...result.next.map((step) => `- ${step}`), "");
  return lines.join("\n");
}

function buildSuggestionReport(item: SearchItem, detail: SuggestDetail): SuggestionReport {
  const title = detail.manifest?.title ?? item.title ?? item.name;
  const summary = detail.manifest?.summary ?? item.summary ?? "";
  const version = detail.manifest?.version;
  const contentType = item.contentType === "directory" ? "directory" : "harness";
  return {
    owner: item.owner,
    name: item.name,
    ref: `${item.owner}/${item.name}`,
    title,
    summary,
    version,
    contentType,
    command: item.cliCommand ?? candidateCommand(item),
    ...(item.directory?.url ? { openUrl: item.directory.url } : {}),
    trust: {
      eval: evalTrustLabel(item, detail),
      risk: riskTrustLabel(item, detail),
      security: securityTrustLabel(detail),
      context: contextCostLabel(detail.contextCost ?? item.contextCost),
      standard: detail.standard ?? "unknown",
      payment: pricingTrustLabel(detail.manifest?.pricing ?? item.pricing),
      compatibility: compatibilityLabels(detail, item),
      ...(detail.verification?.lastVerifiedAt ? { lastVerifiedAt: detail.verification.lastVerifiedAt } : {})
    }
  };
}

function buildCandidateSummary(item: SearchItem, rank: number): CandidateSummary {
  const contentType = item.contentType === "directory" ? "directory" : "harness";
  return {
    rank,
    owner: item.owner,
    name: item.name,
    ref: `${item.owner}/${item.name}`,
    title: item.title ?? item.name,
    summary: item.summary ?? "",
    contentType,
    command: item.cliCommand ?? candidateCommand(item),
    ...(item.directory?.url ? { openUrl: item.directory.url } : {}),
    trust: {
      eval: evalTrustLabel(item, {}),
      risk: riskTrustLabel(item, {}),
      context: contextCostLabel(item.contextCost),
      payment: pricingTrustLabel(item.pricing)
    }
  };
}

function candidateCommand(item: SearchItem): string {
  if (item.contentType === "directory" && item.directory?.url) return `open ${item.directory.url}`;
  return `hh install ${item.owner}/${item.name}`;
}

function evalTrustLabel(item: SearchItem, detail: SuggestDetail): string {
  const status = detail.evalResult?.status ?? item.evalStatus ?? "unknown";
  const score = typeof detail.evalResult?.score === "number" ? detail.evalResult.score : item.evalScore;
  const verification = detail.evalResult?.verification_status ? ` (${detail.evalResult.verification_status})` : "";
  return `${status} ${score ?? "unknown"}${verification}`.trim();
}

function riskTrustLabel(item: SearchItem, detail: SuggestDetail): string {
  const score = typeof detail.risk?.score === "number" ? detail.risk.score : item.riskScore;
  const tier = detail.risk?.tier ?? item.riskTier ?? "UNKNOWN";
  const blocking = detail.risk?.blocking?.length ? `, ${detail.risk.blocking.length} blocking` : "";
  return `${score ?? "unknown"} ${tier}${blocking}`;
}

function securityTrustLabel(detail: SuggestDetail): string {
  const verdict = detail.security?.verdict ?? "unknown";
  const findings = detail.security?.findings?.length ?? 0;
  return `${verdict} (${findings} findings)`;
}

function pricingTrustLabel(pricing: PricingInfo | undefined): string {
  if (!pricing || !pricing.model || pricing.model === "free") return "free";
  if (typeof pricing.amount_usd === "number") return `${pricing.model} ${pricing.amount_usd} ${pricing.currency ?? "USD"}`;
  return pricing.model;
}

function compatibilityLabels(detail: SuggestDetail, item?: SearchItem): string[] {
  const declared = detail.manifest?.compatibility?.targets;
  const targets = declared?.length ? declared : item?.compatibility?.targets ?? [];
  return targets
    .map((target) => `${target.id ?? target.name ?? "target"}:${target.status ?? "unknown"}`)
    .slice(0, 5);
}

function suggestionText(query: string, pick: number, suggestion: SuggestionReport, applied: PullHarnessResult | InstallResult | undefined, candidates: CandidateSummary[]): string {
  const lines = [
    `Suggestion for "${query}" (#${pick})`,
    `${suggestion.ref} - ${suggestion.title}`,
    suggestion.summary,
    "",
    "Trust:",
    `  eval: ${suggestion.trust.eval}`,
    `  risk: ${suggestion.trust.risk}`,
    `  security: ${suggestion.trust.security}`,
    `  context: ${suggestion.trust.context}`,
    `  standard: ${suggestion.trust.standard}`,
    `  payment: ${suggestion.trust.payment}`,
    `  compatibility: ${suggestion.trust.compatibility.length ? suggestion.trust.compatibility.join(", ") : "unknown"}`,
    `  last verified: ${suggestion.trust.lastVerifiedAt ?? "unknown"}`,
    "",
    "Top candidates:",
    ...candidates.map((candidate) => [
      `${candidate.rank === pick ? ">" : " "} #${candidate.rank} ${candidate.ref} - ${candidate.title}`,
      `    eval ${candidate.trust.eval} · risk ${candidate.trust.risk} · context ${candidate.trust.context} · payment ${candidate.trust.payment}`
    ].join("\n")),
    `Pick another: hh suggest ${query} --pick <rank>`,
    "",
    suggestion.contentType === "directory" && suggestion.openUrl
      ? `Next: open ${suggestion.openUrl}`
      : `Next: ${suggestion.command}${applied ? ` && hh run ${applied.out}` : " --out <dir>"}`
  ];
  if (applied) {
    lines.push(`Applied: ${applied.owner}/${applied.name}@${applied.version} -> ${applied.out} (${applied.files} files${applied.skipped ? `, ${applied.skipped} skipped` : ""})`);
    if ("adapter" in applied && applied.adapter) {
      lines.push(`Adapter: ${applied.adapter.target} -> ${applied.adapter.out}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function assertSuggestionApplyAllowed(suggestion: SuggestionReport, detail: SuggestDetail, json: boolean): void {
  const securityVerdict = detail.security?.verdict;
  if (securityVerdict !== "pass") {
    fail(
      `Refusing to apply ${suggestion.ref}: security scan is ${securityVerdict ?? "missing"}.`,
      EXIT.VALIDATION,
      `Inspect ${suggestion.ref} with harness_detail or GET /repos/${suggestion.owner}/${suggestion.name}/security-report before installing.`,
      json
    );
  }
  const blocking = detail.risk?.blocking ?? [];
  if (blocking.length) {
    fail(
      `Refusing to apply ${suggestion.ref}: risk report has ${blocking.length} blocking finding(s).`,
      EXIT.VALIDATION,
      `Resolve blocking risk findings before running hh suggest ${suggestion.name} --apply.`,
      json
    );
  }
}

function boundedPositiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = positiveInt(value, fallback);
  return Math.min(parsed, max);
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

async function setupOrgBundle(input: { org: string; out?: string; token?: string; force: boolean; dryRun: boolean; json: boolean }) {
  const slug = cleanSetupOrg(input.org);
  if (!slug) fail("Expected org slug, e.g. @acme", EXIT.VALIDATION, "hh setup @acme --token <org-token>", input.json);
  if (!input.token) fail("Org token required.", EXIT.AUTH, "Set HH_ORG_TOKEN or pass --token <org-token>", input.json);
  const bundleUrl = `${registryUrl}/orgs/${slug}/bundle`;
  const response = await fetchRegistryResponse(bundleUrl, input.json, { headers: { Authorization: `Bearer ${input.token}` } });
  if (response.status === 401 || response.status === 403) {
    const body = await readResponseJson(response, bundleUrl, input.json).catch(() => ({})) as { error?: string };
    fail(`Setup failed (${response.status}): ${body.error ?? "org authorization failed"}`, EXIT.AUTH, "Check HH_ORG_TOKEN and org membership.", input.json);
  }
  if (response.status === 404) fail(`Org bundle not found: @${slug}`, EXIT.NOT_FOUND, "Ask an org admin to publish a setup bundle.", input.json);
  if (!response.ok) fail(`Registry request failed: ${bundleUrl} -> ${response.status}`, EXIT.GENERAL, undefined, input.json);
  const payload = await readResponseJson(response, bundleUrl, input.json) as OrgBundlePayload;
  if (!payload.organization || !payload.bundle) fail(`Org bundle response was invalid: @${slug}`, EXIT.GENERAL, undefined, input.json);
  const out = path.resolve(input.out ?? path.join(".harnesshub", "orgs", slug));
  const existingSetup = readJsonFile<OrgSetupMetadata>(path.join(out, ".harnesshub/setup.json"));
  const sameManagedSetup = existingSetup?.organization?.slug === payload.organization.slug && existingSetup.bundleVersion === payload.bundle.version;
  if (!input.dryRun && existsSync(out) && readdirSync(out).length > 0 && !input.force && !sameManagedSetup) {
    fail(`${displayPath(out)} exists and is not an idempotent @${slug} setup.`, EXIT.VALIDATION, `hh setup @${slug} --out ${displayPath(out)} --force`, input.json);
  }
  const harnessReports: Array<{ owner: string; name: string; version: string; path: string; files: number; skipped: number }> = [];
  const configReports: Array<{ path: string }> = [];
  if (!input.dryRun) mkdirSync(out, { recursive: true });
  for (const item of payload.bundle.harnesses ?? []) {
    const owner = cleanRegistryOwner(item.owner);
    const name = cleanRegistrySegment(item.name);
    if (!owner || !name) continue;
    const version = item.version;
    const target = path.resolve(out, "harnesses", item.target ?? name);
    const targetRelative = path.relative(out, target);
    if (!targetRelative || targetRelative.startsWith("..") || path.isAbsolute(targetRelative)) continue;
    const archive = await fetchArchive(registryUrl, owner, name, version, input.json, input.token);
    const resolvedVersion = archive.version ?? version;
    if (!resolvedVersion) fail(`Archive ${owner}/${name} did not include a version.`, EXIT.GENERAL, undefined, input.json);
    const { written, skipped, paths } = input.dryRun ? { written: 0, skipped: 0, paths: [] as string[] } : writeArchiveFiles(target, archive.files ?? []);
    if (!input.dryRun) writeSourceMetadata(target, { owner, name, version: resolvedVersion, registry: registryUrl, pulledAt: new Date().toISOString(), files: paths });
    harnessReports.push({ owner, name, version: resolvedVersion, path: path.relative(out, target).split(path.sep).join("/"), files: written, skipped });
  }
  for (const config of payload.bundle.configs ?? []) {
    const target = path.resolve(out, config.path);
    const relative = path.relative(out, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    if (!input.dryRun) {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, config.content);
    }
    configReports.push({ path: relative.split(path.sep).join("/") });
  }
  const setup = {
    organization: payload.organization,
    bundleVersion: payload.bundle.version,
    registry: registryUrl,
    out: path.relative(process.cwd(), out) || ".",
    installedAt: new Date().toISOString(),
    harnesses: harnessReports,
    configs: configReports
  };
  if (!input.dryRun) writeJsonFile(path.join(out, ".harnesshub/setup.json"), setup);
  return setup;
}

async function syncOrgRepo(input: { source: string; org: string; token: string; maxFiles: number; dryRun: boolean; json: boolean }): Promise<SyncReport> {
  const source = materializeSyncSource(input.source, input.json);
  try {
    const scan = findSyncCandidates(source.root, input.maxFiles);
    const report: SyncReport = {
      org: input.org,
      source: input.source,
      cloned: source.cloned,
      dryRun: input.dryRun,
      imported: [],
      skipped: scan.skipped
    };
    if (input.dryRun) {
      report.imported = scan.candidates.map((candidate) => ({
        path: candidate.path,
        name: candidate.name,
        owner: `@${input.org}`,
        title: titleize(candidate.name)
      }));
      return report;
    }
    for (const candidate of scan.candidates) {
      const result = await publishOrgMarkdown({
        org: input.org,
        token: input.token,
        name: candidate.name,
        markdown: candidate.markdown,
        json: input.json,
        command: "Sync"
      });
      report.imported.push({
        path: candidate.path,
        name: result.name,
        owner: result.owner,
        title: result.title,
        snapshotVersion: result.snapshotVersion
      });
    }
    return report;
  } finally {
    source.cleanup();
  }
}

async function publishPublicMarkdown(input: { token?: string; name: string; markdown: string; json: boolean }): Promise<OrgImportResult> {
  const publishUrl = `${registryUrl}/imports/markdown-to-harness`;
  const response = await fetchRegistryResponse(publishUrl, input.json, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(input.token ? { Authorization: `Bearer ${input.token}` } : {})
    },
    body: JSON.stringify({ name: input.name, markdown: input.markdown })
  });
  const body = await response.json().catch(() => ({})) as { item?: { title?: string; name?: string }; snapshotVersion?: string; error?: string };
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      fail(
        `Publish failed (${response.status}): ${body.error ?? "authorization required"}`,
        EXIT.AUTH,
        "Log on at https://onlyharness.com, then export HH_TOKEN=<access token> and retry",
        input.json
      );
    }
    fail(`Publish failed (${response.status}): ${body.error ?? JSON.stringify(body)}`, response.status === 404 ? EXIT.NOT_FOUND : EXIT.GENERAL, undefined, input.json);
  }
  return {
    title: body.item?.title ?? input.name,
    name: body.item?.name ?? input.name,
    owner: "local",
    snapshotVersion: body.snapshotVersion
  };
}

async function publishHarnessDir(input: { org?: string; token?: string; name?: string; root: string; json: boolean; autoEval?: boolean }): Promise<OrgImportResult> {
  const payload = buildHarnessDirPublishPayload(input.root, input.name, input.json, input.autoEval === true);
  const publishUrl = input.org ? `${registryUrl}/orgs/${input.org}/imports/harness-dir` : `${registryUrl}/imports/harness-dir`;
  const response = await fetchRegistryResponse(publishUrl, input.json, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(input.token ? { Authorization: `Bearer ${input.token}` } : {})
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({})) as {
    item?: { title?: string; name?: string; owner?: string };
    snapshotVersion?: string;
    verified?: boolean;
    gate?: PublishGateResult;
    error?: string;
    failures?: string[];
  };
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      fail(
        `Publish failed (${response.status}): ${body.error ?? "authorization required"}`,
        EXIT.AUTH,
        input.org ? "Check HH_ORG_TOKEN and org publish scope." : "Log on at https://onlyharness.com, then export HH_TOKEN=<access token> and retry",
        input.json
      );
    }
    const detail = body.failures?.length ? `${body.error ?? "publish rejected"}: ${body.failures.join("; ")}` : body.error ?? JSON.stringify(body);
    fail(`Publish failed (${response.status}): ${detail}`, response.status === 404 ? EXIT.NOT_FOUND : EXIT.VALIDATION, "hh eval <dir> && hh gate --dir <dir>", input.json);
  }
  return {
    title: body.item?.title ?? input.name ?? path.basename(input.root),
    name: body.item?.name ?? input.name ?? path.basename(input.root),
    owner: body.item?.owner ?? (input.org ? `@${input.org}` : "local"),
    snapshotVersion: body.snapshotVersion,
    verified: body.verified === true,
    gate: body.gate
  };
}

async function publishResourcePackage(input: {
  token?: string;
  name?: string;
  title?: string;
  summary?: string;
  resourceType?: string;
  sourceUrl?: string;
  files: PublishFilePayload[];
  json: boolean;
}): Promise<ResourcePackageImportResult> {
  const response = await fetchRegistryResponse(`${registryUrl}/imports/resource-package`, input.json, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(input.token ? { Authorization: `Bearer ${input.token}` } : {})
    },
    body: JSON.stringify({
      name: input.name,
      title: input.title,
      summary: input.summary,
      resourceType: input.resourceType,
      sourceUrl: input.sourceUrl,
      files: input.files
    })
  });
  const body = await response.json().catch(() => ({})) as ResourcePackageImportResult & { error?: string; code?: string; failures?: string[] };
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      fail(
        `Resource package publish failed (${response.status}): ${body.error ?? "authorization required"}`,
        EXIT.AUTH,
        "Log on at https://onlyharness.com, then export HH_TOKEN=<access token> and retry",
        input.json
      );
    }
    const detail = body.failures?.length ? `${body.error ?? "publish rejected"}: ${body.failures.join("; ")}` : body.error ?? JSON.stringify(body);
    fail(`Resource package publish failed (${response.status}): ${detail}`, response.status === 404 ? EXIT.NOT_FOUND : EXIT.VALIDATION, "Check file count, file sizes, secret files and --type.", input.json);
  }
  return body;
}

async function publishOrgMarkdown(input: { org: string; token: string; name: string; markdown: string; json: boolean; command: "Publish" | "Sync" }): Promise<OrgImportResult> {
  const publishUrl = `${registryUrl}/orgs/${input.org}/imports/markdown-to-harness`;
  const response = await fetchRegistryResponse(publishUrl, input.json, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.token}`
    },
    body: JSON.stringify({ name: input.name, markdown: input.markdown })
  });
  const body = await response.json().catch(() => ({})) as { item?: { title?: string; name?: string }; snapshotVersion?: string; error?: string };
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      fail(
        `${input.command} failed (${response.status}): ${body.error ?? "authorization required"}`,
        EXIT.AUTH,
        "Check HH_ORG_TOKEN and org publish scope.",
        input.json
      );
    }
    if (response.status === 404) {
      fail(`${input.command} failed (404): ${body.error ?? "org or endpoint not found"}`, EXIT.NOT_FOUND, "Ask an org admin to enable org publishing.", input.json);
    }
    fail(`${input.command} failed (${response.status}): ${body.error ?? JSON.stringify(body)}`, EXIT.GENERAL, undefined, input.json);
  }
  return {
    title: body.item?.title ?? input.name,
    name: body.item?.name ?? input.name,
    owner: `@${input.org}`,
    snapshotVersion: body.snapshotVersion
  };
}

function buildHarnessDirPublishPayload(root: string, name: string | undefined, json: boolean, autoEval = false): { name?: string; files: PublishFilePayload[] } {
  const validation = validateHarnessDir(root);
  if (!validation.manifest) {
    fail("Publish failed: harness.yaml is missing or invalid.", EXIT.VALIDATION, `hh validate ${root} --strict`, json);
  }
  if (validation.manifest.content.type === "directory") {
    fail("Publish failed: directory entries are link-only and cannot be published as verified harness dirs.", EXIT.VALIDATION, "Publish a runnable harness directory.", json);
  }
  if (autoEval) writePublishEvalArtifacts(root);
  const resultPath = path.join(root, ".harnesshub/results.json");
  const result = readJsonFile<PublishEvalResult>(resultPath);
  const gate = verifiedPublishGate(validation, result);
  if (gate.failures.length) {
    fail(`Publish failed: eval/gate must pass before verified publish: ${gate.failures.join("; ")}`, EXIT.VALIDATION, `hh eval ${root} && hh gate --dir ${root}`, json);
  }
  const files = collectPublishFiles(root, json);
  return name ? { name, files } : { files };
}

function writePublishEvalArtifacts(root: string) {
  const result = runLocalEval(root);
  mkdirSync(path.join(root, ".harnesshub"), { recursive: true });
  writeFileSync(path.join(root, ".harnesshub/results.json"), JSON.stringify(result, null, 2));
  writeFileSync(path.join(root, ".harnesshub/report.html"), htmlReport(result));
  writeFileSync(path.join(root, ".harnesshub/results.junit.xml"), junitReport(result));
}

function verifiedPublishGate(validation: ReturnType<typeof validateHarnessDir>, result: PublishEvalResult | undefined): PublishGateResult {
  const manifest = validation.manifest;
  const score = Number(result?.score ?? 0);
  const cost = Number(result?.cost_usd ?? 0);
  const failures: string[] = [];
  if (!manifest) failures.push("manifest unavailable");
  if (!result) failures.push("missing .harnesshub/results.json; run hh eval");
  if (result?.status !== "passed" || result.verified !== true) failures.push(`eval status ${result?.status ?? "missing"} is not verified passed`);
  if (manifest && score < manifest.quality_gates.min_score) failures.push(`score ${score} below ${manifest.quality_gates.min_score}`);
  if (manifest && cost > manifest.quality_gates.max_cost_usd_per_run) failures.push(`cost ${cost} above ${manifest.quality_gates.max_cost_usd_per_run}`);
  if (manifest && validation.risk.score > manifest.quality_gates.max_risk_score) failures.push(`risk ${validation.risk.score} above ${manifest.quality_gates.max_risk_score}`);
  failures.push(...validation.risk.blocking);
  return { score, cost, risk: validation.risk.score, failures };
}

function collectPublishFiles(root: string, json: boolean): PublishFilePayload[] {
  const files: PublishFilePayload[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > 10) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (isIgnoredPublishEntry(entry.name)) continue;
        visit(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !isPublishFilePath(relative)) continue;
      const content = readFileSync(full, "utf8");
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes > MAX_PUBLISH_FILE_BYTES) {
        fail(`Publish failed: file too large: ${relative}`, EXIT.VALIDATION, "Keep publishable harness files under 256KB each.", json);
      }
      files.push({ path: relative, content, truncated: false });
    }
  };
  visit(root, 0);
  files.sort((left, right) => left.path.localeCompare(right.path));
  if (!files.some((file) => file.path === "harness.yaml")) {
    fail("Publish failed: harness.yaml is required.", EXIT.VALIDATION, `hh validate ${root} --strict`, json);
  }
  if (!files.some((file) => file.path === ".harnesshub/results.json")) {
    fail("Publish failed: .harnesshub/results.json is required.", EXIT.VALIDATION, `hh eval ${root} && hh gate --dir ${root}`, json);
  }
  if (files.length > MAX_PUBLISH_FILES) {
    fail(`Publish failed: too many files (${files.length} > ${MAX_PUBLISH_FILES}).`, EXIT.VALIDATION, "Trim examples/runbooks or split the harness.", json);
  }
  return files;
}

function collectResourcePackageFiles(root: string, json: boolean): PublishFilePayload[] {
  const files: PublishFilePayload[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > 10) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (isIgnoredResourcePackageEntry(entry.name)) continue;
        visit(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !isPublishFilePath(relative)) continue;
      const content = readFileSync(full, "utf8");
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes > MAX_PUBLISH_FILE_BYTES) {
        fail(`Resource package publish failed: file too large: ${relative}`, EXIT.VALIDATION, "Keep package files under 256KB each.", json);
      }
      files.push({ path: relative, content, truncated: false });
    }
  };
  visit(root, 0);
  files.sort((left, right) => left.path.localeCompare(right.path));
  if (!files.length) {
    fail("Resource package publish failed: no publishable files found.", EXIT.VALIDATION, "Add README.md, SKILL.md, scripts/, commands/, tools/, workflows/, mcp/, plugins/, docs/, src/ or lib/ files.", json);
  }
  if (files.length > MAX_PUBLISH_FILES) {
    fail(`Resource package publish failed: too many files (${files.length} > ${MAX_PUBLISH_FILES}).`, EXIT.VALIDATION, "Trim generated files or split the package.", json);
  }
  return files;
}

function isIgnoredPublishEntry(name: string): boolean {
  return [".git", "node_modules", "dist", "build", "coverage", ".next"].includes(name);
}

function isIgnoredResourcePackageEntry(name: string): boolean {
  return [".git", "node_modules", "dist", "build", "coverage", ".next", ".harnesshub", ".cache"].includes(name);
}

function isPublishFilePath(file: string): boolean {
  return isAgentResourceFilePath(file);
}

function isAgentResourceFilePath(file: string): boolean {
  if (!file || file.startsWith("/") || file.includes("\0")) return false;
  const normalized = path.posix.normalize(file);
  if (normalized !== file || normalized.startsWith("../") || normalized === "..") return false;
  if (/(^|\/)(node_modules|\.git|dist|build|coverage|\.next)(\/|$)/i.test(file)) return false;
  if (deniedAgentResourcePath(file)) return false;
  if (!safeTextResourceExtension(file)) return false;
  if (safeAgentResourceRootFile(file)) return true;
  if (file === ".harnesshub/results.json") return true;
  return /^(agents|skills|prompts|tools|scripts|commands|gates|evals|examples|runbooks|workflows|mcp|plugins|docs|src|lib|bin|\.claude|\.codex|\.claude-plugin|\.codex-plugin|\.gitea\/workflows)\//.test(file);
}

function safeAgentResourceRootFile(file: string): boolean {
  return [
    "harness.yaml",
    "harness.yml",
    "README.md",
    "AGENTS.md",
    "SKILL.md",
    "CLAUDE.md",
    "LICENSE",
    "LICENSE.md",
    "package.json",
    "requirements.txt",
    "pyproject.toml",
    "tsconfig.json",
    "server.json",
    "plugin.json",
    "workflow.md",
    "Dockerfile",
    "Makefile",
    ".gitignore",
    ".mcp.json"
  ].includes(file);
}

function deniedAgentResourcePath(file: string): boolean {
  const lower = file.toLowerCase();
  const segments = lower.split("/");
  if (segments.some((segment) => segment === ".env" || segment.startsWith(".env.") || segment === ".npmrc" || segment === ".pypirc" || segment === ".netrc")) return true;
  if (segments.some((segment) => /^(id_rsa|id_dsa|id_ecdsa|id_ed25519|known_hosts|secrets?|private|credentials?)$/.test(segment))) return true;
  return /\.(pem|key|p12|pfx|crt|cer|sqlite|sqlite3|db|zip|tar|tgz|gz|png|jpe?g|gif|webp|pdf|mp4|mov|avi|dmg|pkg)$/i.test(file);
}

function safeTextResourceExtension(file: string): boolean {
  const base = path.posix.basename(file);
  if (["Dockerfile", "Makefile", "LICENSE"].includes(base)) return true;
  if (base.startsWith(".")) return [".gitignore", ".mcp.json"].includes(base);
  return /\.(md|mdx|txt|ya?ml|json|jsonc|toml|xml|js|mjs|cjs|ts|tsx|jsx|py|sh|bash|zsh|fish|rb|go|rs|java|cs|php|lua|sql|css|html)$/i.test(base);
}

function materializePublishSource(source: string, subdir: string | undefined, json: boolean): MaterializedPublishSource {
  const localPath = path.resolve(source);
  if (existsSync(localPath)) {
    const stats = statSync(localPath);
    if (stats.isDirectory()) {
      return {
        path: resolvePublishHarnessRoot(localPath, subdir, json),
        cloned: false,
        autoEval: false,
        cleanup: () => undefined
      };
    }
    if (subdir) fail("--path can only be used with a git repo or directory source.", EXIT.VALIDATION, "hh publish <git-url> --path harnesses/my-harness", json);
    return { path: localPath, cloned: false, autoEval: false, cleanup: () => undefined };
  }
  if (!looksLikeGitSource(source)) {
    fail(`Publish source not found: ${localPath}`, EXIT.NOT_FOUND, "hh publish workflow.md --name my-workflow", json);
  }
  const tmp = mkdtempSync(path.join(os.tmpdir(), "hh-publish-"));
  const clone = spawnSync("git", ["clone", "--depth", "1", source, tmp], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  if (clone.status !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    fail(`Publish clone failed: ${clone.stderr || clone.stdout || "git clone exited with an error"}`, EXIT.GENERAL, undefined, json);
  }
  return {
    path: resolvePublishHarnessRoot(tmp, subdir, json),
    cloned: true,
    autoEval: true,
    cleanup: () => rmSync(tmp, { recursive: true, force: true })
  };
}

function materializeResourcePackageSource(source: string, subdir: string | undefined, json: boolean): MaterializedResourcePackageSource {
  const localPath = path.resolve(source);
  if (existsSync(localPath)) {
    const stats = statSync(localPath);
    if (!stats.isDirectory()) {
      fail("Resource package source must be a directory or git URL.", EXIT.VALIDATION, "hh publish-resource ./repo-or-package --name my-resource", json);
    }
    return {
      path: resolveResourcePackageRoot(localPath, subdir, json),
      cloned: false,
      cleanup: () => undefined
    };
  }
  if (!looksLikeGitSource(source)) {
    fail(`Resource package source not found: ${localPath}`, EXIT.NOT_FOUND, "hh publish-resource https://github.com/acme/repo.git --path packages/agent-tool --name agent-tool", json);
  }
  const tmp = mkdtempSync(path.join(os.tmpdir(), "hh-resource-publish-"));
  const clone = spawnSync("git", ["clone", "--depth", "1", source, tmp], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  if (clone.status !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    fail(`Resource package clone failed: ${clone.stderr || clone.stdout || "git clone exited with an error"}`, EXIT.GENERAL, undefined, json);
  }
  return {
    path: resolveResourcePackageRoot(tmp, subdir, json),
    cloned: true,
    sourceUrl: publicSourceUrl(source),
    cleanup: () => rmSync(tmp, { recursive: true, force: true })
  };
}

function looksLikeGitSource(source: string): boolean {
  return /^(git@|ssh:\/\/|https?:\/\/|file:\/\/)/.test(source) || source.endsWith(".git");
}

function resolveResourcePackageRoot(root: string, subdir: string | undefined, json: boolean): string {
  if (!subdir) return root;
  const normalized = normalizeRepoSubpath(subdir);
  if (!normalized) fail("Unsafe publish --path.", EXIT.VALIDATION, "Use a relative path like packages/my-agent-tool", json);
  const candidate = path.resolve(root, normalized);
  if (!isPathInside(root, candidate) || !existsSync(candidate) || !statSync(candidate).isDirectory()) {
    fail(`Resource package path not found at --path ${normalized}.`, EXIT.NOT_FOUND, "Point --path at a directory inside the repo.", json);
  }
  return candidate;
}

function publicSourceUrl(source: string): string | undefined {
  if (/^https:\/\/github\.com\//i.test(source)) return source.replace(/\.git$/i, "");
  if (/^http:\/\//i.test(source)) return undefined;
  return undefined;
}

function resolvePublishHarnessRoot(repoRoot: string, subdir: string | undefined, json: boolean): string {
  if (subdir) {
    const normalized = normalizeRepoSubpath(subdir);
    if (!normalized) fail("Unsafe publish --path.", EXIT.VALIDATION, "Use a relative path like harnesses/my-harness", json);
    const candidate = path.resolve(repoRoot, normalized);
    if (!isPathInside(repoRoot, candidate) || !existsSync(path.join(candidate, "harness.yaml"))) {
      fail(`Publish harness not found at --path ${normalized}.`, EXIT.NOT_FOUND, "Point --path at a directory containing harness.yaml", json);
    }
    return candidate;
  }
  if (existsSync(path.join(repoRoot, "harness.yaml"))) return repoRoot;
  const candidates = findPublishHarnessDirs(repoRoot);
  if (candidates.length === 1) return path.join(repoRoot, candidates[0]);
  if (!candidates.length) {
    fail("Publish source does not contain harness.yaml.", EXIT.NOT_FOUND, "Run from a harness directory or pass --path for a repo subdirectory.", json);
  }
  fail(
    `Publish source contains multiple harnesses: ${candidates.slice(0, 8).join(", ")}`,
    EXIT.VALIDATION,
    "Pass --path <harness-dir> to choose one.",
    json
  );
}

function normalizeRepoSubpath(value: string): string | undefined {
  const normalized = value.split("\\").join("/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) return undefined;
  const clean = path.posix.normalize(normalized);
  if (clean === "." || clean === ".." || clean.startsWith("../")) return undefined;
  return clean;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function findPublishHarnessDirs(root: string): string[] {
  const candidates: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > 8 || candidates.length > 20) return;
    if (existsSync(path.join(dir, "harness.yaml"))) {
      candidates.push(path.relative(root, dir).split(path.sep).join("/"));
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || isIgnoredRepoEntry(entry.name)) continue;
      visit(path.join(dir, entry.name), depth + 1);
    }
  };
  visit(root, 0);
  return candidates.sort();
}

function isIgnoredRepoEntry(name: string): boolean {
  return [".git", "node_modules", "dist", "build", "coverage", ".next", ".harnesshub"].includes(name);
}

function materializeSyncSource(source: string, json: boolean): { root: string; cloned: boolean; cleanup: () => void } {
  const localPath = path.resolve(source);
  if (existsSync(localPath)) {
    if (!statSync(localPath).isDirectory()) fail("Sync source must be a git URL or local directory.", EXIT.VALIDATION, "hh sync <git-url> --org acme", json);
    return { root: localPath, cloned: false, cleanup: () => undefined };
  }
  const tmp = mkdtempSync(path.join(os.tmpdir(), "hh-sync-"));
  const clone = spawnSync("git", ["clone", "--depth", "1", source, tmp], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  if (clone.status !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    fail(`Sync clone failed: ${clone.stderr || clone.stdout || "git clone exited with an error"}`, EXIT.GENERAL, undefined, json);
  }
  return { root: tmp, cloned: true, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

function findSyncCandidates(root: string, maxFiles: number): { candidates: SyncCandidate[]; skipped: SyncSkipped[] } {
  const markdown = collectSyncMarkdown(root)
    .filter((file) => isSyncMarkdownCandidate(file))
    .sort(syncCandidateSort);
  const skipped: SyncSkipped[] = [];
  const seenNames = new Set<string>();
  const candidates: SyncCandidate[] = [];
  for (const relative of markdown) {
    const full = path.join(root, relative);
    const bytes = statSync(full).size;
    if (bytes < 20) {
      skipped.push({ path: relative, reason: "too_small" });
      continue;
    }
    if (bytes > 128 * 1024) {
      skipped.push({ path: relative, reason: "too_large" });
      continue;
    }
    if (candidates.length >= maxFiles) {
      skipped.push({ path: relative, reason: "max_files" });
      continue;
    }
    const name = uniqueSyncName(syncNameForMarkdown(relative), seenNames);
    candidates.push({
      path: relative,
      name,
      bytes,
      markdown: readFileSync(full, "utf8")
    });
  }
  return { candidates, skipped };
}

function collectSyncMarkdown(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > 10) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (isIgnoredSyncEntry(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  visit(root, 0);
  return files;
}

function isIgnoredSyncEntry(name: string): boolean {
  return [".git", "node_modules", "dist", "build", "coverage", ".next", ".harnesshub"].includes(name);
}

function isSyncMarkdownCandidate(relative: string): boolean {
  const lower = relative.toLowerCase();
  if (/(^|\/)skill\.md$/.test(lower)) return true;
  if (/^(\.claude\/skills|skills|prompts|runbooks|plugin-marketplace|marketplace|plugins)\//.test(lower)) return true;
  if (!relative.includes("/") && !["readme.md", "license.md", "contributing.md", "changelog.md", "code_of_conduct.md", "security.md"].includes(lower)) return true;
  return false;
}

function syncCandidateSort(left: string, right: string): number {
  const leftSkill = /(^|\/)skill\.md$/i.test(left) ? 0 : 1;
  const rightSkill = /(^|\/)skill\.md$/i.test(right) ? 0 : 1;
  if (leftSkill !== rightSkill) return leftSkill - rightSkill;
  return left.localeCompare(right);
}

function syncNameForMarkdown(relative: string): string {
  const parts = relative.split("/");
  if (parts.at(-1)?.toLowerCase() === "skill.md" && parts.length >= 2) return slugify(parts.at(-2) ?? "skill");
  return slugify(relative.replace(/\.md$/i, "").replace(/\//g, "-"));
}

function uniqueSyncName(base: string, seen: Set<string>): string {
  const stem = cleanRegistrySegment(base) ?? "synced-workflow";
  let name = stem;
  let suffix = 2;
  while (seen.has(name)) {
    name = `${stem.slice(0, 72)}-${suffix}`;
    suffix += 1;
  }
  seen.add(name);
  return name;
}

function syncReportText(report: SyncReport): string {
  const lines = [
    `${report.dryRun ? "Would sync" : "Synced"} ${report.imported.length} markdown files to @${report.org}`,
    `Source: ${report.source}${report.cloned ? " (cloned)" : ""}`
  ];
  for (const item of report.imported) lines.push(`- ${item.path} -> ${item.owner}/${item.name}`);
  if (report.skipped.length) {
    lines.push("Skipped:");
    for (const item of report.skipped.slice(0, 20)) lines.push(`- ${item.path}: ${item.reason}`);
  }
  lines.push("");
  return lines.join("\n");
}

function cleanSetupOrg(value: string): string | undefined {
  const cleaned = value.replace(/^@/, "");
  return /^[a-z][a-z0-9_-]{1,48}$/.test(cleaned) ? cleaned : undefined;
}

function cleanRegistrySegment(value: string | undefined): string | undefined {
  return value && /^[a-z0-9][a-z0-9_-]{1,80}$/.test(value) ? value : undefined;
}

function cleanRegistryOwner(value: string | undefined): string | undefined {
  return value && /^@?[a-z0-9][a-z0-9_-]{1,80}$/.test(value) ? value : undefined;
}

function resolveRemoteRef(root: string, json = false): SourceMetadata | PinMetadata {
  const pin = readPinMetadata(root);
  if (pin) return pin;
  const source = readSourceMetadata(root);
  if (source) return source;
  fail("No registry source metadata found for this harness.", EXIT.VALIDATION, "hh install <owner>/<name> or hh pin --owner <owner>", json);
}

function removeManagedFiles(root: string, files: string[] | undefined) {
  for (const file of files ?? []) {
    const target = path.resolve(root, file);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || relative.startsWith(".harnesshub")) continue;
    rmSync(target, { force: true });
  }
}

function writeSourceMetadata(root: string, source: SourceMetadata) {
  writeJsonFile(path.join(root, ".harnesshub/source.json"), source);
}

function readSourceMetadata(root: string): SourceMetadata | undefined {
  return readJsonFile<SourceMetadata>(path.join(root, ".harnesshub/source.json"));
}

function readPinMetadata(root: string): PinMetadata | undefined {
  return readJsonFile<PinMetadata>(path.join(root, ".harnesshub/pin.json"));
}

function readJsonFile<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function writeJsonFile(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeGateReceipt(input: {
  root: string;
  manifest: HarnessManifest;
  resultsRaw: string;
  score: number;
  risk: number;
  cost: number;
  failures: string[];
  out?: string;
}): { path: string; receipt: GateReceipt } {
  const source = readSourceMetadata(input.root);
  const payload: GateReceiptPayload = {
    harness: source ? `${source.owner}/${source.name}` : receiptHarnessRef(input.manifest),
    version: source?.version ?? input.manifest.version,
    resultsHash: sha256Hex(input.resultsRaw),
    verdict: input.failures.length ? "failed" : "passed",
    at: new Date().toISOString(),
    gate: {
      score: input.score,
      risk: input.risk,
      cost: input.cost,
      failures: input.failures
    }
  };
  const key = gateReceiptKey();
  const signature = sign(null, Buffer.from(stableJson(payload)), key.privateKey).toString("base64");
  const receipt: GateReceipt = {
    type: "onlyharness.gate_receipt.v1",
    algorithm: "ed25519",
    payload,
    publicKey: key.publicKey,
    signature
  };
  const out = path.resolve(input.root, input.out ?? path.join(".harnesshub", "gate-receipt.json"));
  mkdirSync(path.dirname(out), { recursive: true });
  writeJsonFile(out, receipt);
  return { path: out, receipt };
}

function receiptHarnessRef(manifest: HarnessManifest): string {
  if (manifest.visibility === "org" && manifest.org) return `@${manifest.org}/${manifest.name}`;
  return `local/${manifest.name}`;
}

function gateReceiptKey(): { privateKey: string; publicKey: string } {
  const file = path.resolve(process.env.ONLYHARNESS_KEY_PATH ?? path.join(os.homedir(), ".onlyharness", "key"));
  if (!existsSync(file)) {
    const pair = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" }
    });
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, pair.privateKey, { mode: 0o600 });
    return { privateKey: pair.privateKey, publicKey: pair.publicKey };
  }
  const privateKey = readFileSync(file, "utf8");
  const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  return { privateKey, publicKey };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

function readHarnessVersion(root: string): string | undefined {
  return validateHarnessDir(root).manifest?.version;
}

async function recordCliVerificationEvent(root: string, kind: "eval" | "gate"): Promise<void> {
  const source = readPinMetadata(root) ?? readSourceMetadata(root);
  const validation = validateHarnessDir(root);
  const owner = source?.owner;
  const repo = source?.name ?? validation.manifest?.name;
  if (!owner || !repo) return;
  const version = source?.version ?? validation.manifest?.version;
  await recordCliRegistryEvent({
    registry: source?.registry ?? registryUrl,
    kind,
    owner,
    repo,
    version,
    target: "passed",
    client: "hh"
  });
}

async function recordCliRegistryEvent(input: {
  registry: string;
  kind: "suggested" | "accepted" | "applied" | "install" | "eval" | "gate";
  owner: string;
  repo: string;
  version?: string;
  target: string;
  client: "hh" | "claude-code";
  token?: string;
}): Promise<void> {
  const eventUrl = `${input.registry.replace(/\/$/, "")}/events`;
  try {
    await fetch(eventUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(input.token ? { Authorization: `Bearer ${input.token}` } : {})
      },
      body: JSON.stringify({
        kind: input.kind,
        owner: input.owner,
        repo: input.repo,
        version: input.version,
        target: input.target,
        client: input.client
      })
    });
  } catch {
    // CLI telemetry is best-effort and must never change local command results.
  }
}

function estimateContextCost(root: string): ContextCost {
  const files = contextFiles(root);
  const bytes = files.reduce((sum, file) => {
    try {
      return sum + statSync(path.join(root, file)).size;
    } catch {
      return sum;
    }
  }, 0);
  return {
    approxTokens: Math.round(bytes / 4),
    files: files.length,
    bytes,
    status: "estimated"
  };
}

function auditClaudeSetup(input: { homeDir: string; projectDir: string; staleDays: number }): SetupAudit {
  const roots = [
    { scope: "home" as const, dir: path.join(input.homeDir, ".claude") },
    { scope: "project" as const, dir: path.join(input.projectDir, ".claude") }
  ];
  const seenRoots = new Set<string>();
  const rootReports: SetupAudit["roots"] = [];
  const skills: SetupSkillAudit[] = [];
  for (const root of roots) {
    const resolved = path.resolve(root.dir);
    if (seenRoots.has(resolved)) continue;
    seenRoots.add(resolved);
    const report = scanClaudeRoot(root.scope, resolved);
    rootReports.push({
      scope: root.scope,
      exists: report.exists,
      skills: report.skills.length,
      markdownFiles: report.skills.reduce((sum, skill) => sum + skill.markdownFiles, 0),
      approxTokens: report.skills.reduce((sum, skill) => sum + skill.approxTokens, 0)
    });
    skills.push(...report.skills);
  }
  const conflicts = findSetupConflicts(skills);
  const stale = skills
    .filter((skill) => skill.ageDays >= input.staleDays)
    .map(({ terms: _terms, description: _description, approxTokens: _tokens, markdownFiles: _files, ...skill }) => skill)
    .sort((left, right) => right.ageDays - left.ageDays);
  const recommendations = setupRecommendations(skills, conflicts, stale.length);
  const summary = {
    roots: rootReports.length,
    existingRoots: rootReports.filter((root) => root.exists).length,
    skills: skills.length,
    markdownFiles: rootReports.reduce((sum, root) => sum + root.markdownFiles, 0),
    approxTokens: rootReports.reduce((sum, root) => sum + root.approxTokens, 0),
    staleSkills: stale.length,
    conflicts: conflicts.length
  };
  const publicSkills = skills.map(({ terms: _terms, ...skill }) => skill);
  return {
    summary,
    roots: rootReports,
    skills: publicSkills,
    conflicts,
    stale,
    recommendations,
    shareCard: setupShareCard(summary, recommendations)
  };
}

function scanClaudeRoot(scope: "home" | "project", claudeDir: string): { exists: boolean; skills: SetupSkillAudit[] } {
  if (!existsSync(claudeDir)) return { exists: false, skills: [] };
  const skillFiles = findSkillFiles(claudeDir);
  return {
    exists: true,
    skills: skillFiles.map((skillFile) => auditSkillFile(scope, claudeDir, skillFile)).sort((left, right) => `${left.scope}:${left.relativePath}`.localeCompare(`${right.scope}:${right.relativePath}`))
  };
}

function findSkillFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > 8 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full, depth + 1);
      else if (entry.isFile() && entry.name === "SKILL.md") files.push(full);
    }
  };
  visit(root, 0);
  return files;
}

function auditSkillFile(scope: "home" | "project", claudeDir: string, skillFile: string): SetupSkillAudit {
  const skillDir = path.dirname(skillFile);
  const text = readFileSync(skillFile, "utf8");
  const markdownFiles = markdownFilesUnder(skillDir);
  const bytes = markdownFiles.reduce((sum, file) => {
    try {
      return sum + statSync(path.join(skillDir, file)).size;
    } catch {
      return sum;
    }
  }, 0);
  const modifiedMs = markdownFiles.reduce((latest, file) => {
    try {
      return Math.max(latest, statSync(path.join(skillDir, file)).mtimeMs);
    } catch {
      return latest;
    }
  }, statSync(skillFile).mtimeMs);
  const description = extractSkillDescription(text);
  const relativePath = path.relative(claudeDir, skillFile).split(path.sep).join("/");
  return {
    scope,
    name: path.basename(skillDir),
    relativePath,
    description,
    approxTokens: Math.round(bytes / 4),
    markdownFiles: markdownFiles.length,
    modifiedAt: new Date(modifiedMs).toISOString(),
    ageDays: Math.max(0, Math.floor((Date.now() - modifiedMs) / 86_400_000)),
    terms: [...descriptionTerms(description)].sort()
  };
}

function markdownFilesUnder(root: string): string[] {
  const files: string[] = [];
  collectMarkdownFiles(root, root, files);
  return files.sort();
}

function extractSkillDescription(text: string): string {
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const source = frontmatter?.[1] ?? text.split("\n").slice(0, 40).join("\n");
  const descriptionLine = source.split(/\r?\n/).find((line) => /^\s*description\s*:/.test(line));
  if (descriptionLine) {
    const raw = descriptionLine.replace(/^\s*description\s*:\s*/, "").trim();
    const unquoted = raw.replace(/^['"]|['"]$/g, "").trim();
    if (unquoted && unquoted !== "|" && unquoted !== ">") return unquoted.slice(0, 280);
  }
  const heading = text.split(/\r?\n/).find((line) => /^#\s+/.test(line));
  if (heading) return heading.replace(/^#\s+/, "").trim().slice(0, 280);
  return "No trigger description found";
}

function descriptionTerms(description: string): Set<string> {
  const stop = new Set(["when", "with", "that", "this", "from", "into", "your", "user", "users", "task", "asks", "help", "using", "should", "would", "could", "about", "after", "before"]);
  const terms = new Set<string>();
  for (const match of description.toLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu)) {
    const term = match[0].replace(/^-+|-+$/g, "");
    if (term.length >= 4 && !stop.has(term)) terms.add(term);
  }
  return terms;
}

function findSetupConflicts(skills: SetupSkillAudit[]): SetupConflict[] {
  const conflicts: SetupConflict[] = [];
  for (let leftIndex = 0; leftIndex < skills.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < skills.length; rightIndex += 1) {
      const left = skills[leftIndex];
      const right = skills[rightIndex];
      const sharedTerms = left.terms.filter((term) => right.terms.includes(term));
      const unionSize = new Set([...left.terms, ...right.terms]).size;
      const similarity = unionSize ? sharedTerms.length / unionSize : 0;
      if (sharedTerms.length >= 3 && similarity >= 0.34) {
        conflicts.push({
          left: skillRef(left),
          right: skillRef(right),
          similarity: Number(similarity.toFixed(2)),
          sharedTerms: sharedTerms.slice(0, 8)
        });
      }
    }
  }
  return conflicts.sort((left, right) => right.similarity - left.similarity).slice(0, 10);
}

function skillRef(skill: SetupSkillAudit): Pick<SetupSkillAudit, "scope" | "name" | "relativePath"> {
  return { scope: skill.scope, name: skill.name, relativePath: skill.relativePath };
}

function setupRecommendations(skills: SetupSkillAudit[], conflicts: SetupConflict[], staleCount: number): string[] {
  const recommendations: string[] = [];
  const totalTokens = skills.reduce((sum, skill) => sum + skill.approxTokens, 0);
  if (!skills.length) {
    recommendations.push("No Claude skills found in home or project .claude directories; install or create one before expecting skill triggers.");
    return recommendations;
  }
  if (conflicts.length) recommendations.push("Review candidate trigger conflicts and narrow or merge overlapping skill descriptions before sharing the setup.");
  if (staleCount) recommendations.push("Review stale skills before sharing the setup; archive unused skills or refresh their trigger descriptions.");
  if (totalTokens > 20_000) recommendations.push("Trim long markdown references or split heavyweight skills; total local setup context is above 20k estimated tokens.");
  if (skills.some((skill) => skill.description === "No trigger description found")) recommendations.push("Add frontmatter descriptions to skills missing trigger text.");
  if (!recommendations.length) recommendations.push("Setup looks tight: no obvious trigger conflicts, stale skills or oversized context load.");
  return recommendations;
}

function setupShareCard(summary: SetupAudit["summary"], recommendations: string[]): string {
  return [
    "OnlyHarness setup audit",
    `Skills ${summary.skills} · context ~${summary.approxTokens} tokens · conflicts ${summary.conflicts} · stale ${summary.staleSkills}`,
    `Next: ${recommendations[0] ?? "Run hh audit-setup again after your next skill change."}`
  ].join("\n");
}

function setupAuditText(audit: SetupAudit): string {
  const lines = [
    "OnlyHarness setup audit",
    `Roots: ${audit.summary.existingRoots}/${audit.summary.roots} found`,
    `Skills: ${audit.summary.skills}`,
    `Context: ~${audit.summary.approxTokens} tokens across ${audit.summary.markdownFiles} markdown files`,
    `Conflicts: ${audit.summary.conflicts}`,
    `Stale: ${audit.summary.staleSkills}`,
    ""
  ];
  if (audit.conflicts.length) {
    lines.push("Candidate trigger conflicts:");
    for (const conflict of audit.conflicts) {
      lines.push(`- ${conflict.left.scope}:${conflict.left.relativePath} vs ${conflict.right.scope}:${conflict.right.relativePath} (${Math.round(conflict.similarity * 100)}%, ${conflict.sharedTerms.join(", ")})`);
    }
    lines.push("");
  }
  if (audit.stale.length) {
    lines.push("Stale candidates:");
    for (const skill of audit.stale.slice(0, 10)) {
      lines.push(`- ${skill.scope}:${skill.relativePath} (${skill.ageDays} days old)`);
    }
    lines.push("");
  }
  lines.push("Recommendations:");
  lines.push(...audit.recommendations.map((item) => `- ${item}`));
  lines.push("", "Share card:", audit.shareCard, "");
  return lines.join("\n");
}

function runBenchmarkSuite(suitePath: string, json = false): BenchmarkResult {
  if (!existsSync(suitePath)) fail(`Benchmark suite not found: ${suitePath}`, EXIT.NOT_FOUND, "hh benchmark benchmarks/research-discovery.yaml", json);
  const suite = (YAML.parse(readFileSync(suitePath, "utf8")) ?? {}) as BenchmarkSuiteFile;
  const suiteDir = path.dirname(suitePath);
  const minScore = benchmarkMinScore(suite.min_score);
  const entries = benchmarkEntries(suite);
  const notes = [
    "Local category benchmark runner. It compares declared eval case scores from harness repositories; it does not call an LLM or independently verify output quality.",
    "Use this for relative smoke checks until Owner-authored benchmark suites add externally measured scores."
  ];
  const rows = entries.map((entry, index) => benchmarkRow(entry, index, suiteDir, minScore));
  rows.sort((left, right) => right.score - left.score || left.riskScore - right.riskScore || left.label.localeCompare(right.label));
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });
  const candidates = rows.filter((row) => row.role === "candidate");
  const analogs = rows.filter((row) => row.role === "analog");
  const topCandidate = candidates[0] ? benchmarkSummaryRow(candidates[0]) : undefined;
  const topAnalog = analogs[0] ? benchmarkSummaryRow(analogs[0]) : undefined;
  const invalid = rows.filter((row) => !row.valid).length;
  const unverified = rows.filter((row) => !row.verified).length;
  let status: BenchmarkResult["status"] = "passed";
  if (!rows.length || !candidates.length || invalid || !candidates.some((row) => row.aboveMinScore)) status = "failed";
  else if (unverified) status = "unverified";
  const candidateDeltaVsAnalog = topCandidate && topAnalog
    ? Number((topCandidate.score - topAnalog.score).toFixed(3))
    : undefined;
  return {
    runner: "harnesshub-category-benchmark",
    suite: path.resolve(suitePath),
    category: suite.category ?? path.basename(suitePath, path.extname(suitePath)),
    title: suite.title ?? titleize(path.basename(suitePath, path.extname(suitePath))),
    ...(suite.description ? { description: suite.description } : {}),
    minScore,
    status,
    verificationStatus: unverified ? "unverified_or_missing_case_scores" : "declared_case_scores",
    generatedAt: new Date().toISOString(),
    summary: {
      harnesses: rows.length,
      candidates: candidates.length,
      analogs: analogs.length,
      verified: rows.filter((row) => row.verified).length,
      invalid,
      ...(topCandidate ? { topCandidate } : {}),
      ...(topAnalog ? { topAnalog } : {}),
      ...(candidateDeltaVsAnalog !== undefined ? { candidateDeltaVsAnalog } : {})
    },
    rows,
    notes
  };
}

function benchmarkEntries(suite: BenchmarkSuiteFile): BenchmarkSuiteEntry[] {
  return [
    ...benchmarkEntryList(suite.harnesses, "candidate"),
    ...benchmarkEntryList(suite.candidates, "candidate"),
    ...benchmarkEntryList(suite.analogs, "analog")
  ];
}

function benchmarkEntryList(entries: BenchmarkSuiteEntry[] | undefined, role: BenchmarkRole): BenchmarkSuiteEntry[] {
  return (entries ?? []).map((entry) => ({
    ...entry,
    role: entry.role ?? role
  }));
}

function benchmarkMinScore(value: unknown): number {
  const score = typeof value === "number" && Number.isFinite(value) ? value : 0.8;
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

function benchmarkRow(entry: BenchmarkSuiteEntry, index: number, suiteDir: string, minScore: number): BenchmarkRow {
  const role = entry.role ?? "candidate";
  if (!entry.path) {
    return {
      rank: index + 1,
      role,
      name: entry.name ?? `missing-path-${index + 1}`,
      label: entry.label ?? entry.name ?? `missing-path-${index + 1}`,
      path: "",
      valid: false,
      score: 0,
      status: "invalid",
      verified: false,
      verificationStatus: "missing_path",
      riskScore: 100,
      riskTier: "UNKNOWN",
      costUsd: 0,
      cases: 0,
      aboveMinScore: false,
      ...(entry.notes ? { notes: entry.notes } : {}),
      errors: ["benchmark entry requires path"]
    };
  }
  const root = path.resolve(suiteDir, entry.path);
  const validation = validateHarnessDir(root);
  const result = runLocalEval(root);
  const name = entry.name ?? validation.manifest?.name ?? path.basename(root);
  const errors = [
    ...validation.issues.filter((issue) => issue.severity === "error").map((issue) => `${issue.path}: ${issue.message}`),
    ...validation.risk.blocking
  ];
  const valid = Boolean(validation.valid && validation.manifest);
  return {
    rank: index + 1,
    role,
    name,
    label: entry.label ?? validation.manifest?.title ?? titleize(name),
    path: root,
    valid,
    score: result.score,
    status: result.status,
    verified: result.verified,
    verificationStatus: result.verification_status,
    riskScore: validation.risk.score,
    riskTier: validation.risk.tier,
    costUsd: result.cost_usd,
    cases: result.cases.length,
    aboveMinScore: result.verified && result.score >= minScore,
    ...(entry.notes ? { notes: entry.notes } : {}),
    errors
  };
}

function benchmarkSummaryRow(row: BenchmarkRow): Pick<BenchmarkRow, "name" | "label" | "score" | "riskScore"> {
  return {
    name: row.name,
    label: row.label,
    score: row.score,
    riskScore: row.riskScore
  };
}

function benchmarkText(result: BenchmarkResult): string {
  const lines = [
    `OnlyHarness benchmark: ${result.title}`,
    `Category: ${result.category}`,
    `Status: ${result.status}`,
    `Runner: ${result.runner} (${result.verificationStatus})`,
    `Min candidate score: ${result.minScore}`,
    `Harnesses: ${result.summary.harnesses} (${result.summary.candidates} candidates, ${result.summary.analogs} analogs)`,
    ""
  ];
  if (result.summary.topCandidate) {
    lines.push(`Top candidate: ${result.summary.topCandidate.label} (${result.summary.topCandidate.score})`);
  }
  if (result.summary.topAnalog) {
    lines.push(`Top analog: ${result.summary.topAnalog.label} (${result.summary.topAnalog.score})`);
  }
  if (result.summary.candidateDeltaVsAnalog !== undefined) {
    lines.push(`Candidate delta vs analog: ${signedNumber(result.summary.candidateDeltaVsAnalog)}`);
  }
  lines.push("", "Ranking:");
  for (const row of result.rows) {
    lines.push(`${row.rank}. [${row.role}] ${row.label} - score ${row.score}, risk ${row.riskScore} ${row.riskTier}, ${row.verified ? "verified" : row.verificationStatus}`);
    if (row.errors.length) lines.push(`   errors: ${row.errors.join("; ")}`);
  }
  lines.push("", "Notes:");
  lines.push(...result.notes.map((note) => `- ${note}`), "");
  return lines.join("\n");
}

function signedNumber(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function contextFiles(root: string): string[] {
  const files: string[] = [];
  if (!existsSync(root)) return files;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(entry.name);
  }
  for (const dir of ["agents", "skills", "runbooks", "prompts"]) {
    collectMarkdownFiles(root, path.join(root, dir), files);
  }
  return files.sort();
}

function collectMarkdownFiles(root: string, dir: string, files: string[]) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectMarkdownFiles(root, full, files);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(path.relative(root, full));
  }
}

function compareVersions(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (const key of ["major", "minor", "patch"] as const) {
    const diff = a[key] - b[key];
    if (diff !== 0) return diff;
  }
  if (!a.prerelease.length && b.prerelease.length) return 1;
  if (a.prerelease.length && !b.prerelease.length) return -1;
  if (a.prerelease.length && b.prerelease.length) return comparePrerelease(a.prerelease, b.prerelease);
  return 0;
}

function parseSemver(value: string): { major: number; minor: number; patch: number; prerelease: string[] } {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return { major: 0, minor: 0, patch: 0, prerelease: [value] };
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? []
  };
}

function comparePrerelease(left: string[], right: string[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const aNum = /^\d+$/.test(a) ? Number(a) : undefined;
    const bNum = /^\d+$/.test(b) ? Number(b) : undefined;
    if (aNum !== undefined && bNum !== undefined && aNum !== bNum) return aNum - bNum;
    if (aNum !== undefined && bNum === undefined) return -1;
    if (aNum === undefined && bNum !== undefined) return 1;
    const lexical = a.localeCompare(b);
    if (lexical !== 0) return lexical;
  }
  return 0;
}

function validationText(result: ReturnType<typeof validateHarnessDir>): string {
  return [
    result.valid ? "Harness valid" : "Harness invalid",
    `Risk: ${result.risk.score} ${result.risk.tier}`,
    ...result.issues.map((issue) => `- ${issue.severity.toUpperCase()} ${issue.path}: ${issue.message}`),
    ...result.risk.blocking.map((issue) => `- BLOCKING ${issue}`)
  ].join("\n") + "\n";
}

function inspectText(result: ReturnType<typeof inspectHarness> & { contextCost?: ContextCost }): string {
  const manifest = result.manifest;
  if (!manifest) return validationText(result);
  return [
    `${manifest.title} (${manifest.name})`,
    manifest.summary,
    `Runtime: ${manifest.runtime.primary}`,
    `Context: ${contextCostLabel(result.contextCost)}`,
    `Agents: ${result.components?.agents ?? 0}`,
    `Stages: ${result.components?.stages ?? 0}`,
    `Tools: ${result.components?.tools ?? 0}`,
    `Risk: ${result.risk.score} ${result.risk.tier}`
  ].join("\n") + "\n";
}

function formatRisk(report: ReturnType<typeof validateHarnessDir>["risk"], format: OutputFormat): string {
  if (format === "json") return JSON.stringify(report, null, 2);
  if (format === "markdown") return riskMarkdown(report);
  return `Risk: ${report.score} ${report.tier}\n${report.reasons.map((reason) => `- ${reason}`).join("\n")}\n`;
}

function formatDiff(diff: ReturnType<typeof diffHarnessDirs>, format: OutputFormat): string {
  if (format === "json") return JSON.stringify(diff, null, 2);
  if (format === "markdown") return semanticDiffMarkdown(diff);
  return semanticDiffMarkdown(diff);
}

function adaptHarness(input: { root: string; target: AdaptTarget; out?: string; force: boolean; json: boolean }): AdapterResult {
  const manifest = validManifest(input.root, input.json);
  const out = path.resolve(input.out ?? defaultAdapterOut(input.target, manifest));
  const content = adapterContent(input.target, manifest, input.root);
  const file = adapterFileForName(input.target, out, manifest.name);
  writeGeneratedFile(file, content, input.force, input.json);
  return {
    target: input.target,
    harness: manifest.name,
    root: input.root,
    out,
    files: [file],
    next: adapterNextSteps(input.target, input.root)
  };
}

function mcpConfigForHarness(input: { root: string; target: McpConfigTarget; out?: string; json: boolean }): McpConfigResult {
  const manifest = validManifest(input.root, input.json);
  const missingPackage = manifest.tools.mcp_servers.find((server) => !server.package);
  if (missingPackage) {
    fail(
      `MCP server ${missingPackage.id} has no package field.`,
      EXIT.VALIDATION,
      "Add tools.mcp_servers[].package before generating client config.",
      input.json
    );
  }
  const servers = manifest.tools.mcp_servers
    .filter((server): server is typeof server & { package: string } => Boolean(server.package))
    .map((server) => ({ id: server.id, package: server.package, required: server.required }));
  if (!servers.length) {
    fail("No package-backed MCP servers declared in this harness.", EXIT.VALIDATION, "Inspect tools.mcp_servers in harness.yaml.", input.json);
  }
  const config = {
    mcpServers: Object.fromEntries(servers.map((server) => [
      server.id,
      { command: "npx", args: ["-y", server.package] }
    ]))
  };
  const result: McpConfigResult = {
    target: input.target,
    harness: manifest.name,
    root: input.root,
    ...(input.out ? { out: path.resolve(input.out) } : {}),
    servers,
    config
  };
  if (input.out) writeJsonFile(path.resolve(input.out), config);
  return result;
}

function validManifest(root: string, json: boolean): HarnessManifest {
  const validation = validateHarnessDir(root);
  if (!validation.manifest || !validation.valid) {
    fail("Invalid harness manifest.", EXIT.VALIDATION, `hh validate ${displayPath(root)} --strict`, json);
  }
  return validation.manifest;
}

function cleanAdaptTarget(value: string | undefined): AdaptTarget | undefined {
  return value === "claude-code" || value === "codex" || value === "cursor" ? value : undefined;
}

function cleanMcpConfigTarget(value: string | undefined): McpConfigTarget | undefined {
  return value === "claude-desktop" || value === "claude-code" || value === "cursor" ? value : undefined;
}

function preflightAdapterWrite(input: { target: AdaptTarget; harnessName: string; out?: string; force: boolean; json: boolean }): void {
  if (input.force) return;
  const out = path.resolve(input.out ?? defaultAdapterOutForName(input.target, input.harnessName));
  const file = adapterFileForName(input.target, out, input.harnessName);
  if (existsSync(file)) {
    fail(`${displayPath(file)} already exists.`, EXIT.VALIDATION, "Pass --force to overwrite generated adapter files.", input.json);
  }
}

function defaultAdapterOut(target: AdaptTarget, manifest: HarnessManifest): string {
  return defaultAdapterOutForName(target, manifest.name);
}

function defaultAdapterOutForName(target: AdaptTarget, name: string): string {
  if (target === "claude-code") return path.join(".claude", "skills", name);
  if (target === "codex") return path.join(".codex", "harnesses", name);
  return path.join(".cursor", "rules");
}

function adapterContent(target: AdaptTarget, manifest: HarnessManifest, root: string): string {
  if (target === "claude-code") return claudeSkillAdapter(manifest, root);
  if (target === "codex") return codexAdapter(manifest, root);
  return cursorAdapter(manifest, root);
}

function adapterFileForName(target: AdaptTarget, out: string, name: string): string {
  if (target === "claude-code") return path.join(out, "SKILL.md");
  if (target === "codex") return path.join(out, "AGENTS.md");
  return path.join(out, `${name}.mdc`);
}

function claudeSkillAdapter(manifest: HarnessManifest, root: string): string {
  return [
    "---",
    `name: ${manifest.name}`,
    `description: "Use this local OnlyHarness harness for ${escapeFrontmatter(manifest.summary)}"`,
    "---",
    "",
    `# ${manifest.title}`,
    "",
    manifest.summary,
    "",
    `Harness root: \`${displayPath(root)}\``,
    "",
    "## Commands",
    "",
    "```bash",
    `hh inspect ${shellQuote(displayPath(root))} --json`,
    `hh run ${shellQuote(displayPath(root))} --json`,
    `hh eval ${shellQuote(displayPath(root))} --json`,
    `hh gate --dir ${shellQuote(displayPath(root))} --json`,
    "```",
    "",
    "Do not enable external_send, money_movement or new credentials beyond the manifest without explicit approval.",
    ""
  ].join("\n");
}

function codexAdapter(manifest: HarnessManifest, root: string): string {
  return [
    `# ${manifest.title}`,
    "",
    "This directory is a local OnlyHarness adapter for Codex.",
    "",
    `Harness root: \`${displayPath(root)}\``,
    `Summary: ${manifest.summary}`,
    "",
    "Use this loop before relying on the harness:",
    "",
    "```bash",
    `hh inspect ${shellQuote(displayPath(root))} --json`,
    `hh run ${shellQuote(displayPath(root))} --json`,
    `hh eval ${shellQuote(displayPath(root))} --json`,
    `hh gate --dir ${shellQuote(displayPath(root))} --json`,
    "```",
    "",
    "Keep runtime credentials injected at execution time; do not copy secrets into this adapter.",
    ""
  ].join("\n");
}

function cursorAdapter(manifest: HarnessManifest, root: string): string {
  return [
    "---",
    `description: ${JSON.stringify(`Use ${manifest.title} OnlyHarness workflow`)}`,
    "alwaysApply: false",
    "---",
    "",
    `# ${manifest.title}`,
    "",
    manifest.summary,
    "",
    `Harness root: \`${displayPath(root)}\``,
    "",
    "Before using this workflow, run:",
    "",
    "```bash",
    `hh inspect ${shellQuote(displayPath(root))} --json`,
    `hh eval ${shellQuote(displayPath(root))} --json`,
    `hh gate --dir ${shellQuote(displayPath(root))} --json`,
    "```",
    ""
  ].join("\n");
}

function adapterNextSteps(target: AdaptTarget, root: string): string[] {
  const displayed = shellQuote(displayPath(root));
  if (target === "claude-code") return [`hh mcp-config ${displayed} --target claude-code --out .mcp.json`, `hh eval ${displayed} --json`, `hh gate --dir ${displayed} --json`];
  if (target === "codex") return [`hh eval ${displayed} --json`, `hh gate --dir ${displayed} --json`];
  return [`hh mcp-config ${displayed} --target cursor`, `hh eval ${displayed} --json`, `hh gate --dir ${displayed} --json`];
}

function adapterText(result: AdapterResult): string {
  return [
    `Adapted ${result.harness} for ${result.target} -> ${displayPath(result.out)}`,
    ...result.files.map((file) => `- ${displayPath(file)}`),
    "Next:",
    ...result.next.map((step) => `- ${step}`),
    ""
  ].join("\n");
}

function writeGeneratedFile(file: string, content: string, force: boolean, json: boolean) {
  if (existsSync(file) && !force) {
    fail(`${displayPath(file)} already exists.`, EXIT.VALIDATION, "Pass --force to overwrite generated adapter files.", json);
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function escapeFrontmatter(value: string): string {
  return value.replace(/["\\]/g, "\\$&").replace(/\s+/g, " ").slice(0, 240);
}

function writeOutput(output: string, out?: string) {
  if (out) {
    mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    writeFileSync(path.resolve(out), output);
  } else {
    writeStdout(output.endsWith("\n") ? output : `${output}\n`);
  }
}

function writeStdout(output: unknown) {
  if (typeof output === "string") {
    process.stdout.write(output);
  } else {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  }
}

function resolveDiffDirs(range: string | undefined, baseDir: string | undefined, headDir: string): { baseDir: string; headDir: string; cleanup: () => void } {
  if (baseDir) {
    return { baseDir: path.resolve(baseDir), headDir: path.resolve(headDir), cleanup: () => undefined };
  }
  if (range?.includes("...")) {
    const [baseRef, headRef] = range.split("...");
    const baseTmp = materializeGitRef(baseRef);
    const headTmp = headRef === "HEAD" ? path.resolve(headDir) : materializeGitRef(headRef);
    return {
      baseDir: baseTmp,
      headDir: headTmp,
      cleanup: () => {
        rmSync(baseTmp, { recursive: true, force: true });
        if (headTmp !== path.resolve(headDir)) rmSync(headTmp, { recursive: true, force: true });
      }
    };
  }
  const baseFallback = path.resolve(".harnesshub/base");
  if (existsSync(baseFallback)) {
    return { baseDir: baseFallback, headDir: path.resolve(headDir), cleanup: () => undefined };
  }
  return { baseDir: path.resolve(headDir), headDir: path.resolve(headDir), cleanup: () => undefined };
}

function materializeGitRef(ref: string): string {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "hh-ref-"));
  const tree = spawnSync("git", ["ls-tree", "-r", "--name-only", ref], { encoding: "utf8" });
  if (tree.status !== 0) throw new Error(`Cannot read git ref ${ref}: ${tree.stderr}`);
  for (const file of tree.stdout.split("\n").filter(Boolean)) {
    if (!isHarnessPath(file)) continue;
    const content = spawnSync("git", ["show", `${ref}:${file}`], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    if (content.status !== 0) continue;
    const target = path.join(tmp, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content.stdout);
  }
  return tmp;
}

function isHarnessPath(file: string): boolean {
  return file === "harness.yaml" || /^(agents|prompts|tools|gates|evals|examples|runbooks)\//.test(file);
}

function runLocalEval(root: string) {
  const casesDir = path.join(root, "evals/cases");
  const files = existsSync(casesDir) ? readdirSync(casesDir).filter((file) => file.endsWith(".yaml") || file.endsWith(".yml")) : [];
  const cases = files.map((file) => {
    const parsed = YAML.parse(readFileSync(path.join(casesDir, file), "utf8")) ?? {};
    const hasMeasuredScore = typeof parsed.score === "number" && Number.isFinite(parsed.score);
    const score = hasMeasuredScore ? parsed.score : 0;
    return {
      id: path.basename(file, path.extname(file)),
      title: parsed.title ?? path.basename(file),
      score,
      passed: hasMeasuredScore && score >= 0.8,
      verification_status: hasMeasuredScore ? "declared_score" : "unverified_missing_score",
      ...(hasMeasuredScore ? {} : { note: "No measured case score declared; counted as unverified instead of inferred." })
    };
  });
  const score = cases.length ? Number((cases.reduce((sum, item) => sum + item.score, 0) / cases.length).toFixed(3)) : 0;
  const unverifiedCases = cases.filter((item) => item.verification_status !== "declared_score").length;
  return {
    runner: "harnesshub-local-eval",
    status: !cases.length || unverifiedCases ? "unverified" : score >= 0.8 ? "passed" : "failed",
    score,
    verified: Boolean(cases.length) && unverifiedCases === 0,
    verification_status: !cases.length ? "no_eval_cases" : unverifiedCases ? "unverified_missing_case_scores" : "declared_case_scores",
    cost_usd: Number((cases.length * 0.03).toFixed(2)),
    duration_ms: 250 + cases.length * 15,
    cases
  };
}

function evalText(result: ReturnType<typeof runLocalEval>): string {
  return [
    `Eval ${result.status}`,
    `Score: ${result.score}`,
    `Verification: ${result.verification_status}`,
    `Cost: $${result.cost_usd}`,
    ...result.cases.map((item) => `- ${item.passed ? "PASS" : "FAIL"} ${item.id}: ${item.score} (${item.verification_status})`)
  ].join("\n") + "\n";
}

function htmlReport(result: ReturnType<typeof runLocalEval>): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Harness Eval</title><style>body{font-family:Inter,system-ui,sans-serif;padding:32px;color:#17202a}table{border-collapse:collapse}td,th{border:1px solid #d8dee8;padding:8px 12px}</style></head><body><h1>Harness Eval</h1><p>Status: ${result.status}</p><p>Score: ${result.score}</p><p>Verification: ${result.verification_status}</p><table><thead><tr><th>Case</th><th>Score</th><th>Status</th><th>Verification</th></tr></thead><tbody>${result.cases.map((item) => `<tr><td>${item.title}</td><td>${item.score}</td><td>${item.passed ? "PASS" : "FAIL"}</td><td>${item.verification_status}</td></tr>`).join("")}</tbody></table></body></html>`;
}

function junitReport(result: ReturnType<typeof runLocalEval>): string {
  return `<?xml version="1.0" encoding="UTF-8"?><testsuite name="harness-eval" tests="${result.cases.length}" failures="${result.cases.filter((item) => !item.passed).length}">${result.cases.map((item) => `<testcase name="${escapeXml(item.id)}">${item.passed ? "" : `<failure message="score ${item.score}"/>`}</testcase>`).join("")}</testsuite>`;
}

function createHarnessFromMarkdown(text: string, out: string, name: string, sourcePath: string) {
  mkdirSync(out, { recursive: true });
  for (const dir of ["agents", "prompts", "tools", "gates", "evals/cases", "examples", "runbooks", ".gitea/workflows", ".harnesshub"]) {
    mkdirSync(path.join(out, dir), { recursive: true });
  }
  const title = titleize(name);
  const unverifiedResult = unverifiedImportResult("smoke", "Imported workflow smoke");
  writeFileSync(path.join(out, "harness.yaml"), YAML.stringify({
    schemaVersion: "harness.v0.1",
    name,
    title,
    summary: `Unverified imported harness scaffold for ${title}. Add real eval scores before publishing.`,
    version: "0.1.0",
    license: "UNSPECIFIED",
    maintainers: [{ name: "Harness.Hub Local" }],
    tags: ["imported", "unverified"],
    runtime: { primary: "openai-agents-sdk", adapters: [] },
    entrypoint: { command: "npm run harness:run", cwd: "." },
    inputs: [{ id: "request", type: "markdown", required: true }],
    outputs: [{ id: "final_result", type: "markdown" }],
    agents: [
      { id: "operator", role: "run_imported_workflow", title: "Operator", prompt: "agents/operator.md", tools: [], handoffs: [] }
    ],
    workflow: { entrypoint: "operator", stages: [{ id: "run", agent: "operator" }] },
    tools: { mcp_servers: [], function_tools: [], external_apis: [] },
    permissions: {
      network: "allowlist",
      network_allowlist: ["api.openai.com"],
      filesystem: "readonly",
      shell: false,
      browser: false,
      credentials: "runtime_injected",
      external_send: false,
      money_movement: false,
      user_data: false,
      human_approval_required: ["external_send", "money_movement"]
    },
    secrets: { required: ["OPENAI_API_KEY"], optional: [] },
    evals: {
      promptfoo_config: "evals/promptfooconfig.yaml",
      command: "npx promptfoo@latest eval -c evals/promptfooconfig.yaml -o .harnesshub/results.json -o .harnesshub/report.html -o .harnesshub/results.junit.xml"
    },
    quality_gates: { min_score: 0.82, max_regression: 0.03, max_cost_usd_per_run: 3, max_risk_score: 39, required_checks: ["schema_valid", "eval_passed", "no_high_risk_permission_delta"] },
    examples: [{ title: "Imported workflow smoke", input: "examples/input.md", output: "examples/expected.md" }]
  }));
  writeFileSync(path.join(out, "README.md"), `# ${title}\n\nImported from \`${sourcePath}\`.\n\nTrust status: unverified import. This scaffold has no measured eval score yet; \`.harnesshub/results.json\` intentionally records score \`0\` until a real eval run supplies evidence.\n\nBefore publishing:\n\n1. Review \`runbooks/source-import.md\` against the original source.\n2. Replace unresolved workflow notes.\n3. Add measured eval scores to \`evals/cases/*.yaml\` or wire a real evaluator.\n4. Run \`hh validate --strict && hh eval && hh gate\`.\n`);
  writeFileSync(path.join(out, "AGENTS.md"), `# ${title} - agent guide\n\nThis directory is an OnlyHarness harness.\n\n- Validate: hh validate . --strict\n- Run the bundled example (no LLM calls): hh run .\n- Score eval cases: hh eval . && hh gate --dir .\n- Manifest (runtime, permissions, gates): harness.yaml\n- Do not enable external_send or money_movement without human approval (see permissions).\n`);
  writeFileSync(path.join(out, "agents/operator.md"), `You run the imported workflow exactly as specified.\n\nTrust status: unverified import. Treat source gaps as unresolved until a human verifies them.\n\nRules:\n- Preserve the source intent.\n- Mark missing data as needs_resolution.\n- Do not invent tools, permissions, eval scores or external sends.\n`);
  writeFileSync(path.join(out, "evals/promptfooconfig.yaml"), "description: Imported harness smoke eval (unverified scaffold; add measured assertions before gating)\nprompts:\n  - agents/operator.md\nproviders:\n  - echo\n");
  writeFileSync(path.join(out, "evals/cases/smoke.yaml"), "title: Imported workflow smoke\nverification_status: unverified_import\nnote: Generated scaffold only; add a measured score after a real eval run.\n");
  writeFileSync(path.join(out, "examples/input.md"), "# Request\n\nRun the imported workflow on a small test case.\n");
  writeFileSync(path.join(out, "examples/expected.md"), "The result preserves the source workflow, marks unresolved fields as needs_resolution, and does not claim verification without a measured eval.\n");
  writeFileSync(path.join(out, "runbooks/source-import.md"), text);
  writeFileSync(path.join(out, ".harnesshub/results.json"), JSON.stringify(unverifiedResult, null, 2));
  writeFileSync(path.join(out, ".harnesshub/report.html"), htmlReport(unverifiedResult));
  writeFileSync(path.join(out, ".harnesshub/results.junit.xml"), junitReport(unverifiedResult));
  writeFileSync(path.join(out, ".gitea/workflows/harness-ci.yml"), defaultWorkflow());
}

function unverifiedImportResult(id: string, title: string) {
  return {
    runner: "harnesshub-local-eval",
    status: "unverified",
    score: 0,
    verified: false,
    verification_status: "unverified_import_scaffold",
    cost_usd: 0,
    duration_ms: 0,
    cases: [
      {
        id,
        title,
        score: 0,
        passed: false,
        verification_status: "unverified_import",
        note: "Generated scaffold only; add a measured eval score before gating."
      }
    ]
  };
}

function defaultWorkflow(): string {
  return `name: Harness CI
on:
  pull_request:
    paths:
      - "harness.yaml"
      - "agents/**"
      - "prompts/**"
      - "tools/**"
      - "gates/**"
      - "evals/**"
      - "examples/**"
  push:
    branches: [main]
jobs:
  validate-and-eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: OnlyHarness checks
        run: |
          npm install -g onlyharness
          hh validate --strict --json
          hh risk --format markdown
          hh diff origin/main...HEAD --format markdown
          hh eval --ci
          hh gate --results .harnesshub/results.json
`;
}

function extractSkillHarness(input: {
  skillQuery: string;
  out?: string;
  name?: string;
  title?: string;
  homeDir: string;
  projectDir: string;
  license: string;
  force: boolean;
  dryRun: boolean;
  json: boolean;
}): ExtractedSkill {
  const source = resolveSkillSource(input.skillQuery, { homeDir: input.homeDir, projectDir: input.projectDir }, input.json);
  const sourceText = readFileSync(source.skillFile, "utf8");
  const name = slugify(input.name ?? path.basename(source.skillDir));
  const title = input.title ?? titleize(name);
  const out = input.out ?? path.resolve(name);
  if (!input.dryRun && existsSync(out) && readdirSync(out).length > 0 && !input.force) {
    fail(`${displayPath(out)} exists and is not empty.`, EXIT.VALIDATION, `hh extract ${source.displayPath} --out ${displayPath(out)} --force`, input.json);
  }
  const markdownFiles = markdownFilesUnder(source.skillDir);
  const dependencies = inferSkillDependencies(source.skillDir, sourceText);
  if (!input.dryRun) {
    writeExtractedSkillHarness({
      out,
      name,
      title,
      source,
      description: extractSkillDescription(sourceText),
      license: input.license,
      markdownFiles,
      dependencies
    });
  }
  return {
    name,
    title,
    out: displayPath(out),
    source: source.displayPath,
    markdownFiles: markdownFiles.length,
    depends_on: dependencies
  };
}

function resolveSkillSource(query: string, roots: { homeDir: string; projectDir: string }, json = false): { skillDir: string; skillFile: string; displayPath: string } {
  const pathLike = query.includes("/") || query.includes("\\") || query === "." || query.startsWith("~");
  const expanded = query.startsWith("~/") ? path.join(os.homedir(), query.slice(2)) : query;
  const directPath = path.resolve(expanded);
  if (existsSync(directPath)) {
    return skillSourceFromPath(directPath, json);
  }
  if (pathLike) {
    fail(`Skill path not found: ${path.basename(query)}`, EXIT.NOT_FOUND, "hh extract <skill-name> or hh extract ~/.claude/skills/<skill-name>", json);
  }
  const candidates = findNamedSkillCandidates(query, roots);
  if (!candidates.length) {
    fail(`Skill not found: ${query}`, EXIT.NOT_FOUND, `hh audit-setup --home-dir ${displayPath(roots.homeDir)} --project-dir ${displayPath(roots.projectDir)}`, json);
  }
  if (candidates.length > 1) {
    const labels = candidates.map((candidate) => candidate.displayPath).join(", ");
    fail(`Skill name is ambiguous: ${query}`, EXIT.VALIDATION, `Use an explicit path. Candidates: ${labels}`, json);
  }
  return candidates[0];
}

function skillSourceFromPath(skillPath: string, json = false): { skillDir: string; skillFile: string; displayPath: string } {
  const stat = statSync(skillPath);
  const skillFile = stat.isDirectory() ? path.join(skillPath, "SKILL.md") : skillPath;
  if (!existsSync(skillFile) || path.basename(skillFile) !== "SKILL.md") {
    fail("Expected a skill directory containing SKILL.md or a SKILL.md file.", EXIT.VALIDATION, "hh extract ~/.claude/skills/<skill-name>", json);
  }
  return {
    skillDir: path.dirname(skillFile),
    skillFile,
    displayPath: path.basename(path.dirname(skillFile))
  };
}

function findNamedSkillCandidates(query: string, roots: { homeDir: string; projectDir: string }): Array<{ skillDir: string; skillFile: string; displayPath: string }> {
  const normalized = slugify(query);
  const searchRoots = [
    { scope: "home", dir: path.join(roots.homeDir, ".claude") },
    { scope: "project", dir: path.join(roots.projectDir, ".claude") }
  ];
  const candidates: Array<{ skillDir: string; skillFile: string; displayPath: string }> = [];
  const seen = new Set<string>();
  for (const root of searchRoots) {
    if (!existsSync(root.dir)) continue;
    for (const skillFile of findSkillFiles(root.dir)) {
      const skillDir = path.dirname(skillFile);
      const name = path.basename(skillDir);
      if (name !== query && slugify(name) !== normalized) continue;
      const resolved = path.resolve(skillFile);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      candidates.push({
        skillDir,
        skillFile,
        displayPath: `${root.scope}:${path.relative(root.dir, skillFile).split(path.sep).join("/")}`
      });
    }
  }
  return candidates.sort((left, right) => left.displayPath.localeCompare(right.displayPath));
}

function inferSkillDependencies(skillDir: string, skillText: string): ExtractDependency[] {
  const dependencies = new Map<string, ExtractDependency>();
  for (const dependency of explicitSkillDependencies(skillText)) {
    if (!dependency) continue;
    dependencies.set(dependency.ref, dependency);
  }
  const parent = path.dirname(skillDir);
  const self = path.basename(skillDir);
  if (existsSync(parent)) {
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === self) continue;
      if (!existsSync(path.join(parent, entry.name, "SKILL.md"))) continue;
      const plain = entry.name;
      const slug = slugify(plain);
      const patterns = [
        new RegExp(`\\b${escapeRegex(plain)}\\b`, "i"),
        new RegExp(`\\$${escapeRegex(plain)}\\b`, "i"),
        new RegExp(`\\b${escapeRegex(slug)}\\b`, "i")
      ];
      if (patterns.some((pattern) => pattern.test(skillText))) {
        const ref = normalizeDependencyRef(`skill:${slug}`);
        if (ref && !dependencies.has(ref)) {
          dependencies.set(ref, { ref, optional: true, reason: "Mentioned sibling skill in source text" });
        }
      }
    }
  }
  return [...dependencies.values()].sort((left, right) => left.ref.localeCompare(right.ref)).slice(0, 20);
}

function explicitSkillDependencies(skillText: string): ExtractDependency[] {
  const frontmatter = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return [];
  try {
    const parsed = YAML.parse(frontmatter[1]) as { depends_on?: unknown; dependencies?: unknown };
    const raw = parsed?.depends_on ?? parsed?.dependencies;
    const items = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
    return items
      .map((item) => typeof item === "string" ? parseDependencyString(item, false, "Declared in source skill frontmatter") : parseDependencyObject(item))
      .filter((item): item is ExtractDependency => Boolean(item));
  } catch {
    return [];
  }
  return [];
}

function parseDependencyObject(value: unknown): ExtractDependency | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as { ref?: unknown; version?: unknown; optional?: unknown; reason?: unknown };
  if (typeof input.ref !== "string") return undefined;
  const parsed = parseDependencyString(input.ref, Boolean(input.optional), typeof input.reason === "string" ? input.reason : "Declared in source skill frontmatter");
  if (!parsed) return undefined;
  if (typeof input.version === "string" && input.version.trim()) parsed.version = input.version.trim();
  return parsed;
}

function parseDependencyString(value: string, optional: boolean, reason: string): ExtractDependency | undefined {
  const cleaned = value.trim().replace(/^['"]|['"]$/g, "");
  const versionSplit = splitDependencyVersion(cleaned);
  const ref = normalizeDependencyRef(versionSplit.ref);
  if (!ref) return undefined;
  return {
    ref,
    ...(versionSplit.version ? { version: versionSplit.version } : {}),
    optional,
    reason
  };
}

function splitDependencyVersion(value: string): { ref: string; version?: string } {
  const at = value.lastIndexOf("@");
  if (at > 0 && at < value.length - 1) {
    return { ref: value.slice(0, at), version: value.slice(at + 1) };
  }
  return { ref: value };
}

function normalizeDependencyRef(value: string): string | undefined {
  const cleaned = value.trim().replace(/^['"]|['"]$/g, "");
  if (!/^[a-z0-9][a-z0-9_./:@-]*$/.test(cleaned)) return undefined;
  return cleaned;
}

function writeExtractedSkillHarness(input: {
  out: string;
  name: string;
  title: string;
  source: { skillDir: string; displayPath: string };
  description: string;
  license: string;
  markdownFiles: string[];
  dependencies: ExtractDependency[];
}) {
  mkdirSync(input.out, { recursive: true });
  for (const dir of ["agents", "evals/cases", "examples", "runbooks/source", ".gitea/workflows", ".harnesshub"]) {
    mkdirSync(path.join(input.out, dir), { recursive: true });
  }
  const unverifiedResult = unverifiedImportResult("extract-smoke", "Extracted skill smoke");
  const sourceSummary = input.description === "No trigger description found"
    ? `Extracted local skill ${input.source.displayPath}.`
    : input.description;
  writeFileSync(path.join(input.out, "harness.yaml"), YAML.stringify({
    schemaVersion: "harness.v0.2",
    name: input.name,
    title: input.title,
    summary: `Extracted local skill harness for ${input.title}. Review dependencies and evals before publishing.`,
    version: "0.1.0",
    license: input.license,
    visibility: "private",
    pricing: { model: "free", currency: "USD" },
    source: {
      attribution: `Extracted from local skill ${input.source.displayPath}`,
      authors: [],
      vendor_policy: "original"
    },
    compatibility: {
      targets: [
        { id: "claude-code", name: "Claude Code skill", status: "available", notes: "Extracted from a Claude skill directory" },
        { id: "onlyharness", name: "OnlyHarness harness", status: "available", notes: "Generated scaffold validates locally" }
      ]
    },
    depends_on: input.dependencies,
    content: { type: "harness" },
    maintainers: [{ name: "Harness.Hub Local" }],
    tags: ["extracted", "skill", "unverified"],
    runtime: { primary: "none", adapters: [] },
    inputs: [{ id: "request", type: "markdown", required: true }],
    outputs: [{ id: "final_result", type: "markdown" }],
    agents: [
      { id: "operator", role: "run_extracted_skill", title: "Operator", prompt: "agents/operator.md", tools: [], handoffs: [] }
    ],
    workflow: { entrypoint: "operator", stages: [{ id: "run", agent: "operator" }] },
    tools: { mcp_servers: [], function_tools: [], external_apis: [] },
    permissions: {
      network: "false",
      network_allowlist: [],
      filesystem: "readonly",
      shell: false,
      browser: false,
      credentials: "false",
      external_send: false,
      money_movement: false,
      user_data: false,
      human_approval_required: []
    },
    secrets: { required: [], optional: [] },
    evals: {
      promptfoo_config: "evals/promptfooconfig.yaml",
      command: "npx promptfoo@latest eval -c evals/promptfooconfig.yaml"
    },
    quality_gates: { min_score: 0.82, max_regression: 0.03, max_cost_usd_per_run: 1, max_risk_score: 25, required_checks: ["schema_valid", "eval_passed"] },
    examples: [{ title: "Extracted skill smoke", input: "examples/input.md", output: "examples/expected.md" }]
  }));
  writeFileSync(path.join(input.out, "README.md"), `# ${input.title}\n\nExtracted from local skill \`${input.source.displayPath}\`.\n\nTrust status: unverified extraction. The scaffold copies markdown instructions only, redacts obvious token-shaped secrets, and records candidate dependencies in \`depends_on\` for human review.\n\nSource trigger:\n\n> ${sourceSummary.replace(/\n/g, " ").slice(0, 500)}\n\nBefore publishing:\n\n1. Review \`runbooks/source/\` for private context.\n2. Confirm every \`depends_on\` entry in \`harness.yaml\`.\n3. Add measured eval scores to \`evals/cases/*.yaml\`.\n4. Run \`hh validate --strict && hh eval && hh gate\`.\n`);
  writeFileSync(path.join(input.out, "AGENTS.md"), `# ${input.title} - agent guide\n\nThis directory is an extracted OnlyHarness harness.\n\n- Validate: hh validate . --strict\n- Inspect risk/context: hh inspect . --json\n- Source markdown lives under runbooks/source/\n- Do not publish until private context and depends_on entries are reviewed.\n`);
  writeFileSync(path.join(input.out, "agents/operator.md"), `Use the extracted skill instructions in runbooks/source/SKILL.md to satisfy the request.\n\nRules:\n- Treat the extraction as unverified until evals are measured.\n- Preserve dependency notes from harness.yaml depends_on.\n- Do not reveal private paths, credentials or local-only context.\n- Ask for human review before external sends, payments or account-changing actions.\n`);
  for (const file of input.markdownFiles) {
    const sourceFile = path.join(input.source.skillDir, file);
    const target = path.join(input.out, "runbooks/source", file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, redact(readFileSync(sourceFile, "utf8")));
  }
  writeFileSync(path.join(input.out, "runbooks/dependency-review.md"), dependencyReviewMarkdown(input.dependencies));
  writeFileSync(path.join(input.out, "evals/promptfooconfig.yaml"), "description: Extracted skill smoke eval (unverified scaffold; add measured assertions before gating)\nprompts:\n  - agents/operator.md\nproviders:\n  - echo\n");
  writeFileSync(path.join(input.out, "evals/cases/extract-smoke.yaml"), "title: Extracted skill smoke\nverification_status: unverified_extraction\nnote: Generated scaffold only; add a measured score after a real eval run.\n");
  writeFileSync(path.join(input.out, "examples/input.md"), "# Request\n\nRun this extracted skill on a small safe task.\n");
  writeFileSync(path.join(input.out, "examples/expected.md"), "The result follows the extracted skill, names unresolved dependencies, and does not claim verification without measured eval evidence.\n");
  writeFileSync(path.join(input.out, ".harnesshub/results.json"), JSON.stringify(unverifiedResult, null, 2));
  writeFileSync(path.join(input.out, ".harnesshub/report.html"), htmlReport(unverifiedResult));
  writeFileSync(path.join(input.out, ".harnesshub/results.junit.xml"), junitReport(unverifiedResult));
  writeFileSync(path.join(input.out, ".harnesshub/extract.json"), JSON.stringify({
    source: input.source.displayPath,
    extractedAt: new Date().toISOString(),
    markdownFiles: input.markdownFiles,
    depends_on: input.dependencies
  }, null, 2));
  writeFileSync(path.join(input.out, ".gitea/workflows/harness-ci.yml"), defaultWorkflow());
}

function dependencyReviewMarkdown(dependencies: ExtractDependency[]): string {
  if (!dependencies.length) return "# Dependency Review\n\nNo candidate dependencies were detected. Review the source manually before publishing.\n";
  return [
    "# Dependency Review",
    "",
    "Candidate dependencies inferred during extraction:",
    "",
    ...dependencies.map((dependency) => `- \`${dependency.ref}\` (${dependency.optional ? "optional" : "required"}): ${dependency.reason}`),
    "",
    "Review these before publishing; this is a heuristic, not proof."
  ].join("\n");
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "imported-harness";
}

function displayPath(value: string): string {
  const resolved = path.resolve(value);
  const relative = path.relative(process.cwd(), resolved);
  if (!relative) return ".";
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return relative.split(path.sep).join("/");
  return resolved;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleize(value: string): string {
  return value.split(/[-_\s]+/).filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" }[char] ?? char));
}

function redact(value: string): string {
  return value.replace(/sk-[A-Za-z0-9]{20,}/g, "sk-REDACTED").replace(/(api[_-]?key|token)([:=]\s*)[A-Za-z0-9_\-]{16,}/gi, "$1$2REDACTED");
}
