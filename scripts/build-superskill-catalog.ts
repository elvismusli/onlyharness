import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  curatedCatalogSchema,
  capabilityRequiresIndependentReview,
  managedCapabilityHistorySchema,
  managedCapabilityIndexSchema,
  hasReviewWarningLimitation,
  publicActorIdentitySchema,
  reviewAttestationSchema,
  reviewWarningLimitationCodes,
  type CuratedResource,
  type ManagedCapability,
  type ManagedCapabilityIndex,
  type ManagedCapabilityHistory,
  type ManagedPermissions,
  type ReviewAttestation,
  type TrustCheck
} from "@harnesshub/capability-schema/browser";
import { parseManifestText, type HarnessManifest } from "@harnesshub/schema";
import { canonicalArtifactDigest, readArtifactFilesFromRoot } from "@harnesshub/capability-schema/node";
import YAML from "yaml";
import * as registry from "../apps/harness-api/src/registry.js";
import { evaluateManagedEligibility } from "../apps/harness-api/src/trust-policy.js";
import { recomputeCapabilityDiff, scanHarnessFiles } from "../apps/harness-api/src/security-scan.js";

const root = path.resolve(import.meta.dirname, "..");
const curatedPath = path.join(root, "data/superskill/curated.json");
const indexPath = path.join(root, "data/superskill/index.json");
const historyPath = path.join(root, "data/superskill/history.json");
const minuteMs = 60_000;
const dayMs = 86_400_000;
const approvalClockSkewMs = 5 * minuteMs;
const compatibilityFreshnessMs = 90 * dayMs;
const humanReviewFreshnessMs = 180 * dayMs;

export function buildSuperskillIndex(now = new Date()): ManagedCapabilityIndex {
  const curated = curatedCatalogSchema.parse(JSON.parse(readFileSync(curatedPath, "utf8")));
  assertUnique(curated.resources);
  const capabilities = curated.resources.map((resource) => buildCapability(resource, now));
  const generatedAt = capabilities.reduce((latest, item) => latest > item.release.publishedAt ? latest : item.release.publishedAt, "1970-01-01T00:00:00.000Z");
  return managedCapabilityIndexSchema.parse({ schemaVersion: "superskill.index.v1", generatedAt, capabilities });
}

export function mergeSuperskillHistory(current: ManagedCapabilityIndex, previous?: ManagedCapabilityHistory): ManagedCapabilityHistory {
  const releases = new Map<string, ManagedCapability>();
  for (const capability of previous?.capabilities ?? []) releases.set(historyKey(capability), capability);
  for (const capability of current.capabilities) releases.set(historyKey(capability), capability);
  const capabilities = [...releases.values()].sort((left, right) => left.id.localeCompare(right.id)
    || left.release.version.localeCompare(right.release.version)
    || left.release.artifactDigest.localeCompare(right.release.artifactDigest));
  const generatedAt = previous?.generatedAt && previous.generatedAt > current.generatedAt ? previous.generatedAt : current.generatedAt;
  return managedCapabilityHistorySchema.parse({ schemaVersion: "superskill.history.v1", generatedAt, capabilities });
}

function buildCapability(resource: CuratedResource, now: Date): ManagedCapability {
  const [owner, repo] = resource.ref.split("/");
  const sourceRoot = owner && repo ? registry.resolveHarnessPath(owner, repo) : undefined;
  if (!sourceRoot) throw new Error(`Managed source is missing: ${resource.ref}`);
  const snapshot = registry.readArchiveSnapshot(owner, repo, resource.version);
  if (!snapshot || snapshot.archiveTruncated || snapshot.totalFileCount !== snapshot.files.length || !snapshot.artifactDigest) {
    throw new Error(`Managed source has no complete immutable snapshot: ${resource.ref}@${resource.version}`);
  }
  if (snapshot.artifactDigest !== resource.expectedDigest) throw new Error(`Managed source digest mismatch: ${resource.ref}@${resource.version}`);
  const manifestFile = snapshot.files.find((file) => file.path === "harness.yaml" && !file.truncated);
  if (!manifestFile) throw new Error(`Managed snapshot has no harness.yaml: ${resource.ref}@${resource.version}`);
  const manifest = parseManifestText(manifestFile.content);
  if (manifest.name !== repo || manifest.version !== resource.version) throw new Error(`Managed manifest tuple mismatch: ${resource.ref}@${resource.version}`);
  if (manifest.pricing.model !== "free") throw new Error(`Managed source must use free pricing: ${resource.ref}@${resource.version}`);
  if (manifest.content.type !== "harness") throw new Error(`Managed source must be an instruction harness: ${resource.ref}@${resource.version}`);
  if (!manifest.source.upstream_url || !manifest.source.upstream_license || manifest.source.upstream_license.toUpperCase() === "UNSPECIFIED") {
    throw new Error(`Managed source/license is unknown: ${resource.ref}@${resource.version}`);
  }

  const review = resource.reviewFile ? loadReview(resource) : undefined;
  const permissions = mapPermissions(manifest);
  const snapshotFiles = snapshot.files.map((file) => ({ path: file.path, content: file.content }));
  const snapshotScan = scanHarnessFiles(snapshotFiles, { networkAllowlist: permissions.networkAllowlist, scannedAt: snapshot.createdAt });
  const snapshotDiff = recomputeCapabilityDiff(snapshotFiles, permissions);
  validateApprovalEvidence(resource, review, now, {
    evalCommand: manifest.evals.command,
    expectedAuthorship: resource.status === "approved" ? loadPromotionAuthorship(resource) : undefined
  });
  if (review) verifyAttestationAgainstSnapshot(resource, review, snapshotScan, snapshotDiff, {
    url: manifest.source.upstream_url,
    license: manifest.source.upstream_license
  });
  if (resource.status === "approved") {
    assertManagedInstructionOnly(snapshot.files, resource, manifest);
    const currentPaths = registry.listHarnessFiles(sourceRoot);
    if (registry.countHarnessFiles(sourceRoot) !== currentPaths.length) throw new Error(`Approved managed source exceeds the complete file limit: ${resource.id}`);
    const currentDigest = canonicalArtifactDigest(readArtifactFilesFromRoot(sourceRoot, currentPaths));
    if (currentDigest !== resource.expectedDigest) throw new Error(`Approved managed source contains unsafe files or differs from its exact snapshot: ${resource.id}`);
  }
  const detail = registry.registryDetailBasics(sourceRoot);
  const checks = buildChecks(resource, snapshot.createdAt, review);
  const compatibility = (["claude-code", "codex"] as const).map((client) => {
    const row = review?.compatibility.find((item) => item.client === client && item.verdict === "pass");
    return row
      ? { client, status: "verified" as const, verifiedAt: row.checkedAt, notes: "Exact release activation smoke completed" }
      : { client, status: "available" as const, notes: "Managed activation smoke has not been completed" };
  });
  const contextCost = snapshotContextCost(snapshot.files);
  const capability = managedCapabilityIndexSchema.shape.capabilities.element.parse({
    id: resource.id,
    type: "instruction_harness",
    title: manifest.title,
    summary: manifest.summary,
    jobs: resource.jobs,
    release: {
      ref: resource.ref,
      version: resource.version,
      artifactDigest: resource.expectedDigest,
      immutable: true,
      publishedAt: snapshot.createdAt,
      delivery: "free_archive"
    },
    source: {
      owner: manifest.source.authors[0] ?? "OnlyHarness",
      url: manifest.source.upstream_url,
      license: manifest.source.upstream_license
    },
    compatibility,
    permissions,
    contextCost,
    trust: {
      status: resource.status,
      riskScore: detail.inspection.risk.score,
      riskTier: detail.inspection.risk.tier,
      checks,
      limitations: review?.limitations ?? ["Candidate has not completed exact-release managed review"],
      reviewedAt: review?.reviewedAt ?? snapshot.createdAt
    }
  });
  if (resource.status === "approved") {
    for (const client of ["claude-code", "codex"] as const) {
      const eligibility = evaluateManagedEligibility(capability, client, now);
      if (!eligibility.eligible) throw new Error(`Approved capability is not eligible for ${client}: ${resource.id} (${eligibility.blocks.join(", ")})`);
    }
  }
  return capability;
}

export function verifyAttestationAgainstSnapshot(
  resource: CuratedResource,
  review: ReviewAttestation,
  scan: ReturnType<typeof scanHarnessFiles>,
  capabilityDiff: ReturnType<typeof recomputeCapabilityDiff>,
  expectedSource: ReviewAttestation["source"]
): void {
  if (JSON.stringify(review.source) !== JSON.stringify(expectedSource)) throw new Error(`Review source provenance drift: ${resource.id}`);
  if (review.scanner.rulesetVersion !== scan.scanner) throw new Error(`Review scanner ruleset drift: ${resource.id}`);
  if (review.scanner.status !== scan.verdict) throw new Error(`Review scanner verdict drift: ${resource.id}`);
  const attestedFindings = review.scanner.findings.map((item) => `${item.ruleId}:${item.severity}`).sort();
  const actualFindings = scan.findings.map((item) => `${item.rule}:${item.severity}`).sort();
  if (JSON.stringify(attestedFindings) !== JSON.stringify(actualFindings)) throw new Error(`Review scanner findings drift: ${resource.id}`);
  if (JSON.stringify(normalizeCapabilityDiff(review.capabilityDiff)) !== JSON.stringify(normalizeCapabilityDiff(capabilityDiff))) {
    throw new Error(`Review capability diff drift: ${resource.id}`);
  }
}

function normalizeCapabilityDiff(value: ReviewAttestation["capabilityDiff"] | ReturnType<typeof recomputeCapabilityDiff>) {
  return {
    status: value.status,
    declared: value.declared,
    inferred: [...value.inferred]
      .map((item) => ({ ...item, evidence: [...item.evidence].sort((left, right) => left.file.localeCompare(right.file) || left.rule.localeCompare(right.rule)) }))
      .sort((left, right) => left.capability.localeCompare(right.capability)),
    differences: [...value.differences].sort((left, right) => left.field.localeCompare(right.field) || left.declared.localeCompare(right.declared) || left.inferred.localeCompare(right.inferred))
  };
}

function loadReview(resource: CuratedResource): ReviewAttestation {
  const reviewPath = path.resolve(path.join(root, "data/superskill", resource.reviewFile!));
  const reviewsRoot = path.resolve(path.join(root, "data/superskill/reviews"));
  if (!reviewPath.startsWith(`${reviewsRoot}${path.sep}`)) throw new Error(`Review path escapes reviews root: ${resource.reviewFile}`);
  const review = reviewAttestationSchema.parse(JSON.parse(readFileSync(reviewPath, "utf8")));
  if (review.capability.id !== resource.id || review.capability.ref !== resource.ref || review.capability.version !== resource.version || review.capability.artifactDigest !== resource.expectedDigest) {
    throw new Error(`Review exact release tuple mismatch: ${resource.id}`);
  }
  return review;
}

export function validateApprovalEvidence(
  resource: CuratedResource,
  review: ReviewAttestation | undefined,
  now: Date,
  context: { evalCommand?: string; expectedAuthorship?: ReviewAttestation["authorship"] } = {}
): void {
  if (resource.status !== "approved") return;
  if (!review) throw new Error(`Approved capability requires a review: ${resource.id}`);
  validatePromotionActorGate(resource, review, context.expectedAuthorship);
  if (review.scanner.status === "fail" || review.capabilityDiff.status === "fail") throw new Error(`Approved capability has failing review evidence: ${resource.id}`);
  const nowMs = now.getTime();
  const reviewedAtMs = Date.parse(review.reviewedAt);
  const expiresAtMs = Date.parse(review.expiresAt);
  if (reviewedAtMs > nowMs + approvalClockSkewMs) throw new Error(`Approved capability review date is in the future: ${resource.id}`);
  if (nowMs - reviewedAtMs > humanReviewFreshnessMs) throw new Error(`Approved capability human review is stale: ${resource.id}`);
  if (expiresAtMs <= reviewedAtMs || expiresAtMs > reviewedAtMs + humanReviewFreshnessMs) {
    throw new Error(`Approved capability review expiry must be after review and within 180 days: ${resource.id}`);
  }
  if (expiresAtMs <= nowMs) throw new Error(`Approved capability review expired: ${resource.id}`);
  const scannerCheckedAtMs = Date.parse(review.scanner.checkedAt);
  if (scannerCheckedAtMs > nowMs + approvalClockSkewMs || scannerCheckedAtMs > reviewedAtMs + approvalClockSkewMs) {
    throw new Error(`Approved capability scanner evidence is future-dated: ${resource.id}`);
  }
  const compatibilityCounts = new Map<string, number>();
  for (const item of review.compatibility) compatibilityCounts.set(item.client, (compatibilityCounts.get(item.client) ?? 0) + 1);
  for (const client of ["claude-code", "codex"] as const) {
    if (compatibilityCounts.get(client) !== 1) throw new Error(`Approved capability requires exactly one ${client} compatibility row: ${resource.id}`);
  }
  if (review.humanCases.length < 3 || review.humanCases.some((item) => item.verdict === "fail")) throw new Error(`Approved capability requires three non-failing human cases: ${resource.id}`);
  if (new Set(review.humanCases.map((item) => item.caseId.trim())).size !== review.humanCases.length) {
    throw new Error(`Approved capability requires unique human case IDs: ${resource.id}`);
  }
  if (capabilityRequiresIndependentReview(resource.id)) {
    const independent = review.independentReview;
    if (!independent) throw new Error(`Approved high-stakes capability requires an independent reviewer pass: ${resource.id}`);
    if (independent.verdict !== "pass") throw new Error(`Approved high-stakes capability requires a passing independent review: ${resource.id}`);
    if (!publicActorIdentitySchema.safeParse(independent.reviewer).success) {
      throw new Error(`Approved high-stakes capability independent reviewer identity must be canonical and public: ${resource.id}`);
    }
    if (independent.reviewer.actorId === review.reviewer.actorId) {
      throw new Error(`Approved high-stakes capability requires a distinct independent reviewer: ${resource.id}`);
    }
    const independentReviewedAtMs = Date.parse(independent.reviewedAt);
    if (independentReviewedAtMs > nowMs + approvalClockSkewMs || independentReviewedAtMs > reviewedAtMs + approvalClockSkewMs) {
      throw new Error(`Approved high-stakes capability independent review is future-dated: ${resource.id}`);
    }
    if (nowMs - independentReviewedAtMs > humanReviewFreshnessMs) {
      throw new Error(`Approved high-stakes capability independent review is stale: ${resource.id}`);
    }
    const humanCaseIds = [...new Set(review.humanCases.map((item) => item.caseId.trim()))].sort();
    const independentCaseIds = [...new Set(independent.caseIds.map((caseId) => caseId.trim()))].sort();
    if (independentCaseIds.length !== independent.caseIds.length
      || JSON.stringify(independentCaseIds) !== JSON.stringify(humanCaseIds)) {
      throw new Error(`Approved high-stakes capability independent review must cover every human case exactly once: ${resource.id}`);
    }
  }
  if (review.scanner.status === "warn" && !hasWarningLimitation(review, reviewWarningLimitationCodes.scanner)) {
    throw new Error(`Approved capability scanner warning requires ${reviewWarningLimitationCodes.scanner} limitation: ${resource.id}`);
  }
  if (review.capabilityDiff.status === "warn" && !hasWarningLimitation(review, reviewWarningLimitationCodes.capabilityDiff)) {
    throw new Error(`Approved capability capability warning requires ${reviewWarningLimitationCodes.capabilityDiff} limitation: ${resource.id}`);
  }
  if (context.evalCommand?.trim() && !hasWarningLimitation(review, reviewWarningLimitationCodes.evalCommand)) {
    throw new Error(`Approved capability manifest eval command requires ${reviewWarningLimitationCodes.evalCommand} limitation: ${resource.id}`);
  }
  for (const client of ["claude-code", "codex"] as const) {
    const row = review.compatibility.find((item) => item.client === client)!;
    const checkedAtMs = Date.parse(row.checkedAt);
    if (checkedAtMs > nowMs + approvalClockSkewMs || checkedAtMs > reviewedAtMs + approvalClockSkewMs) {
      throw new Error(`Approved capability ${client} compatibility evidence is future-dated: ${resource.id}`);
    }
    if (row.verdict !== "pass" || nowMs - checkedAtMs > compatibilityFreshnessMs) {
      throw new Error(`Approved capability requires fresh ${client} compatibility evidence: ${resource.id}`);
    }
  }
}

export function validatePromotionActorGate(
  resource: Pick<CuratedResource, "id">,
  review: ReviewAttestation,
  expectedAuthorship: ReviewAttestation["authorship"] | undefined
): void {
  if (!expectedAuthorship) throw new Error(`Approved capability requires immutable promotion authorship: ${resource.id}`);
  const author = publicActorIdentitySchema.safeParse(review.authorship?.author);
  const releaseCutter = publicActorIdentitySchema.safeParse(review.authorship?.releaseCutter);
  const reviewer = publicActorIdentitySchema.safeParse(review.reviewer);
  const expectedAuthor = publicActorIdentitySchema.safeParse(expectedAuthorship.author);
  const expectedReleaseCutter = publicActorIdentitySchema.safeParse(expectedAuthorship.releaseCutter);
  if (!author.success || !releaseCutter.success || !reviewer.success
    || !expectedAuthor.success || !expectedReleaseCutter.success) {
    throw new Error(`Approved capability requires canonical public actor identities: ${resource.id}`);
  }
  if (JSON.stringify(review.authorship) !== JSON.stringify(expectedAuthorship)) {
    throw new Error(`Approved capability promotion authorship drift: ${resource.id}`);
  }
  if (reviewer.data.actorId === author.data.actorId) {
    throw new Error(`Approved capability reviewer actor must differ from release author actor: ${resource.id}`);
  }
  if (reviewer.data.actorId === releaseCutter.data.actorId) {
    throw new Error(`Approved capability reviewer actor must differ from release cutter actor: ${resource.id}`);
  }
  if (review.independentReview) {
    const independentReviewer = publicActorIdentitySchema.safeParse(review.independentReview.reviewer);
    if (!independentReviewer.success) {
      throw new Error(`Approved capability requires a canonical independent reviewer actor identity: ${resource.id}`);
    }
    if (independentReviewer.data.actorId === author.data.actorId) {
      throw new Error(`Approved capability independent reviewer actor must differ from release author actor: ${resource.id}`);
    }
    if (independentReviewer.data.actorId === releaseCutter.data.actorId) {
      throw new Error(`Approved capability independent reviewer actor must differ from release cutter actor: ${resource.id}`);
    }
  }
}

function loadPromotionAuthorship(resource: CuratedResource): ReviewAttestation["authorship"] {
  const packetPath = path.join(root, "data/superskill/review-packets", `${resource.id}-${resource.version}.json`);
  const packetText = readFileSync(packetPath, "utf8");
  if (/OHSC_[A-Za-z0-9_-]{43}|\/(?:Users|home|private|tmp)\//.test(packetText)) {
    throw new Error(`Approved capability promotion packet is not public-safe: ${resource.id}`);
  }
  const packet = JSON.parse(packetText) as Record<string, any>;
  if (packet.schemaVersion !== "superskill.review-packet.v1"
    || packet.release?.id !== resource.id
    || packet.release?.ref !== resource.ref
    || packet.release?.version !== resource.version
    || packet.release?.artifactDigest !== resource.expectedDigest
    || packet.authorship?.immutable !== true
    || packet.authorship?.identityScheme !== "github_numeric_actor_v1"
    || packet.promotionGate?.identityScheme !== "github_numeric_actor_v1"
    || packet.promotionGate?.reviewerActorMustDifferFromAuthor !== true
    || packet.promotionGate?.reviewerActorMustDifferFromReleaseCutter !== true) {
    throw new Error(`Approved capability promotion packet binding is invalid: ${resource.id}`);
  }
  const author = publicActorIdentitySchema.safeParse(packet.authorship.author);
  const releaseCutter = publicActorIdentitySchema.safeParse(packet.authorship.releaseCutter);
  if (!author.success || !releaseCutter.success) {
    throw new Error(`Approved capability promotion packet actor identities are invalid: ${resource.id}`);
  }
  return { author: author.data, releaseCutter: releaseCutter.data };
}

function hasWarningLimitation(review: ReviewAttestation, code: string): boolean {
  return hasReviewWarningLimitation(review.limitations, code);
}

function buildChecks(resource: CuratedResource, checkedAt: string, review?: ReviewAttestation): TrustCheck[] {
  const expiresAt = review?.expiresAt;
  const independentReviewSummary = review?.independentReview?.verdict === "pass"
    ? "; independent high-stakes reviewer pass recorded"
    : "";
  return [
    check("schema", "pass", "static_checked", checkedAt, "Native manifest schema validated"),
    check("artifact_digest", "pass", "static_checked", checkedAt, "Immutable artifact digest matches curated release"),
    check("source_license", "pass", "static_checked", checkedAt, "Source and license are declared"),
    check("static_security", review ? review.scanner.status : "not_run", "static_checked", review?.scanner.checkedAt ?? checkedAt, review ? "Static security ruleset completed" : "Static managed review not run", expiresAt),
    check("capability_diff", review ? review.capabilityDiff.status : "not_run", "static_checked", review?.reviewedAt ?? checkedAt, review ? "Declared and inferred capabilities compared" : "Capability diff not run", expiresAt),
    check("claude_code_activation", review?.compatibility.some((item) => item.client === "claude-code" && item.verdict === "pass") ? "pass" : "not_run", "compatibility_smoked", review?.compatibility.find((item) => item.client === "claude-code")?.checkedAt ?? checkedAt, "Claude Code exact-release activation smoke", expiresAt),
    check("codex_activation", review?.compatibility.some((item) => item.client === "codex" && item.verdict === "pass") ? "pass" : "not_run", "compatibility_smoked", review?.compatibility.find((item) => item.client === "codex")?.checkedAt ?? checkedAt, "Codex exact-release activation smoke", expiresAt),
    check("human_review", review && review.humanCases.length >= 3 && !review.humanCases.some((item) => item.verdict === "fail") ? (review.humanCases.some((item) => item.verdict === "partial") ? "warn" : "pass") : "not_run", "human_reviewed", review?.reviewedAt ?? checkedAt, review ? `${review.humanCases.length} reviewed task cases${independentReviewSummary}` : "Human task review not run", expiresAt),
    check("independent_eval", "not_run", "independently_evaluated", review?.reviewedAt ?? checkedAt, "Independent outcome evaluation not run")
  ];
}

function check(id: TrustCheck["id"], status: TrustCheck["status"] | "warn", evidenceLevel: TrustCheck["evidenceLevel"], checkedAt: string, summary: string, expiresAt?: string): TrustCheck {
  const normalizedStatus = status === "fail" ? "fail" : status === "warn" ? "warn" : status;
  return { id, status: normalizedStatus, evidenceLevel, checkedAt, summary, ...(expiresAt ? { expiresAt } : {}) };
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

function snapshotContextCost(files: Array<{ path: string; content: string }>) {
  const context = files.filter((file) => file.path === "README.md" || /^(agents|prompts|runbooks)\/.+\.md$/i.test(file.path));
  const bytes = context.reduce((sum, file) => sum + Buffer.byteLength(file.content, "utf8"), 0);
  return { approxTokens: Math.round(bytes / 4), files: context.length, bytes, status: "estimated" as const };
}

function assertUnique(resources: CuratedResource[]): void {
  const ids = new Set<string>();
  const refs = new Set<string>();
  for (const resource of resources) {
    if (ids.has(resource.id)) throw new Error(`Duplicate curated capability id: ${resource.id}`);
    const exact = `${resource.ref}@${resource.version}`;
    if (refs.has(exact)) throw new Error(`Duplicate curated release: ${exact}`);
    ids.add(resource.id);
    refs.add(exact);
  }
}

export function assertManagedInstructionOnly(
  files: Array<{ path: string; content: string; truncated?: boolean }>,
  resource: Pick<CuratedResource, "id">,
  manifest: Pick<HarnessManifest, "evals">
): void {
  const allowed = /^(?:harness\.yaml|README\.md|(?:agents|prompts|runbooks)\/[a-z0-9][a-z0-9._/-]*\.md|examples\/[a-z0-9][a-z0-9._/-]*\.md|evals\/(?:promptfooconfig\.yaml|cases\/[a-z0-9][a-z0-9._/-]*\.(?:yaml|yml|json|md)))$/;
  const forbidden = files.map((file) => file.path).filter((file) => {
    const segments = file.split("/");
    return file.includes("\\") || segments.some((segment) => !segment || segment === "." || segment === "..") || !allowed.test(file);
  });
  if (forbidden.length) throw new Error(`Approved capability is not instruction-only: ${resource.id} (${forbidden.join(", ")})`);
  const expectedConfigPath = "evals/promptfooconfig.yaml";
  if (manifest.evals.promptfoo_config !== expectedConfigPath) {
    throw new Error(`Approved capability must bind its eval config to ${expectedConfigPath}: ${resource.id} (${manifest.evals.promptfoo_config})`);
  }
  const evalConfigs = files.filter((file) => file.path === expectedConfigPath);
  if (evalConfigs.length !== 1) throw new Error(`Approved capability must contain exactly one ${expectedConfigPath}: ${resource.id}`);
  validateManagedEvalConfig(evalConfigs[0], files, resource);
}

function validateManagedEvalConfig(
  configFile: { path: string; content: string; truncated?: boolean },
  files: Array<{ path: string; content: string; truncated?: boolean }>,
  resource: Pick<CuratedResource, "id">
): void {
  const fail = (reason: string): never => {
    throw new Error(`Approved capability has unsafe declarative eval config: ${resource.id} (${reason})`);
  };
  if (configFile.truncated) fail("config is truncated");
  let parsed: unknown;
  try {
    parsed = YAML.parse(configFile.content, { maxAliasCount: 0 });
  } catch {
    fail("invalid YAML");
  }
  const config = isPlainObject(parsed) ? parsed : fail("top level must be a mapping");
  const allowedKeys = new Set(["description", "prompts", "providers"]);
  const unknownKeys = Object.keys(config).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length) fail(`unsupported keys: ${unknownKeys.join(", ")}`);
  if (config.description !== undefined && (typeof config.description !== "string" || config.description.length > 500)) {
    fail("description must be a short string");
  }
  const prompts = Array.isArray(config.prompts) ? config.prompts : fail("prompts must contain 1-16 local markdown references");
  if (prompts.length === 0 || prompts.length > 16) {
    fail("prompts must contain 1-16 local markdown references");
  }
  const artifactPaths = new Set(files.filter((file) => !file.truncated).map((file) => file.path));
  for (const prompt of prompts) {
    if (typeof prompt !== "string" || !/^(?:agents|prompts|runbooks|examples|evals\/cases)\/[a-z0-9][a-z0-9._/-]*\.md$/.test(prompt)
      || prompt.includes("..") || prompt.includes("\\") || !artifactPaths.has(prompt)) {
      fail(`prompt must reference an existing local markdown file: ${String(prompt)}`);
    }
  }
  const providers = Array.isArray(config.providers) ? config.providers : fail("provider must be exactly echo");
  if (providers.length !== 1 || providers[0] !== "echo") {
    fail("provider must be exactly echo");
  }
  const scalarText = [config.description, ...prompts, ...providers]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  if (/(?:(?:https?|ssh|ftp|file|mailto|data|javascript|tel):|[a-z][a-z0-9+.-]*:\/\/|\/\/[a-z0-9.-]|www\.)/i.test(scalarText)) fail("URLs are not allowed");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function historyKey(capability: ManagedCapability): string {
  return `${capability.id}\0${capability.release.version}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = buildSuperskillIndex();
  const previous = (() => {
    try { return managedCapabilityHistorySchema.parse(JSON.parse(readFileSync(historyPath, "utf8"))); }
    catch { return undefined; }
  })();
  const history = mergeSuperskillHistory(index, previous);
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`);
  console.log(`wrote ${index.capabilities.length} current and ${history.capabilities.length} historical managed releases`);
}
