import assert from "node:assert/strict";
import test from "node:test";
import { openapi } from "../src/openapi.js";

test("OpenAPI exposes the confirmed-account exact handoff decision without activation claims", () => {
  const operation = openapi.paths["/superskill/handoff/decision"].post;
  assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
  assert.match(operation.description, /confirmed Supabase account/);
  assert.match(operation.description, /never activates, loads or invokes/);
  const schema = operation.requestBody.content["application/json"].schema;
  assert.deepEqual(schema.required, ["capability", "client"]);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.capability.additionalProperties, false);
  assert.deepEqual(schema.properties.client.enum, ["claude-code", "codex"]);
  assert.ok("401" in operation.responses);
  assert.ok("403" in operation.responses);
  assert.ok("409" in operation.responses);
});
