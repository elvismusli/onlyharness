import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyGateReceipt, type GateReceiptPayload } from "../src/receipts.ts";

test("verifyGateReceipt accepts ed25519 signed gate receipts", () => {
  const receipt = signedReceipt();
  const result = verifyGateReceipt(receipt);

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.error);
  assert.match(result.receipt_hash, /^[a-f0-9]{64}$/);
  assert.equal(result.harness, "harnesses/deep-market-researcher");
  assert.equal(result.version, "0.1.0");
  assert.equal(result.verdict, "passed");
  assert.equal(result.resultsHash, receipt.payload.resultsHash);
  assert.equal(result.at, receipt.payload.at);
});

test("verifyGateReceipt rejects tampered payloads and invalid shapes", () => {
  const receipt = signedReceipt();
  const tampered = { ...receipt, payload: { ...receipt.payload, verdict: "failed" } };

  assert.deepEqual(verifyGateReceipt(tampered), {
    ok: false,
    status: 400,
    error: "Invalid gate receipt signature"
  });
  assert.deepEqual(verifyGateReceipt({ ...receipt, payload: { ...receipt.payload, resultsHash: "not-a-hash" } }), {
    ok: false,
    status: 400,
    error: "Invalid gate receipt shape"
  });
});

function signedReceipt() {
  const pair = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });
  const payload: GateReceiptPayload = {
    harness: "harnesses/deep-market-researcher",
    version: "0.1.0",
    resultsHash: "a".repeat(64),
    verdict: "passed",
    at: "2026-07-06T00:00:00.000Z",
    gate: {
      score: 0.95,
      risk: 1,
      cost: 0,
      failures: []
    }
  };
  return {
    type: "onlyharness.gate_receipt.v1" as const,
    algorithm: "ed25519" as const,
    payload,
    publicKey: pair.publicKey,
    signature: sign(null, Buffer.from(stableJson(payload)), pair.privateKey).toString("base64")
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}
