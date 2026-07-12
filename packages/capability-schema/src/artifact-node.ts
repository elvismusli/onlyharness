import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export const MAX_ARTIFACT_FILES = 80;
export const MAX_ARTIFACT_FILE_BYTES = 256 * 1024;
export const MAX_ARTIFACT_TOTAL_BYTES = 2 * 1024 * 1024;

export type ArtifactFileInput = {
  path: string;
  content: string | Uint8Array;
  truncated?: boolean;
};

export type ArtifactArchiveInput = {
  files: ArtifactFileInput[];
  totalFileCount?: number;
  archiveTruncated?: boolean;
};

export class ArtifactValidationError extends Error {
  readonly reasonCode: string;

  constructor(reasonCode: string, message: string) {
    super(message);
    this.name = "ArtifactValidationError";
    this.reasonCode = reasonCode;
  }
}

export function normalizeArtifactPath(input: string): string {
  if (!input || input.includes("\0") || input.includes("\\")) {
    throw new ArtifactValidationError("ARTIFACT_PATH_INVALID", "Artifact path is empty, contains NUL, or uses backslashes");
  }
  if (input !== input.normalize("NFC")) {
    throw new ArtifactValidationError("ARTIFACT_PATH_INVALID", "Artifact path must already be Unicode NFC normalized");
  }
  if (path.posix.isAbsolute(input) || path.win32.isAbsolute(input)) {
    throw new ArtifactValidationError("ARTIFACT_PATH_INVALID", "Artifact path must be relative");
  }
  const segments = input.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new ArtifactValidationError("ARTIFACT_PATH_INVALID", "Artifact path contains an empty or traversal segment");
  }
  return segments.join("/");
}

export function canonicalArtifactDigest(input: ArtifactArchiveInput | ArtifactFileInput[]): string {
  const archive: ArtifactArchiveInput = Array.isArray(input) ? { files: input } : input;
  if (archive.archiveTruncated) throw new ArtifactValidationError("ARTIFACT_TRUNCATED", "Artifact archive is truncated");
  if (archive.totalFileCount !== undefined && archive.totalFileCount !== archive.files.length) {
    throw new ArtifactValidationError("ARTIFACT_TRUNCATED", "Artifact archive file count is incomplete");
  }
  if (archive.files.length === 0) throw new ArtifactValidationError("ARTIFACT_EMPTY", "Artifact must contain at least one file");
  if (archive.files.length > MAX_ARTIFACT_FILES) throw new ArtifactValidationError("ARTIFACT_TOO_LARGE", "Artifact exceeds the file count limit");

  const seen = new Set<string>();
  let totalBytes = 0;
  const chunks = archive.files.map((file) => {
    const canonicalPath = normalizeArtifactPath(file.path);
    if (seen.has(canonicalPath)) throw new ArtifactValidationError("ARTIFACT_PATH_DUPLICATE", `Duplicate artifact path: ${canonicalPath}`);
    seen.add(canonicalPath);
    if (file.truncated) throw new ArtifactValidationError("ARTIFACT_TRUNCATED", `Artifact file is truncated: ${canonicalPath}`);

    const bytes = strictUtf8Bytes(file.content, canonicalPath);
    if (bytes.byteLength > MAX_ARTIFACT_FILE_BYTES) {
      throw new ArtifactValidationError("ARTIFACT_TOO_LARGE", `Artifact file exceeds the byte limit: ${canonicalPath}`);
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_ARTIFACT_TOTAL_BYTES) throw new ArtifactValidationError("ARTIFACT_TOO_LARGE", "Artifact exceeds the total byte limit");
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    return { canonicalPath, chunk: Buffer.concat([Buffer.from(canonicalPath, "utf8"), Buffer.from([0]), Buffer.from(fileHash, "ascii"), Buffer.from("\n", "ascii")]) };
  });

  chunks.sort((left, right) => Buffer.compare(Buffer.from(left.canonicalPath, "utf8"), Buffer.from(right.canonicalPath, "utf8")));
  return `sha256:${createHash("sha256").update(Buffer.concat(chunks.map((item) => item.chunk))).digest("hex")}`;
}

export function readArtifactFilesFromRoot(resourceRoot: string, relativePaths: string[]): ArtifactFileInput[] {
  const rootReal = realpathSync(resourceRoot);
  const rootPrefix = rootReal.endsWith(path.sep) ? rootReal : `${rootReal}${path.sep}`;
  return relativePaths.map((relativePath) => {
    const canonicalPath = normalizeArtifactPath(relativePath);
    const fullPath = path.resolve(rootReal, ...canonicalPath.split("/"));
    const stat = lstatSync(fullPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new ArtifactValidationError("ARTIFACT_FILE_UNSAFE", `Artifact entry is not a regular file: ${canonicalPath}`);
    }
    const real = realpathSync(fullPath);
    if (!real.startsWith(rootPrefix)) {
      throw new ArtifactValidationError("ARTIFACT_FILE_UNSAFE", `Artifact file escapes its resource root: ${canonicalPath}`);
    }
    return { path: canonicalPath, content: readFileSync(real) };
  });
}

function strictUtf8Bytes(content: string | Uint8Array, artifactPath: string): Buffer {
  if (typeof content === "string") return Buffer.from(content, "utf8");
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(content);
    return Buffer.from(decoded, "utf8");
  } catch {
    throw new ArtifactValidationError("ARTIFACT_UTF8_INVALID", `Artifact file is not valid UTF-8: ${artifactPath}`);
  }
}
