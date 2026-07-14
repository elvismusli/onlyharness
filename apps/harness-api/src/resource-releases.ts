import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync
} from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { MAX_ARCHIVE_FILE_BYTES, workspaceRoot } from "./registry.js";
import { parseRuntimeResource } from "./resource-schema.js";
import type { Resource } from "./resources.js";

export type ResourceReleaseStatus = "pending" | "active" | "failed";

export type ResourceRelease = {
  id: string;
  resourceId: string;
  version: string;
  ownerSubject: string;
  idempotencyKeyHash: string;
  payloadDigest: string;
  artifactDigest: string;
  archiveSize: number;
  storageKey: string;
  status: ResourceReleaseStatus;
  trust: "unreviewed";
  resource: Resource;
  createdAt: string;
  activatedAt?: string;
  failedAt?: string;
  failureCode?: string;
};

export type CanonicalResourceFile = { path: string; content: string };
export const MAX_CANONICAL_RESOURCE_TAR_BYTES = 32 * 1024 * 1024;
const MAX_LEGACY_RESOURCE_FILE_BYTES = 256 * 1024;
const MAX_LEGACY_RESOURCE_TOTAL_BYTES = 16 * 1024 * 1024;

export type CommitResourceReleaseInput = {
  resource: Resource;
  version: string;
  idempotencyKey: string;
  ownerSubject: string;
  payloadDigest: string;
  files: CanonicalResourceFile[];
};

export type CommitResourceReleaseResult =
  | { ok: true; release: ResourceRelease; replay: boolean }
  | { ok: false; status: number; code: "VALIDATION_FAILED" | "PUBLISH_CONFLICT" | "ARCHIVE_STORAGE_UNAVAILABLE"; error: string; next: string };

export type MigrateLegacyResourceReleaseInput = {
  resource: Resource;
  version: string;
  ownerSubject: string;
  expectedDigest: string;
};

type ResourceOwner = { resourceId: string; ownerSubject: string; claimedAt: string };
type ResourceReleaseFile = { schemaVersion: 1; owners: ResourceOwner[]; releases: ResourceRelease[] };
type SupabaseReleaseRow = {
  id: string;
  resource_id: string;
  version: string;
  owner_subject: string;
  idempotency_key_hash: string;
  payload_digest: string;
  artifact_digest: string;
  archive_size: number;
  storage_key: string;
  status: ResourceReleaseStatus;
  trust: "unreviewed";
  resource_payload: Resource;
  created_at: string;
  activated_at?: string | null;
  failed_at?: string | null;
  failure_code?: string | null;
};

const releaseLocks = new Map<string, Promise<void>>();
const importArchiveRoot = path.resolve(
  process.env.RESOURCE_IMPORT_ARCHIVE_DIR ?? path.join(workspaceRoot, "data/resources/import-archives")
);
const legacyArchiveRoot = path.resolve(
  process.env.RESOURCE_ARCHIVE_DIR ?? path.join(workspaceRoot, "data/resources/archives")
);
const releasesPath = path.resolve(
  process.env.RESOURCE_RELEASES_PATH ?? path.join(workspaceRoot, "data/resources/releases.json")
);

export function isReleaseSemver(value: string | undefined): value is string {
  return Boolean(value && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value));
}

export function isValidIdempotencyKey(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/.test(value));
}

export function canonicalPayloadDigest(input: {
  name: string;
  version: string;
  resourceType: string;
  title: string;
  summary: string;
  sourceUrl?: string;
  worksWith: string[];
  tags: string[];
  files: CanonicalResourceFile[];
}): string {
  const canonical = {
    name: input.name,
    version: input.version,
    resourceType: input.resourceType,
    title: input.title,
    summary: input.summary,
    sourceUrl: input.sourceUrl ?? null,
    worksWith: [...input.worksWith].sort(),
    tags: [...input.tags].sort(),
    files: [...input.files]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => ({ path: file.path, contentSha256: sha256(Buffer.from(file.content, "utf8")) }))
  };
  return sha256(Buffer.from(JSON.stringify(canonical), "utf8"));
}

export function buildCanonicalResourceArchive(files: CanonicalResourceFile[]): Buffer {
  const entries: Array<{ name: string; mode: number; type: "0" | "5"; content: Buffer }> = [];
  for (const file of files) entries.push({ name: file.path, mode: 0o644, type: "0", content: Buffer.from(file.content, "utf8") });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const header = tarHeader(entry.name, entry.mode, entry.content.length, entry.type);
    blocks.push(header, entry.content);
    const padding = (512 - (entry.content.length % 512)) % 512;
    if (padding) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024));
  const compressed = gzipSync(Buffer.concat(blocks), { level: 9 });
  // Canonical gzip header: mtime=0 and OS=unknown so the digest is independent
  // of the publisher host. Node already writes a zero mtime; enforce both bytes.
  compressed.fill(0, 4, 8);
  compressed[9] = 255;
  return compressed;
}

type CanonicalResourceFileValidation =
  | { ok: true; files: CanonicalResourceFile[] }
  | { ok: false; code: "DUPLICATE_PATH" | "ARCHIVE_PATH_INVALID" | "ARCHIVE_PATH_TOO_LONG" | "ARCHIVE_TOO_LARGE"; error: string };

function normalizeCanonicalResourceFiles(files: CanonicalResourceFile[]): CanonicalResourceFileValidation {
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, code: "ARCHIVE_PATH_INVALID", error: "resource package must contain at least one file" };
  }
  if (files.length > 120) return { ok: false, code: "ARCHIVE_TOO_LARGE", error: "resource package contains too many files" };
  const normalizedFiles: CanonicalResourceFile[] = [];
  for (const file of files) {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
      return { ok: false, code: "ARCHIVE_PATH_INVALID", error: "each resource file needs a path and text content" };
    }
    const normalized = file.path.replaceAll("\\", "/");
    if (unsafeWindowsPath(file.path) || unsafeWindowsPath(normalized)
      || !normalized || normalized.startsWith("/") || normalized.includes("\0") || path.posix.normalize(normalized) !== normalized
      || normalized === ".." || normalized.startsWith("../")) {
      return { ok: false, code: "ARCHIVE_PATH_INVALID", error: `unsafe canonical resource path: ${file.path}` };
    }
    if (Buffer.byteLength(file.content, "utf8") > MAX_ARCHIVE_FILE_BYTES) {
      return { ok: false, code: "ARCHIVE_TOO_LARGE", error: `resource file exceeds the per-file size limit: ${normalized}` };
    }
    normalizedFiles.push({ path: normalized, content: file.content });
  }
  return { ok: true, files: normalizedFiles };
}

export function validateCanonicalResourceFiles(files: CanonicalResourceFile[]):
  | { ok: true }
  | { ok: false; code: "DUPLICATE_PATH" | "ARCHIVE_PATH_INVALID" | "ARCHIVE_PATH_TOO_LONG" | "ARCHIVE_TOO_LARGE"; error: string } {
  const normalized = normalizeCanonicalResourceFiles(files);
  if (!normalized.ok) return normalized;
  const seen = new Set<string>();
  let tarBytes = 1024;
  for (const file of normalized.files) {
    if (seen.has(file.path)) return { ok: false, code: "DUPLICATE_PATH", error: `duplicate normalized resource path: ${file.path}` };
    seen.add(file.path);
    try {
      splitTarPath(file.path);
    } catch {
      return { ok: false, code: "ARCHIVE_PATH_TOO_LONG", error: `resource path cannot be represented safely in canonical tar: ${file.path}` };
    }
    const size = Buffer.byteLength(file.content, "utf8");
    tarBytes += 512 + size + ((512 - (size % 512)) % 512);
    if (tarBytes > MAX_CANONICAL_RESOURCE_TAR_BYTES) {
      return { ok: false, code: "ARCHIVE_TOO_LARGE", error: "canonical resource archive exceeds the uncompressed size limit" };
    }
  }
  return { ok: true };
}

export async function commitResourceRelease(input: CommitResourceReleaseInput): Promise<CommitResourceReleaseResult> {
  if (!safeResourcePayload(input.resource)) return conflict("Resource metadata contains a forbidden public identity or invalid ID.");
  if (!isReleaseSemver(input.version) || !isValidIdempotencyKey(input.idempotencyKey)
    || !/^user:[a-f0-9]{64}$/.test(input.ownerSubject) || !/^[a-f0-9]{64}$/.test(input.payloadDigest)) {
    return validationFailure("Resource release metadata is invalid.");
  }
  const normalizedFiles = normalizeCanonicalResourceFiles(input.files);
  if (!normalizedFiles.ok) return validationFailure(normalizedFiles.error);
  const canonicalValidation = validateCanonicalResourceFiles(normalizedFiles.files);
  if (!canonicalValidation.ok) return validationFailure(canonicalValidation.error);
  const normalizedInput = { ...input, files: normalizedFiles.files };
  const lockKey = input.resource.id;
  return withReleaseLock(lockKey, async () => {
    const archive = buildCanonicalResourceArchive(normalizedInput.files);
    const artifactDigest = sha256(archive);
    const idempotencyKeyHash = `sha256:${sha256(Buffer.from(input.idempotencyKey, "utf8"))}`;
    const storageKey = `${Buffer.from(`${input.resource.id}@${input.version}`, "utf8").toString("base64url")}.tar.gz`;
    const existing = await readDurableReleases();
    if (!existing.ok) return storageUnavailable();

    const ownership = existing.releases.find((release) => release.resourceId === normalizedInput.resource.id && release.ownerSubject !== normalizedInput.ownerSubject);
    if (ownership) return conflict("Resource name is already owned by another publisher.");

    const byKey = existing.releases.find((release) => release.ownerSubject === normalizedInput.ownerSubject && release.idempotencyKeyHash === idempotencyKeyHash);
    if (byKey) {
      if (sameRelease(byKey, normalizedInput, artifactDigest) && byKey.status === "active") {
        return syncAndVerifyLocalProjection(existing.releases) ? { ok: true, release: byKey, replay: true } : storageUnavailable();
      }
      return conflict("Idempotency key was already used with a different release payload.");
    }

    const byVersion = existing.releases.find((release) => release.resourceId === normalizedInput.resource.id && release.version === normalizedInput.version);
    if (byVersion) {
      if (sameRelease(byVersion, normalizedInput, artifactDigest) && byVersion.status === "active") {
        return syncAndVerifyLocalProjection(existing.releases) ? { ok: true, release: byVersion, replay: true } : storageUnavailable();
      }
      return conflict("Published resource versions are immutable.");
    }

    const now = new Date().toISOString();
    const pending: ResourceRelease = {
      id: randomUUID(),
      resourceId: normalizedInput.resource.id,
      version: normalizedInput.version,
      ownerSubject: normalizedInput.ownerSubject,
      idempotencyKeyHash,
      payloadDigest: normalizedInput.payloadDigest,
      artifactDigest,
      archiveSize: archive.length,
      storageKey,
      status: "pending",
      trust: "unreviewed",
      resource: normalizedInput.resource,
      createdAt: now
    };

    const inserted = await insertPendingRelease(pending);
    if (!inserted.ok) {
      if (inserted.conflict) {
        const raced = await readDurableReleases();
        if (raced.ok) {
          const replay = raced.releases.find((release) =>
            release.ownerSubject === normalizedInput.ownerSubject && release.idempotencyKeyHash === idempotencyKeyHash
          );
          if (replay && replay.status === "active" && sameRelease(replay, normalizedInput, artifactDigest)) {
            return syncAndVerifyLocalProjection(raced.releases)
              ? { ok: true, release: replay, replay: true }
              : storageUnavailable();
          }
        }
        return conflict("Concurrent publish collided with an existing release.");
      }
      return storageUnavailable();
    }

    let createdArchive = false;
    try {
      fault("before_temp_write");
      createdArchive = commitArchiveAtomically(storageKey, archive, artifactDigest);
      fault("after_archive_rename");
      fault("before_metadata_activation");
      const active: ResourceRelease = { ...pending, status: "active", activatedAt: new Date().toISOString() };
      const activated = await activateRelease(active);
      if (!activated) throw new ReleaseStorageError("METADATA_ACTIVATION_FAILED");
      return { ok: true, release: active, replay: false };
    } catch {
      const persisted = await durableReleaseById(pending.id);
      if (persisted?.status === "active") {
        const snapshot = await readDurableReleases();
        if (snapshot.ok && syncAndVerifyLocalProjection(snapshot.releases)) return { ok: true, release: persisted, replay: false };
        return storageUnavailable();
      }
      if (persisted?.status === "pending") {
        if (createdArchive) safeRemoveCommittedArchive(storageKey, artifactDigest);
        await abortPendingRelease(pending);
      }
      return storageUnavailable();
    }
  });
}

export function validateLegacyResourceArchive(archive: Buffer):
  | { ok: true; files: number; totalFileBytes: number }
  | { ok: false; error: string } {
  if (!Buffer.isBuffer(archive) || archive.length < 20 || archive.length > MAX_CANONICAL_RESOURCE_TAR_BYTES) {
    return { ok: false, error: "Legacy archive size is outside the supported bounds." };
  }
  if (archive[0] !== 0x1f || archive[1] !== 0x8b || archive[2] !== 8 || archive[3] !== 0
    || archive.readUInt32LE(4) !== 0) {
    return { ok: false, error: "Legacy archive must use deterministic gzip without optional headers or timestamps." };
  }
  let tar: Buffer;
  try {
    tar = gunzipSync(archive, { maxOutputLength: MAX_CANONICAL_RESOURCE_TAR_BYTES });
  } catch {
    return { ok: false, error: "Legacy archive is not a valid bounded gzip stream." };
  }
  if (tar.length < 1024 || tar.length % 512 !== 0) {
    return { ok: false, error: "Legacy archive does not contain a complete tar stream." };
  }
  try {
    const seen = new Set<string>();
    let offset = 0;
    let entries = 0;
    let files = 0;
    let totalFileBytes = 0;
    while (offset < tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (isZeroBlock(header)) {
      if (offset + 1024 > tar.length || !isZeroBlock(tar.subarray(offset + 512, offset + 1024))
        || !tar.subarray(offset).every((byte) => byte === 0)) {
        return { ok: false, error: "Legacy tar terminator or trailing data is invalid." };
      }
        return files > 0
          ? { ok: true, files, totalFileBytes }
          : { ok: false, error: "Legacy archive must contain at least one regular file." };
    }
    entries += 1;
    if (entries > 120) return { ok: false, error: "Legacy archive contains too many entries." };
    if (!validTarChecksum(header)) return { ok: false, error: "Legacy tar header checksum is invalid." };
    if (readTarString(header, 257, 6).trim() !== "ustar") {
      return { ok: false, error: "Legacy archive uses an unsupported tar format." };
    }
    const type = header[156];
    if (type !== 0 && type !== 0x30 && type !== 0x35) {
      return { ok: false, error: "Legacy archive contains links or a special filesystem entry." };
    }
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const rawPath = prefix ? `${prefix}/${name}` : name;
    const normalizedPath = normalizeLegacyTarPath(rawPath, type === 0x35);
    if (normalizedPath === undefined) return { ok: false, error: `Legacy archive contains an unsafe path: ${rawPath}` };
    const size = readTarOctal(header, 124, 12);
    if (size === undefined || (type === 0x35 && size !== 0)) return { ok: false, error: "Legacy tar entry size is invalid." };
    if (normalizedPath) {
      if (seen.has(normalizedPath)) return { ok: false, error: `Legacy archive contains a duplicate normalized path: ${normalizedPath}` };
      seen.add(normalizedPath);
    }
    if (type !== 0x35) {
      if (size > MAX_LEGACY_RESOURCE_FILE_BYTES) return { ok: false, error: `Legacy archive file exceeds the per-file limit: ${normalizedPath}` };
      totalFileBytes += size;
      if (totalFileBytes > MAX_LEGACY_RESOURCE_TOTAL_BYTES) return { ok: false, error: "Legacy archive exceeds the total file size limit." };
      files += 1;
    }
    const paddedSize = Math.ceil(size / 512) * 512;
    if (offset + 512 + paddedSize > tar.length) return { ok: false, error: "Legacy tar entry is truncated." };
      offset += 512 + paddedSize;
    }
  } catch {
    return { ok: false, error: "Legacy archive contains a malformed tar header." };
  }
  return { ok: false, error: "Legacy archive is missing the tar terminator." };
}

export async function migrateLegacyResourceRelease(input: MigrateLegacyResourceReleaseInput): Promise<CommitResourceReleaseResult> {
  if (!isReleaseSemver(input.version) || !/^[a-f0-9]{64}$/.test(input.expectedDigest) || !/^user:[a-f0-9]{64}$/.test(input.ownerSubject) || !safeResourcePayload(input.resource)) {
    return conflict("Legacy migration manifest is invalid.");
  }
  return withReleaseLock(input.resource.id, async () => {
    const source = legacyResourceArchivePath(input.resource.id);
    if (!source) return storageUnavailable();
    let archive: Buffer;
    try {
      archive = readFileSync(source);
    } catch {
      return storageUnavailable();
    }
    const artifactDigest = sha256(archive);
    if (artifactDigest !== input.expectedDigest) return conflict("Legacy archive digest does not match the approved migration inventory.");
    const legacyValidation = validateLegacyResourceArchive(archive);
    if (!legacyValidation.ok) return validationFailure(legacyValidation.error);
    const idempotencyKeyHash = `sha256:${sha256(Buffer.from(`legacy-migration:${input.resource.id}:${input.version}:${artifactDigest}`, "utf8"))}`;
    const storageKey = `${Buffer.from(`${input.resource.id}@${input.version}`, "utf8").toString("base64url")}.tar.gz`;
    const durable = await readDurableReleases();
    if (!durable.ok) return storageUnavailable();
    const ownerConflict = durable.releases.find((release) => release.resourceId === input.resource.id && release.ownerSubject !== input.ownerSubject);
    if (ownerConflict) return conflict("Resource is already owned by another publisher.");
    const exact = durable.releases.find((release) => release.resourceId === input.resource.id && release.version === input.version);
    if (exact) {
      if (exact.status === "active" && exact.ownerSubject === input.ownerSubject && exact.artifactDigest === artifactDigest) {
        return syncAndVerifyLocalProjection(durable.releases) ? { ok: true, release: exact, replay: true } : storageUnavailable();
      }
      return conflict("Published resource versions are immutable.");
    }
    const now = new Date().toISOString();
    const pending: ResourceRelease = {
      id: randomUUID(),
      resourceId: input.resource.id,
      version: input.version,
      ownerSubject: input.ownerSubject,
      idempotencyKeyHash,
      payloadDigest: sha256(Buffer.from(`legacy:${input.resource.id}:${input.version}:${artifactDigest}`, "utf8")),
      artifactDigest,
      archiveSize: archive.length,
      storageKey,
      status: "pending",
      trust: "unreviewed",
      resource: input.resource,
      createdAt: now
    };
    const inserted = await insertPendingRelease(pending);
    if (!inserted.ok) return inserted.conflict ? conflict("Legacy migration collided with an existing release.") : storageUnavailable();
    let createdArchive = false;
    try {
      createdArchive = commitArchiveAtomically(storageKey, archive, artifactDigest);
      const active: ResourceRelease = { ...pending, status: "active", activatedAt: new Date().toISOString() };
      if (!await activateRelease(active)) throw new ReleaseStorageError("METADATA_ACTIVATION_FAILED");
      return { ok: true, release: active, replay: false };
    } catch {
      const persisted = await durableReleaseById(pending.id);
      if (persisted?.status === "active") {
        const snapshot = await readDurableReleases();
        if (snapshot.ok && syncAndVerifyLocalProjection(snapshot.releases)) return { ok: true, release: persisted, replay: false };
        return storageUnavailable();
      }
      if (persisted?.status === "pending") {
        if (createdArchive) safeRemoveCommittedArchive(storageKey, artifactDigest);
        await abortPendingRelease(pending);
      }
      return storageUnavailable();
    }
  });
}

export function readActiveReleaseResourcesSync(): Resource[] {
  const ids = new Set(readLocalReleaseFile().releases.filter((release) => release.status === "active").map((release) => release.resourceId));
  return [...ids].flatMap((resourceId) => {
    const latest = activeRelease(resourceId);
    return latest ? [latest.resource] : [];
  });
}

export function resourceReleaseOwnerSubject(resourceId: string): string | undefined {
  return readLocalReleaseFile().owners.find((owner) => owner.resourceId === resourceId)?.ownerSubject;
}

export function activeReleaseArchivePath(resourceId: string, version?: string): string | undefined {
  const release = activeRelease(resourceId, version);
  if (!release) return undefined;
  const candidate = path.join(importArchiveRoot, release.storageKey);
  if (!isWithin(importArchiveRoot, candidate) || !existsSync(candidate)) return undefined;
  try {
    if (statSync(candidate).size !== release.archiveSize || sha256(readFileSync(candidate)) !== release.artifactDigest) return undefined;
    return candidate;
  } catch {
    return undefined;
  }
}

export function activeReleaseMetadata(resourceId: string, version?: string): Pick<ResourceRelease, "version" | "artifactDigest" | "archiveSize" | "trust"> | undefined {
  const release = activeRelease(resourceId, version);
  if (!release || release.status !== "active") return undefined;
  return {
    version: release.version,
    artifactDigest: release.artifactDigest,
    archiveSize: release.archiveSize,
    trust: release.trust
  };
}

export function activeReleaseDetail(resourceId: string, version?: string): { resource: Resource; release: Pick<ResourceRelease, "version" | "artifactDigest" | "archiveSize" | "trust"> } | undefined {
  const row = activeRelease(resourceId, version);
  if (!row || row.status !== "active") return undefined;
  if (!resourceArchivePathForRead(row.resourceId, row.version)) return undefined;
  return {
    resource: row.resource,
    release: { version: row.version, artifactDigest: row.artifactDigest, archiveSize: row.archiveSize, trust: row.trust }
  };
}

export function resourceArchivePathForRead(resourceId: string, version?: string): string | undefined {
  const release = activeRelease(resourceId, version);
  // Legacy mirrors are never proof that SuperSkill hosts an upstream resource.
  // A public archive is readable only when durable release metadata owns the
  // exact resource/version; the legacy directory is a digest-matched fallback
  // for an already migrated release, not a catalog-wide hosting signal.
  if (!release) return undefined;
  const imported = process.env.RESOURCE_IMPORT_READ_ENABLED === "false" ? undefined : activeReleaseArchivePath(resourceId, version);
  if (imported) return imported;
  const legacy = legacyResourceArchivePath(resourceId);
  if (!legacy) return undefined;
  try {
    return statSync(legacy).size === release.archiveSize && sha256(readFileSync(legacy)) === release.artifactDigest ? legacy : undefined;
  } catch {
    return undefined;
  }
}

export function legacyResourceArchivePath(resourceId: string): string | undefined {
  const candidate = path.join(legacyArchiveRoot, `${Buffer.from(resourceId, "utf8").toString("base64url")}.tar.gz`);
  return isWithin(legacyArchiveRoot, candidate) && existsSync(candidate) ? candidate : undefined;
}

function activeRelease(resourceId: string, version?: string): ResourceRelease | undefined {
  return readLocalReleaseFile().releases
    .filter((candidate) => candidate.resourceId === resourceId && candidate.status === "active" && (!version || candidate.version === version))
    .sort((left, right) => compareReleaseVersion(right, left) || right.createdAt.localeCompare(left.createdAt))[0];
}

function compareReleaseVersion(left: ResourceRelease, right: ResourceRelease): number {
  const leftParts = left.version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?/);
  const rightParts = right.version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?/);
  if (!leftParts || !rightParts) return left.version.localeCompare(right.version);
  for (let index = 1; index <= 3; index += 1) {
    const delta = Number(leftParts[index]) - Number(rightParts[index]);
    if (delta) return delta;
  }
  if (!leftParts[4] && rightParts[4]) return 1;
  if (leftParts[4] && !rightParts[4]) return -1;
  return (leftParts[4] ?? "").localeCompare(rightParts[4] ?? "", undefined, { numeric: true });
}

export function resourceImportArchiveRoot(): string {
  return importArchiveRoot;
}

export function probeResourceImportArchiveStorage(): { ok: true } | { ok: false; code: "ARCHIVE_STORAGE_UNAVAILABLE" } {
  const payload = Buffer.from(`onlyharness-storage-probe:${randomUUID()}`, "utf8");
  const tempName = `.storage-probe.${randomUUID()}.tmp`;
  const finalName = `.storage-probe.${randomUUID()}.committed`;
  const temp = path.join(importArchiveRoot, tempName);
  const target = path.join(importArchiveRoot, finalName);
  let fd: number | undefined;
  try {
    mkdirSync(importArchiveRoot, { recursive: true, mode: 0o750 });
    fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    writeSync(fd, payload, 0, payload.length, 0);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, target);
    fsyncDirectory(importArchiveRoot);
    const readBack = readFileSync(target);
    if (!readBack.equals(payload)) throw new ReleaseStorageError("PROBE_READ_MISMATCH");
    rmSync(target, { force: true });
    fsyncDirectory(importArchiveRoot);
    return { ok: true };
  } catch {
    return { ok: false, code: "ARCHIVE_STORAGE_UNAVAILABLE" };
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { rmSync(temp, { force: true }); } catch { /* Parent may itself be an invalid file. */ }
    try { rmSync(target, { force: true }); } catch { /* Parent may itself be an invalid file. */ }
  }
}

export async function reconcileResourceReleases(options: { pendingMaxAgeMs?: number } = {}): Promise<{
  active: number;
  failed: number;
  removedTemps: number;
  removedOrphans: number;
  store: "supabase" | "local" | "unavailable";
}> {
  const durable = await readDurableReleases();
  if (!durable.ok) return { active: 0, failed: 0, removedTemps: 0, removedOrphans: 0, store: "unavailable" };
  const pendingMaxAgeMs = options.pendingMaxAgeMs ?? 15 * 60_000;
  const now = Date.now();
  const reconciled: ResourceRelease[] = [];
  let failed = 0;
  for (const release of durable.releases) {
    if (release.status !== "pending" || now - Date.parse(release.createdAt) < pendingMaxAgeMs) {
      reconciled.push(release);
      continue;
    }
    const archivePath = path.join(importArchiveRoot, release.storageKey);
    const valid = isWithin(importArchiveRoot, archivePath)
      && existsSync(archivePath)
      && statSync(archivePath).size === release.archiveSize
      && sha256(readFileSync(archivePath)) === release.artifactDigest;
    if (valid) {
      const active = { ...release, status: "active" as const, activatedAt: new Date().toISOString() };
      if (await activateRelease(active)) reconciled.push(active);
      else reconciled.push(release);
    } else {
      const failedRelease = { ...release, status: "failed" as const, failedAt: new Date().toISOString(), failureCode: "RECONCILE_ARCHIVE_MISSING" };
      await failRelease(release, failedRelease.failureCode);
      reconciled.push(failedRelease);
      failed += 1;
    }
  }
  const current = await readDurableReleases();
  if (current.ok && (hasSupabaseStore() || existsSync(releasesPath) || current.releases.length > 0)) {
    if (!syncAndVerifyLocalProjection(current.releases)) {
      return { active: 0, failed, removedTemps: 0, removedOrphans: 0, store: "unavailable" };
    }
  }
  const removedTemps = removeStaleTempArchives(now, pendingMaxAgeMs);
  const snapshot = current.ok ? current.releases : reconciled;
  const removedOrphans = removeOrphanArchives(snapshot, now, pendingMaxAgeMs);
  return {
    active: snapshot.filter((release) => release.status === "active").length,
    failed,
    removedTemps,
    removedOrphans,
    store: hasSupabaseStore() ? "supabase" : "local"
  };
}

function removeOrphanArchives(releases: ResourceRelease[], now: number, minAgeMs: number): number {
  if (!existsSync(importArchiveRoot)) return 0;
  const referenced = new Set(releases.filter((release) => release.status !== "failed").map((release) => release.storageKey));
  const failed = new Map(releases.filter((release) => release.status === "failed").map((release) => [release.storageKey, release.artifactDigest]));
  let removed = 0;
  for (const entry of readDirectoryNames(importArchiveRoot)) {
    if (!entry.endsWith(".tar.gz") || referenced.has(entry)) continue;
    const target = path.join(importArchiveRoot, entry);
    if (!isWithin(importArchiveRoot, target)) continue;
    try {
      const expected = failed.get(entry);
      if (expected) {
        if (sha256(readFileSync(target)) !== expected) continue;
      } else if (now - statSync(target).mtimeMs < minAgeMs) {
        continue;
      }
      rmSync(target, { force: true });
      removed += 1;
    } catch {
      // Unknown or changed objects remain quarantined and invisible for operator review.
    }
  }
  if (removed) fsyncDirectory(importArchiveRoot);
  return removed;
}

export function resourceReleaseInventory(): Array<Pick<ResourceRelease, "resourceId" | "version" | "artifactDigest" | "archiveSize" | "storageKey" | "status"> & {
  archivePresent: boolean;
  actualDigest: string | null;
  actualSize: number | null;
  source: "import" | "legacy" | null;
  parity: boolean;
}> {
  return readLocalReleaseFile().releases.map((release) => {
    const importPath = path.join(importArchiveRoot, release.storageKey);
    const resolved = release.status === "active" ? resourceArchivePathForRead(release.resourceId, release.version) : (existsSync(importPath) ? importPath : undefined);
    let actualDigest: string | null = null;
    let actualSize: number | null = null;
    try {
      if (resolved) {
        actualSize = statSync(resolved).size;
        actualDigest = sha256(readFileSync(resolved));
      }
    } catch {
      actualDigest = null;
      actualSize = null;
    }
    return {
      resourceId: release.resourceId,
      version: release.version,
      artifactDigest: release.artifactDigest,
      archiveSize: release.archiveSize,
      storageKey: release.storageKey,
      status: release.status,
      archivePresent: Boolean(resolved),
      actualDigest,
      actualSize,
      source: resolved ? (path.dirname(resolved) === importArchiveRoot ? "import" as const : "legacy" as const) : null,
      parity: release.status !== "active" || (actualDigest === release.artifactDigest && actualSize === release.archiveSize)
    };
  });
}

export function verifyResourceReleaseInventory(): {
  ok: boolean;
  active: number;
  failures: Array<{ resourceId: string; version: string; code: "ARCHIVE_PARITY_FAILED" }>;
} {
  const active = resourceReleaseInventory().filter((release) => release.status === "active");
  const failures = active.filter((release) => !release.parity).map((release) => ({
    resourceId: release.resourceId,
    version: release.version,
    code: "ARCHIVE_PARITY_FAILED" as const
  }));
  return { ok: failures.length === 0, active: active.length, failures };
}

function commitArchiveAtomically(storageKey: string, archive: Buffer, expectedDigest: string): boolean {
  mkdirSync(importArchiveRoot, { recursive: true, mode: 0o750 });
  const target = path.join(importArchiveRoot, storageKey);
  if (!isWithin(importArchiveRoot, target)) throw new ReleaseStorageError("UNSAFE_STORAGE_KEY");
  if (existsSync(target)) {
    const existing = readFileSync(target);
    if (sha256(existing) !== expectedDigest) throw new ReleaseStorageError("ARCHIVE_IMMUTABLE_CONFLICT");
    return false;
  }
  const temp = path.join(importArchiveRoot, `.${storageKey}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  let targetCreated = false;
  try {
    fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o640);
    let offset = 0;
    while (offset < archive.length) offset += writeSync(fd, archive, offset, archive.length - offset, offset);
    fault("before_file_fsync");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    if (sha256(readFileSync(temp)) !== expectedDigest) throw new ReleaseStorageError("ARCHIVE_DIGEST_MISMATCH");
    fault("before_archive_rename");
    renameSync(temp, target);
    targetCreated = true;
    fault("before_parent_fsync");
    fsyncDirectory(importArchiveRoot);
    return true;
  } catch (error) {
    if (targetCreated) {
      try {
        rmSync(target, { force: true });
        fsyncDirectory(importArchiveRoot);
      } catch {
        // A failed release stays non-active; reconciler/inventory will report any orphan.
      }
    }
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temp, { force: true });
  }
}

function tarHeader(name: string, mode: number, size: number, type: "0" | "5"): Buffer {
  const header = Buffer.alloc(512);
  const split = splitTarPath(name);
  writeTarString(header, split.name, 0, 100);
  writeTarOctal(header, mode, 100, 8);
  writeTarOctal(header, 0, 108, 8);
  writeTarOctal(header, 0, 116, 8);
  writeTarOctal(header, size, 124, 12);
  writeTarOctal(header, 0, 136, 12);
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, "ascii");
  writeTarString(header, "ustar", 257, 6);
  writeTarString(header, "00", 263, 2);
  writeTarString(header, split.prefix, 345, 155);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const encoded = checksum.toString(8).padStart(6, "0");
  header.write(encoded, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function splitTarPath(value: string): { name: string; prefix: string } {
  if (!value || value.endsWith("/")) throw new ReleaseStorageError("ARCHIVE_PATH_INVALID");
  if (Buffer.byteLength(value, "utf8") <= 100) return { name: value, prefix: "" };
  for (let index = value.lastIndexOf("/"); index > 0; index = value.lastIndexOf("/", index - 1)) {
    const prefix = value.slice(0, index);
    const name = value.slice(index + 1);
    if (Buffer.byteLength(prefix, "utf8") <= 155 && Buffer.byteLength(name, "utf8") <= 100) return { name, prefix };
  }
  throw new ReleaseStorageError("ARCHIVE_PATH_TOO_LONG");
}

function isZeroBlock(block: Buffer): boolean {
  return block.length === 512 && block.every((byte) => byte === 0);
}

function readTarString(buffer: Buffer, offset: number, length: number): string {
  const field = buffer.subarray(offset, offset + length);
  const end = field.indexOf(0);
  const encoded = end < 0 ? field : field.subarray(0, end);
  if (end >= 0 && !field.subarray(end).every((byte) => byte === 0)) throw new ReleaseStorageError("ARCHIVE_HEADER_INVALID");
  const decoded = encoded.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(encoded)) throw new ReleaseStorageError("ARCHIVE_HEADER_INVALID");
  return decoded;
}

function readTarOctal(buffer: Buffer, offset: number, length: number): number | undefined {
  const raw = buffer.subarray(offset, offset + length).toString("ascii").replace(/[\0 ]+$/g, "").replace(/^ +/g, "");
  if (!raw || !/^[0-7]+$/.test(raw)) return undefined;
  const value = Number.parseInt(raw, 8);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function validTarChecksum(header: Buffer): boolean {
  const stored = readTarOctal(header, 148, 8);
  if (stored === undefined) return false;
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) actual += index >= 148 && index < 156 ? 0x20 : header[index];
  return actual === stored;
}

function normalizeLegacyTarPath(value: string, directory: boolean): string | undefined {
  if (!value || unsafeWindowsPath(value) || value.startsWith("/") || value.includes("\0")) return undefined;
  let candidate = value.replaceAll("\\", "/");
  if (unsafeWindowsPath(candidate)) return undefined;
  while (candidate.startsWith("./")) candidate = candidate.slice(2);
  if (directory) candidate = candidate.replace(/\/+$/g, "");
  if (!candidate && directory) return "";
  if (!candidate || candidate === ".." || candidate.startsWith("../") || path.posix.normalize(candidate) !== candidate) return undefined;
  return candidate;
}

function writeTarString(buffer: Buffer, value: string, offset: number, length: number): void {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.length > length) throw new ReleaseStorageError("ARCHIVE_PATH_TOO_LONG");
  encoded.copy(buffer, offset);
}

function writeTarOctal(buffer: Buffer, value: number, offset: number, length: number): void {
  const encoded = value.toString(8).padStart(length - 1, "0");
  if (encoded.length >= length) throw new ReleaseStorageError("ARCHIVE_VALUE_TOO_LARGE");
  buffer.write(encoded, offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

async function readDurableReleases(): Promise<{ ok: true; releases: ResourceRelease[] } | { ok: false }> {
  if (!hasSupabaseStore()) {
    try {
      return { ok: true, releases: readLocalReleaseFile(true).releases };
    } catch {
      return { ok: false };
    }
  }
  const response = await supabaseRequest("resource_package_releases", { select: "*", order: "created_at.asc" });
  if (!response?.ok) return { ok: false };
  try {
    const rows = await response.json() as unknown;
    if (!Array.isArray(rows)) return { ok: false };
    const releases = rows.map((row) => fromSupabaseRow(row as SupabaseReleaseRow));
    if (releases.some((release) => !release)) return { ok: false };
    return { ok: true, releases: releases as ResourceRelease[] };
  } catch {
    return { ok: false };
  }
}

async function durableReleaseById(id: string): Promise<ResourceRelease | undefined> {
  const durable = await readDurableReleases();
  return durable.ok ? durable.releases.find((release) => release.id === id) : undefined;
}

async function insertPendingRelease(release: ResourceRelease): Promise<{ ok: boolean; conflict?: boolean }> {
  if (!hasSupabaseStore()) {
    try {
      return await withReleaseLock("__local_release_store__", async () => {
        const current = readLocalReleaseFile(true);
        const owner = current.owners.find((item) => item.resourceId === release.resourceId);
        if (owner && owner.ownerSubject !== release.ownerSubject) return { ok: false, conflict: true };
        if (current.releases.some((item) =>
          (item.resourceId === release.resourceId && item.version === release.version)
          || (item.ownerSubject === release.ownerSubject && item.idempotencyKeyHash === release.idempotencyKeyHash)
        )) return { ok: false, conflict: true };
        const owners = owner ? current.owners : [...current.owners, { resourceId: release.resourceId, ownerSubject: release.ownerSubject, claimedAt: release.createdAt }];
        writeLocalReleaseFile([...current.releases, release], owners);
        return { ok: true };
      });
    } catch {
      return { ok: false };
    }
  }
  const response = await supabaseRpc("claim_resource_package_release", {
    p_release: toSupabaseRow(release)
  }, {
    method: "POST",
    headers: { "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({ p_release: toSupabaseRow(release) })
  });
  return { ok: Boolean(response?.ok), conflict: response?.status === 409 };
}

async function activateRelease(release: ResourceRelease): Promise<boolean> {
  if (!hasSupabaseStore()) {
    try {
      const current = readLocalReleaseFile(true);
      return syncAndVerifyLocalProjection(current.releases.map((item) => item.id === release.id ? release : item), current.owners);
    } catch {
      return false;
    }
  }
  const response = await supabaseRequest("resource_package_releases", { id: `eq.${release.id}`, status: "eq.pending" }, {
    method: "PATCH",
    headers: { "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify({ status: "active", activated_at: release.activatedAt, failure_code: null, failed_at: null })
  });
  if (!response?.ok) return false;
  try {
    const rows = await response.json() as unknown[];
    if (rows.length !== 1) return false;
  } catch {
    return false;
  }
  const durable = await readDurableReleases();
  return durable.ok && syncAndVerifyLocalProjection(durable.releases);
}

async function failRelease(release: ResourceRelease, code: string): Promise<void> {
  const failed = { ...release, status: "failed" as const, failedAt: new Date().toISOString(), failureCode: code };
  if (!hasSupabaseStore()) {
    try {
      const current = readLocalReleaseFile(true);
      writeLocalReleaseFile(current.releases.map((item) => item.id === release.id ? failed : item), current.owners);
    } catch {
      // Corrupt durable local metadata is never overwritten by a failure cleanup.
    }
    return;
  }
  await supabaseRequest("resource_package_releases", { id: `eq.${release.id}`, status: "eq.pending" }, {
    method: "PATCH",
    headers: { "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({ status: "failed", failed_at: failed.failedAt, failure_code: code })
  });
}

async function abortPendingRelease(release: ResourceRelease): Promise<void> {
  if (!hasSupabaseStore()) {
    try {
      await withReleaseLock("__local_release_store__", async () => {
        const current = readLocalReleaseFile(true);
        const releases = current.releases.filter((item) => item.id !== release.id || item.status !== "pending");
        const owners = current.owners.filter((owner) =>
          owner.resourceId !== release.resourceId || releases.some((item) => item.resourceId === owner.resourceId)
        );
        writeLocalReleaseFile(releases, owners);
      });
    } catch {
      // A retained pending row stays invisible and is handled by the startup reconciler.
    }
    return;
  }
  await supabaseRpc("abort_resource_package_release", {
    p_release_id: release.id,
    p_owner_subject: release.ownerSubject,
    p_idempotency_key_hash: release.idempotencyKeyHash
  });
}

function readLocalReleaseFile(strict = false): ResourceReleaseFile {
  if (!existsSync(releasesPath)) return { schemaVersion: 1, owners: [], releases: [] };
  try {
    const parsed = JSON.parse(readFileSync(releasesPath, "utf8")) as Partial<ResourceReleaseFile>;
    if (!Array.isArray(parsed.releases) || (parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1)) {
      throw new ReleaseStorageError("RELEASE_STORE_CORRUPT");
    }
    const releases = parsed.releases.filter(validRelease);
    if (releases.length !== parsed.releases.length) throw new ReleaseStorageError("RELEASE_STORE_CORRUPT");
    const owners = Array.isArray(parsed.owners)
      ? parsed.owners.filter(validOwner)
      : dedupeOwners(releases.map((release) => ({ resourceId: release.resourceId, ownerSubject: release.ownerSubject, claimedAt: release.createdAt })));
    if (Array.isArray(parsed.owners) && owners.length !== parsed.owners.length) throw new ReleaseStorageError("RELEASE_STORE_CORRUPT");
    return { schemaVersion: 1, owners, releases };
  } catch {
    if (strict) throw new ReleaseStorageError("RELEASE_STORE_CORRUPT");
    return { schemaVersion: 1, owners: [], releases: [] };
  }
}

function writeLocalReleaseFile(
  releases: ResourceRelease[],
  owners = dedupeOwners(releases.map((release) => ({ resourceId: release.resourceId, ownerSubject: release.ownerSubject, claimedAt: release.createdAt })))
): void {
  mkdirSync(path.dirname(releasesPath), { recursive: true, mode: 0o750 });
  const payload = Buffer.from(`${JSON.stringify({ schemaVersion: 1, owners: dedupeOwners(owners), releases }, null, 2)}\n`, "utf8");
  atomicWriteFile(releasesPath, payload, 0o640);
}

function syncAndVerifyLocalProjection(
  releases: ResourceRelease[],
  owners = dedupeOwners(releases.map((release) => ({ resourceId: release.resourceId, ownerSubject: release.ownerSubject, claimedAt: release.createdAt })))
): boolean {
  try {
    fault("before_projection_sync");
    writeLocalReleaseFile(releases, owners);
    fault("after_projection_write");
    const projected = readLocalReleaseFile(true);
    const expected = releases.map(releaseProjectionKey).sort();
    const actual = projected.releases.map(releaseProjectionKey).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) return false;
    return projected.releases
      .filter((release) => release.status === "active")
      .every((release) => Boolean(resourceArchivePathForRead(release.resourceId, release.version)));
  } catch {
    return false;
  }
}

function releaseProjectionKey(release: ResourceRelease): string {
  return [release.id, release.resourceId, release.version, release.ownerSubject, release.idempotencyKeyHash, release.payloadDigest, release.artifactDigest, release.archiveSize, release.storageKey, release.status, release.trust].join("|");
}

function atomicWriteFile(target: string, payload: Buffer, mode: number): void {
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode);
    let offset = 0;
    while (offset < payload.length) offset += writeSync(fd, payload, offset, payload.length - offset, offset);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, target);
    fsyncDirectory(path.dirname(target));
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temp, { force: true });
  }
}

function fsyncDirectory(directory: string): void {
  const fd = openSync(directory, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function safeRemoveCommittedArchive(storageKey: string, expectedDigest: string): void {
  const target = path.join(importArchiveRoot, storageKey);
  try {
    if (isWithin(importArchiveRoot, target) && existsSync(target) && sha256(readFileSync(target)) === expectedDigest) {
      rmSync(target, { force: true });
      fsyncDirectory(importArchiveRoot);
    }
  } catch {
    // Reconciler will quarantine any failed release object that could not be removed.
  }
}

function removeStaleTempArchives(now: number, maxAgeMs: number): number {
  if (!existsSync(importArchiveRoot)) return 0;
  let removed = 0;
  for (const entry of readDirectoryNames(importArchiveRoot)) {
    if (!entry.startsWith(".") || !entry.endsWith(".tmp")) continue;
    const target = path.join(importArchiveRoot, entry);
    try {
      if (now - statSync(target).mtimeMs < maxAgeMs) continue;
      rmSync(target, { force: true });
      removed += 1;
    } catch {
      // Best effort; never make a failed cleanup object visible.
    }
  }
  if (removed) fsyncDirectory(importArchiveRoot);
  return removed;
}

function readDirectoryNames(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

function sameRelease(release: ResourceRelease, input: CommitResourceReleaseInput, artifactDigest: string): boolean {
  return release.resourceId === input.resource.id
    && release.version === input.version
    && release.ownerSubject === input.ownerSubject
    && release.payloadDigest === input.payloadDigest
    && release.artifactDigest === artifactDigest;
}

function safeResourcePayload(resource: Resource): boolean {
  const parsed = parseRuntimeResource(resource);
  if (!parsed) return false;
  // A static signature scan does not infer declared permissions or runtime
  // capability risk. Only a failing scan establishes a critical block; clean
  // or warning-only packages remain UNKNOWN until a separate capability review.
  const scanRisk = { not_scanned: "UNKNOWN", pass: "UNKNOWN", warn: "UNKNOWN", fail: "CRITICAL" } as const;
  const scan = parsed.trust.securityScan;
  return /^onlyharness:packages\/[a-z0-9][a-z0-9-]{1,80}$/.test(parsed.id)
    && parsed.identity.scheme === "onlyharness"
    && parsed.identity.key === parsed.id.slice("onlyharness:".length)
    && parsed.trust.sourceChecked === true
    && Boolean(scan ? scanRisk[scan] === parsed.trust.riskTier : false)
    && parsed.trust.installVerifiedAt === undefined
    && parsed.trust.gateVerifiedAt === undefined
    && parsed.workspaceApproval === undefined
    && !parsed.creatorName?.includes("@");
}

function unsafeWindowsPath(value: string): boolean {
  return path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value) || /^(?:\\\\|\/\/)/.test(value);
}

function validRelease(value: unknown): value is ResourceRelease {
  if (!value || typeof value !== "object") return false;
  const release = value as Partial<ResourceRelease>;
  const resource = release.resource as Resource | undefined;
  const expectedStorageKey = release.resourceId && release.version
    ? `${Buffer.from(`${release.resourceId}@${release.version}`, "utf8").toString("base64url")}.tar.gz`
    : undefined;
  const validState = release.status === "pending"
    ? !release.activatedAt && !release.failedAt && !release.failureCode
    : release.status === "active"
      ? validTimestamp(release.activatedAt) && !release.failedAt && !release.failureCode
      : release.status === "failed" && validTimestamp(release.failedAt) && !release.activatedAt && typeof release.failureCode === "string";
  return typeof release.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(release.id)
    && typeof release.resourceId === "string" && /^onlyharness:packages\/[a-z0-9][a-z0-9-]{1,80}$/.test(release.resourceId)
    && isReleaseSemver(release.version)
    && /^user:[a-f0-9]{64}$/.test(release.ownerSubject ?? "")
    && /^sha256:[a-f0-9]{64}$/.test(release.idempotencyKeyHash ?? "")
    && /^[a-f0-9]{64}$/.test(release.payloadDigest ?? "")
    && /^[a-f0-9]{64}$/.test(release.artifactDigest ?? "")
    && Number.isSafeInteger(release.archiveSize) && (release.archiveSize ?? 0) > 0
    && release.storageKey === expectedStorageKey
    && (release.status === "pending" || release.status === "active" || release.status === "failed")
    && validState
    && release.trust === "unreviewed"
    && Boolean(resource) && safeResourcePayload(resource as Resource)
    && resource?.id === release.resourceId
    && resource?.identity.key === release.resourceId.slice("onlyharness:".length)
    && validTimestamp(release.createdAt);
}

function validOwner(value: unknown): value is ResourceOwner {
  if (!value || typeof value !== "object") return false;
  const owner = value as Partial<ResourceOwner>;
  return typeof owner.resourceId === "string" && /^onlyharness:packages\/[a-z0-9][a-z0-9-]{1,80}$/.test(owner.resourceId)
    && /^user:[a-f0-9]{64}$/.test(owner.ownerSubject ?? "")
    && validTimestamp(owner.claimedAt);
}

function validTimestamp(value: string | undefined): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function dedupeOwners(owners: ResourceOwner[]): ResourceOwner[] {
  const byResource = new Map<string, ResourceOwner>();
  for (const owner of owners) if (!byResource.has(owner.resourceId)) byResource.set(owner.resourceId, owner);
  return [...byResource.values()];
}

function toSupabaseRow(release: ResourceRelease): SupabaseReleaseRow {
  return {
    id: release.id,
    resource_id: release.resourceId,
    version: release.version,
    owner_subject: release.ownerSubject,
    idempotency_key_hash: release.idempotencyKeyHash,
    payload_digest: release.payloadDigest,
    artifact_digest: release.artifactDigest,
    archive_size: release.archiveSize,
    storage_key: release.storageKey,
    status: release.status,
    trust: release.trust,
    resource_payload: release.resource,
    created_at: release.createdAt,
    activated_at: release.activatedAt ?? null,
    failed_at: release.failedAt ?? null,
    failure_code: release.failureCode ?? null
  };
}

function fromSupabaseRow(row: SupabaseReleaseRow): ResourceRelease | undefined {
  const release: ResourceRelease = {
    id: row.id,
    resourceId: row.resource_id,
    version: row.version,
    ownerSubject: row.owner_subject,
    idempotencyKeyHash: row.idempotency_key_hash,
    payloadDigest: row.payload_digest,
    artifactDigest: row.artifact_digest,
    archiveSize: row.archive_size,
    storageKey: row.storage_key,
    status: row.status,
    trust: row.trust,
    resource: row.resource_payload,
    createdAt: row.created_at,
    ...(row.activated_at ? { activatedAt: row.activated_at } : {}),
    ...(row.failed_at ? { failedAt: row.failed_at } : {}),
    ...(row.failure_code ? { failureCode: row.failure_code } : {})
  };
  return validRelease(release) ? release : undefined;
}

function hasSupabaseStore(): boolean {
  if (process.env.RESOURCE_RELEASES_USE_LOCAL_STORE === "true") return false;
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function supabaseRequest(table: string, params?: Record<string, string>, init?: RequestInit): Promise<Response | undefined> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return undefined;
  const query = params ? `?${new URLSearchParams(params).toString()}` : "";
  try {
    return await fetch(`${url}/rest/v1/${table}${query}`, {
      ...init,
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        ...(init?.headers ?? {})
      }
    });
  } catch {
    return undefined;
  }
}

async function supabaseRpc(name: string, body: unknown, init?: RequestInit): Promise<Response | undefined> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return undefined;
  try {
    return await fetch(`${url}/rest/v1/rpc/${name}`, {
      ...init,
      body: JSON.stringify(body),
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...(init?.headers ?? {})
      }
    });
  } catch {
    return undefined;
  }
}

async function withReleaseLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = releaseLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  releaseLocks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (releaseLocks.get(key) === queued) releaseLocks.delete(key);
  }
}

function conflict(error: string): CommitResourceReleaseResult {
  return { ok: false, status: 409, code: "PUBLISH_CONFLICT", error, next: "Choose a new name/version or replay the original request with the same idempotency key and payload." };
}

function validationFailure(error: string): CommitResourceReleaseResult {
  return { ok: false, status: 400, code: "VALIDATION_FAILED", error, next: "Fix the release metadata or archive contents before retrying. No durable mutation was made." };
}

function storageUnavailable(): CommitResourceReleaseResult {
  return { ok: false, status: 503, code: "ARCHIVE_STORAGE_UNAVAILABLE", error: "Hosted resource archive storage is temporarily unavailable", next: "Retry later. No resource package was made visible." };
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" ? !relative.startsWith("..") && !path.isAbsolute(relative) : true;
}

function fault(boundary: string): void {
  if (process.env.RESOURCE_RELEASE_FAULT_AT === boundary) throw new ReleaseStorageError(`FAULT_${boundary.toUpperCase()}`);
}

class ReleaseStorageError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
