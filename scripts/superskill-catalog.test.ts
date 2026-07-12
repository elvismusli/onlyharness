import assert from "node:assert/strict";
import test from "node:test";
import type { CuratedResource, ReviewAttestation } from "@harnesshub/capability-schema/browser";
import { recomputeCapabilityDiff, scanHarnessFiles } from "../apps/harness-api/src/security-scan.js";
import { buildSuperskillIndex, verifyAttestationAgainstSnapshot } from "./build-superskill-catalog.js";

test("managed catalog builds deterministic candidate-only exact releases", () => {
  const first = buildSuperskillIndex(new Date("2026-07-12T00:00:00.000Z"));
  const second = buildSuperskillIndex(new Date("2026-07-12T00:00:00.000Z"));
  assert.deepEqual(first, second);
  assert.equal(first.capabilities.length, 12);
  assert.ok(first.capabilities.every((item) => item.trust.status === "candidate"));
  assert.ok(first.capabilities.every((item) => item.release.immutable && item.release.delivery === "free_archive"));
  assert.ok(first.capabilities.every((item) => item.compatibility.every((target) => target.status === "available")));
});

test("catalog review binding rejects scanner or inferred capability drift", () => {
  const resource = { id: "fixture" } as CuratedResource;
  const declared = {
    network: "false" as const,
    networkAllowlist: [],
    filesystem: "readonly" as const,
    shell: false,
    browser: false,
    credentials: "false" as const,
    externalSend: false,
    moneyMovement: false,
    userData: false,
    humanApprovalRequired: []
  };
  const files = [{ path: "agents/operator.md", content: "Write the file." }];
  const scan = scanHarnessFiles(files, { scannedAt: "2026-07-12T00:00:00.000Z" });
  const diff = recomputeCapabilityDiff(files, declared);
  const review = {
    source: { url: "https://example.test/source", license: "MIT" },
    scanner: {
      status: scan.verdict,
      rulesetVersion: scan.scanner,
      findings: scan.findings.map((item) => ({ ruleId: item.rule, severity: item.severity }))
    },
    capabilityDiff: diff
  } as ReviewAttestation;
  assert.doesNotThrow(() => verifyAttestationAgainstSnapshot(resource, review, scan, diff, review.source));
  assert.throws(() => verifyAttestationAgainstSnapshot(resource, { ...review, scanner: { ...review.scanner, findings: [] } }, scan, diff, review.source), /findings drift/);
  const changed = { ...diff, status: "pass" as const };
  assert.throws(() => verifyAttestationAgainstSnapshot(resource, review, scan, changed, review.source), /capability diff drift/);
  assert.throws(() => verifyAttestationAgainstSnapshot(resource, { ...review, source: { ...review.source, license: "Apache-2.0" } }, scan, diff, review.source), /source provenance drift/);
});
