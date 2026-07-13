import { z } from "zod";

export const capabilityIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
export const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const rfc3339Schema = z.string().datetime({ offset: true });
export const clientSchema = z.enum(["claude-code", "codex"]);
export const managedStatusSchema = z.enum(["candidate", "approved", "quarantined", "revoked"]);
export const evidenceLevelSchema = z.enum([
  "author_declared",
  "static_checked",
  "compatibility_smoked",
  "human_reviewed",
  "independently_evaluated"
]);
export const recommendationDecisionSchema = z.enum(["recommend", "needs_clarification", "no_safe_match"]);
export const activationModeSchema = z.enum(["temporary", "pinned"]);
export const activationExecutionStateSchema = z.enum([
  "accepted",
  "downloading",
  "digest_verified",
  "ready",
  "loaded",
  "invoked",
  "outcome_success",
  "outcome_failed",
  "outcome_unknown",
  "failed"
]);
export const activationPinStateSchema = z.enum(["none", "pinned", "removed"]);
export const outcomeEvidenceSchema = z.enum(["agent_reported", "user_confirmed", "unknown"]);

export const managedPermissionsSchema = z.object({
  network: z.enum(["false", "allowlist", "unrestricted"]),
  networkAllowlist: z.array(z.string().min(1)),
  filesystem: z.enum(["none", "readonly", "workspace-write", "unrestricted"]),
  shell: z.boolean(),
  browser: z.boolean(),
  credentials: z.enum(["false", "runtime_injected", "persistent"]),
  externalSend: z.boolean(),
  moneyMovement: z.boolean(),
  userData: z.boolean(),
  humanApprovalRequired: z.array(z.string().min(1))
}).strict();

export const trustCheckIdSchema = z.enum([
  "schema",
  "artifact_digest",
  "source_license",
  "static_security",
  "capability_diff",
  "claude_code_activation",
  "codex_activation",
  "human_review",
  "independent_eval"
]);

export const trustCheckSchema = z.object({
  id: trustCheckIdSchema,
  status: z.enum(["pass", "warn", "fail", "not_run"]),
  evidenceLevel: evidenceLevelSchema,
  checkedAt: rfc3339Schema,
  expiresAt: rfc3339Schema.optional(),
  summary: z.string().min(1)
}).strict();

const managedJobSchema = z.object({
  id: capabilityIdSchema,
  intents: z.array(z.string().min(1)),
  outcomes: z.array(z.string().min(1)),
  exclusions: z.array(z.string().min(1))
}).strict();

export const managedCapabilitySchema = z.object({
  id: capabilityIdSchema,
  type: z.literal("instruction_harness"),
  title: z.string().min(2),
  summary: z.string().min(12),
  jobs: z.array(managedJobSchema).min(1),
  release: z.object({
    ref: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,80}\/[a-z0-9][a-z0-9._-]{0,80}$/),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/),
    artifactDigest: digestSchema,
    immutable: z.literal(true),
    publishedAt: rfc3339Schema,
    delivery: z.literal("free_archive")
  }).strict(),
  source: z.object({
    owner: z.string().min(1).max(100),
    url: z.string().url(),
    revision: z.string().min(1).max(200).optional(),
    license: z.string().min(2).max(100)
  }).strict(),
  compatibility: z.array(z.object({
    client: clientSchema,
    status: z.enum(["verified", "available", "blocked"]),
    verifiedAt: rfc3339Schema.optional(),
    notes: z.string().min(1).optional()
  }).strict()),
  permissions: managedPermissionsSchema,
  contextCost: z.object({
    approxTokens: z.number().int().nonnegative(),
    files: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    status: z.literal("estimated")
  }).strict(),
  trust: z.object({
    status: managedStatusSchema,
    riskScore: z.number().int().min(0).max(100),
    riskTier: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    checks: z.array(trustCheckSchema),
    limitations: z.array(z.string().min(1)),
    reviewedAt: rfc3339Schema
  }).strict()
}).strict();

export const managedCapabilityIndexSchema = z.object({
  schemaVersion: z.literal("superskill.index.v1"),
  generatedAt: rfc3339Schema,
  capabilities: z.array(managedCapabilitySchema)
}).strict();

export const managedCapabilityHistorySchema = z.object({
  schemaVersion: z.literal("superskill.history.v1"),
  generatedAt: rfc3339Schema,
  capabilities: z.array(managedCapabilitySchema)
}).strict();

export const curatedResourceSchema = z.object({
  id: capabilityIdSchema,
  ref: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,80}\/[a-z0-9][a-z0-9._-]{0,80}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/),
  expectedDigest: digestSchema,
  status: managedStatusSchema,
  jobs: z.array(managedJobSchema).min(1),
  reviewFile: z.string().regex(/^reviews\/[a-zA-Z0-9._-]+\.json$/).optional()
}).strict();

export const curatedCatalogSchema = z.object({
  schemaVersion: z.literal("superskill.curated.v1"),
  generatedFor: z.literal("internal-alpha"),
  resources: z.array(curatedResourceSchema)
}).strict();

export const reviewWarningLimitationCodes = {
  scanner: "[SCANNER_WARN]",
  capabilityDiff: "[CAPABILITY_DIFF_WARN]",
  evalCommand: "[EVAL_COMMAND_WARN]"
} as const;

export function hasReviewWarningLimitation(limitations: string[], code: string): boolean {
  return limitations.some((limitation) => limitation.startsWith(`${code} `)
    && limitation.slice(code.length).trim().length >= 8);
}

const reviewCompatibilitySchema = z.array(z.object({
  client: clientSchema,
  clientVersion: z.string().min(1).max(40),
  os: z.enum(["darwin", "linux", "win32"]),
  verdict: z.enum(["pass", "fail"]),
  checkedAt: rfc3339Schema,
  fixtureId: z.string().min(1)
}).strict()).length(2).superRefine((rows, context) => {
  for (const client of clientSchema.options) {
    if (rows.filter((row) => row.client === client).length !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `compatibility must contain exactly one ${client} row`
      });
    }
  }
});

const reviewHumanCasesSchema = z.array(z.object({
  caseId: z.string().trim().min(1),
  verdict: z.enum(["pass", "partial", "fail"]),
  limitationCodes: z.array(z.string().min(1))
}).strict()).superRefine((rows, context) => {
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (seen.has(row.caseId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "human case IDs must be unique",
        path: [index, "caseId"]
      });
    }
    seen.add(row.caseId);
  });
});

export const reviewAttestationSchema = z.object({
  schemaVersion: z.literal("superskill.review.v1"),
  capability: z.object({
    id: capabilityIdSchema,
    ref: z.string().min(3),
    version: z.string().min(1),
    artifactDigest: digestSchema
  }).strict(),
  source: z.object({
    url: z.string().url(),
    revision: z.string().min(1).optional(),
    license: z.string().min(2)
  }).strict(),
  scanner: z.object({
    status: z.enum(["pass", "warn", "fail"]),
    rulesetVersion: z.string().min(1),
    checkedAt: rfc3339Schema,
    findings: z.array(z.object({ ruleId: z.string().min(1), severity: z.enum(["info", "warn", "fail"]) }).strict())
  }).strict(),
  capabilityDiff: z.object({
    status: z.enum(["pass", "warn", "fail"]),
    declared: managedPermissionsSchema,
    inferred: z.array(z.object({
      capability: z.string().min(1),
      status: z.enum(["detected", "not_detected"]),
      evidence: z.array(z.object({ file: z.string().min(1), rule: z.string().min(1) }).strict())
    }).strict()),
    differences: z.array(z.object({ field: z.string().min(1), declared: z.string(), inferred: z.string() }).strict())
  }).strict(),
  compatibility: reviewCompatibilitySchema,
  humanCases: reviewHumanCasesSchema,
  reviewer: z.object({
    label: z.string().min(2).max(100).regex(/^[^\r\n]+$/).refine(
      (label) => !/[^\s@]+@[^\s@]+\.[^\s@]+/.test(label.trim()),
      "reviewer label must be public-safe and must not be an email address"
    )
  }).strict(),
  limitations: z.array(z.string().min(1)),
  reviewedAt: rfc3339Schema,
  expiresAt: rfc3339Schema,
  replacement: z.object({ ref: z.string().min(3), version: z.string().min(1), artifactDigest: digestSchema }).strict().optional()
}).strict().superRefine((review, context) => {
  const missingCodes = [
    ...(review.scanner.status === "warn" ? [reviewWarningLimitationCodes.scanner] : []),
    ...(review.capabilityDiff.status === "warn" ? [reviewWarningLimitationCodes.capabilityDiff] : [])
  ].filter((code) => !hasReviewWarningLimitation(review.limitations, code));
  for (const code of missingCodes) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${code} requires an explicit public limitation`,
      path: ["limitations"]
    });
  }
});

export const revocationTombstoneSchema = z.object({
  schemaVersion: z.literal("superskill.revoke.v1"),
  eventId: z.string().regex(/^rev_[A-Za-z0-9_-]{8,}$/),
  artifactDigest: digestSchema,
  aliases: z.array(z.object({ capabilityId: capabilityIdSchema, ref: z.string().min(3), version: z.string().min(1) }).strict()).min(1),
  reasonCode: z.string().regex(/^[A-Z0-9_]{2,80}$/),
  actorLabel: z.string().min(2).max(100),
  revokedAt: rfc3339Schema,
  replacement: z.object({ ref: z.string().min(3), version: z.string().min(1), artifactDigest: digestSchema }).strict().optional()
}).strict();

export const showroomPreviewSchema = z.object({
  schemaVersion: z.literal("superskill.showroom-preview.v1"),
  capabilityId: capabilityIdSchema,
  artifactDigest: digestSchema,
  reviewCaseId: z.string().min(1).max(100),
  taskLabel: z.string().min(1).max(160),
  lines: z.array(z.string().min(1).max(500)).min(1).max(6),
  outcomeLabel: z.string().min(1).max(200),
  reviewedAt: rfc3339Schema
}).strict();

export const showroomCapabilitySchema = z.object({
  capability: managedCapabilitySchema,
  clientHandoff: z.object({
    status: z.enum(["available", "blocked"]),
    reason: z.enum(["revoked", "quarantined", "stale_or_ineligible_evidence"]).optional()
  }).strict(),
  preview: showroomPreviewSchema.optional()
}).strict();

export const showroomListResponseSchema = z.object({
  items: z.array(showroomCapabilitySchema),
  total: z.number().int().nonnegative(),
  generatedAt: rfc3339Schema
}).strict();

const selectedShowroomCandidateSchema = managedCapabilitySchema.pick({
  id: true,
  type: true,
  title: true,
  summary: true,
  jobs: true,
  release: true,
  source: true,
  compatibility: true,
  permissions: true,
  contextCost: true,
  trust: true
}).extend({
  trust: managedCapabilitySchema.shape.trust.extend({
    status: z.literal("candidate")
  }).strict()
}).strict();

export const selectedShowroomCapabilitySchema = z.object({
  capability: selectedShowroomCandidateSchema,
  status: z.literal("selected_unreviewed"),
  managedHandoff: z.object({
    status: z.literal("blocked"),
    reason: z.literal("review_required")
  }).strict()
}).strict();

export const selectedShowroomListResponseSchema = z.object({
  items: z.array(selectedShowroomCapabilitySchema),
  total: z.number().int().nonnegative(),
  generatedAt: rfc3339Schema
}).strict();

const installedManagedRefSchema = z.object({
  ref: z.string().min(3),
  version: z.string().min(1),
  artifactDigest: digestSchema
}).strict();

export const recommendationRequestSchema = z.object({
  task: z.string().min(3).max(500),
  context: z.object({
    client: clientSchema,
    clientVersion: z.string().regex(/^[A-Za-z0-9._+ -]{1,40}$/).optional(),
    os: z.enum(["darwin", "linux", "win32", "unknown"]),
    arch: z.enum(["arm64", "x64", "unknown"]),
    installedManagedRefs: z.array(installedManagedRefSchema).max(20),
    inventorySummary: z.object({
      managedSkills: z.number().int().nonnegative(),
      unmanagedSkills: z.number().int().nonnegative(),
      approxTokens: z.number().int().nonnegative(),
      conflicts: z.number().int().nonnegative(),
      permissionsKnown: z.boolean()
    }).strict().optional()
  }).strict()
}).strict();

export const recommendationCandidateSchema = z.object({
  capability: managedCapabilitySchema,
  score: z.number().int().min(0).max(100),
  why: z.array(z.object({
    code: z.enum([
      "INTENT_EXACT", "INTENT_OVERLAP", "OUTCOME_MATCH", "CLIENT_VERIFIED", "TRUST_CHECKS_PASS",
      "HUMAN_CASES", "INDEPENDENT_EVAL", "LOW_PERMISSION_DELTA", "CURRENT_REVIEW", "LOW_CONTEXT_COST"
    ]),
    text: z.string().min(1),
    points: z.number().int().nonnegative()
  }).strict()),
  limitations: z.array(z.string().min(1)),
  permissionDelta: z.object({
    status: z.enum(["known", "partial", "unknown"]),
    added: z.array(z.string()),
    unchanged: z.array(z.string()),
    unknownBecause: z.string().min(1).optional()
  }).strict(),
  consent: z.literal("required")
}).strict();

export const recommendationResponseSchema = z.object({
  recommendationId: z.string().regex(/^rec_[A-Za-z0-9_-]+$/),
  decisionDigest: digestSchema,
  decision: recommendationDecisionSchema,
  confidence: z.number().min(0).max(1),
  selected: recommendationCandidateSchema.optional(),
  alternatives: z.array(recommendationCandidateSchema).max(2),
  clarification: z.object({
    code: z.enum(["CLIENT_CONSTRAINT", "TASK_SCOPE", "AMBIGUOUS_OUTCOME"]),
    question: z.string().min(1)
  }).strict().optional(),
  expiresAt: rfc3339Schema
}).strict();

export const exactCapabilityReleaseSchema = z.object({
  capability: managedCapabilitySchema,
  activationAllowed: z.boolean(),
  archive: z.object({ url: z.string().min(1), artifactDigest: digestSchema }).strict().optional(),
  blockCode: z.enum(["CAPABILITY_QUARANTINED", "CAPABILITY_REVOKED", "PERMISSION_BLOCKED"]).optional(),
  replacement: z.object({ ref: z.string(), version: z.string(), artifactDigest: digestSchema }).strict().optional()
}).strict();

export const activationRecordSchema = z.object({
  schemaVersion: z.literal("superskill.activation.v1"),
  activationId: z.string().min(1),
  activationRequestId: z.string().min(1),
  projectRoot: z.string().min(1),
  recommendationId: z.string().optional(),
  mode: activationModeSchema,
  sourceMarkerPath: z.string().optional(),
  capability: z.object({ id: capabilityIdSchema, ref: z.string(), version: z.string(), artifactDigest: digestSchema }).strict(),
  client: clientSchema,
  executionState: activationExecutionStateSchema,
  pinState: activationPinStateSchema,
  pinned: z.object({ markerPath: z.string(), markerDigest: digestSchema, packageDigest: digestSchema }).strict().optional(),
  outcome: z.object({ value: z.enum(["success", "failed", "unknown"]), evidence: outcomeEvidenceSchema }).strict().optional(),
  createdAt: rfc3339Schema,
  updatedAt: rfc3339Schema
}).strict();

export const superskillErrorCodeSchema = z.enum([
  "SUPERSKILL_DISABLED", "SUPERSKILL_AUTH_REQUIRED", "INTERNAL_ALPHA_DENIED", "CATALOG_NOT_READY",
  "TASK_INVALID", "CAPABILITY_NOT_FOUND", "CAPABILITY_QUARANTINED", "CAPABILITY_REVOKED",
  "ARTIFACT_NOT_IMMUTABLE", "ARTIFACT_DIGEST_MISMATCH", "ACTIVATION_INVALID_TRANSITION",
  "ACTIVATION_NOT_FOUND", "CLIENT_UNSUPPORTED", "CLIENT_NOT_DETECTED", "TARGET_COLLISION",
  "MANAGED_FILE_CHANGED", "PERMISSION_BLOCKED", "CONSENT_REQUIRED", "CONSENT_STALE",
  "LOCAL_CLI_UNAVAILABLE", "PAYMENT_NOT_SUPPORTED_IN_SUPERSKILL"
]);

export type Client = z.infer<typeof clientSchema>;
export type ManagedStatus = z.infer<typeof managedStatusSchema>;
export type EvidenceLevel = z.infer<typeof evidenceLevelSchema>;
export type ManagedPermissions = z.infer<typeof managedPermissionsSchema>;
export type TrustCheck = z.infer<typeof trustCheckSchema>;
export type ManagedCapability = z.infer<typeof managedCapabilitySchema>;
export type ManagedCapabilityIndex = z.infer<typeof managedCapabilityIndexSchema>;
export type ManagedCapabilityHistory = z.infer<typeof managedCapabilityHistorySchema>;
export type CuratedCatalog = z.infer<typeof curatedCatalogSchema>;
export type CuratedResource = z.infer<typeof curatedResourceSchema>;
export type ReviewAttestation = z.infer<typeof reviewAttestationSchema>;
export type RevocationTombstone = z.infer<typeof revocationTombstoneSchema>;
export type ShowroomPreview = z.infer<typeof showroomPreviewSchema>;
export type ShowroomCapability = z.infer<typeof showroomCapabilitySchema>;
export type ShowroomListResponse = z.infer<typeof showroomListResponseSchema>;
export type SelectedShowroomCapability = z.infer<typeof selectedShowroomCapabilitySchema>;
export type SelectedShowroomListResponse = z.infer<typeof selectedShowroomListResponseSchema>;
export type RecommendationRequest = z.infer<typeof recommendationRequestSchema>;
export type RecommendationCandidate = z.infer<typeof recommendationCandidateSchema>;
export type RecommendationResponse = z.infer<typeof recommendationResponseSchema>;
export type ExactCapabilityRelease = z.infer<typeof exactCapabilityReleaseSchema>;
export type ActivationRecord = z.infer<typeof activationRecordSchema>;
export type SuperskillErrorCode = z.infer<typeof superskillErrorCodeSchema>;
