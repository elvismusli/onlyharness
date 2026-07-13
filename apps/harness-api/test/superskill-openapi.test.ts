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

test("OpenAPI documents bounded one-time device authorization without URL credentials", () => {
  const start = openapi.paths["/auth/device/start"].post;
  const approve = openapi.paths["/auth/device/approve"].post;
  const token = openapi.paths["/auth/device/token"].post;
  assert.match(start.description, /verification URL is static/);
  assert.deepEqual(approve.security, [{ bearerAuth: [] }]);
  assert.match(approve.description, /confirmed email/);
  assert.match(approve.description, /audited server-only operator RPC/);
  assert.match(token.description, /consumes the session exactly once/);
  assert.match(token.description, /maximum 30-minute HMAC bearer/);
  assert.deepEqual(token.requestBody.content["application/json"].schema.required, ["device_code"]);
  assert.equal(token.requestBody.content["application/json"].schema.additionalProperties, false);
  assert.ok("202" in token.responses);
  assert.ok("409" in token.responses);
  assert.ok("410" in token.responses);
  assert.equal(openapi.components.schemas.DeviceAuthorizationToken.properties.scope.const, "superskill:managed");
});

test("OpenAPI keeps public package publishing self-service but unreviewed", () => {
  const operation = openapi.paths["/imports/resource-package"].post;
  assert.match(operation.description, /confirmed signed-in user/);
  assert.match(operation.description, /does not require a managed recommendation grant/);
  assert.match(operation.description, /unreviewed metadata/);
  assert.doesNotMatch(operation.description, /active superskill:managed access grant is required/);
});
