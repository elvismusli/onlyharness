import type { ManagedCapability, ManagedCapabilityIndex } from "@harnesshub/capability-schema/browser";

type CapabilityOverrides = Omit<Partial<ManagedCapability>, "release" | "source" | "permissions" | "contextCost" | "trust"> & {
  release?: Partial<ManagedCapability["release"]>;
  source?: Partial<ManagedCapability["source"]>;
  permissions?: Partial<ManagedCapability["permissions"]>;
  contextCost?: Partial<ManagedCapability["contextCost"]>;
  trust?: Partial<ManagedCapability["trust"]>;
};

export function approvedCapability(overrides: CapabilityOverrides = {}): ManagedCapability {
  const checkedAt = "2026-07-01T00:00:00.000Z";
  const expiresAt = "2026-12-01T00:00:00.000Z";
  const base: ManagedCapability = {
    id: "market-research",
    type: "instruction_harness",
    title: "Deep Market Researcher",
    summary: "Builds a source-backed market map and competitor comparison.",
    jobs: [{
      id: "market-research",
      intents: ["competitor research", "market map"],
      outcomes: ["source-backed comparison"],
      exclusions: ["send outreach", "buy data"]
    }],
    release: {
      ref: "harnesses/deep-market-researcher",
      version: "0.2.0",
      artifactDigest: `sha256:${"a".repeat(64)}`,
      immutable: true,
      publishedAt: "2026-06-30T00:00:00.000Z",
      delivery: "free_archive"
    },
    source: { owner: "OnlyHarness", url: "https://example.com/market-research", license: "MIT" },
    compatibility: [
      { client: "claude-code", status: "verified", verifiedAt: checkedAt },
      { client: "codex", status: "verified", verifiedAt: checkedAt }
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
    contextCost: { approxTokens: 3200, files: 5, bytes: 12800, status: "estimated" },
    trust: {
      status: "approved",
      riskScore: 8,
      riskTier: "LOW",
      reviewedAt: checkedAt,
      limitations: ["Sources still require user judgment"],
      checks: [
        { id: "schema", status: "pass", evidenceLevel: "static_checked", checkedAt, expiresAt, summary: "Schema passed" },
        { id: "artifact_digest", status: "pass", evidenceLevel: "static_checked", checkedAt, expiresAt, summary: "Digest passed" },
        { id: "source_license", status: "pass", evidenceLevel: "static_checked", checkedAt, expiresAt, summary: "License passed" },
        { id: "static_security", status: "pass", evidenceLevel: "static_checked", checkedAt, expiresAt, summary: "Static scan passed" },
        { id: "capability_diff", status: "pass", evidenceLevel: "static_checked", checkedAt, expiresAt, summary: "Capability diff passed" },
        { id: "claude_code_activation", status: "pass", evidenceLevel: "compatibility_smoked", checkedAt, expiresAt, summary: "Claude smoke passed" },
        { id: "codex_activation", status: "pass", evidenceLevel: "compatibility_smoked", checkedAt, expiresAt, summary: "Codex smoke passed" },
        { id: "human_review", status: "pass", evidenceLevel: "human_reviewed", checkedAt, expiresAt, summary: "Three human cases passed" },
        { id: "independent_eval", status: "not_run", evidenceLevel: "independently_evaluated", checkedAt, summary: "Not run" }
      ]
    }
  };
  return {
    ...base,
    ...overrides,
    release: { ...base.release, ...overrides.release },
    source: { ...base.source, ...overrides.source },
    permissions: { ...base.permissions, ...overrides.permissions },
    contextCost: { ...base.contextCost, ...overrides.contextCost },
    trust: { ...base.trust, ...overrides.trust }
  };
}

export function managedIndex(capabilities: ManagedCapability[]): ManagedCapabilityIndex {
  return { schemaVersion: "superskill.index.v1", generatedAt: "2026-07-01T00:00:00.000Z", capabilities };
}
