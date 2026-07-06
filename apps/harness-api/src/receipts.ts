import { createHash, verify } from "node:crypto";

export type GateReceiptPayload = {
  harness: string;
  version: string;
  resultsHash: string;
  verdict: "passed" | "failed";
  at: string;
  gate: {
    score: number;
    risk: number;
    cost: number;
    failures: string[];
  };
};

export type GateReceipt = {
  type: "onlyharness.gate_receipt.v1";
  algorithm: "ed25519";
  payload: GateReceiptPayload;
  publicKey: string;
  signature: string;
};

export type GateReceiptVerification =
  | {
    ok: true;
    receipt_hash: string;
    harness: string;
    version: string;
    verdict: "passed" | "failed";
    resultsHash: string;
    at: string;
  }
  | { ok: false; status: number; error: string };

export function verifyGateReceipt(input: unknown): GateReceiptVerification {
  if (!isGateReceipt(input)) return { ok: false, status: 400, error: "Invalid gate receipt shape" };
  const signed = stableJson(input.payload);
  let valid = false;
  try {
    valid = verify(null, Buffer.from(signed), input.publicKey, Buffer.from(input.signature, "base64"));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, status: 400, error: "Invalid gate receipt signature" };
  return {
    ok: true,
    receipt_hash: createHash("sha256").update(stableJson(input)).digest("hex"),
    harness: input.payload.harness,
    version: input.payload.version,
    verdict: input.payload.verdict,
    resultsHash: input.payload.resultsHash,
    at: input.payload.at
  };
}

function isGateReceipt(value: unknown): value is GateReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<GateReceipt>;
  if (receipt.type !== "onlyharness.gate_receipt.v1" || receipt.algorithm !== "ed25519") return false;
  if (typeof receipt.publicKey !== "string" || typeof receipt.signature !== "string") return false;
  const payload = receipt.payload;
  if (!payload || typeof payload !== "object") return false;
  if (typeof payload.harness !== "string" || !payload.harness.includes("/")) return false;
  if (typeof payload.version !== "string" || !payload.version) return false;
  if (!/^[a-f0-9]{64}$/i.test(payload.resultsHash)) return false;
  if (payload.verdict !== "passed" && payload.verdict !== "failed") return false;
  if (typeof payload.at !== "string" || Number.isNaN(Date.parse(payload.at))) return false;
  const gate = payload.gate;
  if (!gate || typeof gate !== "object") return false;
  if (!Number.isFinite(gate.score) || !Number.isFinite(gate.risk) || !Number.isFinite(gate.cost)) return false;
  return Array.isArray(gate.failures) && gate.failures.every((failure) => typeof failure === "string");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}
