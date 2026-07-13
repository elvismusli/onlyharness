import assert from "node:assert/strict";
import test from "node:test";
import {
  activationExecutionStateSchema,
  clientSchema,
  managedStatusSchema,
  reviewAttestationSchema,
  reviewWarningLimitationCodes,
  selectedShowroomCapabilitySchema,
  selectedShowroomListResponseSchema,
  superskillErrorCodeSchema
} from "../src/browser.js";

function validReviewAttestation() {
  return {
    schemaVersion: "superskill.review.v1",
    capability: {
      id: "selected-skill",
      ref: "harnesses/selected-skill",
      version: "0.2.0",
      artifactDigest: `sha256:${"a".repeat(64)}`
    },
    source: { url: "https://example.com/selected-skill", license: "MIT" },
    scanner: {
      status: "pass",
      rulesetVersion: "superskill-static-v1",
      checkedAt: "2026-07-12T00:00:00.000Z",
      findings: []
    },
    capabilityDiff: {
      status: "pass",
      declared: {
        network: "false",
        networkAllowlist: [],
        filesystem: "readonly",
        shell: false,
        browser: false,
        credentials: "false",
        externalSend: false,
        moneyMovement: false,
        userData: false,
        humanApprovalRequired: []
      },
      inferred: [],
      differences: []
    },
    compatibility: [
      { client: "claude-code", clientVersion: "2.1.112", os: "darwin", verdict: "pass", checkedAt: "2026-07-12T00:00:00.000Z", fixtureId: "claude-clean" },
      { client: "codex", clientVersion: "0.135.0", os: "darwin", verdict: "pass", checkedAt: "2026-07-12T00:00:00.000Z", fixtureId: "codex-clean" }
    ],
    humanCases: [
      { caseId: "case-1", verdict: "pass", limitationCodes: [] },
      { caseId: "case-2", verdict: "pass", limitationCodes: [] },
      { caseId: "case-3", verdict: "partial", limitationCodes: ["SCOPE"] }
    ],
    reviewer: { label: "Internal alpha reviewer 1" },
    limitations: ["Scope is limited to the reviewed market-research workflow"],
    reviewedAt: "2026-07-12T00:01:00.000Z",
    expiresAt: "2026-12-01T00:01:00.000Z"
  };
}

test("managed enums are exhaustive and reject unknown optimistic states", () => {
  assert.deepEqual(clientSchema.options, ["claude-code", "codex"]);
  assert.deepEqual(managedStatusSchema.options, ["candidate", "approved", "quarantined", "revoked"]);
  assert.equal(activationExecutionStateSchema.safeParse("installed").success, false);
  assert.equal(superskillErrorCodeSchema.safeParse("SAFE").success, false);
});

test("selected showroom contract is candidate-only and blocks managed handoff", () => {
  const candidate = {
    id: "selected-skill",
    type: "instruction_harness",
    title: "Selected Skill",
    summary: "A selected exact skill awaiting managed review.",
    jobs: [{ id: "research", intents: ["research"], outcomes: ["report"], exclusions: ["publish"] }],
    release: {
      ref: "harnesses/selected-skill",
      version: "0.2.0",
      artifactDigest: `sha256:${"a".repeat(64)}`,
      immutable: true,
      publishedAt: "2026-07-12T00:00:00.000Z",
      delivery: "free_archive"
    },
    source: { owner: "OnlyHarness", url: "https://example.com/selected-skill", license: "MIT" },
    compatibility: [
      { client: "claude-code", status: "available", notes: "Review required" },
      { client: "codex", status: "available", notes: "Review required" }
    ],
    permissions: {
      network: "false",
      networkAllowlist: [],
      filesystem: "readonly",
      shell: false,
      browser: false,
      credentials: "false",
      externalSend: false,
      moneyMovement: false,
      userData: false,
      humanApprovalRequired: []
    },
    contextCost: { approxTokens: 200, files: 2, bytes: 800, status: "estimated" },
    trust: {
      status: "candidate",
      riskScore: 15,
      riskTier: "LOW",
      checks: [],
      limitations: ["Managed review has not completed"],
      reviewedAt: "2026-07-12T00:00:00.000Z"
    }
  };
  const item = {
    capability: candidate,
    status: "selected_unreviewed",
    managedHandoff: { status: "blocked", reason: "review_required" }
  };
  assert.equal(selectedShowroomCapabilitySchema.safeParse(item).success, true);
  assert.equal(selectedShowroomListResponseSchema.safeParse({
    items: [item],
    total: 1,
    generatedAt: "2026-07-12T00:00:00.000Z"
  }).success, true);
  assert.equal(selectedShowroomCapabilitySchema.safeParse({
    ...item,
    capability: { ...candidate, trust: { ...candidate.trust, status: "approved" } }
  }).success, false);
  assert.equal(selectedShowroomCapabilitySchema.safeParse({
    ...item,
    managedHandoff: { status: "available", reason: "review_required" }
  }).success, false);
});

test("review attestation requires exact client coverage, unique cases, and a public-safe reviewer", () => {
  const review = validReviewAttestation();
  assert.equal(reviewAttestationSchema.safeParse(review).success, true);
  assert.equal(reviewAttestationSchema.safeParse({
    ...review,
    compatibility: [review.compatibility[0], { ...review.compatibility[0], fixtureId: "duplicate" }]
  }).success, false);
  assert.equal(reviewAttestationSchema.safeParse({
    ...review,
    compatibility: [review.compatibility[0]]
  }).success, false);
  assert.equal(reviewAttestationSchema.safeParse({
    ...review,
    humanCases: [review.humanCases[0], { ...review.humanCases[0] }, review.humanCases[2]]
  }).success, false);
  assert.equal(reviewAttestationSchema.safeParse({
    ...review,
    reviewer: { label: "Reviewer reviewer@example.com" }
  }).success, false);
});

test("warning review evidence requires deterministic public limitation codes", () => {
  assert.equal(reviewWarningLimitationCodes.evalCommand, "[EVAL_COMMAND_WARN]");
  const review = validReviewAttestation();
  assert.equal(reviewAttestationSchema.safeParse({
    ...review,
    scanner: { ...review.scanner, status: "warn" }
  }).success, false);
  assert.equal(reviewAttestationSchema.safeParse({
    ...review,
    scanner: { ...review.scanner, status: "warn" },
    limitations: ["[SCANNER_WARN] One informational static rule remains for human review"]
  }).success, true);
  assert.equal(reviewAttestationSchema.safeParse({
    ...review,
    scanner: { ...review.scanner, status: "warn" },
    limitations: ["[SCANNER_WARN]        "]
  }).success, false);
  assert.equal(reviewAttestationSchema.safeParse({
    ...review,
    capabilityDiff: { ...review.capabilityDiff, status: "warn" }
  }).success, false);
  assert.equal(reviewAttestationSchema.safeParse({
    ...review,
    capabilityDiff: { ...review.capabilityDiff, status: "warn" },
    limitations: ["[CAPABILITY_DIFF_WARN] One declared capability requires human confirmation"]
  }).success, true);
});
