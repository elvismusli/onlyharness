import assert from "node:assert/strict";
import test from "node:test";
import {
  activationExecutionStateSchema,
  clientSchema,
  managedStatusSchema,
  selectedShowroomCapabilitySchema,
  selectedShowroomListResponseSchema,
  superskillErrorCodeSchema
} from "../src/browser.js";

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
