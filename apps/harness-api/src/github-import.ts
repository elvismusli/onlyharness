import { readFileSync } from "node:fs";
import path from "node:path";
import { workspaceRoot } from "./registry.js";

export type GitHubResourceImportRequest = {
  url?: string;
  path?: string;
  action?: "classify";
};

export type GitHubResourceImportResult = {
  url: string;
  owner: string;
  repo: string;
  path: string;
  classification: "harness_candidate" | "skill" | "plugin" | "mcp_server" | "command_pack" | "config" | "workflow" | "guide" | "unknown";
  detectedFiles: string[];
  unsafeFiles: string[];
  licenseStatus: "permissive" | "copyleft" | "proprietary" | "unknown" | "blocked" | "manual_review";
  licenseName?: string;
  recommendedAction: string;
  conversionBlocked?: string;
  archiveFetch: false;
};

export class GitHubImportError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "GitHubImportError";
    this.status = status;
    this.code = code;
  }
}

export type ArchiveEntryCandidate = {
  path: string;
  size: number;
  type?: "file" | "directory" | "symlink" | "special";
};

const allowedHosts = new Set(["github.com", "api.github.com", "codeload.github.com"]);
const maxResponseBytes = 2 * 1024 * 1024;
const maxFiles = 200;
const maxPathDepth = 12;
const maxDecompressedArchiveBytes = 8 * 1024 * 1024;
const denylistPath = path.join(workspaceRoot, "docs/research/catalog-denylist.json");

type GitHubContentItem = {
  name?: string;
  path?: string;
  type?: string;
  size?: number;
  download_url?: string | null;
};

export async function classifyGitHubResource(input: GitHubResourceImportRequest): Promise<GitHubResourceImportResult> {
  if (input.action && input.action !== "classify") {
    throw new GitHubImportError(400, "UNSUPPORTED_ACTION", "Only classify is supported for GitHub resources.");
  }
  const target = parseGitHubResourceTarget(input.url ?? "", input.path);
  assertNotDenylisted(target.owner, target.repo, target.url);
  const files = await listGitHubFiles(target.owner, target.repo, target.path);
  const detectedFiles = files.map((file) => file.path).filter((file): file is string => Boolean(file)).slice(0, maxFiles);
  const unsafeFiles = files
    .filter((file) => file.type === "symlink" || file.type === "submodule")
    .map((file) => file.path)
    .filter((file): file is string => Boolean(file));
  const license = await fetchGitHubLicense(target.owner, target.repo);
  const classification = classifyDetectedFiles(detectedFiles);
  const conversionBlocked = conversionBlockReason(license.status, unsafeFiles);
  return {
    url: target.url,
    owner: target.owner,
    repo: target.repo,
    path: target.path,
    classification,
    detectedFiles,
    unsafeFiles,
    licenseStatus: license.status,
    ...(license.name ? { licenseName: license.name } : {}),
    recommendedAction: recommendedAction(classification, license.status),
    ...(conversionBlocked ? { conversionBlocked } : {}),
    archiveFetch: false
  };
}

export function parseGitHubResourceTarget(rawUrl: string, requestedPath = ""): { url: string; owner: string; repo: string; path: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new GitHubImportError(400, "INVALID_GITHUB_URL", "Expected a GitHub repository URL.");
  }
  assertAllowedOutboundUrl(parsed);
  if (parsed.hostname !== "github.com") {
    throw new GitHubImportError(400, "INVALID_GITHUB_URL", "GitHub resource imports must start from github.com repository URLs.");
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  const [owner, repo] = parts;
  if (!owner || !repo || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new GitHubImportError(400, "INVALID_GITHUB_URL", "Expected a GitHub owner/repo URL.");
  }
  let pathParts = requestedPath ? requestedPath.split("/") : parts[2] === "tree" || parts[2] === "blob" ? parts.slice(4) : [];
  pathParts = normalizeSafePath(pathParts.join("/")).split("/").filter(Boolean);
  return {
    url: `https://github.com/${owner}/${repo}`,
    owner,
    repo,
    path: pathParts.join("/")
  };
}

export function assertAllowedOutboundUrl(url: URL) {
  if (url.protocol !== "https:") throw new GitHubImportError(400, "UNSAFE_GITHUB_URL", "Only HTTPS GitHub URLs are allowed.");
  if (url.username || url.password) throw new GitHubImportError(400, "UNSAFE_GITHUB_URL", "GitHub URLs must not include credentials.");
  if (!allowedHosts.has(url.hostname)) throw new GitHubImportError(400, "UNSAFE_GITHUB_URL", "Only github.com, api.github.com and codeload.github.com are allowed.");
}

export function validateArchiveEntries(entries: ArchiveEntryCandidate[]) {
  if (entries.length > maxFiles) {
    throw new GitHubImportError(413, "ARCHIVE_TOO_LARGE", "Archive has too many entries.");
  }
  let total = 0;
  for (const entry of entries) {
    normalizeSafePath(entry.path);
    if ((entry.path.split("/").filter(Boolean).length) > maxPathDepth) {
      throw new GitHubImportError(413, "ARCHIVE_PATH_TOO_DEEP", "Archive path depth exceeds limit.");
    }
    if (entry.type === "symlink" || entry.type === "special") {
      throw new GitHubImportError(400, "UNSAFE_ARCHIVE_ENTRY", "Archive contains symlinks or special files.");
    }
    total += Math.max(0, entry.size);
    if (total > maxDecompressedArchiveBytes) {
      throw new GitHubImportError(413, "ARCHIVE_TOO_LARGE", "Archive decompressed size exceeds limit.");
    }
  }
}

function normalizeSafePath(value: string): string {
  const clean = value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  const parts = clean.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new GitHubImportError(400, "UNSAFE_PATH", "Path traversal is not allowed.");
  }
  if (parts.length > maxPathDepth) {
    throw new GitHubImportError(400, "UNSAFE_PATH", "Path is too deep.");
  }
  return parts.join("/");
}

async function listGitHubFiles(owner: string, repo: string, targetPath: string): Promise<GitHubContentItem[]> {
  const queue = [targetPath];
  const files: GitHubContentItem[] = [];
  while (queue.length && files.length < maxFiles) {
    const current = queue.shift() ?? "";
    const url = githubApiUrl(`/repos/${owner}/${repo}/contents/${current}`);
    const response = await safeGitHubFetch(url);
    if (response.status === 404) throw new GitHubImportError(404, "GITHUB_RESOURCE_NOT_FOUND", "GitHub repository or path not found.");
    if (!response.ok) throw new GitHubImportError(response.status, "GITHUB_FETCH_FAILED", `GitHub API request failed with ${response.status}.`);
    const json = await readBoundedJson(response, maxResponseBytes);
    const items = Array.isArray(json) ? json as GitHubContentItem[] : [json as GitHubContentItem];
    for (const item of items) {
      const itemPath = normalizeSafePath(String(item.path ?? item.name ?? ""));
      if (!itemPath) continue;
      if (item.type === "dir") {
        if (itemPath.split("/").length <= maxPathDepth) queue.push(itemPath);
        continue;
      }
      files.push({ ...item, path: itemPath });
      if (files.length >= maxFiles) break;
    }
  }
  return files;
}

async function fetchGitHubLicense(owner: string, repo: string): Promise<{ status: GitHubResourceImportResult["licenseStatus"]; name?: string }> {
  const response = await safeGitHubFetch(githubApiUrl(`/repos/${owner}/${repo}/license`));
  if (response.status === 404) return { status: "unknown" };
  if (!response.ok) return { status: "unknown" };
  const json = await readBoundedJson(response, maxResponseBytes) as { license?: { spdx_id?: string; name?: string } };
  const name = json.license?.spdx_id && json.license.spdx_id !== "NOASSERTION" ? json.license.spdx_id : json.license?.name;
  if (!name) return { status: "unknown" };
  return { status: licenseStatusFor(name), name };
}

async function safeGitHubFetch(url: URL): Promise<Response> {
  assertAllowedOutboundUrl(url);
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "onlyharness-github-import"
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(url, { headers, redirect: "manual" });
  const location = response.headers.get("location");
  if (location) {
    assertAllowedOutboundUrl(new URL(location, url));
    throw new GitHubImportError(502, "GITHUB_REDIRECT_BLOCKED", "Unexpected GitHub API redirect was blocked.");
  }
  return response;
}

function githubApiUrl(pathname: string): URL {
  return new URL(pathname.replace(/^\/?/, "/"), "https://api.github.com");
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return await response.json();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) throw new GitHubImportError(413, "GITHUB_RESPONSE_TOO_LARGE", "GitHub response exceeded maximum size.");
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function classifyDetectedFiles(files: string[]): GitHubResourceImportResult["classification"] {
  const names = files.map((file) => file.toLowerCase());
  if (names.some((file) => /(^|\/)harness\.ya?ml$/.test(file))) return "harness_candidate";
  if (names.some((file) => /(^|\/)skill\.md$/.test(file) || file.includes("/.claude/skills/") || file.includes("/.codex/skills/"))) return "skill";
  if (names.some((file) => file.endsWith(".claude-plugin/plugin.json") || file.endsWith(".codex-plugin/plugin.json"))) return "plugin";
  if (names.some((file) => file.endsWith(".mcp.json") || file.endsWith("server.json") || file.includes("mcp"))) return "mcp_server";
  if (names.some((file) => file.includes("commands/") || file.includes("slash"))) return "command_pack";
  if (names.some((file) => file.includes("settings") || file.endsWith(".cursorrules"))) return "config";
  if (names.some((file) => file.endsWith("readme.md"))) return "workflow";
  return "unknown";
}

function licenseStatusFor(license: string): GitHubResourceImportResult["licenseStatus"] {
  const normalized = license.toLowerCase();
  if (/mit|apache|bsd|isc|mpl|unlicense|cc0/.test(normalized)) return "permissive";
  if (/gpl|agpl|lgpl|copyleft/.test(normalized)) return "copyleft";
  return "manual_review";
}

function recommendedAction(classification: GitHubResourceImportResult["classification"], licenseStatus: GitHubResourceImportResult["licenseStatus"]): string {
  if (classification === "harness_candidate") return "Can be listed as a harness-format resource; use publish only if you want OnlyHarness-hosted files.";
  if (licenseStatus === "permissive") return "Can be listed as an upstream resource; package files only when explicitly needed.";
  return "List as upstream-only and send users to the source URL; do not re-host files until license review passes.";
}

function conversionBlockReason(licenseStatus: GitHubResourceImportResult["licenseStatus"], unsafeFiles: string[]): string | undefined {
  if (unsafeFiles.length) return "Packaging/re-hosting is blocked because the repository contains symlinks or unsafe file entries.";
  if (licenseStatus !== "permissive") return "Packaging/re-hosting is blocked until the license is permissive or manually approved.";
  return undefined;
}

function assertNotDenylisted(owner: string, repo: string, url: string) {
  const denylist = JSON.parse(readFileSync(denylistPath, "utf8")) as { repos?: Array<{ repo?: string; url?: string }> };
  for (const denied of denylist.repos ?? []) {
    if (denied.url === url || denied.repo?.toLowerCase() === `${owner}/${repo}`.toLowerCase()) {
      throw new GitHubImportError(451, "DENYLISTED_REPOSITORY", "This repository is blocked by the OnlyHarness denylist.");
    }
  }
}
