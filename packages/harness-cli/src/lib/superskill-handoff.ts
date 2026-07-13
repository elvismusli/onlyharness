import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync
} from "node:fs";
import path from "node:path";
import { canonicalInstallUrl, type BootstrapCapability } from "./superskill-bootstrap.js";
import { computeDecisionDigest, fetchExactHandoffDecision } from "./superskill-client.js";
import type { RecommendationResponse, SuperSkillClient } from "./superskill-types.js";
import { CAPABILITY_ID_RE, DIGEST_RE, SUPERSKILL_RUNTIME, SuperSkillCliError } from "./superskill-types.js";

const HANDOFF_RELATIVE = ".onlyharness/superskill-handoff.json";
const MAX_HANDOFF_BYTES = 16 * 1024;

export type PendingSuperSkillHandoff = {
  schemaVersion: "superskill.handoff.v1";
  status: "pending_explicit_activation_consent";
  capability: BootstrapCapability;
  canonicalUrl: string;
};

export type ConsumedSuperSkillHandoff = {
  source: "pending_exact_handoff";
  client: SuperSkillClient;
  handoff: PendingSuperSkillHandoff;
  recommendation: RecommendationResponse;
  activation: {
    performed: false;
    explicitConsentRequired: true;
    mode: "temporary";
    command: string;
  };
};

export function readPendingSuperSkillHandoff(projectDir?: string): PendingSuperSkillHandoff {
  const projectRoot = safeProjectRoot(projectDir);
  const handoffFile = path.join(projectRoot, HANDOFF_RELATIVE);
  let raw: string;
  let handle: number | undefined;
  try {
    assertSafeHandoffPath(projectRoot, handoffFile);
    if (!existsSync(handoffFile)) throw handoffError("Pending SuperSkill handoff was not found.", "HANDOFF_NOT_FOUND", "Use an exact SuperSkill install link first, or continue with normal SuperSkill routing.");
    const status = lstatSync(handoffFile);
    if (status.isSymbolicLink() || !status.isFile()) throw unsafeHandoff();
    if (status.size <= 0 || status.size > MAX_HANDOFF_BYTES) throw invalidHandoff();
    handle = openSync(handoffFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(handle);
    if (!opened.isFile() || opened.size <= 0 || opened.size > MAX_HANDOFF_BYTES) throw unsafeHandoff();
    const resolvedFile = realpathSync(handoffFile);
    const resolvedRelative = path.relative(projectRoot, resolvedFile);
    if (!resolvedRelative || resolvedRelative.startsWith("..") || path.isAbsolute(resolvedRelative)) throw unsafeHandoff();
    const current = lstatSync(handoffFile);
    if (current.isSymbolicLink() || current.dev !== opened.dev || current.ino !== opened.ino) throw unsafeHandoff();
    raw = readFileSync(handle, "utf8");
  } catch (error) {
    if (error instanceof SuperSkillCliError) throw error;
    throw unsafeHandoff();
  } finally {
    if (handle !== undefined) {
      try { closeSync(handle); } catch { /* read-only cleanup */ }
    }
  }

  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw invalidHandoff(); }
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "status", "capability", "canonicalUrl"])) throw invalidHandoff();
  if (value.schemaVersion !== "superskill.handoff.v1" || value.status !== "pending_explicit_activation_consent" || typeof value.canonicalUrl !== "string") throw invalidHandoff();
  if (!isRecord(value.capability) || !hasExactKeys(value.capability, ["id", "version", "artifactDigest"])) throw invalidHandoff();
  const capability = value.capability as Record<string, unknown>;
  if (
    typeof capability.id !== "string" || !CAPABILITY_ID_RE.test(capability.id)
    || typeof capability.version !== "string" || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(capability.version)
    || typeof capability.artifactDigest !== "string" || !DIGEST_RE.test(capability.artifactDigest)
  ) throw invalidHandoff();
  const tuple: BootstrapCapability = {
    id: capability.id,
    version: capability.version,
    artifactDigest: capability.artifactDigest
  };
  if (value.canonicalUrl !== canonicalInstallUrl(tuple)) throw invalidHandoff();
  return {
    schemaVersion: "superskill.handoff.v1",
    status: "pending_explicit_activation_consent",
    capability: tuple,
    canonicalUrl: value.canonicalUrl
  };
}

export async function consumePendingSuperSkillHandoff(input: {
  registry: string;
  projectDir?: string;
  client: SuperSkillClient;
  signal?: AbortSignal;
}): Promise<ConsumedSuperSkillHandoff> {
  const handoff = readPendingSuperSkillHandoff(input.projectDir);
  const recommendation = await fetchExactHandoffDecision({
    registry: input.registry,
    capability: handoff.capability,
    client: input.client,
    signal: input.signal
  });
  const selected = recommendation.selected;
  if (
    recommendation.decision !== "recommend"
    || !selected
    || recommendation.alternatives.length !== 0
    || selected.capability.id !== handoff.capability.id
    || selected.capability.release.version !== handoff.capability.version
    || selected.capability.release.artifactDigest !== handoff.capability.artifactDigest
    || selected.capability.trust.status !== "approved"
    || Date.parse(recommendation.expiresAt) <= Date.now()
    || computeDecisionDigest(selected.capability, input.client, recommendation.expiresAt, recommendation.recommendationId) !== recommendation.decisionDigest
  ) {
    throw handoffError("Registry returned an invalid exact handoff decision.", "HANDOFF_INVALID", "Do not activate anything; retry after the managed API and CLI versions are aligned.");
  }
  const activationRequestId = `req_${createHash("sha256").update(JSON.stringify({
    recommendationId: recommendation.recommendationId,
    capability: handoff.capability,
    client: input.client
  })).digest("base64url").slice(0, 24)}`;
  const command = [
    "npx --yes", `${SUPERSKILL_RUNTIME.cliPackage}@${SUPERSKILL_RUNTIME.cliVersion}`,
    "activation start", selected.capability.id,
    "--version", selected.capability.release.version,
    "--digest", selected.capability.release.artifactDigest,
    "--recommendation", recommendation.recommendationId,
    "--decision-digest", recommendation.decisionDigest,
    "--recommendation-expires-at", recommendation.expiresAt,
    "--activation-request", activationRequestId,
    "--target", input.client,
    "--mode temporary --consent explicit --json"
  ].join(" ");
  return {
    source: "pending_exact_handoff",
    client: input.client,
    handoff,
    recommendation,
    activation: { performed: false, explicitConsentRequired: true, mode: "temporary", command }
  };
}

export function acknowledgePendingSuperSkillHandoff(projectDir: string | undefined, capability: BootstrapCapability): boolean {
  try {
    const handoff = readPendingSuperSkillHandoff(projectDir);
    if (
      handoff.capability.id !== capability.id
      || handoff.capability.version !== capability.version
      || handoff.capability.artifactDigest !== capability.artifactDigest
    ) return false;
    removeVerifiedHandoff(projectDir);
    return true;
  } catch {
    return false;
  }
}

export function dismissPendingSuperSkillHandoff(projectDir?: string): PendingSuperSkillHandoff {
  const handoff = readPendingSuperSkillHandoff(projectDir);
  removeVerifiedHandoff(projectDir);
  return handoff;
}

function removeVerifiedHandoff(projectDir?: string): void {
  const projectRoot = safeProjectRoot(projectDir);
  const handoffFile = path.join(projectRoot, HANDOFF_RELATIVE);
  let handle: number | undefined;
  try {
    assertSafeHandoffPath(projectRoot, handoffFile);
    handle = openSync(handoffFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(handle);
    const current = lstatSync(handoffFile);
    if (!opened.isFile() || current.isSymbolicLink() || current.dev !== opened.dev || current.ino !== opened.ino) throw unsafeHandoff();
    unlinkSync(handoffFile);
    const parent = openSync(path.dirname(handoffFile), constants.O_RDONLY);
    try { fsyncSync(parent); } finally { closeSync(parent); }
  } catch (error) {
    if (error instanceof SuperSkillCliError) throw error;
    throw unsafeHandoff();
  } finally {
    if (handle !== undefined) {
      try { closeSync(handle); } catch { /* verified removal cleanup */ }
    }
  }
}

function safeProjectRoot(projectDir?: string): string {
  const requested = path.resolve(projectDir ?? process.cwd());
  try {
    const status = lstatSync(requested);
    if (status.isSymbolicLink() || !status.isDirectory()) throw unsafeHandoff();
    return realpathSync(requested);
  } catch (error) {
    if (error instanceof SuperSkillCliError) throw error;
    throw unsafeHandoff();
  }
}

function assertSafeHandoffPath(projectRoot: string, target: string): void {
  const relative = path.relative(projectRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw unsafeHandoff();
  let current = projectRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!existsSync(current)) continue;
    if (lstatSync(current).isSymbolicLink()) throw unsafeHandoff();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function invalidHandoff(): SuperSkillCliError {
  return handoffError("Pending SuperSkill handoff is malformed.", "HANDOFF_INVALID", "Reinstall from the exact SuperSkill link; do not edit the handoff file manually.");
}

function unsafeHandoff(): SuperSkillCliError {
  return handoffError("Pending SuperSkill handoff path is unsafe.", "HANDOFF_UNSAFE", "Remove the symlink or non-regular path manually, then reinstall from the exact link.");
}

function handoffError(message: string, reasonCode: string, next: string): SuperSkillCliError {
  return new SuperSkillCliError(message, reasonCode === "HANDOFF_NOT_FOUND" ? 4 : 3, reasonCode, next);
}
