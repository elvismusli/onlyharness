import assert from "node:assert/strict";
import test from "node:test";
import { evaluateManagedEligibility } from "../src/trust-policy.js";
import { approvedCapability } from "./superskill-fixture.js";

const now = new Date("2026-07-12T00:00:00.000Z");

test("approved exact release is eligible and consent remains explicit", () => {
  const result = evaluateManagedEligibility(approvedCapability(), "codex", now);
  assert.equal(result.eligible, true);
  assert.ok(result.consentReasons.includes("PERMISSION_BASELINE_INCOMPLETE"));
});

test("hard blocks cover money, unrestricted access, revoke and critical context", () => {
  const capability = approvedCapability({
    permissions: { moneyMovement: true, network: "unrestricted", filesystem: "unrestricted", credentials: "persistent" },
    contextCost: { approxTokens: 33_000 },
    trust: { status: "revoked", riskTier: "CRITICAL" }
  });
  const result = evaluateManagedEligibility(capability, "codex", now);
  assert.equal(result.eligible, false);
  assert.ok(result.blocks.includes("CAPABILITY_REVOKED"));
  assert.ok(result.blocks.includes("MONEY_MOVEMENT"));
  assert.ok(result.blocks.includes("NETWORK_UNRESTRICTED"));
  assert.ok(result.blocks.includes("FILESYSTEM_UNRESTRICTED"));
  assert.ok(result.blocks.includes("PERSISTENT_CREDENTIALS"));
  assert.ok(result.blocks.includes("CRITICAL_RISK"));
  assert.ok(result.blocks.includes("CONTEXT_TOO_LARGE"));
});

test("approval fails when the non-selected first client is stale", () => {
  const capability = approvedCapability({
    compatibility: [
      { client: "claude-code", status: "verified", verifiedAt: "2025-01-01T00:00:00.000Z" },
      { client: "codex", status: "verified", verifiedAt: "2026-07-01T00:00:00.000Z" }
    ]
  });
  const result = evaluateManagedEligibility(capability, "codex", now);
  assert.equal(result.eligible, false);
  assert.ok(result.blocks.includes("CLIENT_COMPATIBILITY_CLAUDE_CODE_NOT_VERIFIED"));
});

test("approval fails when either activation check is not passing", () => {
  const base = approvedCapability();
  const capability = approvedCapability({
    trust: { checks: base.trust.checks.map((item) => item.id === "claude_code_activation" ? { ...item, status: "fail" as const } : item) }
  });
  const result = evaluateManagedEligibility(capability, "codex", now);
  assert.equal(result.eligible, false);
  assert.ok(result.blocks.includes("CHECK_CLAUDE_CODE_ACTIVATION_FAILED"));
});
