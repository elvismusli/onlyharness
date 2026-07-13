import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  curatedCatalogSchema,
  managedCapabilityHistorySchema,
  type CuratedResource,
  type ManagedPermissions
} from "@harnesshub/capability-schema/browser";
import { canonicalArtifactDigest } from "@harnesshub/capability-schema/node";
import { parseManifestText, type HarnessManifest } from "@harnesshub/schema";
import * as registry from "../apps/harness-api/src/registry.js";
import { recomputeCapabilityDiff, scanHarnessFiles } from "../apps/harness-api/src/security-scan.js";
import {
  assertManagedInstructionOnly,
  buildSuperskillIndex,
  mergeSuperskillHistory
} from "./build-superskill-catalog.js";

const root = path.resolve(import.meta.dirname, "..");
const curatedPath = path.join(root, "data/superskill/curated.json");
const historyPath = path.join(root, "data/superskill/history.json");
const indexPath = path.join(root, "data/superskill/index.json");
const sourceReleasePath = path.join(root, "data/superskill/source-releases.json");
const releaseCutLockPath = path.join(root, "data/superskill/.prepare-release.lock");
const releaseCutJournalPath = path.join(root, "data/superskill/.prepare-release-journal.json");
const workflowPath = ".gitea/workflows/harness-ci.yml";
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

type SnapshotFile = { path: string; content: string; truncated?: boolean };
type ReleaseCutArgs = { id: string; from: string; to: string; write: boolean };
type ReleaseCutResult = {
  files: SnapshotFile[];
  removedFiles: string[];
  artifactDigest: string;
  scanner: ReturnType<typeof scanHarnessFiles>;
  capabilityDiff: ReturnType<typeof recomputeCapabilityDiff>;
};

export function parseReleaseCutArgs(argv: string[]): ReleaseCutArgs {
  const values = new Map<string, string>();
  let write = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--write") {
      if (write) throw new Error("Duplicate --write flag");
      write = true;
      continue;
    }
    if (!["--id", "--from", "--to"].includes(token)) throw new Error(`Unknown release-cut argument: ${token}`);
    if (values.has(token)) throw new Error(`Duplicate release-cut argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    values.set(token, value);
    index += 1;
  }
  const id = values.get("--id") ?? "";
  const from = values.get("--from") ?? "";
  const to = values.get("--to") ?? "";
  if (!idPattern.test(id)) throw new Error("--id must be a canonical capability id");
  if (!semverPattern.test(from) || !semverPattern.test(to) || compareSemver(to, from) <= 0) {
    throw new Error("--from and --to must be canonical semver values with --to greater than --from");
  }
  return { id, from, to, write };
}

export function buildReleaseCut(
  resource: Pick<CuratedResource, "id">,
  from: string,
  to: string,
  snapshotFiles: SnapshotFile[]
): ReleaseCutResult {
  const workflowCount = snapshotFiles.filter((file) => file.path === workflowPath).length;
  if (workflowCount > 1) throw new Error(`Release cut allows at most one ${workflowPath}: ${resource.id}`);
  if (snapshotFiles.some((file) => file.truncated)) throw new Error(`Release cut source is truncated: ${resource.id}`);
  const manifestFiles = snapshotFiles.filter((file) => file.path === "harness.yaml");
  if (manifestFiles.length !== 1) throw new Error(`Release cut requires exactly one harness.yaml: ${resource.id}`);
  const beforeManifest = parseManifestText(manifestFiles[0].content);
  if (beforeManifest.name !== resource.id || beforeManifest.version !== from) {
    throw new Error(`Release cut source tuple mismatch: ${resource.id}@${from}`);
  }
  const versionLine = new RegExp(`^version: ${escapeRegExp(from)}$`, "gm");
  const matches = manifestFiles[0].content.match(versionLine) ?? [];
  if (matches.length !== 1) throw new Error(`Release cut requires one canonical version line: ${resource.id}@${from}`);
  const files = snapshotFiles
    .filter((file) => file.path !== workflowPath)
    .map((file) => file.path === "harness.yaml"
      ? { ...file, content: file.content.replace(versionLine, `version: ${to}`) }
      : { ...file });
  const manifest = parseManifestText(files.find((file) => file.path === "harness.yaml")!.content);
  if (manifest.name !== resource.id || manifest.version !== to) throw new Error(`Prepared release tuple mismatch: ${resource.id}@${to}`);
  assertManagedInstructionOnly(files, resource, manifest);
  const permissions = mapPermissions(manifest);
  const scanner = scanHarnessFiles(files, {
    networkAllowlist: permissions.networkAllowlist,
    scannedAt: "1970-01-01T00:00:00.000Z"
  });
  if (scanner.verdict === "fail") throw new Error(`Prepared release static scan failed: ${resource.id}@${to}`);
  const capabilityDiff = recomputeCapabilityDiff(files, permissions);
  if (capabilityDiff.status === "fail") throw new Error(`Prepared release capability diff failed: ${resource.id}@${to}`);
  const artifactDigest = canonicalArtifactDigest({ files, totalFileCount: files.length, archiveTruncated: false });
  return {
    files,
    removedFiles: workflowCount === 1 ? [workflowPath] : [],
    artifactDigest,
    scanner,
    capabilityDiff
  };
}

export function runReleaseCut(args: ReleaseCutArgs): Record<string, unknown> {
  if (!args.write) return runReleaseCutUnlocked(args);
  const releaseLock = acquireReleaseCutLock(releaseCutLockPath);
  try {
    recoverReleaseCutJournal(releaseCutJournalPath, root);
    return runReleaseCutUnlocked(args);
  } finally {
    releaseLock();
  }
}

function runReleaseCutUnlocked(args: ReleaseCutArgs): Record<string, unknown> {
  const curated = curatedCatalogSchema.parse(JSON.parse(readFileSync(curatedPath, "utf8")));
  const resource = curated.resources.find((item) => item.id === args.id);
  if (!resource) throw new Error(`Unknown curated capability: ${args.id}`);
  if (resource.ref !== `harnesses/${args.id}` || resource.version !== args.from) {
    throw new Error(`Curated release tuple mismatch: ${args.id}@${args.from}`);
  }
  if (resource.status !== "candidate" || resource.reviewFile) {
    throw new Error(`Release cut is allowed only for an unreviewed candidate: ${args.id}`);
  }
  const sourceRoot = registry.resolveHarnessPath("harnesses", args.id);
  if (!sourceRoot || path.dirname(sourceRoot) !== registry.seedRoot) throw new Error(`Seed source is missing: ${args.id}`);
  const oldSnapshot = registry.readArchiveSnapshot("harnesses", args.id, args.from);
  if (!oldSnapshot || oldSnapshot.archiveTruncated || oldSnapshot.totalFileCount !== oldSnapshot.files.length
    || oldSnapshot.artifactDigest !== resource.expectedDigest) {
    throw new Error(`Immutable source snapshot mismatch: ${args.id}@${args.from}`);
  }
  const sourceArchive = registry.buildArchive(sourceRoot);
  if (sourceArchive.archiveTruncated || sourceArchive.totalFileCount !== oldSnapshot.totalFileCount
    || sourceArchive.artifactDigest !== resource.expectedDigest
    || !archiveFilesEqual(sourceArchive.files, oldSnapshot.files)) {
    throw new Error(`Seed source drifted from immutable snapshot: ${args.id}@${args.from}`);
  }
  if (registry.readArchiveSnapshot("harnesses", args.id, args.to)) {
    throw new Error(`Target immutable snapshot already exists: ${args.id}@${args.to}`);
  }
  const sourceReleases = readSourceReleases();
  const sourceRelease = sourceReleases.resources.find((item) => item.id === args.id);
  const sourceIncludesCiWorkflow = oldSnapshot.files.some((file) => file.path === workflowPath);
  if (!sourceRelease || sourceRelease.version !== args.from
    || sourceRelease.includeCiWorkflow !== sourceIncludesCiWorkflow) {
    throw new Error(`Source generator state does not match release source: ${args.id}@${args.from}`);
  }
  const prepared = buildReleaseCut(resource, args.from, args.to, oldSnapshot.files);
  const result = {
    id: args.id,
    ref: resource.ref,
    from: args.from,
    to: args.to,
    artifactDigest: prepared.artifactDigest,
    fileCount: prepared.files.length,
    removedFiles: prepared.removedFiles,
    scanner: prepared.scanner.verdict,
    capabilityDiff: prepared.capabilityDiff.status,
    status: "candidate",
    approvalCreated: false,
    write: args.write
  };
  if (!args.write) return result;

  const createdAt = new Date().toISOString();
  const snapshotPath = path.join(registry.versionRoot, "harnesses", args.id, `${args.to}.json`);
  const sourceManifestPath = path.join(sourceRoot, "harness.yaml");
  const sourceWorkflowPath = path.join(sourceRoot, workflowPath);
  const transactionPaths = [
    sourceReleasePath,
    sourceManifestPath,
    sourceWorkflowPath,
    snapshotPath,
    curatedPath,
    indexPath,
    historyPath
  ];
  const before = new Map(transactionPaths.map((file) => [file, existsSync(file) ? readFileSync(file) : undefined]));
  writeReleaseCutJournal(releaseCutJournalPath, root, before, { id: args.id, from: args.from, to: args.to });
  try {
    sourceRelease.version = args.to;
    sourceRelease.includeCiWorkflow = false;
    writeJsonAtomic(sourceReleasePath, sourceReleases);
    writeFileAtomic(sourceManifestPath, prepared.files.find((file) => file.path === "harness.yaml")!.content);
    if (prepared.removedFiles.includes(workflowPath)) unlinkSync(sourceWorkflowPath);
    writeJsonAtomic(snapshotPath, {
      owner: "harnesses",
      repo: args.id,
      version: args.to,
      createdAt,
      files: prepared.files,
      totalFileCount: prepared.files.length,
      archiveTruncated: false,
      artifactDigest: prepared.artifactDigest
    });
    resource.version = args.to;
    resource.expectedDigest = prepared.artifactDigest;
    writeJsonAtomic(curatedPath, curated);
    const index = buildSuperskillIndex(new Date(createdAt));
    const previous = managedCapabilityHistorySchema.parse(JSON.parse(readFileSync(historyPath, "utf8")));
    const history = mergeSuperskillHistory(index, previous);
    const current = index.capabilities.find((item) => item.id === args.id);
    if (!current || current.trust.status !== "candidate" || current.release.version !== args.to
      || current.release.artifactDigest !== prepared.artifactDigest) {
      throw new Error(`Generated catalog did not preserve the candidate release tuple: ${args.id}@${args.to}`);
    }
    const oldHistory = history.capabilities.find((item) => item.id === args.id && item.release.version === args.from);
    const newHistory = history.capabilities.find((item) => item.id === args.id && item.release.version === args.to);
    if (!oldHistory || !newHistory) throw new Error(`Generated history did not retain both release versions: ${args.id}`);
    writeJsonAtomic(indexPath, index);
    writeJsonAtomic(historyPath, history);
    const exact = registry.readArchiveSnapshot("harnesses", args.id, args.to);
    if (!exact || exact.artifactDigest !== prepared.artifactDigest) throw new Error(`Written snapshot verification failed: ${args.id}@${args.to}`);
    removeDurableFile(releaseCutJournalPath);
    return result;
  } catch (error) {
    restoreFiles(before);
    removeDurableFile(releaseCutJournalPath);
    throw error;
  }
}

function readSourceReleases(): {
  schemaVersion: "superskill.source-releases.v1";
  resources: Array<{ id: string; version: string; includeCiWorkflow: boolean }>;
} {
  const parsed = JSON.parse(readFileSync(sourceReleasePath, "utf8")) as Record<string, unknown>;
  if (parsed.schemaVersion !== "superskill.source-releases.v1" || !Array.isArray(parsed.resources)) {
    throw new Error("Invalid SuperSkill source release state");
  }
  const resources = parsed.resources.map((value) => {
    if (!value || typeof value !== "object") throw new Error("Invalid SuperSkill source release entry");
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || !idPattern.test(item.id)
      || typeof item.version !== "string" || !semverPattern.test(item.version)
      || typeof item.includeCiWorkflow !== "boolean"
      || Object.keys(item).some((key) => !["id", "version", "includeCiWorkflow"].includes(key))) {
      throw new Error("Invalid SuperSkill source release entry");
    }
    return item as { id: string; version: string; includeCiWorkflow: boolean };
  });
  if (new Set(resources.map((item) => item.id)).size !== resources.length) throw new Error("Duplicate SuperSkill source release entry");
  return { schemaVersion: "superskill.source-releases.v1", resources };
}

function mapPermissions(manifest: HarnessManifest): ManagedPermissions {
  return {
    network: manifest.permissions.network,
    networkAllowlist: manifest.permissions.network_allowlist,
    filesystem: manifest.permissions.filesystem,
    shell: manifest.permissions.shell,
    browser: manifest.permissions.browser,
    credentials: manifest.permissions.credentials,
    externalSend: manifest.permissions.external_send,
    moneyMovement: manifest.permissions.money_movement,
    userData: manifest.permissions.user_data,
    humanApprovalRequired: manifest.permissions.human_approval_required
  };
}

function compareSemver(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function archiveFilesEqual(left: SnapshotFile[], right: SnapshotFile[]): boolean {
  const normalize = (files: SnapshotFile[]) => [...files]
    .map((file) => ({ path: file.path, content: file.content, truncated: file.truncated ?? false }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function writeJsonAtomic(file: string, value: unknown): void {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFileAtomic(file: string, content: string | Uint8Array): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  const descriptor = openSync(temporary, "w", 0o600);
  try {
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, file);
  syncDirectory(path.dirname(file));
}

function restoreFiles(before: Map<string, Buffer | undefined>): void {
  for (const [file, content] of before) {
    if (content === undefined) {
      rmSync(file, { force: true });
      syncDirectory(path.dirname(file));
    }
    else writeFileAtomic(file, content);
  }
}

export function acquireReleaseCutLock(lockFile: string): () => void {
  mkdirSync(path.dirname(lockFile), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor: number;
    try {
      descriptor = openSync(lockFile, "wx", 0o600);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const owner = readLockOwner(lockFile);
      if (!owner || processIsAlive(owner.pid)) throw new Error(`Release cut is already locked by pid ${owner?.pid ?? "unknown"}`);
      rmSync(lockFile, { force: true });
      syncDirectory(path.dirname(lockFile));
      continue;
    }
    const owner = { schemaVersion: "superskill.release-cut-lock.v1", pid: process.pid, startedAt: new Date().toISOString() };
    writeFileSync(descriptor, `${JSON.stringify(owner)}\n`);
    fsyncSync(descriptor);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      closeSync(descriptor);
      const current = readLockOwner(lockFile);
      if (current?.pid === process.pid) {
        rmSync(lockFile, { force: true });
        syncDirectory(path.dirname(lockFile));
      }
    };
  }
  throw new Error("Could not acquire release-cut lock");
}

export function writeReleaseCutJournal(
  journalFile: string,
  workspaceRoot: string,
  before: Map<string, Buffer | undefined>,
  release: { id: string; from: string; to: string }
): void {
  const files = [...before.entries()].map(([file, content]) => ({
    path: containedRelativePath(workspaceRoot, file),
    existed: content !== undefined,
    contentBase64: content?.toString("base64") ?? null
  }));
  writeJsonAtomic(journalFile, {
    schemaVersion: "superskill.release-cut-journal.v1",
    release,
    files
  });
}

export function recoverReleaseCutJournal(journalFile: string, workspaceRoot: string): boolean {
  if (!existsSync(journalFile)) return false;
  const parsed = JSON.parse(readFileSync(journalFile, "utf8")) as Record<string, unknown>;
  if (parsed.schemaVersion !== "superskill.release-cut-journal.v1" || !isReleaseTuple(parsed.release) || !Array.isArray(parsed.files)) {
    throw new Error("Invalid release-cut recovery journal");
  }
  const before = new Map<string, Buffer | undefined>();
  for (const value of parsed.files) {
    if (!value || typeof value !== "object") throw new Error("Invalid release-cut recovery entry");
    const entry = value as Record<string, unknown>;
    if (typeof entry.path !== "string" || typeof entry.existed !== "boolean"
      || (entry.contentBase64 !== null && typeof entry.contentBase64 !== "string")
      || Object.keys(entry).some((key) => !["path", "existed", "contentBase64"].includes(key))) {
      throw new Error("Invalid release-cut recovery entry");
    }
    if (entry.existed !== (typeof entry.contentBase64 === "string")) throw new Error("Inconsistent release-cut recovery entry");
    const file = resolveContainedPath(workspaceRoot, entry.path);
    if (before.has(file)) throw new Error("Duplicate release-cut recovery entry");
    before.set(file, typeof entry.contentBase64 === "string" ? decodeCanonicalBase64(entry.contentBase64) : undefined);
  }
  if (before.size === 0) throw new Error("Empty release-cut recovery journal");
  restoreFiles(before);
  removeDurableFile(journalFile);
  return true;
}

function removeDurableFile(file: string): void {
  rmSync(file, { force: true });
  syncDirectory(path.dirname(file));
}

function syncDirectory(directory: string): void {
  const descriptor = openSync(directory, "r");
  try { fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}

function containedRelativePath(workspaceRoot: string, file: string): string {
  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(file));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Release-cut transaction path escapes workspace root");
  }
  return relative.split(path.sep).join("/");
}

function resolveContainedPath(workspaceRoot: string, relative: string): string {
  if (!relative || relative.includes("\\") || path.posix.isAbsolute(relative)
    || relative.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Release-cut recovery path is unsafe");
  }
  const base = path.resolve(workspaceRoot);
  const file = path.resolve(base, ...relative.split("/"));
  if (!file.startsWith(`${base}${path.sep}`)) throw new Error("Release-cut recovery path escapes workspace root");
  return file;
}

function decodeCanonicalBase64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Invalid release-cut recovery bytes");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error("Non-canonical release-cut recovery bytes");
  return decoded;
}

function isReleaseTuple(value: unknown): value is { id: string; from: string; to: string } {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && idPattern.test(item.id)
    && typeof item.from === "string" && semverPattern.test(item.from)
    && typeof item.to === "string" && semverPattern.test(item.to)
    && Object.keys(item).every((key) => ["id", "from", "to"].includes(key));
}

function readLockOwner(lockFile: string): { pid: number } | undefined {
  try {
    const value = JSON.parse(readFileSync(lockFile, "utf8")) as Record<string, unknown>;
    return value.schemaVersion === "superskill.release-cut-lock.v1" && Number.isSafeInteger(value.pid) && Number(value.pid) > 0
      ? { pid: Number(value.pid) }
      : undefined;
  } catch {
    return undefined;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !error || typeof error !== "object" || !("code" in error) || error.code !== "ESRCH";
  }
}

function isAlreadyExists(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "EEXIST";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(runReleaseCut(parseReleaseCutArgs(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
