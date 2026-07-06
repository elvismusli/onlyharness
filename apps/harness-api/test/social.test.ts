import test from "node:test";
import assert from "node:assert/strict";
import { badgeFor, heatFor, HEAT_SIGNAL_THRESHOLD, qualifiesForHeat, socialFromCounters } from "../src/social.ts";

test("socialFromCounters returns honest zeros when no row exists", () => {
  const social = socialFromCounters(undefined, {
    riskTier: "LOW",
    evalScore: 0.9,
    updatedAt: new Date().toISOString()
  });

  assert.equal(social.stars, 0);
  assert.equal(social.forks, 0);
  assert.equal(social.threads, 0);
  assert.equal(social.runs, 0);
  assert.equal(social.installConfirms, 0);
  assert.equal(social.signalCount, 0);
  assert.equal(social.heatQualified, false);
  assert.equal(social.heatDelta, 0);
  assert.equal(social.freshness, "collecting signals");
});

test("heat grows from real signals and has no fake floor", () => {
  const now = new Date().toISOString();
  const cold = heatFor({ stars: 0, forks: 0, threads: 0, runs: 0, installConfirms: 0 }, 0, "LOW", now);
  const warm = heatFor({ stars: 50, forks: 10, threads: 5, runs: 0, installConfirms: 2 }, 0.9, "LOW", now);

  assert.equal(cold, 0);
  assert.ok(warm > cold);
});

test("badge is new for a harness with no real signals", () => {
  assert.equal(badgeFor("LOW", 0.9, 4.8, 0), "new");
});

test("badge reports Claude Code install confirmations from real telemetry", () => {
  assert.equal(badgeFor("LOW", 0.9, 5.1, 2, 2), "works in Claude Code: 2 confirms");
});

test("low-risk badge does not promise safety", () => {
  assert.equal(badgeFor("LOW", 0.7, 2.1, 1), "low-risk scan");
});

test("heat qualification requires enough real signals or a verified install confirm", () => {
  assert.equal(HEAT_SIGNAL_THRESHOLD, 3);
  assert.equal(qualifiesForHeat(2, 0), false);
  assert.equal(qualifiesForHeat(3, 0), true);
  assert.equal(qualifiesForHeat(1, 1), true);
});
