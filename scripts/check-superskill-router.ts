import { readFileSync } from "node:fs";
import path from "node:path";
import { managedCapabilityIndexSchema, type Client, type ManagedCapability, type RecommendationResponse } from "@harnesshub/capability-schema/browser";
import { recommendCapabilities } from "../apps/harness-api/src/recommendations.js";

type CaseCategory = "positive" | "ambiguous" | "out_of_scope" | "adversarial";
type RouterCase = {
  id: string;
  category: CaseCategory;
  task: string;
  client?: Client;
  expectedDecision: RecommendationResponse["decision"];
  allowedTop: string[];
  forbidden: string[];
  expectedReasonCodes: string[];
};

const root = path.resolve(import.meta.dirname, "..");
const index = managedCapabilityIndexSchema.parse(JSON.parse(readFileSync(path.join(root, "data/superskill/index.json"), "utf8")));
const fixture = JSON.parse(readFileSync(path.join(root, "data/superskill/router-cases/stage-a.json"), "utf8")) as {
  schemaVersion?: string;
  cases?: RouterCase[];
};
if (fixture.schemaVersion !== "superskill.router-cases.v1" || !Array.isArray(fixture.cases) || fixture.cases.length < 30) {
  throw new Error("Stage A router gate requires at least 30 strict fixture cases");
}
const cases = fixture.cases;
assertFixtureComposition(cases, index.capabilities.map((item) => item.id));

const now = new Date("2026-07-12T12:00:00.000Z");
const approved = index.capabilities.map((capability) => approvedRouterFixture(capability, now));
const blocked = blockedRouterFixtures(approved[0]!);
const capabilities = [...approved, ...blocked];
const blockedIds = new Set(blocked.map((item) => item.id));
const failures: string[] = [];
const summaries: string[] = [];

for (const client of ["claude-code", "codex"] as const) {
  const clientCases = cases.filter((item) => !item.client || item.client === client);
  let positiveTop1 = 0;
  let positiveTop3 = 0;
  let positiveTotal = 0;
  let ambiguousCorrect = 0;
  let ambiguousTotal = 0;
  let outCorrect = 0;
  let outTotal = 0;
  let adversarialCorrect = 0;
  let adversarialTotal = 0;
  let forbiddenAppearances = 0;

  for (const item of clientCases) {
    const recommendationId = `rec_fixture_${item.id.replaceAll("-", "_")}_${client.replace("-", "_")}`;
    const request = { task: item.task, context: { client, os: "darwin" as const, arch: "arm64" as const, installedManagedRefs: [] } };
    const response = recommendCapabilities(request, capabilities, { now, recommendationId });
    const repeated = recommendCapabilities(request, capabilities, { now, recommendationId });
    const canonical = (value: RecommendationResponse) => JSON.stringify({
      decision: value.decision,
      decisionDigest: value.decisionDigest,
      confidence: value.confidence,
      selected: value.selected?.capability.id,
      alternatives: value.alternatives.map((candidate) => candidate.capability.id),
      clarification: value.clarification?.code
    });
    if (canonical(response) !== canonical(repeated)) failures.push(`${client}/${item.id}: non-deterministic response`);

    const returned = [response.selected, ...response.alternatives].filter(Boolean).map((candidate) => candidate!.capability.id);
    const top3 = returned.slice(0, 3);
    const forbidden = new Set([...item.forbidden, ...blockedIds]);
    const appeared = returned.filter((id) => forbidden.has(id));
    forbiddenAppearances += appeared.length;
    if (appeared.length) failures.push(`${client}/${item.id}: forbidden=${appeared.join(",")}`);

    const reasonCodes = new Set([
      ...(response.selected?.why.map((reason) => reason.code) ?? []),
      ...(response.clarification ? [response.clarification.code] : [])
    ]);
    const missingReasons = item.expectedReasonCodes.filter((code) => !reasonCodes.has(code as never));
    if (missingReasons.length) failures.push(`${client}/${item.id}: missing reasons=${missingReasons.join(",")}`);
    if (response.decision !== item.expectedDecision) failures.push(`${client}/${item.id}: decision=${response.decision}, expected=${item.expectedDecision}`);

    if (item.category === "positive") {
      positiveTotal += 1;
      if (response.selected && item.allowedTop.includes(response.selected.capability.id)) positiveTop1 += 1;
      if (top3.some((id) => item.allowedTop.includes(id))) positiveTop3 += 1;
    } else if (item.category === "ambiguous") {
      ambiguousTotal += 1;
      if (response.decision === "needs_clarification" && response.selected && item.allowedTop.includes(response.selected.capability.id)) ambiguousCorrect += 1;
    } else if (item.category === "out_of_scope") {
      outTotal += 1;
      if (response.decision === "no_safe_match" && returned.length === 0) outCorrect += 1;
    } else {
      adversarialTotal += 1;
      if (response.decision === "no_safe_match" && appeared.length === 0) adversarialCorrect += 1;
    }
  }

  const top1Rate = positiveTop1 / positiveTotal;
  const top3Rate = positiveTop3 / positiveTotal;
  const ambiguousRate = ambiguousCorrect / ambiguousTotal;
  if (top1Rate < 0.7) failures.push(`${client}: positive top-1 ${(top1Rate * 100).toFixed(1)}% < 70%`);
  if (top3Rate < 0.9) failures.push(`${client}: positive top-3 ${(top3Rate * 100).toFixed(1)}% < 90%`);
  if (ambiguousRate < 0.8) failures.push(`${client}: ambiguous non-confident ${(ambiguousRate * 100).toFixed(1)}% < 80%`);
  if (outCorrect !== outTotal) failures.push(`${client}: out-of-scope ${outCorrect}/${outTotal} < 100%`);
  if (adversarialCorrect !== adversarialTotal) failures.push(`${client}: adversarial ${adversarialCorrect}/${adversarialTotal} < 100%`);
  if (forbiddenAppearances) failures.push(`${client}: ${forbiddenAppearances} forbidden/revoked appearances`);
  summaries.push(`${client}: top1 ${positiveTop1}/${positiveTotal}, top3 ${positiveTop3}/${positiveTotal}, ambiguous ${ambiguousCorrect}/${ambiguousTotal}, out ${outCorrect}/${outTotal}, adversarial ${adversarialCorrect}/${adversarialTotal}, forbidden 0`);
}

if (failures.length) throw new Error(`SuperSkill router gate failed\n${failures.join("\n")}`);
console.log(`SuperSkill Stage A router gate passed (${cases.length} cases; ${summaries.join("; ")})`);

function assertFixtureComposition(items: RouterCase[], capabilityIds: string[]): void {
  const ids = new Set<string>();
  const counts: Record<CaseCategory, number> = { positive: 0, ambiguous: 0, out_of_scope: 0, adversarial: 0 };
  const positiveCoverage = new Set<string>();
  for (const item of items) {
    if (!item || typeof item.id !== "string" || ids.has(item.id)) throw new Error(`Invalid or duplicate router case: ${item?.id ?? "unknown"}`);
    ids.add(item.id);
    if (!(item.category in counts) || !item.task || !Array.isArray(item.allowedTop) || !Array.isArray(item.forbidden) || !Array.isArray(item.expectedReasonCodes)) {
      throw new Error(`Router case ${item.id} is missing strict category/ranking/reason fields`);
    }
    counts[item.category] += 1;
    if (item.category === "positive") item.allowedTop.forEach((id) => positiveCoverage.add(id));
  }
  if (counts.positive < 18 || counts.ambiguous < 5 || counts.out_of_scope < 3 || counts.adversarial < 4) {
    throw new Error(`Stage A composition invalid: ${JSON.stringify(counts)}`);
  }
  const uncovered = capabilityIds.filter((id) => !positiveCoverage.has(id));
  if (uncovered.length) throw new Error(`Stage A positive coverage missing: ${uncovered.join(",")}`);
}

function blockedRouterFixtures(source: ManagedCapability): ManagedCapability[] {
  const clone = (id: string, digestCharacter: string, mutate: (item: ManagedCapability) => ManagedCapability): ManagedCapability => mutate({
    ...source,
    id,
    title: `Synthetic blocked ${id}`,
    release: { ...source.release, ref: `harnesses/${id}`, artifactDigest: `sha256:${digestCharacter.repeat(64)}` },
    trust: { ...source.trust, checks: source.trust.checks.map((check) => ({ ...check })) }
  });
  return [
    clone("revoked-router-shadow", "d", (item) => ({ ...item, trust: { ...item.trust, status: "revoked" } })),
    clone("quarantined-router-shadow", "e", (item) => ({ ...item, trust: { ...item.trust, status: "quarantined" } })),
    clone("high-risk-router-shadow", "f", (item) => ({ ...item, permissions: { ...item.permissions, moneyMovement: true, humanApprovalRequired: ["before money movement"] } }))
  ];
}

function approvedRouterFixture(capability: ManagedCapability, checkedAt: Date): ManagedCapability {
  const expiresAt = new Date(checkedAt.getTime() + 30 * 86_400_000).toISOString();
  const mandatory = new Set(["schema", "artifact_digest", "source_license", "static_security", "capability_diff", "claude_code_activation", "codex_activation", "human_review"]);
  return {
    ...capability,
    compatibility: (["claude-code", "codex"] as Client[]).map((client) => ({ client, status: "verified" as const, verifiedAt: checkedAt.toISOString(), notes: "Synthetic router fixture only" })),
    trust: {
      ...capability.trust,
      status: "approved",
      reviewedAt: checkedAt.toISOString(),
      limitations: ["Synthetic router fixture; not a catalog approval"],
      checks: capability.trust.checks.map((check) => mandatory.has(check.id)
        ? { ...check, status: "pass", checkedAt: checkedAt.toISOString(), expiresAt, summary: `${check.id} synthetic router fixture` }
        : { ...check, checkedAt: checkedAt.toISOString() })
    }
  };
}
