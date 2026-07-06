import test from "node:test";
import assert from "node:assert/strict";
import { createCheckoutSession, entitlementRowsAllow, settlePaymentWebhook } from "../src/payments.ts";

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

test("settlePaymentWebhook rejects malformed manual payloads before touching storage", async () => {
  assert.deepEqual(await settlePaymentWebhook({ provider: "paddle", provider_ref: "p1" }), {
    ok: false,
    status: 400,
    error: "Unsupported payment provider"
  });
  assert.deepEqual(await settlePaymentWebhook({ provider: "manual", provider_ref: "p1", status: "refunded" }), {
    ok: false,
    status: 400,
    error: "Unsupported payment status"
  });
  assert.deepEqual(await settlePaymentWebhook({ provider: "manual" }), {
    ok: false,
    status: 400,
    error: "provider_ref is required"
  });
});

test("createCheckoutSession requires PAYMENTS_ENABLED before creating purchases", async () => {
  const previous = process.env.PAYMENTS_ENABLED;
  delete process.env.PAYMENTS_ENABLED;
  try {
    const result = await createCheckoutSession({
      owner: "harnesses",
      repo: "paid-harness",
      version: "0.1.0",
      userId: "user-1",
      manifest: {
        pricing: { model: "one_time", amount_usd: 12, currency: "USD" }
      } as never
    });
    assert.deepEqual(result, {
      status: 503,
      error: "Payments are disabled in this environment"
    });
  } finally {
    if (previous === undefined) delete process.env.PAYMENTS_ENABLED;
    else process.env.PAYMENTS_ENABLED = previous;
  }
});
