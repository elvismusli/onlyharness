import test from "node:test";
import assert from "node:assert/strict";
import { badgeFor, heatFor, socialFromCounters } from "../src/social.ts";

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
  assert.equal(social.heatDelta, 0);
});

test("heat grows from real signals and has no fake floor", () => {
  const now = new Date().toISOString();
  const cold = heatFor({ stars: 0, forks: 0, threads: 0, runs: 0 }, 0, "LOW", now);
  const warm = heatFor({ stars: 50, forks: 10, threads: 5, runs: 400 }, 0.9, "LOW", now);

  assert.equal(cold, 0);
  assert.ok(warm > cold);
});

test("badge is new for a harness with no real signals", () => {
  assert.equal(badgeFor("LOW", 0.9, 4.8, 0), "new");
});
