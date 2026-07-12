import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTask, recommendCapabilities, RecommendationValidationError } from "../src/recommendations.js";
import { approvedCapability } from "./superskill-fixture.js";

const context = { client: "codex" as const, os: "darwin" as const, arch: "arm64" as const, installedManagedRefs: [] };
const now = new Date("2026-07-12T00:00:00.000Z");

test("deterministic router selects exact approved release with honest partial delta", () => {
  const result = recommendCapabilities({ task: "Do competitor research and build a source-backed comparison", context }, [approvedCapability()], { now, recommendationId: "rec_fixture" });
  assert.equal(result.decision, "recommend");
  assert.equal(result.selected?.capability.id, "market-research");
  assert.equal(result.selected?.permissionDelta.status, "partial");
  assert.match(result.selected?.permissionDelta.unknownBecause ?? "", /Unmanaged skills/);
  assert.equal(result.confidence, 0.85);
  assert.equal(result.recommendationId, "rec_fixture");
  assert.ok(result.selected?.why.some((reason) => reason.code === "CLIENT_VERIFIED"));
});

test("tie order is stable by risk, context and id", () => {
  const a = approvedCapability({ id: "z-market", trust: { riskScore: 12 } });
  const b = approvedCapability({ id: "a-market", trust: { riskScore: 6 } });
  const result = recommendCapabilities({ task: "competitor research source-backed comparison", context }, [a, b], { now, recommendationId: "rec_tie" });
  assert.equal(result.selected?.capability.id, "a-market");
  assert.equal(result.decision, "needs_clarification");
});

test("exclusions and out-of-scope return no safe match", () => {
  const excluded = recommendCapabilities({ task: "competitor research and send outreach", context }, [approvedCapability()], { now, recommendationId: "rec_excluded" });
  assert.equal(excluded.decision, "no_safe_match");
  const noMatch = recommendCapabilities({ task: "draw a watercolor portrait", context }, [approvedCapability()], { now, recommendationId: "rec_none" });
  assert.equal(noMatch.decision, "no_safe_match");
});

test("task normalization rejects common secret forms", () => {
  for (const task of [
    `debug token sk_${"a".repeat(24)}`,
    `debug token sk-${"a".repeat(24)}`,
    "api_key=very-secret-value-123"
  ]) assert.throws(() => normalizeTask(task), RecommendationValidationError);
});

test("decision digest excludes raw task", () => {
  const first = recommendCapabilities({ task: "competitor research market map", context }, [approvedCapability()], { now, recommendationId: "rec_first" });
  const second = recommendCapabilities({ task: "market map competitor research", context }, [approvedCapability()], { now, recommendationId: "rec_second" });
  assert.equal(first.decisionDigest, second.decisionDigest);
});
