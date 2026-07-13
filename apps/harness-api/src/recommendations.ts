import { createHash, randomBytes } from "node:crypto";
import {
  recommendationRequestSchema,
  type Client,
  type ManagedCapability,
  type ManagedPermissions,
  type RecommendationCandidate,
  type RecommendationRequest,
  type RecommendationResponse
} from "@harnesshub/capability-schema/browser";
import { evaluateManagedEligibility } from "./trust-policy.js";

const STOPWORDS = new Set(["a", "an", "and", "for", "in", "of", "on", "the", "to", "with", "и", "в", "во", "для", "на", "по", "с", "со"]);
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:sk|pk|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\b(?:api[_ -]?key|token|password|secret)\s*[:=]\s*\S{8,}/i
];

export class RecommendationValidationError extends Error {
  readonly reasonCode = "TASK_INVALID";
}

export type RecommendationOptions = {
  now?: Date;
  recommendationId?: string;
};

export function exactHandoffDecision(
  capability: ManagedCapability,
  client: Client,
  options: RecommendationOptions = {}
): RecommendationResponse {
  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
  const recommendationId = options.recommendationId ?? `rec_${randomBytes(12).toString("base64url")}`;
  const added = permissionLabels(capability.permissions);
  const selected: RecommendationCandidate = {
    capability,
    score: 100,
    why: [
      { code: "CLIENT_VERIFIED", text: `The exact linked release is compatibility-smoked for ${client}`, points: 40 },
      { code: "TRUST_CHECKS_PASS", text: "The exact linked release still passes mandatory trust checks", points: 40 },
      { code: "CURRENT_REVIEW", text: "The exact linked release review evidence is still current", points: 20 }
    ],
    limitations: capability.trust.limitations,
    permissionDelta: {
      status: "partial",
      added,
      unchanged: [],
      unknownBecause: "The universal handoff does not inspect unmanaged skills or the client sandbox policy"
    },
    consent: "required"
  };
  const decisionDigest = digestCanonicalJson({
    recommendationId,
    selected: {
      id: capability.id,
      ref: capability.release.ref,
      version: capability.release.version,
      artifactDigest: capability.release.artifactDigest,
      client,
      permissions: capability.permissions,
      trustChecks: capability.trust.checks,
      limitations: capability.trust.limitations
    },
    expiresAt
  });
  return {
    recommendationId,
    decisionDigest,
    decision: "recommend",
    confidence: 1,
    selected,
    alternatives: [],
    expiresAt
  };
}

export function normalizeTask(task: string): { phrase: string; tokens: string[] } {
  const phrase = task.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  if (phrase.length < 3 || phrase.length > 500 || SECRET_PATTERNS.some((pattern) => pattern.test(phrase))) {
    throw new RecommendationValidationError("Task must be 3..500 characters and must not contain secrets");
  }
  const cleaned = phrase.replace(/(^|\s)[^\p{L}\p{N}+#-]+|[^\p{L}\p{N}+#-]+(?=\s|$)/gu, " ").replace(/[^\p{L}\p{N}+#-]+/gu, " ");
  return { phrase, tokens: [...new Set(cleaned.split(/\s+/).filter((token) => token && !STOPWORDS.has(token)))] };
}

export function recommendCapabilities(
  rawRequest: RecommendationRequest,
  capabilities: ManagedCapability[],
  options: RecommendationOptions = {}
): RecommendationResponse {
  const parsed = recommendationRequestSchema.safeParse(rawRequest);
  if (!parsed.success) throw new RecommendationValidationError("Recommendation request is invalid");
  const request = parsed.data;
  const normalized = normalizeTask(request.task);
  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
  const scored = capabilities
    .filter((capability) => evaluateManagedEligibility(capability, request.context.client, now).eligible)
    .map((capability) => scoreCandidate(capability, request, normalized, now))
    .filter((candidate): candidate is RecommendationCandidate => Boolean(candidate))
    .sort(compareCandidates);

  const top = scored[0];
  const secondScore = scored[1]?.score ?? 0;
  let decision: RecommendationResponse["decision"] = "no_safe_match";
  if (top) {
    const gap = top.score - secondScore;
    if (top.score >= 75 && gap >= 10) decision = "recommend";
    else if (top.score >= 55 || gap < 10) decision = "needs_clarification";
  }
  const confidence = top ? Math.min(scored.length === 1 ? 0.9 : 1, Math.round(((top.score / 100) * 0.7 + (Math.min(Math.max(top.score - secondScore, 0), 20) / 20) * 0.3) * 100) / 100) : 0;
  const recommendationId = options.recommendationId ?? `rec_${randomBytes(12).toString("base64url")}`;
  const selected = decision === "no_safe_match" ? undefined : top;
  const alternatives = scored.slice(selected ? 1 : 0, selected ? 3 : 2);
  const decisionDigest = digestCanonicalJson({
    recommendationId,
    selected: selected ? {
      id: selected.capability.id,
      ref: selected.capability.release.ref,
      version: selected.capability.release.version,
      artifactDigest: selected.capability.release.artifactDigest,
      client: request.context.client,
      permissions: selected.capability.permissions,
      trustChecks: selected.capability.trust.checks,
      limitations: selected.limitations
    } : null,
    expiresAt
  });
  return {
    recommendationId,
    decisionDigest,
    decision,
    confidence,
    ...(selected ? { selected } : {}),
    alternatives,
    ...(decision === "needs_clarification" ? { clarification: { code: "AMBIGUOUS_OUTCOME" as const, question: "Which outcome matters most for this task?" } } : {}),
    expiresAt
  };
}

export function digestCanonicalJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(sortObjectKeys(value))).digest("hex")}`;
}

function scoreCandidate(
  capability: ManagedCapability,
  request: RecommendationRequest,
  task: ReturnType<typeof normalizeTask>,
  now: Date
): RecommendationCandidate | undefined {
  const exclusions = capability.jobs.flatMap((job) => job.exclusions).map(normalizedPhrase);
  if (exclusions.some((phrase) => phrase && task.phrase.includes(phrase))) return undefined;

  const intents = capability.jobs.flatMap((job) => job.intents);
  const outcomes = capability.jobs.flatMap((job) => job.outcomes);
  const exactIntent = intents.some((intent) => task.phrase.includes(normalizedPhrase(intent)));
  const intentTokens = tokenSet(intents.join(" "));
  const outcomeTokens = tokenSet(outcomes.join(" "));
  const supportTokens = tokenSet(`${capability.title} ${capability.summary}`);
  const intentMatches = overlapCount(task.tokens, intentTokens);
  const allMatches = new Set([...intentTokens, ...outcomeTokens, ...supportTokens]);
  if (!exactIntent && overlapCount(task.tokens, allMatches) < 2) return undefined;

  const why: RecommendationCandidate["why"] = [];
  if (exactIntent) why.push(reason("INTENT_EXACT", "The task matches a curated intent phrase", 18));
  const intentPoints = Math.round((intentMatches / Math.max(1, task.tokens.length)) * 12);
  if (intentPoints) why.push(reason("INTENT_OVERLAP", "Task terms overlap the capability intent", intentPoints));
  const outcomePoints = Math.round((overlapCount(task.tokens, outcomeTokens) / Math.max(1, task.tokens.length)) * 6);
  if (outcomePoints) why.push(reason("OUTCOME_MATCH", "Requested outcome matches the capability", outcomePoints));
  const supportPoints = Math.round((overlapCount(task.tokens, supportTokens) / Math.max(1, task.tokens.length)) * 4);
  const taskFit = Math.min(40, (exactIntent ? 18 : 0) + intentPoints + outcomePoints + supportPoints);

  why.push(reason("CLIENT_VERIFIED", `Exact release was compatibility-smoked for ${request.context.client}`, 15));
  const eligibility = evaluateManagedEligibility(capability, request.context.client, now);
  const trustPoints = eligibility.reviewedWarnings ? 10 : 15;
  why.push(reason("TRUST_CHECKS_PASS", eligibility.reviewedWarnings ? "Mandatory checks pass with reviewed warnings" : "Mandatory checks pass", trustPoints));

  const independent = capability.trust.checks.some((check) => check.id === "independent_eval" && check.status === "pass");
  const human = capability.trust.checks.some((check) => check.id === "human_review" && (check.status === "pass" || check.status === "warn"));
  const evaluationPoints = independent ? 10 : human ? 6 : 0;
  if (independent) why.push(reason("INDEPENDENT_EVAL", "Independent evaluation evidence is present", 10));
  else if (human) why.push(reason("HUMAN_CASES", "Human-reviewed task cases are present", 6));

  const baselineExact = request.context.installedManagedRefs.some((item) => item.artifactDigest === capability.release.artifactDigest);
  const elevated = hasElevatedPermissions(capability.permissions);
  const permissionPoints = baselineExact ? 10 : elevated ? 3 : 7;
  why.push(reason("LOW_PERMISSION_DELTA", baselineExact ? "The exact managed release is already present" : elevated ? "Capability requires highlighted powers" : "Capability uses readonly or allowlisted powers", permissionPoints));

  const reviewAgeDays = Math.max(0, (now.getTime() - Date.parse(capability.trust.reviewedAt)) / 86_400_000);
  const currentnessPoints = reviewAgeDays <= 30 ? 5 : reviewAgeDays <= 90 ? 3 : reviewAgeDays <= 180 ? 1 : 0;
  if (currentnessPoints) why.push(reason("CURRENT_REVIEW", "Review evidence is current", currentnessPoints));
  const tokens = capability.contextCost.approxTokens;
  const contextPoints = tokens <= 4_000 ? 5 : tokens <= 8_000 ? 3 : tokens <= 16_000 ? 1 : 0;
  if (contextPoints) why.push(reason("LOW_CONTEXT_COST", "Estimated context cost is bounded", contextPoints));

  const permissions = permissionLabels(capability.permissions);
  return {
    capability,
    score: Math.min(100, taskFit + 15 + trustPoints + evaluationPoints + permissionPoints + currentnessPoints + contextPoints),
    why,
    limitations: capability.trust.limitations,
    permissionDelta: {
      status: baselineExact ? "known" : "partial",
      added: baselineExact ? [] : permissions,
      unchanged: baselineExact ? permissions : [],
      ...(baselineExact ? {} : { unknownBecause: "Unmanaged skills and client sandbox policy are not a complete permission baseline" })
    },
    consent: "required"
  };
}

function permissionLabels(permissions: ManagedPermissions): string[] {
  const result: string[] = [];
  if (permissions.filesystem !== "none") result.push(`filesystem:${permissions.filesystem}`);
  if (permissions.network !== "false") result.push(`network:${permissions.network}`);
  if (permissions.shell) result.push("shell");
  if (permissions.browser) result.push("browser");
  if (permissions.credentials !== "false") result.push(`credentials:${permissions.credentials}`);
  if (permissions.userData) result.push("user-data");
  if (permissions.externalSend) result.push("external-send");
  if (permissions.moneyMovement) result.push("money-movement");
  return result;
}

function hasElevatedPermissions(permissions: ManagedPermissions): boolean {
  return permissions.shell || permissions.browser || permissions.userData || permissions.filesystem === "workspace-write" || permissions.credentials === "runtime_injected";
}

function compareCandidates(left: RecommendationCandidate, right: RecommendationCandidate): number {
  return right.score - left.score
    || left.capability.trust.riskScore - right.capability.trust.riskScore
    || left.capability.contextCost.approxTokens - right.capability.contextCost.approxTokens
    || left.capability.id.localeCompare(right.capability.id);
}

function reason(code: RecommendationCandidate["why"][number]["code"], text: string, points: number): RecommendationCandidate["why"][number] {
  return { code, text, points };
}

function overlapCount(tokens: string[], candidates: Set<string>): number {
  return tokens.filter((token) => candidates.has(token)).length;
}

function tokenSet(value: string): Set<string> {
  const normalized = value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}+#-]+/gu, " ");
  return new Set(normalized.split(/\s+/).filter((token) => token && !STOPWORDS.has(token)));
}

function normalizedPhrase(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortObjectKeys(item)]));
}

export function clientFromTarget(value: string): Client | undefined {
  return value === "claude-code" || value === "codex" ? value : undefined;
}
