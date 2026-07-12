import assert from "node:assert/strict";
import test from "node:test";
import {
  activationExecutionStateSchema,
  clientSchema,
  managedStatusSchema,
  superskillErrorCodeSchema
} from "../src/browser.js";

test("managed enums are exhaustive and reject unknown optimistic states", () => {
  assert.deepEqual(clientSchema.options, ["claude-code", "codex"]);
  assert.deepEqual(managedStatusSchema.options, ["candidate", "approved", "quarantined", "revoked"]);
  assert.equal(activationExecutionStateSchema.safeParse("installed").success, false);
  assert.equal(superskillErrorCodeSchema.safeParse("SAFE").success, false);
});
