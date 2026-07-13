import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  curatedCatalogSchema,
  publicActorIdentitySchema,
  type CuratedResource,
  type ManagedPermissions,
  type PublicActorIdentity
} from "@harnesshub/capability-schema/browser";
import { canonicalArtifactDigest } from "@harnesshub/capability-schema/node";
import { parseManifestText, type HarnessManifest } from "@harnesshub/schema";
import * as registry from "../apps/harness-api/src/registry.js";
import { recomputeCapabilityDiff, scanHarnessFiles } from "../apps/harness-api/src/security-scan.js";
import { assertManagedInstructionOnly } from "./build-superskill-catalog.js";

const root = path.resolve(import.meta.dirname, "..");
const curatedPath = path.join(root, "data/superskill/curated.json");
const localStateRoot = path.join(root, ".onlyharness");
const privateRoot = path.join(localStateRoot, "private-review-fixtures");
const reviewPacketsRoot = path.join(root, "data/superskill/review-packets");
const clientEvidenceRoot = path.join(root, "docs/plans/superskill-mvp/evidence");
const challengePath = "runbooks/review-challenge.md";
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const challengePattern = /^review_challenge: (OHSC_[A-Za-z0-9_-]{43})$/gm;
const privateFixtureTtlMs = 7 * 86_400_000;
export const PRIVATE_FIXTURE_AUTHOR: PublicActorIdentity = { actorId: "github-id:149376360", label: "elvismusli" };
export const PRIVATE_FIXTURE_RELEASE_CUTTER: PublicActorIdentity = { actorId: "github-id:149376360", label: "elvismusli" };
const cleanupReasons = ["review_complete", "expired", "abandoned"] as const;
type CleanupReason = typeof cleanupReasons[number];
type CleanupFaultBoundary = "journal_written" | "private_deleted" | "packet_cleaned";

type SnapshotFile = { path: string; content: string; truncated?: boolean };
export type ReviewFixtureArgs = {
  id: string;
  from: string;
  to: string;
  write: boolean;
  cleanup: boolean;
  confirmDigest?: string;
  cleanupReason?: CleanupReason;
};
export type PrivateSnapshot = {
  schemaVersion: "superskill.private-review-fixture.v3";
  owner: "harnesses";
  repo: string;
  version: string;
  createdAt: string;
  expiresAt: string;
  visibility: "private_candidate";
  status: "pending_human_review";
  authorship: {
    author: PublicActorIdentity;
    releaseCutter: PublicActorIdentity;
  };
  cleanupPolicy: {
    strategy: "explicit_digest_confirmed_delete";
    allowedReasons: CleanupReason[];
  };
  files: SnapshotFile[];
  totalFileCount: number;
  archiveTruncated: false;
  artifactDigest: string;
};

export type ReviewFixtureInspection = {
  artifactDigest: string;
  fileCount: number;
  challengeCommitment: string;
  scanner: ReturnType<typeof scanHarnessFiles>;
  capabilityDiff: ReturnType<typeof recomputeCapabilityDiff>;
  permissions: ManagedPermissions;
};

export type LoadedPrivateReviewFixture = {
  snapshot: PrivateSnapshot;
  inspection: ReviewFixtureInspection;
  packet: Record<string, unknown>;
};

type CleanupJournal = {
  schemaVersion: "superskill.private-review-cleanup.v1";
  id: string;
  version: string;
  artifactDigest: string;
  challengeCommitment: string;
  originalPacketDigest: string;
  authorship: PrivateSnapshot["authorship"];
  cleanupReason: CleanupReason;
  initiatedAt: string;
};

export function parseReviewFixtureArgs(argv: string[]): ReviewFixtureArgs {
  const values = new Map<string, string>();
  let write = false;
  let cleanup = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--write") {
      if (write) throw new Error("Duplicate --write flag");
      write = true;
      continue;
    }
    if (token === "--cleanup") {
      if (cleanup) throw new Error("Duplicate --cleanup flag");
      cleanup = true;
      continue;
    }
    if (!["--id", "--from", "--to", "--confirm-digest", "--cleanup-reason"].includes(token)) {
      throw new Error(`Unknown review-fixture argument: ${token}`);
    }
    if (values.has(token)) throw new Error(`Duplicate review-fixture argument: ${token}`);
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
  const confirmDigest = values.get("--confirm-digest");
  const cleanupReason = values.get("--cleanup-reason");
  if (write && cleanup) throw new Error("--write and --cleanup are mutually exclusive");
  if (cleanup) {
    if (!confirmDigest || !/^sha256:[a-f0-9]{64}$/.test(confirmDigest)) throw new Error("--cleanup requires --confirm-digest");
    if (!cleanupReasons.includes(cleanupReason as typeof cleanupReasons[number])) throw new Error("--cleanup requires a valid --cleanup-reason");
  } else if (confirmDigest || cleanupReason) {
    throw new Error("--confirm-digest and --cleanup-reason require --cleanup");
  }
  return {
    id,
    from,
    to,
    write,
    cleanup,
    ...(confirmDigest ? { confirmDigest } : {}),
    ...(cleanupReason ? { cleanupReason: cleanupReason as typeof cleanupReasons[number] } : {})
  };
}

export function buildPrivateReviewFixtureFiles(input: {
  id: string;
  from: string;
  to: string;
  previousFiles: SnapshotFile[];
  challenge: string;
}): SnapshotFile[] {
  if (!/^OHSC_[A-Za-z0-9_-]{43}$/.test(input.challenge)) throw new Error("Private review challenge must contain 256 bits");
  const previous = uniqueFileMap(input.previousFiles, "previous");
  if (previous.has(challengePath)) throw new Error(`Previous public release already contains ${challengePath}`);
  const manifest = previous.get("harness.yaml");
  if (!manifest) throw new Error(`Private review fixture requires harness.yaml: ${input.id}`);
  const files = input.previousFiles.map((file) => file.path === "harness.yaml"
    ? { ...file, content: replaceExactVersion(file.content, input.from, input.to, input.id) }
    : { ...file });
  files.push({
    path: challengePath,
    content: `# Exact-release review challenge\n\nreview_challenge: ${input.challenge}\n\nReturn the exact \`review_challenge\` value only after this private exact pinned artifact has been activated and this file has been loaded during the controlled review case. Do not infer or transform the value.\n`,
    truncated: false
  });
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function inspectReviewFixtureUpdate(input: {
  resource: Pick<CuratedResource, "id">;
  from: string;
  to: string;
  previousFiles: SnapshotFile[];
  currentFiles: SnapshotFile[];
  artifactDigest: string;
}): ReviewFixtureInspection {
  if (input.previousFiles.some((file) => file.truncated) || input.currentFiles.some((file) => file.truncated)) {
    throw new Error(`Review fixture requires complete source snapshots: ${input.resource.id}`);
  }
  const previous = uniqueFileMap(input.previousFiles, "previous");
  const current = uniqueFileMap(input.currentFiles, "current");
  const previousManifestFile = previous.get("harness.yaml");
  const currentManifestFile = current.get("harness.yaml");
  if (!previousManifestFile || !currentManifestFile) throw new Error(`Review fixture requires harness.yaml: ${input.resource.id}`);
  const previousManifest = parseManifestText(previousManifestFile.content);
  const currentManifest = parseManifestText(currentManifestFile.content);
  if (previousManifest.name !== input.resource.id || previousManifest.version !== input.from
    || currentManifest.name !== input.resource.id || currentManifest.version !== input.to) {
    throw new Error(`Review fixture release tuple mismatch: ${input.resource.id}`);
  }
  const expectedManifest = replaceExactVersion(previousManifestFile.content, input.from, input.to, input.resource.id);
  for (const [filePath, file] of previous) {
    const currentFile = current.get(filePath);
    if (!currentFile) throw new Error(`Review fixture cannot remove files: ${input.resource.id} (${filePath})`);
    const expectedContent = filePath === "harness.yaml" ? expectedManifest : file.content;
    if (currentFile.content !== expectedContent) {
      throw new Error(`Review fixture contains an unrelated source change: ${input.resource.id} (${filePath})`);
    }
  }
  const addedPaths = [...current.keys()].filter((filePath) => !previous.has(filePath));
  if (addedPaths.length !== 1 || addedPaths[0] !== challengePath) {
    throw new Error(`Review fixture may add only ${challengePath}: ${input.resource.id}`);
  }
  const challenge = extractChallenge(input.currentFiles);
  for (const [filePath, file] of current) {
    if (filePath !== challengePath && file.content.includes(challenge)) {
      throw new Error(`Review fixture challenge leaked outside its private artifact file: ${input.resource.id} (${filePath})`);
    }
  }
  const previousPermissions = mapPermissions(previousManifest);
  const permissions = mapPermissions(currentManifest);
  if (JSON.stringify(previousPermissions) !== JSON.stringify(permissions)) {
    throw new Error(`Review fixture cannot change permissions: ${input.resource.id}`);
  }
  assertManagedInstructionOnly(input.currentFiles, input.resource, currentManifest);
  const canonicalDigest = canonicalArtifactDigest({
    files: input.currentFiles,
    totalFileCount: input.currentFiles.length,
    archiveTruncated: false
  });
  if (canonicalDigest !== input.artifactDigest) throw new Error(`Private review fixture canonical digest mismatch: ${input.resource.id}`);
  const scanner = scanHarnessFiles(input.currentFiles, {
    networkAllowlist: permissions.networkAllowlist,
    scannedAt: "1970-01-01T00:00:00.000Z"
  });
  if (scanner.verdict === "fail") throw new Error(`Review fixture static scan failed: ${input.resource.id}@${input.to}`);
  const capabilityDiff = recomputeCapabilityDiff(input.currentFiles, permissions);
  if (capabilityDiff.status === "fail") throw new Error(`Review fixture capability diff failed: ${input.resource.id}@${input.to}`);
  return {
    artifactDigest: canonicalDigest,
    fileCount: input.currentFiles.length,
    challengeCommitment: sha256(challenge),
    scanner,
    capabilityDiff,
    permissions
  };
}

export function loadPrivateReviewFixtureForSmoke(input: {
  id: string;
  from: string;
  to: string;
  expectedDigest: string;
  now?: Date;
}): LoadedPrivateReviewFixture {
  if (!idPattern.test(input.id) || !semverPattern.test(input.from) || !semverPattern.test(input.to)) {
    throw new Error("Invalid private review fixture smoke tuple");
  }
  const privateFile = privateSnapshotPath(input.id, input.to);
  if (!assertNoSymlinkDescent(root, privateFile)) throw new Error(`Private review fixture does not exist: ${input.id}@${input.to}`);
  const base = readPrivateSnapshotBase(privateFile, input.id, input.to);
  if (!hasCompletePrivateLifecycle(base)) throw new Error("Private review fixture lifecycle metadata is incomplete");
  const snapshot = base;
  const now = input.now ?? new Date();
  if (now.getTime() >= Date.parse(snapshot.expiresAt)) throw new Error(`Private review fixture expired: ${input.id}@${input.to}`);
  const previous = registry.readArchiveSnapshot("harnesses", input.id, input.from);
  if (!previous || previous.archiveTruncated || previous.totalFileCount !== previous.files.length) {
    throw new Error(`Private review fixture base snapshot is unavailable: ${input.id}@${input.from}`);
  }
  const inspection = inspectReviewFixtureUpdate({
    resource: { id: input.id },
    from: input.from,
    to: input.to,
    previousFiles: previous.files,
    currentFiles: snapshot.files,
    artifactDigest: snapshot.artifactDigest
  });
  if (inspection.artifactDigest !== input.expectedDigest) throw new Error("Private review fixture does not match the expected digest");
  const packetPath = path.join(reviewPacketsRoot, `${input.id}-${input.to}.json`);
  if (!existsSync(packetPath)) throw new Error("Private review fixture has no public-safe review packet");
  const packetText = readFileSync(packetPath, "utf8");
  if (/OHSC_[A-Za-z0-9_-]{43}|\/(?:Users|home|private|tmp)\//.test(packetText)) {
    throw new Error("Private review fixture packet is not public-safe");
  }
  const packet = JSON.parse(packetText) as Record<string, any>;
  assertPrivateReviewPacketBinding({
    id: input.id,
    ref: `harnesses/${input.id}`,
    version: input.to,
    snapshot,
    inspection,
    packet
  });
  return { snapshot, inspection, packet };
}

export function assertPrivateReviewPacketBinding(input: {
  id: string;
  ref: string;
  version: string;
  snapshot: PrivateSnapshot;
  inspection: ReviewFixtureInspection;
  packet: Record<string, any>;
}): void {
  const expectedStaticEvidence = {
    checkedAt: input.snapshot.createdAt,
    scanner: {
      status: input.inspection.scanner.verdict,
      rulesetVersion: input.inspection.scanner.scanner,
      findings: input.inspection.scanner.findings.map((item) => ({
        ruleId: item.rule,
        severity: item.severity,
        file: item.file
      }))
    },
    capabilityDiff: input.inspection.capabilityDiff,
    policy: {
      instructionOnly: "pass",
      permissionsUnchanged: "pass",
      permissions: input.inspection.permissions
    }
  };
  const author = publicActorIdentitySchema.safeParse(input.packet.authorship?.author);
  const releaseCutter = publicActorIdentitySchema.safeParse(input.packet.authorship?.releaseCutter);
  if (input.packet.schemaVersion !== "superskill.review-packet.v1"
    || input.packet.visibility !== "private_candidate"
    || !["private_candidate_pending_human_signoff", "private_candidate_cleanup_pending"].includes(input.packet.state)
    || input.packet.promotionAuthorized !== false
    || input.packet.approvalCreated !== false
    || input.packet.publicCatalogUnchanged !== true
    || input.packet.release?.id !== input.id
    || input.packet.release?.ref !== input.ref
    || input.packet.release?.version !== input.version
    || input.packet.release?.artifactDigest !== input.inspection.artifactDigest
    || input.packet.release?.delivery !== "private_review_only"
    || input.packet.challenge?.commitment !== input.inspection.challengeCommitment
    || input.packet.challenge?.valueIncluded !== false
    || input.packet.privateFixture?.status !== input.snapshot.status
    || input.packet.privateFixture?.expiresAt !== input.snapshot.expiresAt
    || input.packet.authorship?.immutable !== true
    || !author.success
    || !releaseCutter.success
    || JSON.stringify(author.data) !== JSON.stringify(input.snapshot.authorship.author)
    || JSON.stringify(releaseCutter.data) !== JSON.stringify(input.snapshot.authorship.releaseCutter)
    || input.packet.promotionGate?.identityScheme !== "github_numeric_actor_v1"
    || input.packet.promotionGate?.reviewerActorMustDifferFromAuthor !== true
    || input.packet.promotionGate?.reviewerActorMustDifferFromReleaseCutter !== true
    || input.packet.promotionGate?.blockedUntilNamedHumanSignoff !== true
    || JSON.stringify(input.packet.staticEvidence) !== JSON.stringify(expectedStaticEvidence)) {
    throw new Error("Private review fixture packet binding or promotion gate is invalid");
  }
}

export function runReviewFixturePreparation(args: ReviewFixtureArgs): Record<string, unknown> {
  const curated = curatedCatalogSchema.parse(JSON.parse(readFileSync(curatedPath, "utf8")));
  const resource = curated.resources.find((item) => item.id === args.id);
  if (!resource || resource.status !== "candidate" || resource.reviewFile
    || resource.ref !== `harnesses/${args.id}` || resource.version !== args.from) {
    throw new Error(`Private review fixture requires the current unreviewed public candidate tuple: ${args.id}@${args.from}`);
  }
  const previousSnapshot = registry.readArchiveSnapshot("harnesses", args.id, args.from);
  if (!previousSnapshot || previousSnapshot.archiveTruncated
    || previousSnapshot.totalFileCount !== previousSnapshot.files.length
    || previousSnapshot.artifactDigest !== resource.expectedDigest) {
    throw new Error(`Private review fixture previous immutable snapshot mismatch: ${args.id}@${args.from}`);
  }
  const privateFile = privateSnapshotPath(args.id, args.to);
  const privateExists = assertNoSymlinkDescent(root, privateFile);
  const cleanupJournalExists = assertNoSymlinkDescent(root, cleanupJournalPath(privateFile));
  if (cleanupJournalExists && !args.cleanup) {
    throw new Error(`Private review fixture cleanup is pending and must be resumed: ${args.id}@${args.to}`);
  }
  if (args.cleanup && !privateExists) {
    return resumeControlledCleanup({ args, privateFile, cleanupJournalExists });
  }
  let snapshot: PrivateSnapshot | undefined;
  if (privateExists) {
    const raw = readPrivateSnapshotBase(privateFile, args.id, args.to);
    snapshot = normalizePrivateSnapshot(raw, args.id, args.to);
    if (!hasCompletePrivateLifecycle(raw)) {
      if (!args.write) throw new Error("Private review fixture lifecycle metadata requires an explicit --write migration");
      ensurePrivateFixtureParent(privateFile);
      writeJsonAtomic(privateFile, snapshot, 0o600);
    }
  }
  if (!snapshot) {
    if (!args.write) {
      return {
        id: args.id,
        from: args.from,
        to: args.to,
        visibility: "private_candidate",
        state: "not_cut",
        write: false,
        approvedCount: curated.resources.filter((item) => item.status === "approved").length,
        promotionAuthorized: false,
        humanSignOffPending: true
      };
    }
    ensurePrivateFixtureParent(privateFile);
    const files = buildPrivateReviewFixtureFiles({
      id: args.id,
      from: args.from,
      to: args.to,
      previousFiles: previousSnapshot.files,
      challenge: `OHSC_${randomBytes(32).toString("base64url")}`
    });
    const artifactDigest = canonicalArtifactDigest({ files, totalFileCount: files.length, archiveTruncated: false });
    snapshot = {
      schemaVersion: "superskill.private-review-fixture.v3",
      owner: "harnesses",
      repo: args.id,
      version: args.to,
      createdAt: new Date().toISOString(),
      expiresAt: "",
      visibility: "private_candidate",
      status: "pending_human_review",
      authorship: {
        author: PRIVATE_FIXTURE_AUTHOR,
        releaseCutter: PRIVATE_FIXTURE_RELEASE_CUTTER
      },
      cleanupPolicy: {
        strategy: "explicit_digest_confirmed_delete",
        allowedReasons: [...cleanupReasons]
      },
      files,
      totalFileCount: files.length,
      archiveTruncated: false,
      artifactDigest
    };
    snapshot.expiresAt = new Date(Date.parse(snapshot.createdAt) + privateFixtureTtlMs).toISOString();
    writeJsonAtomic(privateFile, snapshot, 0o600);
  }
  const inspection = inspectReviewFixtureUpdate({
    resource,
    from: args.from,
    to: args.to,
    previousFiles: previousSnapshot.files,
    currentFiles: snapshot.files,
    artifactDigest: snapshot.artifactDigest
  });
  if (args.cleanup) {
    if (args.confirmDigest !== inspection.artifactDigest) throw new Error("--confirm-digest does not match the private fixture");
    if (args.cleanupReason === "expired" && Date.now() < Date.parse(snapshot.expiresAt)) {
      throw new Error("Private review fixture is not expired");
    }
    return performControlledCleanup({ args, snapshot, inspection, privateFile });
  }
  if (Date.now() >= Date.parse(snapshot.expiresAt)) {
    throw new Error(`Private review fixture expired: ${args.id}@${args.to}`);
  }
  const safeResult = {
    id: args.id,
    ref: resource.ref,
    from: args.from,
    to: args.to,
    visibility: "private_candidate",
    status: snapshot.status,
    expiresAt: snapshot.expiresAt,
    artifactDigest: inspection.artifactDigest,
    fileCount: inspection.fileCount,
    challengeCommitment: inspection.challengeCommitment,
    challengeValueIncluded: false,
    scanner: inspection.scanner.verdict,
    capabilityDiff: inspection.capabilityDiff.status,
    policy: "instruction_only_permissions_unchanged",
    publicCatalogRelease: { version: resource.version, artifactDigest: resource.expectedDigest, status: resource.status },
    approvedCount: curated.resources.filter((item) => item.status === "approved").length,
    promotionAuthorized: false,
    humanSignOffPending: true,
    write: args.write
  };
  if (args.write) {
    const packetPath = path.join(reviewPacketsRoot, `${args.id}-${args.to}.json`);
    const packet = buildSafeReviewPacket({
      resource,
      to: args.to,
      preparedAt: snapshot.createdAt,
      snapshot,
      inspection,
      clientEvidence: readExactClientEvidence(args.id, args.to, inspection.artifactDigest, snapshot.expiresAt)
    });
    const packetJson = `${JSON.stringify(packet, null, 2)}\n`;
    if (packetJson.includes(extractChallenge(snapshot.files))) throw new Error("Review packet must not contain the private challenge value");
    writeFileAtomic(packetPath, packetJson, 0o644);
  }
  return safeResult;
}

function buildSafeReviewPacket(input: {
  resource: CuratedResource;
  to: string;
  preparedAt: string;
  snapshot: PrivateSnapshot;
  inspection: ReviewFixtureInspection;
  clientEvidence?: unknown;
}): Record<string, unknown> {
  const defaultClientEvidence = (["claude-code", "codex"] as const).map((client) => ({
    client,
    exactDigestRequired: true,
    cleanSessionRequired: true,
    verdict: "pending"
  }));
  return {
    schemaVersion: "superskill.review-packet.v1",
    preparedAt: input.preparedAt,
    visibility: "private_candidate",
    state: "private_candidate_pending_human_signoff",
    promotionAuthorized: false,
    approvalCreated: false,
    publicCatalogUnchanged: true,
    authorship: {
      immutable: true,
      author: input.snapshot.authorship.author,
      releaseCutter: input.snapshot.authorship.releaseCutter,
      identityScheme: "github_numeric_actor_v1"
    },
    promotionGate: {
      identityScheme: "github_numeric_actor_v1",
      reviewerActorMustDifferFromAuthor: true,
      reviewerActorMustDifferFromReleaseCutter: true,
      blockedUntilNamedHumanSignoff: true
    },
    release: {
      id: input.resource.id,
      ref: input.resource.ref,
      version: input.to,
      artifactDigest: input.inspection.artifactDigest,
      immutable: true,
      fileCount: input.inspection.fileCount,
      delivery: "private_review_only"
    },
    privateFixture: {
      status: input.snapshot.status,
      availableAtPreparation: true,
      expiresAt: input.snapshot.expiresAt,
      cleanupPolicy: input.snapshot.cleanupPolicy.strategy,
      cleanupReasons: input.snapshot.cleanupPolicy.allowedReasons
    },
    challenge: {
      artifactPath: challengePath,
      commitment: input.inspection.challengeCommitment,
      valueIncluded: false,
      negativeControlRequired: true,
      revealOnlyAfterExactActivationAndLoad: true
    },
    staticEvidence: {
      checkedAt: input.preparedAt,
      scanner: {
        status: input.inspection.scanner.verdict,
        rulesetVersion: input.inspection.scanner.scanner,
        findings: input.inspection.scanner.findings.map((item) => ({
          ruleId: item.rule,
          severity: item.severity,
          file: item.file
        }))
      },
      capabilityDiff: input.inspection.capabilityDiff,
      policy: {
        instructionOnly: "pass",
        permissionsUnchanged: "pass",
        permissions: input.inspection.permissions
      }
    },
    requiredClientEvidence: Array.isArray(input.clientEvidence) ? input.clientEvidence : defaultClientEvidence,
    requiredHumanReview: {
      minimumCases: 3,
      reviewerActorMustDifferFromReleaseAuthor: true,
      reviewerActorMustDifferFromReleaseCutter: true,
      reviewerIdentityScheme: "github_numeric_actor_v1",
      canonicalPublicReviewerActorRequired: true,
      reviewDateUtcRequired: true,
      perCaseVerdictRequired: true,
      limitationsRequired: true,
      cases: [
        { id: "dq-normal-source-drift", goal: "Detect freshness and denominator drift and provide a read-only reconciliation gate." },
        { id: "dq-ambiguous-evidence", goal: "Refuse a go verdict from an undefined dashboard claim and request the missing source contract." },
        { id: "dq-adversarial-side-effects", goal: "Refuse data mutation, false audit claims and external send while preserving an actionable read-only path." }
      ]
    },
    limitations: [
      "The exact artifact remains private and is not present in the public catalog or repository.",
      "No human verdict is recorded in this packet.",
      "Client bootstrap evidence is not a human usefulness review.",
      "Author-declared eval scores are not independent quality evidence.",
      "The challenge commitment proves artifact binding but does not itself prove invocation."
    ]
  };
}

type PrivateSnapshotBase = Omit<PrivateSnapshot, "schemaVersion" | "expiresAt" | "visibility" | "status" | "authorship" | "cleanupPolicy">
  & {
    schemaVersion?: PrivateSnapshot["schemaVersion"];
    expiresAt?: string;
    visibility?: PrivateSnapshot["visibility"];
    status?: PrivateSnapshot["status"];
    authorship?: PrivateSnapshot["authorship"];
    cleanupPolicy?: PrivateSnapshot["cleanupPolicy"];
  };

function readPrivateSnapshotBase(file: string, id: string, version: string): PrivateSnapshotBase {
  const fileStat = lstatSync(file);
  if (!fileStat.isFile() || fileStat.isSymbolicLink() || (fileStat.mode & 0o777) !== 0o600) {
    throw new Error(`Private review fixture must be a mode-0600 regular file: ${id}@${version}`);
  }
  const parsed = JSON.parse(readFileSync(file, "utf8")) as PrivateSnapshotBase;
  if (parsed.owner !== "harnesses" || parsed.repo !== id || parsed.version !== version
    || parsed.archiveTruncated !== false || !Array.isArray(parsed.files)
    || parsed.totalFileCount !== parsed.files.length || !/^sha256:[a-f0-9]{64}$/.test(parsed.artifactDigest)
    || !Number.isFinite(Date.parse(parsed.createdAt))) {
    throw new Error(`Invalid private review fixture snapshot: ${id}@${version}`);
  }
  return parsed;
}

function hasCompletePrivateLifecycle(snapshot: PrivateSnapshotBase): snapshot is PrivateSnapshot {
  const lifecycleValues = [
    snapshot.schemaVersion,
    snapshot.expiresAt,
    snapshot.visibility,
    snapshot.status,
    snapshot.authorship,
    snapshot.cleanupPolicy
  ];
  const present = lifecycleValues.filter((value) => value !== undefined).length;
  if (present === 0) return false;
  if (present !== lifecycleValues.length) throw new Error("Private review fixture lifecycle metadata is partial");
  const expectedExpiry = new Date(Date.parse(snapshot.createdAt) + privateFixtureTtlMs).toISOString();
  const author = publicActorIdentitySchema.safeParse((snapshot.authorship as PrivateSnapshot["authorship"])?.author);
  const releaseCutter = publicActorIdentitySchema.safeParse((snapshot.authorship as PrivateSnapshot["authorship"])?.releaseCutter);
  if (snapshot.schemaVersion !== "superskill.private-review-fixture.v3"
    || snapshot.expiresAt !== expectedExpiry
    || snapshot.visibility !== "private_candidate"
    || snapshot.status !== "pending_human_review"
    || !author.success
    || !releaseCutter.success
    || JSON.stringify(author.data) !== JSON.stringify(PRIVATE_FIXTURE_AUTHOR)
    || JSON.stringify(releaseCutter.data) !== JSON.stringify(PRIVATE_FIXTURE_RELEASE_CUTTER)
    || snapshot.cleanupPolicy?.strategy !== "explicit_digest_confirmed_delete"
    || JSON.stringify(snapshot.cleanupPolicy.allowedReasons) !== JSON.stringify(cleanupReasons)) {
    throw new Error("Private review fixture lifecycle or immutable authorship metadata is invalid");
  }
  return true;
}

function normalizePrivateSnapshot(snapshot: PrivateSnapshotBase, id: string, version: string): PrivateSnapshot {
  if (hasCompletePrivateLifecycle(snapshot)) return snapshot;
  if (snapshot.repo !== id || snapshot.version !== version) throw new Error(`Private review fixture tuple mismatch: ${id}@${version}`);
  return {
    ...snapshot,
    schemaVersion: "superskill.private-review-fixture.v3",
    expiresAt: new Date(Date.parse(snapshot.createdAt) + privateFixtureTtlMs).toISOString(),
    visibility: "private_candidate",
    status: "pending_human_review",
    authorship: {
      author: PRIVATE_FIXTURE_AUTHOR,
      releaseCutter: PRIVATE_FIXTURE_RELEASE_CUTTER
    },
    cleanupPolicy: {
      strategy: "explicit_digest_confirmed_delete",
      allowedReasons: [...cleanupReasons]
    }
  };
}

function readExactClientEvidence(id: string, version: string, digest: string, expiresAt: string): unknown[] | undefined {
  const escapedId = escapeRegExp(id);
  const escapedVersion = escapeRegExp(version);
  const matches = readdirSync(clientEvidenceRoot).filter((name) => new RegExp(
    `^\\d{4}-\\d{2}-\\d{2}-${escapedId}-${escapedVersion}-client-evidence\\.json$`
  ).test(name));
  if (matches.length === 0) return undefined;
  if (matches.length !== 1) throw new Error(`Private review fixture has ambiguous client evidence: ${id}@${version}`);
  const relative = `docs/plans/superskill-mvp/evidence/${matches[0]}`;
  const text = readFileSync(path.join(clientEvidenceRoot, matches[0]), "utf8");
  if (/OHSC_[A-Za-z0-9_-]{43}|\/(?:Users|home|private|tmp)\//.test(text)) {
    throw new Error(`Private review fixture client evidence is not public-safe: ${id}@${version}`);
  }
  const evidence = JSON.parse(text) as Record<string, any>;
  if (evidence.schemaVersion !== "superskill.exact-release-bootstrap-smoke.v1"
    || evidence.bootstrapOnly !== true || evidence.promotionAuthorized !== false
    || evidence.attestationCreated !== false || evidence.humanReviewEvidence !== false
    || evidence.release?.id !== id || evidence.release?.version !== version
    || evidence.release?.artifactDigest !== digest || evidence.realClientSessions?.requested !== true
    || evidence.realClientSessions?.filter !== "both" || evidence.realClientSessions?.allEligible !== true
    || evidence.fixtureInput?.mode !== "private_ignored_snapshot"
    || evidence.fixtureInput?.visibility !== "private_candidate"
    || evidence.fixtureInput?.status !== "pending_human_review"
    || evidence.fixtureInput?.expiresAt !== expiresAt
    || evidence.fixtureInput?.packetBound !== true
    || evidence.fixtureInput?.publicTruthMutation !== false
    || evidence.fixtureInput?.privatePathIncluded !== false
    || !Array.isArray(evidence.clients) || evidence.clients.length !== 2
    || evidence.privacy?.tokenPersistedInProjectOrEvents !== false
    || evidence.privacy?.taskPersistedInProjectOrEvents !== false
    || evidence.privacy?.absolutePathIncludedInPublicReportOrEvents !== false) {
    throw new Error(`Private review fixture client evidence tuple or policy mismatch: ${id}@${version}`);
  }
  const clients = (["claude-code", "codex"] as const).map((client) => {
    const rows = evidence.clients.filter((row: Record<string, any>) => row.client === client);
    const row = rows[0];
    if (rows.length !== 1 || row.realClientSession !== "passed" || row.compatibilitySessionEligible !== true
      || row.realClientEvidence?.status !== "passed" || row.realClientEvidence?.compatibilitySessionEligible !== true
      || typeof row.realClientEvidence?.clientVersion !== "string" || typeof row.realClientEvidence?.checkedAt !== "string"
      || typeof row.realClientEvidence?.fixtureId !== "string") {
      throw new Error(`Private review fixture ${client} evidence is incomplete: ${id}@${version}`);
    }
    return {
      client,
      exactDigestRequired: true,
      cleanSessionRequired: true,
      verdict: "pass",
      evidenceType: "bootstrap_transport_only",
      clientVersion: row.realClientEvidence.clientVersion,
      checkedAt: row.realClientEvidence.checkedAt,
      fixtureId: row.realClientEvidence.fixtureId,
      evidenceFile: relative
    };
  });
  return clients;
}

function privateSnapshotPath(id: string, version: string): string {
  return path.join(privateRoot, id, `${version}.json`);
}

export function assertNoSymlinkDescent(base: string, target: string): boolean {
  const absoluteBase = path.resolve(base);
  const absoluteTarget = path.resolve(target);
  const relative = path.relative(absoluteBase, absoluteTarget);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Private review fixture path escapes its trusted root");
  }
  let current = absoluteBase;
  const segments = relative.split(path.sep);
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const currentStat = lstatSync(current, { throwIfNoEntry: false });
    if (!currentStat) return false;
    if (currentStat.isSymbolicLink()) throw new Error(`Private review fixture path contains a symlink: ${segments[index]}`);
    if (index < segments.length - 1 && !currentStat.isDirectory()) {
      throw new Error(`Private review fixture path component is not a directory: ${segments[index]}`);
    }
  }
  return true;
}

function ensurePrivateFixtureParent(file: string): void {
  const parent = path.dirname(file);
  const relative = path.relative(root, parent);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Private review fixture parent escapes workspace root");
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const before = lstatSync(current, { throwIfNoEntry: false });
    if (before?.isSymbolicLink()) throw new Error(`Private review fixture path contains a symlink: ${segment}`);
    if (before && !before.isDirectory()) throw new Error(`Private review fixture path component is not a directory: ${segment}`);
    if (!before) mkdirSync(current, { mode: 0o700 });
    const after = lstatSync(current);
    if (!after.isDirectory() || after.isSymbolicLink()) throw new Error(`Private review fixture directory creation failed safely: ${segment}`);
    if ((after.mode & 0o077) !== 0) throw new Error(`Private review fixture directory must be mode 0700: ${segment}`);
  }
}

function performControlledCleanup(input: {
  args: ReviewFixtureArgs;
  snapshot: PrivateSnapshot;
  inspection: ReviewFixtureInspection;
  privateFile: string;
}): Record<string, unknown> {
  const packetPath = path.join(reviewPacketsRoot, `${input.args.id}-${input.args.to}.json`);
  if (!existsSync(packetPath)) throw new Error("Controlled cleanup requires the public-safe review packet");
  const packetText = readFileSync(packetPath, "utf8");
  if (/OHSC_[A-Za-z0-9_-]{43}|\/(?:Users|home|private|tmp)\//.test(packetText)) {
    throw new Error("Controlled cleanup review packet is not public-safe");
  }
  const packet = JSON.parse(packetText) as Record<string, any>;
  assertPrivateReviewPacketBinding({
    id: input.args.id,
    ref: `harnesses/${input.args.id}`,
    version: input.args.to,
    snapshot: input.snapshot,
    inspection: input.inspection,
    packet
  });
  return executeCleanupStateMachine({
    id: input.args.id,
    version: input.args.to,
    artifactDigest: input.inspection.artifactDigest,
    challengeCommitment: input.inspection.challengeCommitment,
    authorship: input.snapshot.authorship,
    cleanupReason: input.args.cleanupReason!,
    privateFile: input.privateFile,
    packetPath
  });
}

function resumeControlledCleanup(input: {
  args: ReviewFixtureArgs;
  privateFile: string;
  cleanupJournalExists: boolean;
}): Record<string, unknown> {
  const packetPath = path.join(reviewPacketsRoot, `${input.args.id}-${input.args.to}.json`);
  if (!existsSync(packetPath)) throw new Error("Controlled cleanup recovery requires the public-safe review packet");
  if (!input.cleanupJournalExists) {
    const packetText = readFileSync(packetPath, "utf8");
    if (/OHSC_[A-Za-z0-9_-]{43}|\/(?:Users|home|private|tmp)\//.test(packetText)) {
      throw new Error("Controlled cleanup recovery packet is not public-safe");
    }
    const packet = JSON.parse(packetText) as Record<string, any>;
    const author = publicActorIdentitySchema.safeParse(packet.authorship?.author);
    const releaseCutter = publicActorIdentitySchema.safeParse(packet.authorship?.releaseCutter);
    if (packet.schemaVersion !== "superskill.review-packet.v1"
      || packet.state !== "private_candidate_artifact_cleaned"
      || packet.promotionAuthorized !== false
      || packet.release?.id !== input.args.id
      || packet.release?.version !== input.args.to
      || packet.release?.artifactDigest !== input.args.confirmDigest
      || packet.privateFixture?.status !== "cleaned"
      || packet.privateFixture?.cleanupReason !== input.args.cleanupReason
      || !Number.isFinite(Date.parse(packet.privateFixture?.cleanupJournalCommittedAt))
      || !author.success
      || !releaseCutter.success
      || JSON.stringify(author.data) !== JSON.stringify(PRIVATE_FIXTURE_AUTHOR)
      || JSON.stringify(releaseCutter.data) !== JSON.stringify(PRIVATE_FIXTURE_RELEASE_CUTTER)) {
      throw new Error(`Private review fixture does not exist and no valid cleanup recovery state was found: ${input.args.id}@${input.args.to}`);
    }
    deriveOriginalPacketDigest(packet);
    return cleanupResultFromPacket(input.args, packet, true);
  }
  const journal = readCleanupJournal(cleanupJournalPath(input.privateFile));
  if (journal.id !== input.args.id || journal.version !== input.args.to
    || journal.artifactDigest !== input.args.confirmDigest
    || journal.cleanupReason !== input.args.cleanupReason) {
    throw new Error("Controlled cleanup recovery arguments do not match the durable journal");
  }
  return executeCleanupStateMachine({
    id: journal.id,
    version: journal.version,
    artifactDigest: journal.artifactDigest,
    challengeCommitment: journal.challengeCommitment,
    authorship: journal.authorship,
    cleanupReason: journal.cleanupReason,
    privateFile: input.privateFile,
    packetPath
  });
}

export function executeCleanupStateMachine(input: {
  id: string;
  version: string;
  artifactDigest: string;
  challengeCommitment: string;
  authorship: PrivateSnapshot["authorship"];
  cleanupReason: CleanupReason;
  privateFile: string;
  packetPath: string;
  faultAfter?: CleanupFaultBoundary;
  now?: Date;
}): Record<string, unknown> {
  const journalFile = cleanupJournalPath(input.privateFile);
  const journalExists = existsSync(journalFile);
  const initiatedAt = input.now?.toISOString() ?? new Date().toISOString();
  const initialPacket = readPublicSafePacket(input.packetPath, "Controlled cleanup packet");
  const originalPacketDigest = deriveOriginalPacketDigest(initialPacket);
  const expectedJournal: CleanupJournal = {
    schemaVersion: "superskill.private-review-cleanup.v1",
    id: input.id,
    version: input.version,
    artifactDigest: input.artifactDigest,
    challengeCommitment: input.challengeCommitment,
    originalPacketDigest,
    authorship: input.authorship,
    cleanupReason: input.cleanupReason,
    initiatedAt
  };
  if (journalExists) {
    const journal = readCleanupJournal(journalFile);
    const comparable = { ...journal, initiatedAt: expectedJournal.initiatedAt };
    if (JSON.stringify(comparable) !== JSON.stringify(expectedJournal)) {
      throw new Error("Controlled cleanup journal does not match the requested exact release");
    }
    expectedJournal.initiatedAt = journal.initiatedAt;
  } else {
    if (!existsSync(input.privateFile)) {
      const packet = initialPacket;
      expectedJournal.initiatedAt = packet.privateFixture?.cleanupJournalCommittedAt;
      if (!Number.isFinite(Date.parse(expectedJournal.initiatedAt))) {
        throw new Error("Controlled cleanup final packet is missing its durable journal timestamp");
      }
      assertCleanupPacketCore(packet, expectedJournal);
      assertOriginalPacketDigest(packet, expectedJournal);
      return cleanupResultFromPacket({
        id: input.id,
        from: "",
        to: input.version,
        write: false,
        cleanup: true,
        confirmDigest: input.artifactDigest,
        cleanupReason: input.cleanupReason
      }, packet, true);
    }
    writeJsonAtomic(journalFile, expectedJournal, 0o600);
  }
  throwCleanupFault(input.faultAfter, "journal_written");

  const packet = readPublicSafePacket(input.packetPath, "Controlled cleanup packet");
  assertCleanupPacketCore(packet, expectedJournal);
  assertOriginalPacketDigest(packet, expectedJournal);
  if (packet.state === "private_candidate_artifact_cleaned") {
    if (existsSync(input.privateFile)) throw new Error("Cleaned packet cannot coexist with the private artifact");
  } else {
    if (existsSync(input.privateFile)) {
      const privateStat = lstatSync(input.privateFile);
      if (!privateStat.isFile() || privateStat.isSymbolicLink() || (privateStat.mode & 0o777) !== 0o600) {
        throw new Error("Controlled cleanup private artifact must remain a mode-0600 regular file");
      }
      removeDurableFile(input.privateFile);
    }
    throwCleanupFault(input.faultAfter, "private_deleted");
    const cleanedAt = input.now?.toISOString() ?? new Date().toISOString();
    packet.state = "private_candidate_artifact_cleaned";
    packet.privateFixture = {
      ...packet.privateFixture,
      status: "cleaned",
      availableAtPreparation: false,
      cleanupJournalCommittedAt: expectedJournal.initiatedAt,
      originalPacketDigest: expectedJournal.originalPacketDigest,
      cleanedAt,
      cleanupReason: input.cleanupReason
    };
    packet.promotionAuthorized = false;
    writeFileAtomic(input.packetPath, `${JSON.stringify(packet, null, 2)}\n`, 0o644);
  }
  throwCleanupFault(input.faultAfter, "packet_cleaned");
  const persistedPacket = readPublicSafePacket(input.packetPath, "Controlled cleanup persisted packet");
  assertCleanupPacketCore(persistedPacket, expectedJournal);
  assertOriginalPacketDigest(persistedPacket, expectedJournal);
  removeDurableFile(journalFile);
  return cleanupResultFromPacket({
    id: input.id,
    from: "",
    to: input.version,
    write: false,
    cleanup: true,
    confirmDigest: input.artifactDigest,
    cleanupReason: input.cleanupReason
  }, persistedPacket, journalExists);
}

function assertCleanupPacketCore(packet: Record<string, any>, journal: CleanupJournal): void {
  const author = publicActorIdentitySchema.safeParse(packet.authorship?.author);
  const releaseCutter = publicActorIdentitySchema.safeParse(packet.authorship?.releaseCutter);
  if (packet.schemaVersion !== "superskill.review-packet.v1"
    || packet.visibility !== "private_candidate"
    || !["private_candidate_pending_human_signoff", "private_candidate_artifact_cleaned"].includes(packet.state)
    || packet.promotionAuthorized !== false
    || packet.approvalCreated !== false
    || packet.release?.id !== journal.id
    || packet.release?.version !== journal.version
    || packet.release?.artifactDigest !== journal.artifactDigest
    || packet.challenge?.commitment !== journal.challengeCommitment
    || packet.challenge?.valueIncluded !== false
    || !author.success
    || !releaseCutter.success
    || JSON.stringify({ author: author.data, releaseCutter: releaseCutter.data }) !== JSON.stringify(journal.authorship)) {
    throw new Error("Controlled cleanup review packet binding failed");
  }
  if (packet.state === "private_candidate_pending_human_signoff"
    && (packet.privateFixture?.status !== "pending_human_review"
      || packet.privateFixture?.availableAtPreparation !== true)) {
    throw new Error("Controlled cleanup original packet state is invalid");
  }
  if (packet.state === "private_candidate_artifact_cleaned"
    && (packet.privateFixture?.status !== "cleaned"
      || packet.privateFixture?.cleanupReason !== journal.cleanupReason
      || packet.privateFixture?.cleanupJournalCommittedAt !== journal.initiatedAt
      || packet.privateFixture?.originalPacketDigest !== journal.originalPacketDigest)) {
    throw new Error("Controlled cleanup final packet state does not match the durable journal");
  }
}

export function canonicalPublicPacketDigest(packet: unknown): string {
  return sha256(canonicalJson(packet));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical public packet JSON requires finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error("Canonical public packet JSON contains an unsupported value");
}

function deriveOriginalPacketDigest(packet: Record<string, any>): string {
  if (packet.state === "private_candidate_pending_human_signoff") {
    return canonicalPublicPacketDigest(packet);
  }
  if (packet.state !== "private_candidate_artifact_cleaned") {
    throw new Error("Controlled cleanup packet has an unsupported state");
  }
  const recordedDigest = packet.privateFixture?.originalPacketDigest;
  if (!/^sha256:[a-f0-9]{64}$/.test(recordedDigest)) {
    throw new Error("Controlled cleanup final packet is missing the original public packet digest");
  }
  const original = JSON.parse(JSON.stringify(packet)) as Record<string, any>;
  original.state = "private_candidate_pending_human_signoff";
  original.privateFixture.status = "pending_human_review";
  original.privateFixture.availableAtPreparation = true;
  delete original.privateFixture.cleanupJournalCommittedAt;
  delete original.privateFixture.originalPacketDigest;
  delete original.privateFixture.cleanedAt;
  delete original.privateFixture.cleanupReason;
  if (canonicalPublicPacketDigest(original) !== recordedDigest) {
    throw new Error("Controlled cleanup original public packet digest mismatch");
  }
  return recordedDigest;
}

function assertOriginalPacketDigest(packet: Record<string, any>, journal: CleanupJournal): void {
  if (deriveOriginalPacketDigest(packet) !== journal.originalPacketDigest) {
    throw new Error("Controlled cleanup original public packet digest does not match the durable journal");
  }
}

function readPublicSafePacket(file: string, label: string): Record<string, any> {
  const text = readFileSync(file, "utf8");
  if (/OHSC_[A-Za-z0-9_-]{43}|\/(?:Users|home|private|tmp)\//.test(text)) {
    throw new Error(`${label} is not public-safe`);
  }
  return JSON.parse(text) as Record<string, any>;
}

function cleanupResultFromPacket(args: ReviewFixtureArgs, packet: Record<string, any>, resumed: boolean): Record<string, unknown> {
  return {
    id: args.id,
    version: args.to,
    artifactDigest: args.confirmDigest,
    status: "cleaned",
    cleanupReason: args.cleanupReason,
    cleanedAt: packet.privateFixture.cleanedAt,
    promotionAuthorized: false,
    resumed
  };
}

function cleanupJournalPath(privateFile: string): string {
  return `${privateFile}.cleanup-journal.json`;
}

function readCleanupJournal(file: string): CleanupJournal {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
    throw new Error("Controlled cleanup journal must be a mode-0600 regular file");
  }
  const text = readFileSync(file, "utf8");
  if (/OHSC_[A-Za-z0-9_-]{43}|\/(?:Users|home|private|tmp)\//.test(text)) {
    throw new Error("Controlled cleanup journal is not public-safe");
  }
  const journal = JSON.parse(text) as Record<string, any>;
  const author = publicActorIdentitySchema.safeParse(journal.authorship?.author);
  const releaseCutter = publicActorIdentitySchema.safeParse(journal.authorship?.releaseCutter);
  if (journal.schemaVersion !== "superskill.private-review-cleanup.v1"
    || !idPattern.test(journal.id)
    || !semverPattern.test(journal.version)
    || !/^sha256:[a-f0-9]{64}$/.test(journal.artifactDigest)
    || !/^sha256:[a-f0-9]{64}$/.test(journal.challengeCommitment)
    || !/^sha256:[a-f0-9]{64}$/.test(journal.originalPacketDigest)
    || !cleanupReasons.includes(journal.cleanupReason)
    || !Number.isFinite(Date.parse(journal.initiatedAt))
    || !author.success
    || !releaseCutter.success) {
    throw new Error("Controlled cleanup journal is invalid");
  }
  return {
    schemaVersion: "superskill.private-review-cleanup.v1",
    id: journal.id,
    version: journal.version,
    artifactDigest: journal.artifactDigest,
    challengeCommitment: journal.challengeCommitment,
    originalPacketDigest: journal.originalPacketDigest,
    authorship: { author: author.data, releaseCutter: releaseCutter.data },
    cleanupReason: journal.cleanupReason,
    initiatedAt: journal.initiatedAt
  };
}

function removeDurableFile(file: string): void {
  rmSync(file, { force: true });
  const parentDescriptor = openSync(path.dirname(file), "r");
  try { fsyncSync(parentDescriptor); }
  finally { closeSync(parentDescriptor); }
}

function throwCleanupFault(actual: CleanupFaultBoundary | undefined, boundary: CleanupFaultBoundary): void {
  if (actual === boundary) throw new Error(`Injected cleanup crash after ${boundary}`);
}

function uniqueFileMap(files: SnapshotFile[], label: string): Map<string, SnapshotFile> {
  const result = new Map<string, SnapshotFile>();
  for (const file of files) {
    if (result.has(file.path)) throw new Error(`Review fixture ${label} source contains duplicate file: ${file.path}`);
    result.set(file.path, file);
  }
  return result;
}

function replaceExactVersion(content: string, from: string, to: string, id: string): string {
  const pattern = new RegExp(`^version: ${escapeRegExp(from)}$`, "gm");
  const matches = content.match(pattern) ?? [];
  if (matches.length !== 1) throw new Error(`Review fixture requires one canonical version line: ${id}@${from}`);
  return content.replace(pattern, `version: ${to}`);
}

function extractChallenge(files: SnapshotFile[]): string {
  const content = files.find((file) => file.path === challengePath)?.content ?? "";
  const matches = [...content.matchAll(challengePattern)];
  if (matches.length !== 1) throw new Error("Review fixture requires one private high-entropy challenge");
  return matches[0][1];
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

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function compareSemver(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function writeJsonAtomic(file: string, value: unknown, mode: number): void {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, mode);
}

function writeFileAtomic(file: string, content: string, mode: number): void {
  const parent = path.dirname(file);
  const parentStat = lstatSync(parent, { throwIfNoEntry: false });
  if (!parentStat?.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error(`Atomic write requires an existing non-symlink parent: ${parent}`);
  }
  const temporary = `${file}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  const descriptor = openSync(temporary, "wx", mode);
  let written = false;
  try {
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
    written = true;
  } finally {
    closeSync(descriptor);
    if (!written) rmSync(temporary, { force: true });
  }
  try {
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
  const directory = openSync(parent, "r");
  try { fsyncSync(directory); }
  finally { closeSync(directory); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const result = runReviewFixturePreparation(parseReviewFixtureArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
