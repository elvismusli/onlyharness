import assert from "node:assert/strict";

export type CuratedSmokeResource = {
  jobs?: Array<{ intents?: unknown; outcomes?: unknown }>;
};

export function deriveCuratedSmokeTask(resource: CuratedSmokeResource, capabilityId: string): string {
  const job = resource.jobs?.[0];
  const intent = Array.isArray(job?.intents) && typeof job.intents[0] === "string" ? job.intents[0] : undefined;
  assert.ok(intent, `Curated ${capabilityId} requires at least one intent to derive a smoke task`);

  // Use the exact curated intent as the routing probe. Appending outcome prose can
  // dilute the score or create a tie with a neighbouring capability, turning a
  // known-positive router fixture into needs_clarification.
  const normalized = intent.trim().replace(/\s+/g, " ");
  assert.ok(normalized.length >= 3 && normalized.length <= 256, "Derived smoke task must contain 3 to 256 characters");
  assert.equal(/[\u0000-\u001f\u007f]/.test(normalized), false, "Derived smoke task must not contain control characters");
  return normalized;
}
