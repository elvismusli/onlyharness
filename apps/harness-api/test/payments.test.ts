import test from "node:test";
import assert from "node:assert/strict";
import { entitlementRowsAllow } from "../src/payments.ts";

test("entitlementRowsAllow accepts repo-wide and matching version entitlements", () => {
  const now = Date.parse("2026-07-06T00:00:00Z");

  assert.equal(entitlementRowsAllow([{ version: null, expires_at: null }], "0.1.0", now), true);
  assert.equal(entitlementRowsAllow([{ version: "0.1.0", expires_at: null }], "0.1.0", now), true);
  assert.equal(entitlementRowsAllow([{ version: "0.2.0", expires_at: null }], "0.1.0", now), false);
});

test("entitlementRowsAllow rejects expired rows", () => {
  const now = Date.parse("2026-07-06T00:00:00Z");

  assert.equal(entitlementRowsAllow([{ version: null, expires_at: "2026-07-05T23:59:59Z" }], "0.1.0", now), false);
  assert.equal(entitlementRowsAllow([{ version: null, expires_at: "2026-07-06T00:00:01Z" }], "0.1.0", now), true);
});
