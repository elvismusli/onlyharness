import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readCanonicalTarGzFiles, type CanonicalArchiveFile } from "./resource-skill-install.js";
import { SuperSkillCliError } from "./superskill-types.js";

const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_RESOURCES = 100;
const MAX_CONFIGS = 100;

type SetupResource = {
  id: string;
  name: string;
  resourceType: string;
  source: string;
  sourceResourceId?: string;
  hostedArchive: boolean;
};

type SetupConfig = { path: string; content: string };

type SetupPayload = {
  workspace: { slug: string; name?: string };
  bundle: {
    version: string;
    target: string;
    resources: SetupResource[];
    configs: SetupConfig[];
  };
  next?: string;
};

export type WorkspaceInstallResult = {
  status: "installed" | "unchanged";
  code: "WORKSPACE_INSTALLED" | "WORKSPACE_UNCHANGED";
  workspace: string;
  bundleVersion: string;
  target: string;
  output: string;
  resources: Array<{ id: string; path?: string; files: number; hosted: boolean; archiveDigest?: string }>;
  configs: string[];
  next?: string;
};

export async function installWorkspaceSetup(input: {
  registry: string;
  workspace: string;
  target: "cli" | "claude-code" | "codex" | "cursor" | "mcp";
  token: string;
  projectRoot: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<WorkspaceInstallResult> {
  const registry = trustedRegistry(input.registry);
  const root = trustedProjectRoot(input.projectRoot);
  const workspace = cleanSlug(input.workspace);
  const target = input.target;
  const fetchImpl = input.fetchImpl ?? fetch;
  const setupUrl = endpoint(registry, `/workspaces/${encodeURIComponent(workspace)}/setup-bundle?target=${encodeURIComponent(target)}`);
  const response = await authenticatedFetch(fetchImpl, setupUrl, input.token, input.signal);
  const payload = await responseJson(response);
  if (!response.ok) throw responseError("Workspace setup could not be read", response.status, payload);
  const setup = validateSetup(payload, workspace, target);
  const relativeOutput = `.harnesshub/workspaces/${workspace}`;
  const output = path.resolve(root, relativeOutput);
  assertDescendant(root, output);
  assertNoSymlinkPath(root, output);
  const markerPath = path.join(output, ".harnesshub", "setup.json");
  const existing = readMarker(markerPath);
  if (existing?.workspace === workspace && existing.bundleVersion === setup.bundle.version && existing.target === target) {
    return result("unchanged", [], []);
  }
  if (existsSync(output)) {
    throw installError("Workspace setup target already exists with different or untrusted content.", "TARGET_COLLISION", "Review and remove the existing workspace setup before retrying.");
  }

  const archives: Array<{ resource: SetupResource; files: CanonicalArchiveFile[]; digest: string }> = [];
  let totalBytes = 0;
  for (const resource of setup.bundle.resources) {
    if (!resource.hostedArchive) continue;
    const resourceName = cleanName(resource.name);
    const archiveUrl = endpoint(registry, `/workspaces/${encodeURIComponent(workspace)}/resources/${encodeURIComponent(resourceName)}/archive`);
    const archiveResponse = await authenticatedFetch(fetchImpl, archiveUrl, input.token, input.signal);
    if (!archiveResponse.ok) {
      const body = await responseJson(archiveResponse);
      throw responseError(`Workspace archive unavailable: ${resourceName}`, archiveResponse.status, body);
    }
    const bytes = Buffer.from(await archiveResponse.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_ARCHIVE_BYTES) throw installError("Workspace archive size is invalid.", "RESOURCE_ARCHIVE_INVALID", "Do not install this workspace bundle.");
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_ARCHIVE_BYTES) throw installError("Workspace bundle archives exceed the local safety limit.", "RESOURCE_ARCHIVE_INVALID", "Ask the workspace owner to split the bundle.");
    archives.push({ resource: { ...resource, name: resourceName }, files: readCanonicalTarGzFiles(bytes), digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` });
  }

  const configFiles = setup.bundle.configs.map((config) => ({ path: safeRelative(config.path), content: config.content }));
  const parent = path.dirname(output);
  assertNoSymlinkPath(root, parent);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  assertDescendant(root, realpathSync(parent));
  const stage = path.join(parent, `.workspace-${workspace}.tmp-${randomBytes(8).toString("hex")}`);
  try {
    mkdirSync(stage, { mode: 0o700 });
    for (const archive of archives) {
      const resourceRoot = path.join(stage, "resources", archive.resource.name);
      for (const file of archive.files) writeSafeFile(stage, path.join(resourceRoot, file.path), file.content);
      writeSafeFile(stage, path.join(resourceRoot, ".harnesshub", "source.json"), Buffer.from(`${JSON.stringify({
        workspace,
        resourceId: archive.resource.id,
        resourceType: archive.resource.resourceType,
        source: archive.resource.source,
        sourceResourceId: archive.resource.sourceResourceId,
        archiveDigest: archive.digest,
        files: archive.files.map((file) => file.path)
      }, null, 2)}\n`));
    }
    for (const config of configFiles) writeSafeFile(stage, path.join(stage, config.path), Buffer.from(config.content, "utf8"));
    const reports = setup.bundle.resources.map((resource) => {
      const archive = archives.find((candidate) => candidate.resource.id === resource.id);
      return {
        id: resource.id,
        ...(archive ? { path: `resources/${archive.resource.name}`, archiveDigest: archive.digest } : {}),
        files: archive?.files.length ?? 0,
        hosted: Boolean(archive)
      };
    });
    writeSafeFile(stage, path.join(stage, ".harnesshub", "setup.json"), Buffer.from(`${JSON.stringify({
      schemaVersion: "superskill.workspace-setup.v1",
      workspace,
      bundleVersion: setup.bundle.version,
      target,
      resources: reports,
      configs: configFiles.map((config) => config.path)
    }, null, 2)}\n`));
    renameSync(stage, output);
    return result("installed", reports, configFiles.map((config) => config.path));
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    if (error instanceof SuperSkillCliError) throw error;
    throw installError("Workspace setup could not be written atomically.", "INSTALL_FAILED", "Check project permissions and retry.", 1);
  }

  function result(
    status: "installed" | "unchanged",
    resources: WorkspaceInstallResult["resources"],
    configs: string[]
  ): WorkspaceInstallResult {
    return {
      status,
      code: status === "installed" ? "WORKSPACE_INSTALLED" : "WORKSPACE_UNCHANGED",
      workspace,
      bundleVersion: setup.bundle.version,
      target,
      output: relativeOutput,
      resources,
      configs,
      next: setup.next
    };
  }
}

function validateSetup(value: unknown, workspace: string, target: string): SetupPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidResponse();
  const payload = value as Partial<SetupPayload>;
  const bundle = payload.bundle;
  if (payload.workspace?.slug !== workspace || !bundle || bundle.target !== target || typeof bundle.version !== "string" || !bundle.version || bundle.version.length > 100) throw invalidResponse();
  if (!Array.isArray(bundle.resources) || bundle.resources.length > MAX_RESOURCES || !Array.isArray(bundle.configs) || bundle.configs.length > MAX_CONFIGS) throw invalidResponse();
  for (const resource of bundle.resources) {
    if (!resource || typeof resource !== "object" || typeof resource.id !== "string" || !resource.id || typeof resource.name !== "string" || typeof resource.resourceType !== "string" || typeof resource.source !== "string" || typeof resource.hostedArchive !== "boolean") throw invalidResponse();
    cleanName(resource.name);
  }
  for (const config of bundle.configs) {
    if (!config || typeof config.path !== "string" || typeof config.content !== "string" || Buffer.byteLength(config.content) > 1_000_000) throw invalidResponse();
    safeRelative(config.path);
  }
  return payload as SetupPayload;
}

async function authenticatedFetch(fetchImpl: typeof fetch, url: URL, token: string, signal?: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json", authorization: `Bearer ${token}` }, redirect: "error", signal });
  } catch {
    throw installError("Workspace setup request failed.", "NETWORK_FAILED", "Check service health and retry.", 1);
  }
  if (response.redirected || (response.url && response.url !== url.toString())) throw installError("Workspace setup response changed origin or route.", "REGISTRY_ORIGIN_UNTRUSTED", "Do not send credentials to another origin.");
  return response;
}

function trustedRegistry(value: string): URL {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw untrustedRegistry(); }
  const pathname = parsed.pathname.replace(/\/$/, "") || "/";
  const canonical = parsed.protocol === "https:" && (parsed.hostname === "superskill.sh" || parsed.hostname === "onlyharness.com") && !parsed.port && (pathname === "/" || pathname === "/api");
  const local = process.env.NODE_ENV !== "production" && process.env.HH_SUPERSKILL_ALLOW_INSECURE_TEST_REGISTRY === "1" && parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) && Boolean(parsed.port) && (pathname === "/" || pathname === "/api");
  if ((!canonical && !local) || parsed.username || parsed.password || parsed.search || parsed.hash) throw untrustedRegistry();
  parsed.pathname = pathname === "/" ? "" : pathname;
  return parsed;
}

function endpoint(registry: URL, route: string): URL {
  return new URL(`${registry.pathname.replace(/\/$/, "")}${route}`, registry.origin);
}

function trustedProjectRoot(value: string): string {
  const root = path.resolve(value);
  if (!existsSync(root) || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw installError("Workspace root is invalid.", "WORKSPACE_ROOT_INVALID", "Expose one real project directory.");
  return realpathSync(root);
}

function writeSafeFile(stage: string, target: string, content: Buffer): void {
  assertDescendant(stage, target);
  const parent = path.dirname(target);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  assertDescendant(stage, realpathSync(parent));
  writeFileSync(target, content, { flag: "wx", mode: 0o600 });
}

function assertDescendant(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw installError("Workspace setup path escapes the project.", "TARGET_UNSAFE", "Do not install this bundle.");
}

function assertNoSymlinkPath(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw installError("Workspace setup path escapes the project.", "TARGET_UNSAFE", "Do not install this bundle.");
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) throw installError("Workspace setup target contains a symlink.", "TARGET_UNSAFE", "Replace the symlink before installing.");
    } catch (error) {
      if (error instanceof SuperSkillCliError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function cleanSlug(value: string): string {
  if (!/^[a-z][a-z0-9_-]{1,62}$/.test(value)) throw installError("Workspace slug is invalid.", "MCP_INPUT_INVALID", "Use the exact workspace slug.");
  return value;
}

function cleanName(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(value)) throw invalidResponse();
  return value;
}

function safeRelative(value: string): string {
  if (!value || value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value) || path.posix.normalize(value) !== value || value.split("/").some((part) => !part || part === "." || part === "..")) throw invalidResponse();
  return value;
}

function readMarker(file: string): { workspace?: string; bundleVersion?: string; target?: string } | undefined {
  if (!existsSync(file) || lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) return undefined;
  try { return JSON.parse(readFileSync(file, "utf8")) as { workspace?: string; bundleVersion?: string; target?: string }; } catch { return undefined; }
}

async function responseJson(response: Response): Promise<unknown> {
  try { return await response.json() as unknown; } catch { return undefined; }
}

function responseError(prefix: string, status: number, value: unknown): SuperSkillCliError {
  const body = value && typeof value === "object" && !Array.isArray(value) ? value as { error?: unknown; code?: unknown; next?: unknown } : {};
  return new SuperSkillCliError(
    typeof body.error === "string" ? body.error.slice(0, 300) : `${prefix} (${status}).`,
    status === 401 || status === 403 ? 2 : status === 404 ? 4 : status >= 500 ? 1 : 3,
    typeof body.code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(body.code) ? body.code : status === 401 ? "SUPERSKILL_AUTH_REQUIRED" : "WORKSPACE_INSTALL_FAILED",
    typeof body.next === "string" ? body.next.slice(0, 300) : "Check workspace access and retry."
  );
}

function invalidResponse(): SuperSkillCliError {
  return installError("Workspace setup returned an invalid contract.", "WORKSPACE_SETUP_INVALID", "Do not write any files; ask the workspace owner to regenerate the setup bundle.", 1);
}

function untrustedRegistry(): SuperSkillCliError {
  return installError("Workspace registry origin is not trusted.", "REGISTRY_ORIGIN_UNTRUSTED", "Use https://superskill.sh/api.");
}

function installError(message: string, code: string, next: string, exitCode: 1 | 2 | 3 | 4 = 3): SuperSkillCliError {
  return new SuperSkillCliError(message, exitCode, code, next);
}
