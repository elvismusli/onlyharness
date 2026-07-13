import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { SuperSkillClient } from "./superskill-types.js";
import { SuperSkillCliError } from "./superskill-types.js";

const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 120;
const INSTALL_MARKER = ".superskill-resource.json";
const PACKAGE_ID = /^onlyharness:packages\/([a-z0-9][a-z0-9-]{1,80})$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

type HostedSkillResource = {
  id: string;
  resourceType: string;
  installability: "open_only" | "importable" | "installable" | "verified";
  upstreamRepo?: string;
  trust?: { securityScan?: "pass" | "warn" | "fail" | "not_scanned"; riskTier?: string };
  actions?: Array<{ id?: string; url?: string }>;
  release?: { version?: string; artifactDigest?: string; archiveSize?: number; trust?: string };
};

type ArchiveFile = { path: string; content: Buffer };

export type HostedSkillInstallResult = {
  status: "installed" | "unchanged" | "planned";
  resourceId: string;
  version: string;
  target: string;
  client: SuperSkillClient;
  archiveDigest: string;
  trust: { securityScan: string; riskTier: string; managedApproval: false };
  files: string[];
  warning: string | null;
};

export async function installHostedCatalogSkill(input: {
  registryUrl: string;
  resourceId: string;
  version?: string;
  client: SuperSkillClient;
  projectDir?: string;
  allowUnreviewed?: boolean;
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<HostedSkillInstallResult> {
  const registry = safeRegistryBase(input.registryUrl);
  const packageMatch = input.resourceId.match(PACKAGE_ID);
  if (!packageMatch) throw installError("Only SuperSkill-hosted public skill package IDs can be installed by this command.", "RESOURCE_NOT_INSTALLABLE", "Use the exact onlyharness:packages/<name> ID from resource_detail.");
  const name = packageMatch[1]!;
  if (input.version && !SEMVER.test(input.version)) throw installError("Catalog skill version is invalid.", "RESOURCE_NOT_INSTALLABLE", "Use the exact semantic version from the shared release page.");
  const versionPath = input.version ? `/releases/${encodeURIComponent(input.version)}` : "";
  const detailUrl = new URL(`${registry.pathname.replace(/\/$/, "")}/resources/${encodeURIComponent(input.resourceId)}${versionPath}`, registry.origin);
  const detailResponse = await safeFetch(input.fetchImpl ?? fetch, detailUrl);
  if (detailResponse.status === 404) throw new SuperSkillCliError("Catalog skill was not found.", 4, "RESOURCE_NOT_FOUND", "Run resources search again and use its exact resource ID.");
  if (!detailResponse.ok) throw installError(`Catalog detail returned HTTP ${detailResponse.status}.`, "RESOURCE_FETCH_FAILED", "Retry after SuperSkill is healthy.", 1);
  assertResponseUrl(detailResponse, detailUrl);
  let resource: HostedSkillResource;
  try { resource = await detailResponse.json() as HostedSkillResource; } catch { throw installError("Catalog detail is not valid JSON.", "RESOURCE_FETCH_FAILED", "Retry after SuperSkill is healthy.", 1); }
  if (resource.id !== input.resourceId || resource.resourceType !== "skill" || resource.upstreamRepo !== name || resource.installability === "open_only") {
    throw installError("Catalog resource is not a hosted installable skill.", "RESOURCE_NOT_INSTALLABLE", "Open the resource page and follow its upstream-only guidance instead.");
  }
  const release = resource.release;
  if (!release || typeof release.version !== "string" || !SEMVER.test(release.version)
    || typeof release.artifactDigest !== "string" || !/^[a-f0-9]{64}$/.test(release.artifactDigest)
    || !Number.isSafeInteger(release.archiveSize) || (release.archiveSize ?? 0) < 1 || (release.archiveSize ?? 0) > MAX_ARCHIVE_BYTES
    || release.trust !== "unreviewed") {
    throw installError("Catalog detail has no valid immutable release tuple.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response.");
  }
  if (input.version && release.version !== input.version) throw installError("Catalog detail release does not match the requested version.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response.");
  const scan = resource.trust?.securityScan ?? "not_scanned";
  if (scan === "fail") throw installError("Catalog skill has a failing security scan.", "RESOURCE_BLOCKED", "Do not install this release.");
  if (scan !== "pass" && !input.allowUnreviewed) {
    throw installError(
      `Catalog skill is ${scan} and is not a managed approved capability.`,
      "RESOURCE_REVIEW_REQUIRED",
      "Review resource_detail and resource_use_instructions, then repeat with --allow-unreviewed only after explicit user consent."
    );
  }
  const archiveAction = resource.actions?.find((action) => action.id === "download_archive" && typeof action.url === "string");
  const archive = exactArchiveUrl(registry, input.resourceId, archiveAction?.url);
  if (archive.version !== release.version) throw installError("Catalog archive action does not match the immutable detail release.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response.");
  const archiveResponse = await safeFetch(input.fetchImpl ?? fetch, archive.url);
  if (!archiveResponse.ok) throw installError(`Catalog archive returned HTTP ${archiveResponse.status}.`, "RESOURCE_ARCHIVE_FAILED", "Retry the same exact release after SuperSkill is healthy.", archiveResponse.status === 404 ? 4 : 1);
  assertResponseUrl(archiveResponse, archive.url);
  const reportedVersion = archiveResponse.headers.get("x-onlyharness-resource-version");
  if (reportedVersion !== archive.version) throw installError("Catalog archive version header does not match its exact URL.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response.");
  const expectedDigest = archiveResponse.headers.get("x-superskill-artifact-sha256");
  if (!expectedDigest || !/^[a-f0-9]{64}$/.test(expectedDigest)) throw installError("Catalog archive has no valid immutable digest header.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response.");
  if (expectedDigest !== release.artifactDigest) throw installError("Catalog archive digest header does not match the immutable detail release.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response.");
  const bytes = Buffer.from(await archiveResponse.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_ARCHIVE_BYTES) throw installError("Catalog archive size is invalid.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response.");
  if (bytes.length !== release.archiveSize) throw installError("Catalog archive size does not match the immutable detail release.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response.");
  const files = readCanonicalTarGz(bytes);
  const skill = files.find((file) => file.path === "SKILL.md");
  if (!skill || !validUtf8(skill.content) || skillName(skill.content.toString("utf8")) !== name) {
    throw installError("Catalog archive has no matching root SKILL.md.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response.");
  }
  const projectRoot = safeProjectRoot(input.projectDir ?? ".");
  const relativeTarget = input.client === "codex" ? `.agents/skills/${name}` : `.claude/skills/${name}`;
  const target = path.join(projectRoot, relativeTarget);
  assertSafeDescendant(projectRoot, target);
  const archiveDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (archiveDigest !== `sha256:${expectedDigest}`) throw installError("Catalog archive bytes do not match the immutable release digest.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response.");
  const marker = `${JSON.stringify({
    schemaVersion: "superskill.resource-install.v1",
    resourceId: input.resourceId,
    version: archive.version,
    archiveDigest,
    client: input.client,
    managedApproval: false
  }, null, 2)}\n`;
  if (existsSync(target)) {
    if (installedFilesMatch(target, files, marker)) return result("unchanged");
    throw installError("Native skill target already exists with different or untrusted content.", "TARGET_COLLISION", "Choose a different project or remove the existing skill after reviewing it.");
  }
  if (input.dryRun) return result("planned");

  const parent = path.dirname(target);
  assertSafeDescendant(projectRoot, parent);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  assertSafeDescendant(projectRoot, parent);
  const stage = path.join(parent, `.superskill-resource.tmp-${randomBytes(8).toString("hex")}`);
  let lock: number | undefined;
  const lockPath = path.join(projectRoot, ".superskill-resource-install.lock");
  try {
    lock = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(), 0o600);
    fsyncSync(lock);
    if (existsSync(target)) throw installError("Native skill target appeared during install.", "TARGET_COLLISION", "Inspect the target before retrying.");
    mkdirSync(stage, { mode: 0o700 });
    for (const file of files) {
      const output = path.join(stage, file.path);
      mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
      writeFileSync(output, file.content, { mode: 0o644, flag: "wx" });
    }
    writeFileSync(path.join(stage, INSTALL_MARKER), marker, { mode: 0o644, flag: "wx" });
    renameSync(stage, target);
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    if (error instanceof SuperSkillCliError) throw error;
    throw installError("Catalog skill could not be written atomically.", "INSTALL_FAILED", "Inspect the project permissions and retry.", 1);
  } finally {
    if (lock !== undefined) try { closeSync(lock); } catch { /* cleanup only */ }
    try { rmSync(lockPath, { force: true }); } catch { /* cleanup only */ }
  }
  return result("installed");

  function result(status: HostedSkillInstallResult["status"]): HostedSkillInstallResult {
    return {
      status,
      resourceId: input.resourceId,
      version: archive.version,
      target: relativeTarget,
      client: input.client,
      archiveDigest,
      trust: { securityScan: scan, riskTier: resource.trust?.riskTier ?? "UNKNOWN", managedApproval: false },
      files: files.map((file) => file.path),
      warning: scan === "pass" ? null : status === "planned"
        ? "Validated and planned after explicit consent as an unreviewed hosted catalog skill; no files were installed and this is not managed approval or Verified evidence."
        : status === "unchanged"
          ? "The existing explicit-consent unreviewed hosted catalog skill is unchanged; this is not managed approval or Verified evidence."
          : "Installed by explicit consent as an unreviewed hosted catalog skill; this is not managed approval or Verified evidence."
    };
  }
}

function safeRegistryBase(value: string): URL {
  let parsed: URL;
  try { parsed = new URL(value.endsWith("/") ? value : `${value}/`); } catch { throw installError("Registry URL is invalid.", "REGISTRY_INVALID", "Use https://superskill.sh/api."); }
  const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
  if ((parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw installError("Registry URL is not a trusted HTTPS or loopback origin.", "REGISTRY_INVALID", "Use https://superskill.sh/api.");
  }
  return parsed;
}

function exactArchiveUrl(registry: URL, resourceId: string, value: string | undefined): { url: URL; version: string } {
  if (!value) throw installError("Catalog skill has no hosted archive action.", "RESOURCE_NOT_INSTALLABLE", "Open the resource page for current availability.");
  let url: URL;
  try { url = new URL(value); } catch { throw installError("Catalog archive URL is invalid.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response."); }
  if (url.origin !== registry.origin || url.username || url.password || url.search || url.hash) {
    throw installError("Catalog archive URL leaves the configured registry origin.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response.");
  }
  const basePath = registry.pathname.replace(/\/$/, "");
  const prefix = `${basePath}/resources/${encodeURIComponent(resourceId)}/releases/`;
  if (!url.pathname.startsWith(prefix) || !url.pathname.endsWith("/archive")) {
    throw installError("Catalog archive URL is not an exact immutable release URL.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response.");
  }
  const encodedVersion = url.pathname.slice(prefix.length, -"/archive".length);
  let version: string;
  try { version = decodeURIComponent(encodedVersion); } catch { throw installError("Catalog archive version is invalid.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response."); }
  if (!SEMVER.test(version) || encodeURIComponent(version) !== encodedVersion) throw installError("Catalog archive version is invalid.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response.");
  return { url, version };
}

async function safeFetch(fetchImpl: typeof fetch, url: URL): Promise<Response> {
  try { return await fetchImpl(url, { redirect: "error" }); } catch { throw installError("SuperSkill catalog request failed.", "RESOURCE_FETCH_FAILED", "Check network access and retry.", 1); }
}

function assertResponseUrl(response: Response, expected: URL): void {
  if (response.redirected || (response.url && response.url !== expected.toString())) {
    throw installError("SuperSkill catalog response redirected or changed origin.", "RESOURCE_FETCH_FAILED", "Do not install this response.", 1);
  }
}

function readCanonicalTarGz(compressed: Buffer): ArchiveFile[] {
  let tar: Buffer;
  try { tar = gunzipSync(compressed, { maxOutputLength: MAX_UNCOMPRESSED_BYTES }); } catch { throw installError("Catalog archive is not a bounded gzip tar.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response."); }
  const files: ArchiveFile[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let terminated = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) { terminated = true; break; }
    if (!validTarChecksum(header)) throw installError("Catalog archive tar checksum is invalid.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response.");
    const type = header[156];
    if (type !== 0 && type !== 48) throw installError("Catalog archive contains a non-regular entry.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response.");
    const name = tarText(header.subarray(0, 100));
    const prefix = tarText(header.subarray(345, 500));
    const filePath = prefix ? `${prefix}/${name}` : name;
    if (!safeArchivePath(filePath) || seen.has(filePath)) throw installError("Catalog archive contains an unsafe or duplicate path.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response.");
    const size = tarOctal(header.subarray(124, 136));
    if (size === undefined || size > MAX_UNCOMPRESSED_BYTES) throw installError("Catalog archive contains an invalid file size.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response.");
    const start = offset + 512;
    const end = start + size;
    if (end > tar.length) throw installError("Catalog archive is truncated.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response.");
    seen.add(filePath);
    files.push({ path: filePath, content: Buffer.from(tar.subarray(start, end)) });
    if (files.length > MAX_FILES) throw installError("Catalog archive contains too many files.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response.");
    offset = start + Math.ceil(size / 512) * 512;
  }
  if (!terminated || !files.length) throw installError("Catalog archive has no canonical end marker or files.", "RESOURCE_ARCHIVE_INVALID", "Do not install this response.");
  return files;
}

function validTarChecksum(header: Buffer): boolean {
  const expected = tarOctal(header.subarray(148, 156));
  if (expected === undefined) return false;
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) actual += index >= 148 && index < 156 ? 32 : header[index]!;
  return actual === expected;
}

function tarOctal(value: Buffer): number | undefined {
  const text = tarText(value).trim();
  if (!/^[0-7]+$/.test(text)) return undefined;
  const parsed = Number.parseInt(text, 8);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function tarText(value: Buffer): string {
  const zero = value.indexOf(0);
  return value.subarray(0, zero === -1 ? value.length : zero).toString("utf8").trimEnd();
}

function safeArchivePath(value: string): boolean {
  return Boolean(value) && !value.includes("\\") && !value.includes("\0") && !path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value && value !== ".." && !value.startsWith("../");
}

function validUtf8(value: Buffer): boolean {
  const text = value.toString("utf8");
  return !text.includes("\uFFFD") && Buffer.from(text, "utf8").equals(value);
}

function skillName(markdown: string): string | undefined {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const name = match?.[1]?.match(/^name:\s*([a-z0-9][a-z0-9-]{1,80})\s*$/m)?.[1];
  return name;
}

function safeProjectRoot(value: string): string {
  const absolute = path.resolve(value);
  if (!existsSync(absolute) || !lstatSync(absolute).isDirectory()) throw installError("Project directory is missing or not a directory.", "PROJECT_INVALID", "Create the project directory before installing.");
  return realpathSync(absolute);
}

function assertSafeDescendant(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    if (target === root) return;
    throw installError("Install target escapes the project.", "TARGET_UNSAFE", "Use a normal project directory.");
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw installError("Install target contains a symlink.", "TARGET_UNSAFE", "Replace symlinked client directories before installing.");
  }
}

function installedFilesMatch(target: string, files: ArchiveFile[], marker: string): boolean {
  try {
    if (!lstatSync(target).isDirectory() || lstatSync(target).isSymbolicLink()) return false;
    const expected = new Map(files.map((file) => [file.path, file.content]));
    const actualPaths = listRegularFiles(target);
    if (actualPaths.length !== expected.size + 1 || !actualPaths.includes(INSTALL_MARKER)) return false;
    if (readFileSync(path.join(target, INSTALL_MARKER), "utf8") !== marker) return false;
    return [...expected].every(([relative, content]) => actualPaths.includes(relative) && readFileSync(path.join(target, relative)).equals(content));
  } catch { return false; }
}

function listRegularFiles(root: string, relative = ""): string[] {
  const directory = path.join(root, relative);
  const output: string[] = [];
  for (const name of readdirSync(directory).sort()) {
    const childRelative = relative ? `${relative}/${name}` : name;
    const child = path.join(root, childRelative);
    const stat = lstatSync(child);
    if (stat.isSymbolicLink()) throw new Error("symlink");
    if (stat.isDirectory()) output.push(...listRegularFiles(root, childRelative));
    else if (stat.isFile()) output.push(childRelative);
    else throw new Error("unsupported");
  }
  return output;
}

function noFollowFlag(): number {
  return typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
}

function installError(message: string, reason: string, next: string, exitCode: 1 | 3 | 4 = 3): SuperSkillCliError {
  return new SuperSkillCliError(message, exitCode, reason, next);
}
