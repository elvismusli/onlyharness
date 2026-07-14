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

test("OpenAPI hides one-transition legacy device authorization", () => {
  assert.equal(openapi.paths["/auth/device/start"], undefined);
  assert.equal(openapi.paths["/auth/device/approve"], undefined);
  assert.equal(openapi.paths["/auth/device/token"], undefined);
  assert.equal(openapi.components.schemas.DeviceAuthorizationStart, undefined);
  assert.equal(openapi.components.schemas.DeviceAuthorizationToken, undefined);
  assert.doesNotMatch(JSON.stringify(openapi), /device bearer/i);
});

test("OpenAPI documents the durable agent-first browser authorization contract", () => {
  const start = openapi.paths["/auth/agent/start"].post;
  const bind = openapi.paths["/auth/agent/browser-bind"].post;
  const context = openapi.paths["/auth/agent/context"].get;
  const decision = openapi.paths["/auth/agent/decision"].post;
  const token = openapi.paths["/auth/agent/token"].post;
  const refresh = openapi.paths["/auth/agent/refresh"].post;
  const revoke = openapi.paths["/auth/agent/revoke"].post;
  assert.match(start.description, /fragment/);
  assert.equal(start.requestBody.content["application/json"].schema.$ref, "#/components/schemas/AgentAuthorizationStartRequest");
  assert.match(bind.description, /HttpOnly/);
  assert.deepEqual(context.security, [{ agentBindingCookie: [] }]);
  assert.match(decision.description, /Deny requires only/);
  assert.match(decision.description, /Approve additionally requires/);
  assert.match(token.description, /consumed exactly once/);
  assert.match(refresh.description, /Reuse revokes the whole session family/);
  assert.deepEqual(revoke.security, [{ bearerAuth: [] }, {}]);
  assert.equal(openapi.components.securitySchemes.agentBindingCookie.name, "__Host-superskill_agent_bind");
  assert.equal(openapi.components.schemas.AgentAuthorizationToken.properties.expires_in.maximum, 600);
  assert.equal(openapi.components.schemas.AgentAuthorizationToken.properties.session_expires_in.maximum, 2592000);
});

test("OpenAPI keeps public package publishing self-service but unreviewed", () => {
  const operation = openapi.paths["/imports/resource-package"].post;
  assert.match(operation.description, /confirmed signed-in user/);
  assert.match(operation.description, /does not require a managed recommendation grant/);
  assert.match(operation.description, /unreviewed metadata/);
  assert.match(operation.description, /8 MiB/);
  assert.ok("413" in operation.responses);
  assert.doesNotMatch(operation.description, /active superskill:managed access grant is required/);
});

test("OpenAPI exposes immutable release metadata on current and exact resource detail", () => {
  const current = openapi.paths["/resources/{id}"].get.responses["200"].content["application/json"].schema;
  const exact = openapi.paths["/resources/{id}/releases/{version}"].get.responses["200"].content["application/json"].schema;
  assert.equal(current.$ref, "#/components/schemas/Resource");
  assert.equal(exact.$ref, "#/components/schemas/ResourceExactRelease");
  assert.equal(openapi.components.schemas.Resource.properties.release.$ref, "#/components/schemas/ResourceRelease");
  assert.deepEqual(openapi.components.schemas.ResourceRelease.required, ["version", "artifactDigest", "archiveSize", "trust"]);
  assert.deepEqual(openapi.components.schemas.ResourceExactRelease.allOf[1].required, ["release"]);
  const exactArchive = openapi.paths["/resources/{id}/releases/{version}/archive"].get.responses;
  assert.ok("ETag" in exactArchive["200"].headers);
  assert.ok("X-OnlyHarness-Resource-Version" in exactArchive["200"].headers);
  assert.ok("X-SuperSkill-Artifact-SHA256" in exactArchive["200"].headers);
  assert.ok("409" in exactArchive);
  assert.ok("503" in exactArchive);
});
