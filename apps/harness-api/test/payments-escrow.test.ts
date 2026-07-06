import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test("gate escrow reserves, captures, refunds and times out through local payment state", () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "hh-escrow-test-"));
  const store = path.join(tmp, "payments.json");
  const script = `
    import assert from "node:assert/strict";
    import { createHash, generateKeyPairSync, sign } from "node:crypto";
    import { readFileSync, writeFileSync } from "node:fs";
    import {
      checkEntitlement,
      createCheckoutSession,
      settleEscrowReceipt,
      settlePaymentWebhook,
      timeoutEscrowPurchase
    } from ${JSON.stringify(pathToFileUrl(path.join(root, "apps/harness-api/src/payments.ts")))};

    const manifest = { pricing: { model: "gate_escrow", amount_usd: 15, currency: "USD" } };
    const userId = "user-escrow";

    const checkout = await createCheckoutSession({ owner: "local", repo: "escrow-harness", version: "0.1.0", manifest, userId });
    assert.equal(checkout.status, "pending");
    const reserved = await settlePaymentWebhook({ provider: "manual", provider_ref: checkout.provider_ref, status: "paid" });
    assert.equal(reserved.status, "reserved");
    let state = JSON.parse(readFileSync(${JSON.stringify(store)}, "utf8"));
    assert.equal(state.purchases[0].status, "reserved");
    assert.equal(state.entitlements[0].kind, "escrow_reserved");

    const beforeCapture = await checkEntitlement({ owner: "local", repo: "escrow-harness", version: "0.1.0", manifest, subject: { type: "user", id: userId } });
    assert.equal(beforeCapture.entitled, false);

    const captured = await settleEscrowReceipt({ providerRef: checkout.provider_ref, userId, receipt: signedReceipt("passed") });
    assert.equal(captured.status, "captured");
    state = JSON.parse(readFileSync(${JSON.stringify(store)}, "utf8"));
    assert.equal(state.purchases[0].status, "captured");
    assert.equal(state.entitlements.length, 1);
    assert.equal(state.entitlements[0].kind, "one_time");
    const afterCapture = await checkEntitlement({ owner: "local", repo: "escrow-harness", version: "0.1.0", manifest, subject: { type: "user", id: userId } });
    assert.equal(afterCapture.entitled, true);

    const failedCheckout = await createCheckoutSession({ owner: "local", repo: "escrow-harness", version: "0.1.0", manifest, userId });
    await settlePaymentWebhook({ provider: "manual", provider_ref: failedCheckout.provider_ref, status: "paid" });
    const refunded = await settleEscrowReceipt({ providerRef: failedCheckout.provider_ref, userId, receipt: signedReceipt("failed") });
    assert.equal(refunded.status, "refunded");
    state = JSON.parse(readFileSync(${JSON.stringify(store)}, "utf8"));
    const failedPurchase = state.purchases.find((row) => row.provider_ref === failedCheckout.provider_ref);
    assert.equal(failedPurchase.status, "refunded");
    assert.equal(state.entitlements.some((row) => row.purchase_id === failedPurchase.id), false);

    const timeoutCheckout = await createCheckoutSession({ owner: "local", repo: "escrow-harness", version: "0.1.0", manifest, userId });
    await settlePaymentWebhook({ provider: "manual", provider_ref: timeoutCheckout.provider_ref, status: "paid" });
    state = JSON.parse(readFileSync(${JSON.stringify(store)}, "utf8"));
    const timeoutPurchase = state.purchases.find((row) => row.provider_ref === timeoutCheckout.provider_ref);
    timeoutPurchase.escrow_expires_at = "2026-07-05T00:00:00.000Z";
    for (const row of state.entitlements) {
      if (row.purchase_id === timeoutPurchase.id) row.expires_at = timeoutPurchase.escrow_expires_at;
    }
    writeFileSync(${JSON.stringify(store)}, JSON.stringify(state, null, 2) + "\\n");
    const timedOut = await timeoutEscrowPurchase({ providerRef: timeoutCheckout.provider_ref, userId, nowMs: Date.parse("2026-07-06T00:00:00.000Z") });
    assert.equal(timedOut.status, "refunded");

    function signedReceipt(verdict) {
      const pair = generateKeyPairSync("ed25519", {
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" }
      });
      const payload = {
        harness: "local/escrow-harness",
        version: "0.1.0",
        resultsHash: createHash("sha256").update(verdict).digest("hex"),
        verdict,
        at: "2026-07-06T00:00:00.000Z",
        gate: { score: verdict === "passed" ? 0.95 : 0.4, risk: 1, cost: 0, failures: verdict === "passed" ? [] : ["failed fixture"] }
      };
      return {
        type: "onlyharness.gate_receipt.v1",
        algorithm: "ed25519",
        payload,
        publicKey: pair.publicKey,
        signature: sign(null, Buffer.from(stableJson(payload)), pair.privateKey).toString("base64")
      };
    }

    function stableJson(value) {
      if (value === null || typeof value !== "object") return JSON.stringify(value);
      if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
      return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableJson(value[key])).join(",") + "}";
    }
  `;

  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      HARNESS_LOCAL_PAYMENTS_PATH: store,
      PAYMENTS_ENABLED: "true"
    }
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

function pathToFileUrl(file: string): string {
  return new URL(`file://${file}`).href;
}
