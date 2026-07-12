import assert from "node:assert/strict";
import test from "node:test";
import { buildPilotReport, type PilotEvent } from "./superskill-pilot-report.js";

test("pilot report counts distinct server-derived tester subjects and event IDs", () => {
  const rows: PilotEvent[] = [
    event("evt_one_01", "recommended", "pilot:tester-a", "rec_alpha", undefined, "claude-code"),
    event("evt_one_01", "recommended", "pilot:tester-a", "rec_alpha", undefined, "claude-code"),
    event("evt_two_02", "activation_ready", "pilot:tester-a", "rec_alpha", "act_alpha", "claude-code"),
    event("evt_three_03", "recommended", "pilot:tester-b", "rec_beta", undefined, "codex"),
    event("evt_four_04", "outcome_reported", "pilot:tester-b", "rec_beta", "act_beta", "codex"),
    event("evt_ignore", "recommended", "anonymous", "rec_ignored", undefined, "codex")
  ];
  const report = buildPilotReport(rows);
  assert.equal(report.testers, 2);
  assert.equal(report.attempts, 2);
  assert.equal(report.activations, 2);
  assert.equal(report.byKind.recommended, 2);
  assert.equal(report.byClient["claude-code"].testers, 1);
  assert.equal(report.byClient.codex.attempts, 1);
  assert.equal(report.gate.passed, false);
  assert.ok(!JSON.stringify(report).includes("rec_ignored"));
});

test("pilot gate requires both 20 distinct testers and 100 distinct attempts", () => {
  const rows: PilotEvent[] = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    rows.push(event(`evt_${String(attempt).padStart(6, "0")}`, "recommended", `pilot:tester-${attempt % 20}`, `rec_${String(attempt).padStart(6, "0")}`, undefined, attempt % 2 ? "codex" : "claude-code"));
  }
  const report = buildPilotReport(rows);
  assert.equal(report.testers, 20);
  assert.equal(report.attempts, 100);
  assert.equal(report.gate.passed, true);
});

function event(eventId: string, kind: string, subject: string, recommendationId?: string, activationId?: string, target?: string): PilotEvent {
  return { eventId, kind, subject, recommendationId, activationId, target };
}
