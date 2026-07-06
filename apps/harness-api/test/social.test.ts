import test from "node:test";
import assert from "node:assert/strict";
import { badgeFor, heatFor, HEAT_SIGNAL_THRESHOLD, mergeForkRows, mergeThreadPostRows, mergeUserActionRows, mergeVerificationRunRows, qualifiesForHeat, socialFromCounters } from "../src/social.ts";

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

test("raw Supabase star rows replace stale aggregate stars without double counting", () => {
  const counters = new Map([
    ["openai/codex", { stars: 9, forks: 2, threads: 4, runs: 0, installConfirms: 1 }],
    ["stale/empty", { stars: 3, forks: 1, threads: 0, runs: 0, installConfirms: 0 }]
  ]);

  mergeUserActionRows(counters, [
    { owner: "openai", repo: "codex", action: "star", id: 1 },
    { owner: "openai", repo: "codex", action: "star", id: 1 },
    { owner: "openai", repo: "codex", action: "star", id: 2 },
    { owner: "openai", repo: "codex", action: "fork", id: 3 },
    { owner: "new", repo: "repo", action: "star", id: 4 }
  ]);

  assert.deepEqual(counters.get("openai/codex"), { stars: 2, forks: 2, threads: 4, runs: 0, installConfirms: 1 });
  assert.equal(counters.get("stale/empty")?.stars, 0);
  assert.deepEqual(counters.get("new/repo"), { stars: 1, forks: 0, threads: 0, runs: 0, installConfirms: 0 });
});

test("raw Supabase thread rows replace stale aggregate threads without double counting", () => {
  const counters = new Map([
    ["openai/codex", { stars: 2, forks: 0, threads: 9, runs: 0, installConfirms: 0 }],
    ["stale/empty", { stars: 0, forks: 0, threads: 2, runs: 0, installConfirms: 0 }]
  ]);

  mergeThreadPostRows(counters, [
    { owner: "openai", repo: "codex", id: "post-1" },
    { owner: "openai", repo: "codex", id: "post-1" },
    { owner: "openai", repo: "codex", id: "post-2" },
    { owner: "new", repo: "repo", id: "post-3" }
  ]);

  assert.deepEqual(counters.get("openai/codex"), { stars: 2, forks: 0, threads: 2, runs: 0, installConfirms: 0 });
  assert.equal(counters.get("stale/empty")?.threads, 0);
  assert.deepEqual(counters.get("new/repo"), { stars: 0, forks: 0, threads: 1, runs: 0, installConfirms: 0 });
});

test("passed gate events count as real runs without counting sample or eval previews", () => {
  const counters = new Map([
    ["openai/codex", { stars: 0, forks: 0, threads: 0, runs: 9, installConfirms: 0 }]
  ]);

  mergeVerificationRunRows(counters, [
    { owner: "openai", repo: "codex", kind: "eval", target: "passed", id: 1 },
    { owner: "openai", repo: "codex", kind: "gate", target: "failed", id: 2 },
    { owner: "openai", repo: "codex", kind: "gate", target: "passed", id: 3 },
    { owner: "openai", repo: "codex", kind: "gate", target: "passed", id: 3 },
    { owner: "new", repo: "repo", kind: "gate", target: "passed", id: 4 }
  ]);

  assert.deepEqual(counters.get("openai/codex"), { stars: 0, forks: 0, threads: 0, runs: 1, installConfirms: 0 });
  assert.deepEqual(counters.get("new/repo"), { stars: 0, forks: 0, threads: 0, runs: 1, installConfirms: 0 });
});

test("fork graph rows replace stale aggregate forks without counting action clicks", () => {
  const counters = new Map([
    ["harnesses/deep-market-researcher", { stars: 0, forks: 5, threads: 0, runs: 0, installConfirms: 0 }],
    ["stale/empty", { stars: 0, forks: 2, threads: 0, runs: 0, installConfirms: 0 }]
  ]);

  mergeForkRows(counters, [
    { source_owner: "harnesses", source_repo: "deep-market-researcher", fork_owner: "local", fork_repo: "one", user_subject: "user:a", id: 1 },
    { source_owner: "harnesses", source_repo: "deep-market-researcher", fork_owner: "local", fork_repo: "one", user_subject: "user:a", id: 1 },
    { source_owner: "harnesses", source_repo: "deep-market-researcher", fork_owner: "local", fork_repo: "two", user_subject: "user:b", id: 2 }
  ]);

  assert.deepEqual(counters.get("harnesses/deep-market-researcher"), { stars: 0, forks: 2, threads: 0, runs: 0, installConfirms: 0 });
  assert.equal(counters.get("stale/empty")?.forks, 0);
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
