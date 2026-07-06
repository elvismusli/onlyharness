import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test("bounties require passing delivery receipts and captured gate escrow before paid", () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "hh-bounty-test-"));
  const bountiesStore = path.join(tmp, "bounties.json");
  const paymentsStore = path.join(tmp, "payments.json");
  const script = `
    import assert from "node:assert/strict";
    import { createHash, generateKeyPairSync, sign } from "node:crypto";
    import {
      acceptBounty,
      claimBounty,
      createBounty,
      deliverBounty,
      listBounties
    } from ${JSON.stringify(pathToFileUrl(path.join(root, "apps/harness-api/src/bounties.ts")))};
    import {
      createCheckoutSession,
      settlePaymentWebhook
    } from ${JSON.stringify(pathToFileUrl(path.join(root, "apps/harness-api/src/payments.ts")))};

    const customer = "customer-1";
    const builder = "builder-1";
    const manifest = { pricing: { model: "gate_escrow", amount_usd: 25, currency: "USD" } };
    const created = await createBounty({
      title: "Spec-writing harness",
      spec: "Build a harness that turns raw operator notes into a clear implementation specification with eval cases.",
      budgetUsd: 25,
      userId: customer
    });
    assert.equal(created.ok, true);
    const bounty = created.value;
    assert.equal(bounty.status, "open");
    assert.equal((await listBounties()).length, 1);

    const claimed = await claimBounty({ id: bounty.id, userId: builder });
    assert.equal(claimed.ok, true);
    assert.equal(claimed.value.status, "claimed");
    assert.equal((await claimBounty({ id: bounty.id, userId: customer })).ok, false);

    const failedDelivery = await deliverBounty({
      id: bounty.id,
      userId: builder,
      harness: "local/bounty-harness",
      version: "0.1.0",
      receipt: signedReceipt("failed")
    });
    assert.equal(failedDelivery.ok, false);
    assert.equal(failedDelivery.status, 400);

    const passReceipt = signedReceipt("passed");
    const delivered = await deliverBounty({
      id: bounty.id,
      userId: builder,
      harness: "local/bounty-harness",
      version: "0.1.0",
      receipt: passReceipt
    });
    assert.equal(delivered.ok, true);
    assert.equal(delivered.value.status, "delivered");
    assert.equal(delivered.value.delivered_harness, "local/bounty-harness");

    const notCustomer = await acceptBounty({
      id: bounty.id,
      userId: builder,
      providerRef: "manual_missing",
      receipt: passReceipt
    });
    assert.equal(notCustomer.ok, false);
    assert.equal(notCustomer.status, 403);

    const cheapCheckout = await createCheckoutSession({
      owner: "local",
      repo: "bounty-harness",
      version: "0.1.0",
      manifest: { pricing: { model: "gate_escrow", amount_usd: 10, currency: "USD" } },
      userId: customer
    });
    assert.equal(cheapCheckout.status, "pending");
    const cheapReserved = await settlePaymentWebhook({ provider: "manual", provider_ref: cheapCheckout.provider_ref, status: "paid" });
    assert.equal(cheapReserved.status, "reserved");
    const underpaid = await acceptBounty({
      id: bounty.id,
      userId: customer,
      providerRef: cheapCheckout.provider_ref,
      receipt: passReceipt
    });
    assert.equal(underpaid.ok, false);
    assert.equal(underpaid.status, 400);

    const checkout = await createCheckoutSession({
      owner: "local",
      repo: "bounty-harness",
      version: "0.1.0",
      manifest,
      userId: customer
    });
    assert.equal(checkout.status, "pending");
    const reserved = await settlePaymentWebhook({ provider: "manual", provider_ref: checkout.provider_ref, status: "paid" });
    assert.equal(reserved.status, "reserved");

    const mismatched = await acceptBounty({
      id: bounty.id,
      userId: customer,
      providerRef: checkout.provider_ref,
      receipt: signedReceipt("passed", "local/other-harness")
    });
    assert.equal(mismatched.ok, false);
    assert.equal(mismatched.status, 400);

    const paid = await acceptBounty({
      id: bounty.id,
      userId: customer,
      providerRef: checkout.provider_ref,
      receipt: passReceipt
    });
    assert.equal(paid.ok, true);
    assert.equal(paid.value.status, "paid");
    assert.equal(paid.value.escrow_provider_ref, checkout.provider_ref);
    assert.equal(paid.value.payment_purchase_id, reserved.purchase_id);
    assert.equal(paid.value.accepted_receipt_hash, paid.value.delivery_receipt_hash);
    assert.ok(paid.value.paid_at);

    const builderPaidRead = await acceptBounty({
      id: bounty.id,
      userId: builder,
      providerRef: checkout.provider_ref,
      receipt: passReceipt
    });
    assert.equal(builderPaidRead.ok, false);
    assert.equal(builderPaidRead.status, 403);

    const paidAgain = await acceptBounty({
      id: bounty.id,
      userId: customer,
      providerRef: checkout.provider_ref,
      receipt: passReceipt
    });
    assert.equal(paidAgain.ok, true);
    assert.equal(paidAgain.value.status, "paid");

    const second = await createBounty({
      title: "Second spec harness",
      spec: "Build another harness with the same passing receipt to verify escrow reuse protection.",
      budgetUsd: 25,
      userId: customer
    });
    assert.equal(second.ok, true);
    assert.equal((await claimBounty({ id: second.value.id, userId: builder })).ok, true);
    assert.equal((await deliverBounty({ id: second.value.id, userId: builder, receipt: passReceipt })).ok, true);
    const duplicatePayment = await acceptBounty({
      id: second.value.id,
      userId: customer,
      providerRef: checkout.provider_ref,
      receipt: passReceipt
    });
    assert.equal(duplicatePayment.ok, false);
    assert.equal(duplicatePayment.status, 409);

    function signedReceipt(verdict, harness = "local/bounty-harness") {
      const pair = generateKeyPairSync("ed25519", {
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" }
      });
      const payload = {
        harness,
        version: "0.1.0",
        resultsHash: createHash("sha256").update(verdict + harness).digest("hex"),
        verdict,
        at: "2026-07-06T00:00:00.000Z",
        gate: { score: verdict === "passed" ? 0.95 : 0.4, risk: 1, cost: 0, failures: verdict === "passed" ? [] : ["failed"] }
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
      HARNESS_LOCAL_BOUNTIES_PATH: bountiesStore,
      HARNESS_LOCAL_PAYMENTS_PATH: paymentsStore,
      PAYMENTS_ENABLED: "true"
    }
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

function pathToFileUrl(file: string): string {
  return new URL(`file://${file}`).href;
}
