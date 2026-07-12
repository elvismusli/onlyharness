import type { Client, ManagedCapability, TrustCheck } from "@harnesshub/capability-schema/browser";

export type EligibilityDecision = {
  eligible: boolean;
  blocks: string[];
  consentReasons: string[];
  reviewedWarnings: boolean;
};

const mandatoryChecks = ["schema", "artifact_digest", "source_license", "static_security", "capability_diff", "human_review"] as const;

export function evaluateManagedEligibility(capability: ManagedCapability, client: Client, now = new Date()): EligibilityDecision {
  const blocks: string[] = [];
  const consentReasons: string[] = [];
  const permissions = capability.permissions;

  if (capability.trust.status !== "approved") blocks.push(statusBlock(capability.trust.status));
  if (!capability.release.immutable) blocks.push("ARTIFACT_NOT_IMMUTABLE");
  if (capability.release.delivery !== "free_archive") blocks.push("PAYMENT_NOT_SUPPORTED_IN_SUPERSKILL");
  if (!capability.source.url || !capability.source.license || capability.source.license.toUpperCase() === "UNSPECIFIED") blocks.push("SOURCE_LICENSE_BLOCKED");
  if (permissions.filesystem === "unrestricted") blocks.push("FILESYSTEM_UNRESTRICTED");
  if (permissions.network === "unrestricted") blocks.push("NETWORK_UNRESTRICTED");
  if (permissions.credentials === "persistent") blocks.push("PERSISTENT_CREDENTIALS");
  if (permissions.externalSend) blocks.push("EXTERNAL_SEND");
  if (permissions.moneyMovement) blocks.push("MONEY_MOVEMENT");
  if (capability.trust.riskTier === "CRITICAL") blocks.push("CRITICAL_RISK");
  if (capability.contextCost.approxTokens > 32_000) blocks.push("CONTEXT_TOO_LARGE");

  for (const requiredClient of ["claude-code", "codex"] as const) {
    const compatibility = capability.compatibility.find((item) => item.client === requiredClient);
    if (!compatibility || compatibility.status !== "verified" || !compatibility.verifiedAt || isOlderThan(compatibility.verifiedAt, now, 90)) {
      blocks.push(`CLIENT_COMPATIBILITY_${requiredClient.toUpperCase().replace("-", "_")}_NOT_VERIFIED`);
    }
  }

  const checks = new Map(capability.trust.checks.map((check) => [check.id, check]));
  for (const id of mandatoryChecks) requireFreshPassingCheck(checks.get(id), id, now, blocks);
  requireFreshPassingCheck(checks.get("claude_code_activation"), "claude_code_activation", now, blocks);
  requireFreshPassingCheck(checks.get("codex_activation"), "codex_activation", now, blocks);

  if (permissions.shell) consentReasons.push("SHELL_ACCESS");
  if (permissions.browser) consentReasons.push("BROWSER_ACCESS");
  if (permissions.userData) consentReasons.push("USER_DATA");
  if (permissions.filesystem === "workspace-write") consentReasons.push("WORKSPACE_WRITE");
  if (permissions.credentials === "runtime_injected") consentReasons.push("RUNTIME_CREDENTIALS");
  if (permissions.network === "allowlist" && permissions.networkAllowlist.length) consentReasons.push("NETWORK_ALLOWLIST");
  if (capability.trust.checks.some((check) => check.status === "warn")) consentReasons.push("REVIEWED_WARNING");
  consentReasons.push("PERMISSION_BASELINE_INCOMPLETE");

  return {
    eligible: blocks.length === 0,
    blocks: [...new Set(blocks)],
    consentReasons: [...new Set(consentReasons)],
    reviewedWarnings: capability.trust.checks.some((check) => check.status === "warn")
  };
}

function requireFreshPassingCheck(check: TrustCheck | undefined, label: string, now: Date, blocks: string[]): void {
  if (!check || (check.status !== "pass" && check.status !== "warn")) {
    blocks.push(`CHECK_${label.toUpperCase()}_FAILED`);
    return;
  }
  if (check.expiresAt && Date.parse(check.expiresAt) <= now.getTime()) blocks.push(`CHECK_${label.toUpperCase()}_EXPIRED`);
}

function isOlderThan(value: string, now: Date, days: number): boolean {
  const timestamp = Date.parse(value);
  return !Number.isFinite(timestamp) || now.getTime() - timestamp > days * 86_400_000;
}

function statusBlock(status: ManagedCapability["trust"]["status"]): string {
  if (status === "revoked") return "CAPABILITY_REVOKED";
  if (status === "quarantined") return "CAPABILITY_QUARANTINED";
  return "CAPABILITY_NOT_APPROVED";
}
