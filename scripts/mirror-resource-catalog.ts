import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { onlyHarnessResourceArchiveUrl, onlyHarnessResourceUrl, type ResourceAction, type ResourceCatalog, type ResourceMirror, type SeedResource } from "./resource-catalog-shared.js";

type MirrorStatus = ResourceMirror["status"];

type MirrorRecord = {
  resourceId: string;
  upstreamFullName: string;
  mirrorRepo: string;
  mirrorFullName: string;
  mirrorUrl: string;
  cloneUrl?: string;
  defaultBranch?: string;
  defaultBranchOnly: boolean;
  fork: boolean;
  status: MirrorStatus;
  lastAttemptAt: string;
  syncedAt?: string;
  error?: string;
};

type MirrorState = {
  owner: string;
  updatedAt: string;
  records: Record<string, MirrorRecord>;
};

type GitHubRepo = {
  id?: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url?: string;
  fork?: boolean;
  default_branch?: string;
};

type GitHubResponse<T> = {
  status: number;
  ok: boolean;
  data: T;
};

class GitHubRateLimitError extends Error {
  constructor(message: string, readonly resetAt?: string) {
    super(message);
    this.name = "GitHubRateLimitError";
  }
}

const root = path.resolve(import.meta.dirname, "..");
const defaultCatalogPath = path.join(root, "data/resources/verified-2026-07.json");
const defaultStatePath = path.join(root, "data/resources/mirrors-overclawswarm.json");
const apiBase = "https://api.github.com";

async function main() {
  const catalogPath = argValue("--catalog") ?? defaultCatalogPath;
  const outputPath = argValue("--output") ?? catalogPath;
  const statePath = argValue("--state") ?? defaultStatePath;
  const owner = argValue("--owner") ?? process.env.ONLYHARNESS_MIRROR_OWNER ?? "overclawswarm";
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const dryRun = process.argv.includes("--dry-run");
  const applyStateOnly = process.argv.includes("--apply-state-only");
  const minimalApi = process.argv.includes("--minimal-api");
  const syncExisting = process.argv.includes("--sync-existing");
  const refreshReady = process.argv.includes("--refresh-ready");
  const only = argValue("--only");
  const limit = numberArg("--limit");
  const limitNew = numberArg("--limit-new");
  const start = numberArg("--start") ?? 0;
  const intervalMs = numberArg("--interval-ms") ?? 2500;
  const pollAttempts = numberArg("--poll-attempts") ?? 30;
  const pollMs = numberArg("--poll-ms") ?? 4000;

  const catalog = readJson<ResourceCatalog>(catalogPath);
  const state = readState(statePath, owner);
  const authLogin = argValue("--auth-login") ?? (token && !dryRun && !applyStateOnly ? await authenticatedLogin(token) : undefined);

  let nextResources = catalog.resources.map((resource) => applyRecord(resource, state.records[resource.id], owner));
  if (applyStateOnly) {
    writeCatalog(outputPath, { ...catalog, generatedAt: state.updatedAt, resources: nextResources });
    console.log(`Applied mirror state to ${outputPath}`);
    return;
  }
  const eligible = nextResources.filter((resource) => isGitHubMirrorCandidate(resource) && matchesOnly(resource, only));
  const selected = limitNew !== undefined
    ? eligible.filter((resource) => state.records[resource.id]?.status !== "ready").slice(0, limitNew)
    : eligible.slice(start, limit ? start + limit : undefined);
  console.log(`Mirror namespace ${owner}: selected ${selected.length}/${eligible.length} resources${dryRun ? " (dry-run)" : ""}`);

  if (dryRun) {
    for (const resource of selected.slice(0, 20)) {
      console.log(`${resource.id} -> ${owner}/${mirrorRepoName(resource)}`);
    }
    return;
  }
  if (!token) throw new Error("Set GH_TOKEN or GITHUB_TOKEN before creating mirrors");
  if (!authLogin) throw new Error("Could not resolve authenticated GitHub user");

  for (const resource of selected) {
    const existing = state.records[resource.id];
    if (existing?.status === "ready" && !refreshReady && !syncExisting) {
      nextResources = upsertResource(nextResources, applyRecord(resource, existing, owner));
      continue;
    }

    let record: MirrorRecord;
    try {
      record = await mirrorResource({
        resource,
        owner,
        token,
        authLogin,
        pollAttempts,
        pollMs,
        syncExisting,
        minimalApi
      });
    } catch (error) {
      writeCatalog(outputPath, { ...catalog, generatedAt: state.updatedAt, resources: nextResources });
      if (error instanceof GitHubRateLimitError) {
        const reset = error.resetAt ? ` Reset: ${error.resetAt}.` : "";
        throw new Error(`GitHub rate limit reached.${reset} Re-run this command to resume; ready mirrors were kept.`);
      }
      throw error;
    }
    state.records[resource.id] = record;
    state.updatedAt = new Date().toISOString();
    writeState(statePath, state);
    nextResources = upsertResource(nextResources, applyRecord(resource, record, owner));
    writeCatalog(outputPath, { ...catalog, generatedAt: state.updatedAt, resources: nextResources });
    console.log(`${record.status.toUpperCase()} ${record.resourceId} -> ${record.mirrorFullName}${record.error ? ` (${record.error})` : ""}`);
    if (intervalMs > 0) await sleep(intervalMs);
  }

  writeCatalog(outputPath, { ...catalog, generatedAt: state.updatedAt, resources: nextResources });
  console.log(`Wrote mirror catalog to ${outputPath}`);
  console.log(`Wrote mirror state to ${statePath}`);
}

async function mirrorResource(options: {
  resource: SeedResource;
  owner: string;
  token: string;
  authLogin: string;
  pollAttempts: number;
  pollMs: number;
  syncExisting: boolean;
  minimalApi: boolean;
}): Promise<MirrorRecord> {
  const { resource, owner, token, authLogin, pollAttempts, pollMs, syncExisting, minimalApi } = options;
  const now = new Date().toISOString();
  const mirrorRepo = mirrorRepoName(resource);
  const upstreamFullName = `${resource.upstreamOwner}/${resource.upstreamRepo}`;
  const mirrorFullName = `${owner}/${mirrorRepo}`;
  const fallbackRecord: MirrorRecord = {
    resourceId: resource.id,
    upstreamFullName,
    mirrorRepo,
    mirrorFullName,
    mirrorUrl: `https://github.com/${mirrorFullName}`,
    defaultBranchOnly: true,
    fork: true,
    status: "pending",
    lastAttemptAt: now
  };

  try {
    let repo = minimalApi ? undefined : await getRepo(owner, mirrorRepo, token);
    if (!repo) {
      repo = await createFork(resource.upstreamOwner, resource.upstreamRepo, owner, mirrorRepo, token, authLogin);
      if (!minimalApi) {
        repo = await waitForRepo(owner, mirrorRepo, token, pollAttempts, pollMs);
      }
    }
    if (!repo) {
      return { ...fallbackRecord, status: "pending", error: "GitHub accepted fork but repo is not visible yet" };
    }

    const metadataErrors: string[] = [];
    if (!minimalApi) {
      try {
        await patchRepoMetadata(owner, mirrorRepo, resource, token);
      } catch (error) {
        metadataErrors.push(errorMessage(error));
      }
      try {
        await putRepoTopics(owner, mirrorRepo, resource, token);
      } catch (error) {
        metadataErrors.push(errorMessage(error));
      }
    }
    let syncedAt: string | undefined;
    if (syncExisting && repo.default_branch) {
      try {
        await syncFork(owner, mirrorRepo, repo.default_branch, token);
        syncedAt = new Date().toISOString();
      } catch (error) {
        metadataErrors.push(errorMessage(error));
      }
    }

    return {
      ...fallbackRecord,
      mirrorUrl: repo.html_url,
      cloneUrl: repo.clone_url,
      defaultBranch: repo.default_branch,
      fork: Boolean(repo.fork),
      status: "ready",
      syncedAt: syncedAt ?? now,
      error: metadataErrors.length ? metadataErrors.join("; ") : undefined
    };
  } catch (error) {
    if (error instanceof GitHubRateLimitError) throw error;
    return { ...fallbackRecord, status: "failed", error: errorMessage(error) };
  }
}

async function authenticatedLogin(token: string): Promise<string> {
  const response = await gh<{ login?: string }>("GET", "/user", token);
  if (!response.data.login) throw new Error("GitHub token did not return a login");
  return response.data.login;
}

async function getRepo(owner: string, repo: string, token: string): Promise<GitHubRepo | undefined> {
  const response = await gh<GitHubRepo | { message?: string }>("GET", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, token, undefined, [404]);
  if (response.status === 404) return undefined;
  return response.data as GitHubRepo;
}

async function createFork(upstreamOwner: string, upstreamRepo: string, owner: string, mirrorRepo: string, token: string, authLogin: string): Promise<GitHubRepo | undefined> {
  const body: Record<string, unknown> = {
    name: mirrorRepo,
    default_branch_only: true
  };
  if (owner !== authLogin) body.organization = owner;
  const response = await gh<GitHubRepo>("POST", `/repos/${encodeURIComponent(upstreamOwner)}/${encodeURIComponent(upstreamRepo)}/forks`, token, body, [202, 201]);
  return response.data?.html_url ? response.data : undefined;
}

async function waitForRepo(owner: string, repo: string, token: string, attempts: number, intervalMs: number): Promise<GitHubRepo | undefined> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const found = await getRepo(owner, repo, token);
    if (found) return found;
    await sleep(intervalMs);
  }
  return undefined;
}

async function patchRepoMetadata(owner: string, repo: string, resource: SeedResource, token: string): Promise<void> {
  const description = `OnlyHarness mirror of ${resource.upstreamOwner}/${resource.upstreamRepo}. Source: ${resource.canonicalUrl}`;
  await gh("PATCH", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, token, {
    description: description.slice(0, 350),
    homepage: resource.canonicalUrl,
    has_issues: false,
    has_projects: false,
    has_wiki: false
  });
}

async function putRepoTopics(owner: string, repo: string, resource: SeedResource, token: string): Promise<void> {
  const names = [
    "onlyharness",
    "onlyharness-mirror",
    "agent-resource",
    safeTopic(resource.resourceType)
  ].filter(Boolean);
  await gh("PUT", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/topics`, token, { names });
}

async function syncFork(owner: string, repo: string, branch: string, token: string): Promise<void> {
  await gh("POST", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/merge-upstream`, token, { branch }, [200, 202, 204]);
}

async function gh<T = unknown>(
  method: string,
  requestPath: string,
  token: string,
  body?: unknown,
  allowedStatuses: number[] = []
): Promise<GitHubResponse<T>> {
  const response = await fetch(`${apiBase}${requestPath}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "onlyharness-mirror-seeder",
      "x-github-api-version": "2022-11-28"
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) as T & { message?: string } : {} as T;
  if (!response.ok && !allowedStatuses.includes(response.status)) {
    const message = typeof data === "object" && data && "message" in data ? String(data.message) : response.statusText;
    if (response.status === 403 && /rate limit/i.test(message)) {
      const reset = response.headers.get("x-ratelimit-reset");
      const resetAt = reset ? new Date(Number(reset) * 1000).toISOString() : undefined;
      throw new GitHubRateLimitError(message, resetAt);
    }
    throw new Error(`${method} ${requestPath} failed ${response.status}: ${message}`);
  }
  return { status: response.status, ok: response.ok, data };
}

function applyRecord(resource: SeedResource, record: MirrorRecord | undefined, owner: string): SeedResource {
  if (!record) return { ...resource, actions: upstreamActions(resource) };
  if (record.status !== "ready") {
    const { mirror: _mirror, ...withoutMirror } = resource;
    return {
      ...withoutMirror,
      actions: upstreamActions(resource)
    };
  }
  const mirror: ResourceMirror = {
    platform: "github",
    owner,
    repo: record.mirrorRepo,
    fullName: record.mirrorFullName,
    url: record.mirrorUrl,
    cloneUrl: record.cloneUrl,
    defaultBranch: record.defaultBranch,
    defaultBranchOnly: record.defaultBranchOnly,
    fork: record.fork,
    sourceUrl: resource.canonicalUrl,
    status: record.status,
    syncedAt: record.syncedAt,
    error: publicMirrorError(record)
  };
  return {
    ...resource,
    mirror,
    actions: actionsForMirror(resource, mirror)
  };
}

function publicMirrorError(record: MirrorRecord): string | undefined {
  if (!record.error) return undefined;
  if (/rate limit/i.test(record.error)) return "GitHub rate limit; retry pending.";
  if (record.status === "failed") return "Mirror creation failed; retry pending.";
  return undefined;
}

function actionsForMirror(resource: SeedResource, mirror: ResourceMirror): ResourceAction[] {
  const rest = resource.actions.filter((action) => action.id !== "open_onlyharness" && action.id !== "open_mirror" && action.id !== "open_upstream" && action.id !== "download_archive");
  const actions: ResourceAction[] = [
    { id: "open_onlyharness", label: "Use in SuperSkill", url: onlyHarnessResourceUrl(resource.id) },
    ...(localArchiveExists(resource.id) ? [{ id: "download_archive" as const, label: "Download from SuperSkill", url: onlyHarnessResourceArchiveUrl(resource.id) }] : []),
    { id: "open_upstream", label: "Open upstream source", url: resource.canonicalUrl }
  ];
  return [...actions, ...rest];
}

function upstreamActions(resource: SeedResource): ResourceAction[] {
  const rest = resource.actions.filter((action) => action.id !== "open_onlyharness" && action.id !== "open_mirror" && action.id !== "open_upstream" && action.id !== "download_archive");
  const actions: ResourceAction[] = [
    { id: "open_onlyharness", label: "Use in SuperSkill", url: onlyHarnessResourceUrl(resource.id) },
    ...(localArchiveExists(resource.id) ? [{ id: "download_archive" as const, label: "Download from SuperSkill", url: onlyHarnessResourceArchiveUrl(resource.id) }] : []),
    { id: "open_upstream", label: "Use upstream", url: resource.canonicalUrl },
  ];
  return [...actions, ...rest];
}

function localArchiveExists(id: string): boolean {
  return existsSync(path.join(archiveRoot(), `${Buffer.from(id, "utf8").toString("base64url")}.tar.gz`));
}

function archiveRoot(): string {
  return process.env.RESOURCE_ARCHIVE_DIR ? path.resolve(process.env.RESOURCE_ARCHIVE_DIR) : path.join(root, "data/resources/archives");
}

function isGitHubMirrorCandidate(resource: SeedResource): boolean {
  return resource.sourcePlatform === "github"
    && resource.canonicalUrl.startsWith("https://github.com/")
    && Boolean(resource.upstreamOwner)
    && Boolean(resource.upstreamRepo);
}

function matchesOnly(resource: SeedResource, only: string | undefined): boolean {
  if (!only) return true;
  const normalized = only.toLowerCase();
  return resource.id.toLowerCase() === normalized
    || resource.upstreamId.toLowerCase() === normalized
    || `${resource.upstreamOwner}/${resource.upstreamRepo}`.toLowerCase() === normalized;
}

function mirrorRepoName(resource: SeedResource): string {
  const base = `oh-${safeRepoPart(resource.upstreamOwner)}-${safeRepoPart(resource.upstreamRepo)}`.replace(/-+/g, "-");
  if (base.length <= 96) return base;
  const hash = createHash("sha256").update(resource.id).digest("hex").slice(0, 10);
  return `${base.slice(0, 85).replace(/[-._]+$/g, "")}-${hash}`;
}

function safeRepoPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "") || "resource";
}

function safeTopic(value: string): string {
  return value.toLowerCase().replace(/_/g, "-").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
}

function upsertResource(resources: SeedResource[], next: SeedResource): SeedResource[] {
  return resources.map((resource) => resource.id === next.id ? next : resource);
}

function readState(statePath: string, owner: string): MirrorState {
  if (!existsSync(statePath)) return { owner, updatedAt: new Date().toISOString(), records: {} };
  const state = readJson<MirrorState>(statePath);
  return {
    owner: state.owner || owner,
    updatedAt: state.updatedAt || new Date().toISOString(),
    records: state.records || {}
  };
}

function writeState(statePath: string, state: MirrorState): void {
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function writeCatalog(outputPath: string, catalog: ResourceCatalog): void {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberArg(name: string): number | undefined {
  const raw = argValue(name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number`);
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const isMain = process.argv[1] ? import.meta.url === new URL(process.argv[1], "file:").href : false;
if (isMain) {
  main().catch((error) => {
    console.error(errorMessage(error));
    process.exit(1);
  });
}
