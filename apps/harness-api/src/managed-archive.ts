import type { ManagedCapability } from "@harnesshub/capability-schema/browser";
import { canonicalArtifactDigest } from "@harnesshub/capability-schema/node";
import * as registry from "./registry.js";

export type ManagedArchivePayload = {
  owner: string;
  repo: string;
  version: string;
  snapshot: true;
  artifactDigest: string;
  totalFileCount: number;
  archiveTruncated: false;
  files: Array<{ path: string; truncated: false; content: string }>;
};

export class ManagedArchiveError extends Error {
  constructor(readonly reasonCode: string, message: string, readonly status = 409) {
    super(message);
    this.name = "ManagedArchiveError";
  }
}

export function buildManagedArchive(capability: ManagedCapability): ManagedArchivePayload {
  const [owner, repo] = capability.release.ref.split("/");
  if (!owner || !repo) throw new ManagedArchiveError("CAPABILITY_NOT_FOUND", "Managed release ref is invalid", 404);
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) throw new ManagedArchiveError("CAPABILITY_NOT_FOUND", "Managed release source is unavailable", 404);
  const manifest = registry.registryDetailBasics(root).inspection.manifest;
  if (!manifest) throw new ManagedArchiveError("CAPABILITY_NOT_FOUND", "Managed release manifest is unavailable", 404);
  if (manifest.pricing.model !== "free" || capability.release.delivery !== "free_archive") {
    throw new ManagedArchiveError("PAYMENT_NOT_SUPPORTED_IN_SUPERSKILL", "SuperSkill managed activation supports free archives only");
  }
  if (manifest.content.type !== "harness") throw new ManagedArchiveError("PERMISSION_BLOCKED", "Directory resources cannot be activated");
  const archive = registry.buildArchiveForVersion(owner, repo, root, capability.release.version);
  if (!archive || !archive.snapshot || archive.version !== capability.release.version) {
    throw new ManagedArchiveError("ARTIFACT_NOT_IMMUTABLE", "Managed archive must be an explicit immutable snapshot");
  }
  if (archive.archiveTruncated || archive.totalFileCount !== archive.files.length || archive.files.some((file) => file.truncated)) {
    throw new ManagedArchiveError("ARTIFACT_NOT_IMMUTABLE", "Managed archive is incomplete or truncated");
  }
  const artifactDigest = canonicalArtifactDigest({
    files: archive.files,
    totalFileCount: archive.totalFileCount,
    archiveTruncated: archive.archiveTruncated
  });
  if (artifactDigest !== capability.release.artifactDigest || archive.artifactDigest !== capability.release.artifactDigest) {
    throw new ManagedArchiveError("ARTIFACT_DIGEST_MISMATCH", "Managed archive digest does not match the curated exact release");
  }
  return {
    owner,
    repo,
    version: archive.version,
    snapshot: true,
    artifactDigest,
    totalFileCount: archive.totalFileCount,
    archiveTruncated: false,
    files: archive.files.map((file) => ({ path: file.path, truncated: false, content: file.content }))
  };
}
