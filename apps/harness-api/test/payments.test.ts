import test from "node:test";
import assert from "node:assert/strict";
import { createCheckoutSession, entitlementRowsAllow, readPurchaseReceipt, requireArchivePaymentAccess, settlePaymentWebhook } from "../src/payments.ts";

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

test("per_call pricing fails closed until hosted execution ships", async () => {
  const manifest = {
    pricing: { model: "per_call", amount_usd: 2, currency: "USD" }
  } as never;

  const archive = await requireArchivePaymentAccess({
    owner: "harnesses",
    repo: "hosted-harness",
    version: "0.1.0",
    manifest
  });
  assert.equal(archive.allowed, false);
  if (!archive.allowed) {
    assert.equal(archive.status, 409);
    assert.equal(archive.body.code, "HOSTED_EXECUTION_NOT_AVAILABLE");
  }

  const checkout = await createCheckoutSession({
    owner: "harnesses",
    repo: "hosted-harness",
    version: "0.1.0",
    userId: "user-1",
    manifest
  });
  assert.deepEqual(checkout, {
    status: 409,
    error: "Hosted execution is not available for per_call pricing"
  });
});

test("readPurchaseReceipt validates provider_ref and fails closed without a payment store", async () => {
  assert.deepEqual(await readPurchaseReceipt({ providerRef: "", userId: "user-1" }), {
    status: 400,
    error: "provider_ref is required"
  });
  assert.deepEqual(await readPurchaseReceipt({ providerRef: "manual_123", userId: "user-1" }), {
    status: 503,
    error: "Payment store unavailable"
  });
});
