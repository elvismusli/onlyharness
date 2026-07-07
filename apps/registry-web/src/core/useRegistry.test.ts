import { expect, test } from "vitest";

import { computeJobs, computeTotals } from "./useRegistry";
import { JOB_FILTERS } from "./constants";
import { keyFor } from "./format";
import type { RegistryItem } from "./types";

// Minimal RegistryItem fixture. computeJobs/computeTotals only read
// owner/name (via keyFor), job, outcome, stars, forks and threads; the rest is
// filled with inert defaults so the object satisfies the type without changing
// what the derivations compute.
function item(partial: Pick<RegistryItem, "owner" | "name"> & Partial<RegistryItem>): RegistryItem {
  return {
    ownerLabel: partial.owner,
    title: partial.name,
    summary: "",
    tags: [],
    job: "",
    outcome: "",
    runtime: "",
    valid: true,
    riskScore: 0,
    riskTier: "LOW",
    evalStatus: "none",
    evalScore: 0,
    security: { verdict: "pass", findings: 0, scanner: "none" },
    contextCost: { approxTokens: 0, files: 0, bytes: 0, status: "estimated" },
    standard: "conformant",
    forks: 0,
    stars: 0,
    threads: 0,
    runs: 0,
    installConfirms: 0,
    signalCount: 0,
    heatQualified: false,
    heat: 0,
    heatDelta: 0,
    freshness: "",
    badge: "",
    cliCommand: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial
  };
}

const MARKET = JOB_FILTERS[0]; // "Market research"
const GTM = JOB_FILTERS[1]; // "GTM research"

const items: RegistryItem[] = [
  item({ owner: "alice", name: "a", job: MARKET, stars: 10, forks: 2, threads: 3 }),
  // outcome matches the MARKET filter even though `job` does not — both are counted.
  item({ owner: "bob", name: "b", job: "misc", outcome: MARKET, stars: 5, forks: 1, threads: 0 }),
  item({ owner: "carol", name: "c", job: GTM, stars: 0, forks: 4, threads: 7 })
];

const starred: Record<string, boolean> = {
  [keyFor(items[0])]: true, // alice/a starred
  [keyFor(items[2])]: true // carol/c starred
};

test("computeJobs counts job OR outcome matches per filter, plus a trailing starred bucket", () => {
  const jobs = computeJobs(items, starred);

  // One entry per JOB_FILTERS label, followed by exactly one "starred" entry.
  expect(jobs).toHaveLength(JOB_FILTERS.length + 1);
  expect(jobs.map((entry) => entry.label)).toEqual([...JOB_FILTERS, "starred"]);

  const byLabel = Object.fromEntries(jobs.map((entry) => [entry.label, entry.count]));
  // MARKET: alice/a via job + bob/b via outcome = 2.
  expect(byLabel[MARKET]).toBe(2);
  // GTM: carol/c via job = 1.
  expect(byLabel[GTM]).toBe(1);
  // A filter nothing matches stays at 0.
  expect(byLabel["Support triage"]).toBe(0);
  // starred bucket counts starred items regardless of job (alice/a, carol/c).
  expect(byLabel.starred).toBe(2);
});

test("computeTotals sums stars/forks/threads and adds +1 per starred item to stars", () => {
  const totals = computeTotals(items, starred);

  // Raw stars 10+5+0 = 15, plus +1 for each of the 2 starred items = 17.
  expect(totals.stars).toBe(17);
  expect(totals.forks).toBe(2 + 1 + 4);
  expect(totals.threads).toBe(3 + 0 + 7);
  expect(totals.indexed).toBe(3);
});

test("with no stars, totals.stars has no bonus and the starred bucket is 0", () => {
  const jobs = computeJobs(items, {});
  const totals = computeTotals(items, {});

  expect(jobs[jobs.length - 1]).toEqual({ label: "starred", count: 0 });
  expect(totals.stars).toBe(15); // no +1 bonuses
  expect(totals.indexed).toBe(3);
});

test("empty registry yields all-zero job counts and zero totals", () => {
  const jobs = computeJobs([], {});
  const totals = computeTotals([], {});

  expect(jobs).toHaveLength(JOB_FILTERS.length + 1);
  expect(jobs.every((entry) => entry.count === 0)).toBe(true);
  expect(totals).toEqual({ stars: 0, forks: 0, threads: 0, indexed: 0 });
});
