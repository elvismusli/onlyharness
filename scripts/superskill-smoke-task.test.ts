import assert from "node:assert/strict";
import test from "node:test";
import { deriveCuratedSmokeTask } from "./superskill-smoke-task.js";

test("derives a known-positive routing probe from the exact curated intent", () => {
  assert.equal(deriveCuratedSmokeTask({
    jobs: [{
      intents: ["  gtm   research sprint  "],
      outcomes: ["source-backed go to market plan"]
    }]
  }, "gtm-research-sprint"), "gtm research sprint");
});

test("fails closed when no curated intent is available", () => {
  assert.throws(() => deriveCuratedSmokeTask({ jobs: [{ outcomes: ["report"] }] }, "missing-intent"), /requires at least one intent/);
});
