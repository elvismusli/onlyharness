import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { CuratedResource, ReviewAttestation } from "@harnesshub/capability-schema/browser";
import { parseManifestText } from "@harnesshub/schema";
import { recomputeCapabilityDiff, scanHarnessFiles } from "../apps/harness-api/src/security-scan.js";
import { assertManagedInstructionOnly, buildSuperskillIndex, validateApprovalEvidence, verifyAttestationAgainstSnapshot } from "./build-superskill-catalog.js";

const approvedResource = { id: "fixture", status: "approved" } as CuratedResource;
const instructionManifest = (promptfooConfig = "evals/promptfooconfig.yaml", command = "npx promptfoo eval") => ({
  evals: { promptfoo_config: promptfooConfig, command }
});

function approvalReview(): ReviewAttestation {
  return {
    schemaVersion: "superskill.review.v1",
    capability: {
      id: "fixture",
      ref: "harnesses/fixture",
      version: "1.0.0",
      artifactDigest: `sha256:${"a".repeat(64)}`
    },
    source: { url: "https://example.test/fixture", license: "MIT" },
    scanner: {
      status: "pass",
      rulesetVersion: "superskill-static-v1",
      checkedAt: "2026-07-12T09:00:00.000Z",
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
      { client: "claude-code", clientVersion: "2.1.112", os: "darwin", verdict: "pass", checkedAt: "2026-07-12T09:00:00.000Z", fixtureId: "claude-clean" },
      { client: "codex", clientVersion: "0.135.0", os: "darwin", verdict: "pass", checkedAt: "2026-07-12T09:00:00.000Z", fixtureId: "codex-clean" }
    ],
    humanCases: [
      { caseId: "case-1", verdict: "pass", limitationCodes: [] },
      { caseId: "case-2", verdict: "pass", limitationCodes: [] },
      { caseId: "case-3", verdict: "partial", limitationCodes: ["SCOPE"] }
    ],
    reviewer: { label: "Internal alpha reviewer 1" },
    limitations: ["Scope is limited to the reviewed market-research workflow"],
    reviewedAt: "2026-07-12T10:00:00.000Z",
    expiresAt: "2026-12-01T10:00:00.000Z"
  };
}

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

test("approved instruction-only artifact accepts only inert local echo eval metadata", () => {
  const resource = { id: "fixture" };
  const files = [
    { path: "harness.yaml", content: "schemaVersion: harness.v0.2\n" },
    { path: "agents/operator.md", content: "Review the supplied input.\n" },
    {
      path: "evals/promptfooconfig.yaml",
      content: "description: Local review metadata\nprompts:\n  - agents/operator.md\nproviders:\n  - echo\n"
    }
  ];
  assert.doesNotThrow(() => assertManagedInstructionOnly(files, resource, instructionManifest()));
  for (const forbiddenKey of ["command", "functions", "plugins", "exec"]) {
    assert.throws(
      () => assertManagedInstructionOnly(files.map((file) => file.path === "evals/promptfooconfig.yaml"
        ? { ...file, content: `${file.content}${forbiddenKey}: unsafe\n` }
        : file), resource, instructionManifest()),
      new RegExp(`unsafe declarative eval config.*unsupported keys: ${forbiddenKey}`)
    );
  }
  for (const url of [
    "https://example.test/review",
    "ssh://example.test/review",
    "ftp://example.test/review",
    "file:/tmp/review",
    "mailto:reviewer@example.test",
    "data:text/plain,unsafe",
    "javascript:alert(1)",
    "tel:+123456789",
    "//example.test/review"
  ]) {
    assert.throws(
      () => assertManagedInstructionOnly(files.map((file) => file.path === "evals/promptfooconfig.yaml"
        ? { ...file, content: file.content.replace("Local review metadata", url) }
        : file), resource, instructionManifest()),
      /URLs are not allowed/
    );
  }
  assert.throws(
    () => assertManagedInstructionOnly(files.map((file) => file.path === "evals/promptfooconfig.yaml"
      ? { ...file, content: "prompts:\n  - https://example.test/prompt.md\nproviders:\n  - echo\n" }
      : file), resource, instructionManifest()),
    /prompt must reference an existing local markdown file/
  );
  assert.throws(
    () => assertManagedInstructionOnly(files.map((file) => file.path === "evals/promptfooconfig.yaml"
      ? { ...file, content: "prompts:\n  - agents/operator.md\nproviders:\n  - openai:gpt-5\n" }
      : file), resource, instructionManifest()),
    /provider must be exactly echo/
  );
});

test("approved instruction-only artifact rejects malformed or missing eval prompt references", () => {
  const resource = { id: "fixture" };
  const base = [{ path: "agents/operator.md", content: "Review the supplied input.\n" }];
  assert.throws(
    () => assertManagedInstructionOnly([...base, { path: "evals/promptfooconfig.yaml", content: "prompts: [\n" }], resource, instructionManifest()),
    /unsafe declarative eval config.*invalid YAML/
  );
  assert.throws(
    () => assertManagedInstructionOnly([...base, {
      path: "evals/promptfooconfig.yaml",
      content: "prompts:\n  - agents/missing.md\nproviders:\n  - echo\n"
    }], resource, instructionManifest()),
    /prompt must reference an existing local markdown file/
  );
  assert.throws(
    () => assertManagedInstructionOnly([...base, { path: "scripts/run.sh", content: "echo unsafe\n" }], resource, instructionManifest()),
    /not instruction-only.*scripts\/run\.sh/
  );
});

test("approved instruction-only artifact rejects case aliases and manifest config rebinding", () => {
  const resource = { id: "fixture" };
  const content = "prompts:\n  - agents/operator.md\nproviders:\n  - echo\n";
  const operator = { path: "agents/operator.md", content: "Review input.\n" };
  assert.throws(
    () => assertManagedInstructionOnly([
      operator,
      { path: "EVALS/PromptfooConfig.yaml", content }
    ], resource, instructionManifest("EVALS/PromptfooConfig.yaml")),
    /not instruction-only.*EVALS\/PromptfooConfig\.yaml/
  );
  assert.throws(
    () => assertManagedInstructionOnly([
      operator,
      { path: "evals/cases/evil.yaml", content }
    ], resource, instructionManifest("evals/cases/evil.yaml")),
    /must bind its eval config to evals\/promptfooconfig\.yaml.*evals\/cases\/evil\.yaml/
  );
  assert.throws(
    () => assertManagedInstructionOnly([operator], resource, instructionManifest()),
    /must contain exactly one evals\/promptfooconfig\.yaml/
  );
});

test("deep-market-researcher 0.2.1 satisfies the exact instruction-only contract unchanged", () => {
  const snapshot = JSON.parse(readFileSync(path.join(
    import.meta.dirname,
    "../data/harness-versions/harnesses/deep-market-researcher/0.2.1.json"
  ), "utf8")) as {
    artifactDigest: string;
    files: Array<{ path: string; content: string; truncated?: boolean }>;
  };
  const manifestFile = snapshot.files.find((file) => file.path === "harness.yaml");
  assert.ok(manifestFile);
  const manifest = parseManifestText(manifestFile.content);
  assert.equal(snapshot.artifactDigest, "sha256:9ebad5b23017dc95b758a77361080f026832538903735cdcb7d9a669f204927e");
  assert.doesNotThrow(() => assertManagedInstructionOnly(snapshot.files, { id: "deep-market-researcher" }, manifest));
});

test("approval evidence rejects duplicate clients and duplicate human case IDs", () => {
  const now = new Date("2026-07-13T00:00:00.000Z");
  const review = approvalReview();
  assert.doesNotThrow(() => validateApprovalEvidence(approvedResource, review, now));
  assert.throws(() => validateApprovalEvidence(approvedResource, {
    ...review,
    compatibility: [review.compatibility[0], { ...review.compatibility[0], fixtureId: "duplicate" }]
  }, now), /exactly one claude-code compatibility row|exactly one codex compatibility row/);
  assert.throws(() => validateApprovalEvidence(approvedResource, {
    ...review,
    compatibility: [review.compatibility[0]]
  }, now), /exactly one codex compatibility row/);
  assert.throws(() => validateApprovalEvidence(approvedResource, {
    ...review,
    humanCases: [review.humanCases[0], { ...review.humanCases[0], caseId: " case-1 " }, review.humanCases[2]]
  }, now), /unique human case IDs/);
});

test("approval evidence rejects future timestamps, stale reviews, and excessive expiry", () => {
  const now = new Date("2026-07-13T00:00:00.000Z");
  const review = approvalReview();
  assert.throws(() => validateApprovalEvidence(approvedResource, {
    ...review,
    reviewedAt: "2026-07-13T01:00:00.000Z"
  }, now), /review date is in the future/);
  assert.throws(() => validateApprovalEvidence(approvedResource, {
    ...review,
    scanner: { ...review.scanner, checkedAt: "2026-07-13T01:00:00.000Z" }
  }, now), /scanner evidence is future-dated/);
  assert.throws(() => validateApprovalEvidence(approvedResource, {
    ...review,
    compatibility: review.compatibility.map((row) => row.client === "codex" ? { ...row, checkedAt: "2026-07-13T01:00:00.000Z" } : row)
  }, now), /codex compatibility evidence is future-dated/);
  assert.throws(() => validateApprovalEvidence(approvedResource, {
    ...review,
    compatibility: review.compatibility.map((row) => row.client === "codex" ? { ...row, checkedAt: "2026-03-01T00:00:00.000Z" } : row)
  }, now), /fresh codex compatibility evidence/);
  assert.throws(() => validateApprovalEvidence(approvedResource, {
    ...review,
    compatibility: review.compatibility.map((row) => row.client === "codex" ? { ...row, checkedAt: "2026-07-12T11:00:00.000Z" } : row)
  }, now), /codex compatibility evidence is future-dated/);
  assert.throws(() => validateApprovalEvidence(approvedResource, {
    ...review,
    expiresAt: "2126-07-12T10:00:00.000Z"
  }, now), /within 180 days/);
  assert.throws(() => validateApprovalEvidence(approvedResource, {
    ...review,
    expiresAt: "2026-07-12T09:59:59.000Z"
  }, now), /after review and within 180 days/);
  assert.throws(() => validateApprovalEvidence(approvedResource, {
    ...review,
    reviewedAt: "2025-01-01T00:00:00.000Z",
    expiresAt: "2025-06-01T00:00:00.000Z"
  }, now), /human review is stale/);
});

test("approval evidence rejects private reviewer labels and undocumented warnings", () => {
  const now = new Date("2026-07-13T00:00:00.000Z");
  const review = approvalReview();
  assert.throws(() => validateApprovalEvidence(approvedResource, {
    ...review,
    reviewer: { label: "Reviewer reviewer@example.com" }
  }, now), /reviewer label must be public-safe/);
  assert.throws(() => validateApprovalEvidence(approvedResource, {
    ...review,
    scanner: { ...review.scanner, status: "warn" }
  }, now), /\[SCANNER_WARN\] limitation/);
  assert.throws(() => validateApprovalEvidence(approvedResource, {
    ...review,
    scanner: { ...review.scanner, status: "warn" },
    limitations: ["[SCANNER_WARN]       "]
  }, now), /\[SCANNER_WARN\] limitation/);
  assert.doesNotThrow(() => validateApprovalEvidence(approvedResource, {
    ...review,
    capabilityDiff: { ...review.capabilityDiff, status: "warn" },
    limitations: ["[CAPABILITY_DIFF_WARN] One declared capability requires human confirmation"]
  }, now));
});

test("approval evidence requires an explicit limitation for inert manifest eval commands", () => {
  const now = new Date("2026-07-13T00:00:00.000Z");
  const review = approvalReview();
  assert.throws(
    () => validateApprovalEvidence(approvedResource, review, now, { evalCommand: "npx promptfoo@latest eval -c evals/promptfooconfig.yaml" }),
    /\[EVAL_COMMAND_WARN\] limitation/
  );
  assert.doesNotThrow(() => validateApprovalEvidence(approvedResource, {
    ...review,
    limitations: [
      ...review.limitations,
      "[EVAL_COMMAND_WARN] Author-declared local eval command is inert during managed activation"
    ]
  }, now, { evalCommand: "npx promptfoo@latest eval -c evals/promptfooconfig.yaml" }));
});
