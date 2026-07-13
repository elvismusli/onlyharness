import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { handleManagedEventRequest } from "../src/routes/superskill-events.js";
import type { EventInput, ManagedEventWriteResult } from "../src/events.js";
import type { SuperskillAccessResolver } from "../src/superskill/access.js";

const userToken = "fixture-confirmed-user-token";
const subject = `user:${"a".repeat(64)}`;
const confirmedResolver: SuperskillAccessResolver = async ({ authorization, requiredScope }) => authorization === `Bearer ${userToken}`
  ? { ok: true, principal: { subject, scope: requiredScope, cohort: "public-e2e", evidence: "confirmed_user", publicGoEligible: true } }
  : { ok: false, status: 401, code: "SUPERSKILL_AUTH_INVALID" };
const base = { kind: "activation_ready", eventId: "evt_abcdef12", activationId: "act_abcdef12", client: "superskill-codex" };

test("managed event handler uses the confirmed managed principal and ignores body identity claims", async () => {
  let written: EventInput | undefined;
  const result = await handleManagedEventRequest(`Bearer ${userToken}`, { ...base, subject: `user:${"f".repeat(64)}`, scope: "self-granted" }, {
    enabled: true,
    accessResolver: confirmedResolver,
    writer: async (input) => {
      written = input;
      return { recorded: true, duplicate: false };
    }
  });
  assert.equal(result?.status, 200);
  assert.equal(result?.headers?.["X-OnlyHarness-SuperSkill-Auth"], "confirmed-user");
  assert.equal(result?.headers?.["X-OnlyHarness-SuperSkill-Public-GO"], "eligible");
  assert.equal(written?.subject, subject);
  assert.equal("scope" in (written ?? {}), false);
});

test("managed event handler rechecks revoked access and marks legacy alpha public-GO ineligible", async () => {
  const revokedResolver: SuperskillAccessResolver = async () => ({ ok: false, status: 403, code: "SUPERSKILL_ACCESS_DENIED" });
  const revoked = await handleManagedEventRequest("Bearer revoked-user", base, { enabled: true, accessResolver: revokedResolver });
  assert.deepEqual(revoked, { status: 403, body: { error: "SuperSkill managed access is not granted", code: "SUPERSKILL_ACCESS_DENIED" } });

  const legacyToken = "fixture-legacy-alpha-token";
  const legacy = await handleManagedEventRequest(`Bearer ${legacyToken}`, base, {
    enabled: true,
    tokenHashes: [createHash("sha256").update(legacyToken).digest("hex")],
    telemetrySalt: "fixture-legacy-telemetry-salt",
    accessResolver: async () => { throw new Error("legacy token must not reach user resolver"); },
    writer: async () => ({ recorded: true, duplicate: false })
  });
  assert.equal(legacy?.status, 200);
  assert.equal(legacy?.headers?.["X-OnlyHarness-SuperSkill-Auth"], "legacy-alpha");
  assert.equal(legacy?.headers?.["X-OnlyHarness-SuperSkill-Public-GO"], "ineligible");
});

test("managed event handler returns stable validation, conflict and unavailable codes", async () => {
  const cases: Array<{ write: ManagedEventWriteResult; status: number; code: string }> = [
    { write: { recorded: false, duplicate: false }, status: 400, code: "VALIDATION_FAILED" },
    { write: { recorded: false, duplicate: false, conflict: true }, status: 409, code: "EVENT_CONFLICT" },
    { write: { recorded: false, duplicate: false, unavailable: true }, status: 503, code: "EVENT_STORAGE_UNAVAILABLE" }
  ];
  for (const fixture of cases) {
    const result = await handleManagedEventRequest(`Bearer ${userToken}`, base, {
      enabled: true,
      accessResolver: confirmedResolver,
      writer: async () => fixture.write
    });
    assert.equal(result?.status, fixture.status);
    assert.equal(result?.body.code, fixture.code);
  }
});

test("managed event handler distinguishes non-managed events and missing auth", async () => {
  assert.equal(await handleManagedEventRequest(undefined, { kind: "view" }, { enabled: true }), undefined);
  const missing = await handleManagedEventRequest(undefined, base, { enabled: true, accessResolver: confirmedResolver });
  assert.equal(missing?.status, 401);
  assert.equal(missing?.body.code, "SUPERSKILL_AUTH_REQUIRED");
  assert.match(missing?.headers?.["WWW-Authenticate"] ?? "", /^Bearer/);
});
