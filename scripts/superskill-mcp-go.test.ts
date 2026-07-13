import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { probeBundledSuperSkillMcp, REQUIRED_LOCAL_TOOLS, validateSuperSkillDistributionContract } from "./superskill-mcp-go-core.js";

const root = path.resolve(import.meta.dirname, "..");

test("source plugin and one-link use the canonical SuperSkill coordinates", () => {
  const contract = validateSuperSkillDistributionContract(root);
  assert.equal(contract.marketplace, "superskill");
  assert.equal(contract.pluginCoordinate, "superskill@superskill");
  assert.equal(contract.localServer, "superskill_local");
  assert.equal(contract.oneLink, "https://superskill.sh/api/superskill/install");
  assert.deepEqual(contract.localTools, REQUIRED_LOCAL_TOOLS);
});

test("bundled superskill_local MCP exposes the exact lifecycle inventory without initializing state", async () => {
  const result = await probeBundledSuperSkillMcp(root);
  assert.deepEqual(result.tools, REQUIRED_LOCAL_TOOLS);
  assert.equal(result.doctorCode, "ACTIVATION_DOCTOR_ATTENTION");
  assert.equal(result.stateInitialized, false);
});
