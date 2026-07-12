import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import {
  ArtifactValidationError,
  MAX_ARTIFACT_FILES,
  MAX_ARTIFACT_FILE_BYTES,
  MAX_ARTIFACT_TOTAL_BYTES,
  canonicalArtifactDigest,
  normalizeArtifactPath
} from "@harnesshub/capability-schema/node";
import type { ManagedArchive } from "./superskill-types.js";
import { DIGEST_RE, SuperSkillCliError } from "./superskill-types.js";

export const MAX_MANAGED_FILES = MAX_ARTIFACT_FILES;
export const MAX_MANAGED_FILE_BYTES = MAX_ARTIFACT_FILE_BYTES;
export const MAX_MANAGED_TOTAL_BYTES = MAX_ARTIFACT_TOTAL_BYTES;

export function sha256Digest(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function normalizeManagedPath(input: string): string {
  try {
    return normalizeArtifactPath(input);
  } catch (error) {
    throw mapArtifactError(error, input);
  }
}

export function computeArtifactDigest(files: Array<{ path: string; content: string; truncated?: boolean }>): string {
  try {
    return canonicalArtifactDigest(files);
  } catch (error) {
    throw mapArtifactError(error);
  }
}

export function validateManagedArchive(archive: ManagedArchive, expected: { version: string; digest: string }): string {
  if (!archive || typeof archive !== "object" || !Array.isArray(archive.files) || !Number.isInteger(archive.totalFileCount) || typeof archive.archiveTruncated !== "boolean") {
    throw new SuperSkillCliError("Registry returned an invalid managed archive contract.", 3, "ARTIFACT_NOT_IMMUTABLE", "Do not write any files; align the API and CLI contract versions.");
  }
  if (archive.files.some((file) => !file || typeof file.path !== "string" || typeof file.content !== "string")) {
    throw new SuperSkillCliError("Managed archive contains an invalid file entry.", 3, "ARTIFACT_NOT_IMMUTABLE", "Do not write any files; request a complete reviewed release.");
  }
  if (!archive.snapshot || archive.version !== expected.version) {
    throw new SuperSkillCliError("Release is not an immutable exact-version snapshot.", 3, "ARTIFACT_NOT_IMMUTABLE", "Request a new SuperSkill recommendation.");
  }
  if (archive.archiveTruncated || archive.totalFileCount !== archive.files.length || archive.totalFileCount > MAX_MANAGED_FILES) {
    throw new SuperSkillCliError("Managed archive is incomplete.", 3, "ARTIFACT_NOT_IMMUTABLE", "Request a complete reviewed release.");
  }
  if (!DIGEST_RE.test(archive.artifactDigest) || archive.artifactDigest !== expected.digest) {
    throw digestMismatch();
  }
  const localDigest = computeArtifactDigest(archive.files);
  if (localDigest !== expected.digest || localDigest !== archive.artifactDigest) throw digestMismatch();
  return localDigest;
}

export function assertSafeRegularFile(root: string, file: string): void {
  const resolvedRoot = realpathSync(root);
  const resolved = path.resolve(file);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new SuperSkillCliError("Managed file resolves outside its package.", 3, "MANAGED_FILE_CHANGED", "Inspect the managed directory manually; no files were changed.");
  }
  let cursor = resolved;
  while (cursor !== resolvedRoot) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new SuperSkillCliError("Managed path contains a symlink.", 3, "MANAGED_FILE_CHANGED", "Replace the symlink or remove the package manually.");
    }
    cursor = path.dirname(cursor);
    if (!cursor.startsWith(resolvedRoot)) throw unsafePath(relative);
  }
  if (existsSync(resolved) && !statSync(resolved).isFile()) {
    throw new SuperSkillCliError("Managed path is not a regular file.", 3, "MANAGED_FILE_CHANGED", "Inspect the managed directory manually; no files were changed.");
  }
}

export function packageDigest(managedFiles: Record<string, string>): string {
  const entries = Object.entries(managedFiles).map(([file, digest]) => ({ path: normalizeManagedPath(file), digest }));
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  return sha256Digest(entries.map((entry) => `${entry.path}\0${entry.digest}\n`).join(""));
}

function digestMismatch(): SuperSkillCliError {
  return new SuperSkillCliError("Managed archive digest does not match the reviewed release.", 3, "ARTIFACT_DIGEST_MISMATCH", "Do not use the artifact; request a new recommendation.");
}

function unsafePath(input: string): SuperSkillCliError {
  return new SuperSkillCliError(`Unsafe managed archive path: ${JSON.stringify(input)}.`, 3, "ARTIFACT_NOT_IMMUTABLE", "Use an archive with normalized relative paths only.");
}

function mapArtifactError(error: unknown, input = "archive"): SuperSkillCliError {
  if (error instanceof ArtifactValidationError) {
    const reason = error.reasonCode.includes("PATH") ? `Unsafe managed archive path: ${JSON.stringify(input)}.` : error.message;
    return new SuperSkillCliError(reason, 3, "ARTIFACT_NOT_IMMUTABLE", "Use a complete reviewed release within the shared artifact limits.");
  }
  return new SuperSkillCliError("Managed archive validation failed.", 3, "ARTIFACT_NOT_IMMUTABLE", "Request a fresh reviewed release.");
}
