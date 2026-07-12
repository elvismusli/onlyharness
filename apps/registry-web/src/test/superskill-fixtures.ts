import { selectedShowroomCapabilitySchema } from "@harnesshub/capability-schema/browser";

import type { ManagedCapability, SelectedShowroomCapability, ShowroomCapability } from "../core/superskill-types";

export function capabilityFixture(overrides: Partial<ManagedCapability> = {}): ManagedCapability {
  return {
    id: "market-research",
    type: "instruction_harness",
    title: "Market research",
    summary: "Builds a source-backed market map.",
    jobs: [{ id: "market-research", intents: ["market map"], outcomes: ["source-backed comparison"], exclusions: ["send outreach"] }],
    release: {
      ref: "harnesses/deep-market-researcher",
      version: "0.2.0",
      artifactDigest: `sha256:${"a".repeat(64)}`,
      immutable: true,
      publishedAt: "2026-07-10T00:00:00.000Z",
      delivery: "free_archive"
    },
    source: { owner: "OnlyHarness", url: "https://onlyharness.com", license: "MIT" },
    compatibility: [
      { client: "claude-code", status: "verified", verifiedAt: "2026-07-10T00:00:00.000Z" },
      { client: "codex", status: "verified", verifiedAt: "2026-07-10T00:00:00.000Z" }
    ],
    permissions: {
      network: "allowlist",
      networkAllowlist: ["example.com"],
      filesystem: "readonly",
      shell: false,
      browser: false,
      credentials: "false",
      externalSend: false,
      moneyMovement: false,
      userData: false,
      humanApprovalRequired: []
    },
    contextCost: { approxTokens: 2100, files: 4, bytes: 8000, status: "estimated" },
    trust: {
      status: "approved",
      riskScore: 12,
      riskTier: "LOW",
      checks: [{ id: "artifact_digest", status: "pass", evidenceLevel: "static_checked", checkedAt: "2026-07-10T00:00:00.000Z", summary: "Exact digest matched." }],
      limitations: ["Does not prove behavior against every untrusted input."],
      reviewedAt: "2026-07-10T00:00:00.000Z"
    },
    ...overrides
  };
}

export function selectedShowroomFixture(overrides: Partial<ManagedCapability> = {}): SelectedShowroomCapability {
  const capability = capabilityFixture({
    trust: {
      status: "candidate",
      riskScore: 0,
      riskTier: "MEDIUM",
      checks: [],
      limitations: ["Exact review is pending."],
      reviewedAt: "2026-07-10T00:00:00.000Z"
    },
    ...overrides
  });
  return selectedShowroomCapabilitySchema.parse({
    capability,
    status: "selected_unreviewed",
    managedHandoff: { status: "blocked", reason: "review_required" }
  });
}

export function showroomFixture(overrides: Partial<ManagedCapability> = {}): ShowroomCapability {
  const capability = capabilityFixture(overrides);
  return {
    capability,
    clientHandoff: capability.trust.status === "approved"
      ? { status: "available" }
      : { status: "blocked", reason: capability.trust.status === "revoked" ? "revoked" : "quarantined" }
  };
}
