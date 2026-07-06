import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { workspaceRoot } from "./registry.js";
import { readPurchaseReceipt, settleEscrowReceipt, type PurchaseReceipt } from "./payments.js";
import { verifyGateReceipt } from "./receipts.js";

export type BountyStatus = "open" | "claimed" | "delivered" | "paid";

export type BountyRecord = {
  id: string;
  title: string;
  spec: string;
  budget_usd: number;
  currency: string;
  status: BountyStatus;
  customer_user_id: string;
  claimant_user_id?: string | null;
  delivered_harness?: string | null;
  delivered_version?: string | null;
  delivery_receipt_hash?: string | null;
  accepted_receipt_hash?: string | null;
  payment_purchase_id?: string | null;
  escrow_provider_ref?: string | null;
  paid_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type BountyResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const localBountiesPath = path.resolve(process.env.HARNESS_LOCAL_BOUNTIES_PATH ?? path.join(workspaceRoot, "data/bounties.json"));

export async function listBounties(): Promise<BountyRecord[]> {
  return readLocalBountyState().bounties.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function createBounty(input: {
  title?: string;
  spec?: string;
  budgetUsd?: number;
  currency?: string;
  userId: string;
}): Promise<BountyResult<BountyRecord>> {
  const title = cleanTitle(input.title);
  if (!title) return { ok: false, status: 400, error: "title is required" };
  const spec = cleanSpec(input.spec);
  if (!spec) return { ok: false, status: 400, error: "spec must be at least 20 characters" };
  const budget = Number(input.budgetUsd);
  if (!Number.isFinite(budget) || budget <= 0) return { ok: false, status: 400, error: "budget_usd must be positive" };
  const currency = cleanCurrency(input.currency ?? "USD");
  if (!currency) return { ok: false, status: 400, error: "currency must be a 3-letter code" };

  const now = new Date().toISOString();
  const bounty: BountyRecord = {
    id: `bounty_${crypto.randomUUID()}`,
    title,
    spec,
    budget_usd: roundMoney(budget),
    currency,
    status: "open",
    customer_user_id: input.userId,
    claimant_user_id: null,
    delivered_harness: null,
    delivered_version: null,
    delivery_receipt_hash: null,
    accepted_receipt_hash: null,
    payment_purchase_id: null,
    escrow_provider_ref: null,
    paid_at: null,
    created_at: now,
    updated_at: now
  };
  const state = readLocalBountyState();
  state.bounties.push(bounty);
  writeLocalBountyState(state);
  return { ok: true, value: bounty };
}

export async function claimBounty(input: { id: string; userId: string }): Promise<BountyResult<BountyRecord>> {
  const state = readLocalBountyState();
  const bounty = state.bounties.find((row) => row.id === input.id);
  if (!bounty) return { ok: false, status: 404, error: "Bounty not found" };
  if (bounty.status === "claimed" && bounty.claimant_user_id === input.userId) return { ok: true, value: bounty };
  if (bounty.status !== "open") return { ok: false, status: 409, error: `Bounty is ${bounty.status}, not open` };
  if (bounty.customer_user_id === input.userId) return { ok: false, status: 400, error: "Customer cannot claim own bounty" };
  bounty.status = "claimed";
  bounty.claimant_user_id = input.userId;
  bounty.updated_at = new Date().toISOString();
  writeLocalBountyState(state);
  return { ok: true, value: bounty };
}

export async function deliverBounty(input: {
  id: string;
  userId: string;
  harness?: string;
  version?: string;
  receipt: unknown;
}): Promise<BountyResult<BountyRecord>> {
  const state = readLocalBountyState();
  const bounty = state.bounties.find((row) => row.id === input.id);
  if (!bounty) return { ok: false, status: 404, error: "Bounty not found" };
  if (bounty.status === "delivered" && bounty.claimant_user_id === input.userId) return { ok: true, value: bounty };
  if (bounty.status !== "claimed") return { ok: false, status: 409, error: `Bounty is ${bounty.status}, not claimed` };
  if (bounty.claimant_user_id !== input.userId) return { ok: false, status: 403, error: "Only the claimant can deliver this bounty" };
  const verified = verifyGateReceipt(input.receipt);
  if (!verified.ok) return { ok: false, status: verified.status, error: verified.error };
  if (verified.verdict !== "passed") return { ok: false, status: 400, error: "Delivery receipt must pass gate" };
  if (input.harness && input.harness !== verified.harness) return { ok: false, status: 400, error: "Delivery harness does not match receipt" };
  if (input.version && input.version !== verified.version) return { ok: false, status: 400, error: "Delivery version does not match receipt" };

  bounty.status = "delivered";
  bounty.delivered_harness = verified.harness;
  bounty.delivered_version = verified.version;
  bounty.delivery_receipt_hash = verified.receipt_hash;
  bounty.updated_at = new Date().toISOString();
  writeLocalBountyState(state);
  return { ok: true, value: bounty };
}

export async function acceptBounty(input: {
  id: string;
  userId: string;
  providerRef?: string;
  receipt: unknown;
}): Promise<BountyResult<BountyRecord>> {
  const state = readLocalBountyState();
  const bounty = state.bounties.find((row) => row.id === input.id);
  if (!bounty) return { ok: false, status: 404, error: "Bounty not found" };
  if (bounty.status === "paid") {
    if (bounty.customer_user_id !== input.userId) return { ok: false, status: 403, error: "Only the customer can accept this bounty" };
    return { ok: true, value: bounty };
  }
  if (bounty.status !== "delivered") return { ok: false, status: 409, error: `Bounty is ${bounty.status}, not delivered` };
  if (bounty.customer_user_id !== input.userId) return { ok: false, status: 403, error: "Only the customer can accept this bounty" };
  const providerRef = input.providerRef?.trim();
  if (!providerRef) return { ok: false, status: 400, error: "provider_ref is required" };
  const verified = verifyGateReceipt(input.receipt);
  if (!verified.ok) return { ok: false, status: verified.status, error: verified.error };
  if (verified.verdict !== "passed") return { ok: false, status: 400, error: "Acceptance receipt must pass gate" };
  if (verified.receipt_hash !== bounty.delivery_receipt_hash) return { ok: false, status: 400, error: "Acceptance receipt does not match delivered receipt" };
  if (verified.harness !== bounty.delivered_harness || verified.version !== bounty.delivered_version) {
    return { ok: false, status: 400, error: "Acceptance receipt target does not match delivery" };
  }

  const payment = await readPurchaseReceipt({ providerRef, userId: input.userId });
  if ("error" in payment) return { ok: false, status: payment.status, error: payment.error };
  const paymentError = validateAcceptancePayment(bounty, payment, providerRef, verified.receipt_hash);
  if (paymentError) return paymentError;
  const linkedBounty = state.bounties.find((row) =>
    row.id !== bounty.id
    && ((row.payment_purchase_id && row.payment_purchase_id === payment.purchase_id)
      || (row.escrow_provider_ref && row.escrow_provider_ref === providerRef))
  );
  if (linkedBounty) return { ok: false, status: 409, error: "Escrow purchase is already linked to another bounty" };

  const settlement = await settleEscrowReceipt({
    providerRef,
    userId: input.userId,
    receipt: input.receipt
  });
  if (!settlement.ok) return { ok: false, status: settlement.status, error: settlement.error };
  if (settlement.status !== "captured" && settlement.status !== "already_captured") {
    return { ok: false, status: 409, error: `Escrow settlement is ${settlement.status}, not captured` };
  }
  if (settlement.purchase_id !== payment.purchase_id) return { ok: false, status: 409, error: "Escrow settlement purchase changed during acceptance" };
  if (settlement.receipt_hash && settlement.receipt_hash !== verified.receipt_hash) {
    return { ok: false, status: 409, error: "Escrow settlement receipt does not match bounty delivery" };
  }

  bounty.status = "paid";
  bounty.accepted_receipt_hash = verified.receipt_hash;
  bounty.payment_purchase_id = settlement.purchase_id;
  bounty.escrow_provider_ref = providerRef;
  bounty.paid_at = new Date().toISOString();
  bounty.updated_at = bounty.paid_at;
  writeLocalBountyState(state);
  return { ok: true, value: bounty };
}

function readLocalBountyState(): { bounties: BountyRecord[] } {
  if (!existsSync(localBountiesPath)) return { bounties: [] };
  try {
    const parsed = JSON.parse(readFileSync(localBountiesPath, "utf8")) as { bounties?: BountyRecord[] };
    return { bounties: Array.isArray(parsed.bounties) ? parsed.bounties : [] };
  } catch {
    return { bounties: [] };
  }
}

function writeLocalBountyState(state: { bounties: BountyRecord[] }) {
  mkdirSync(path.dirname(localBountiesPath), { recursive: true });
  writeFileSync(localBountiesPath, `${JSON.stringify(state, null, 2)}\n`);
}

function validateAcceptancePayment(
  bounty: BountyRecord,
  payment: PurchaseReceipt,
  providerRef: string,
  receiptHash: string
): BountyResult<never> | undefined {
  if (payment.provider_ref !== providerRef) return { ok: false, status: 409, error: "Payment provider_ref changed during acceptance" };
  if (payment.pricing_model !== "gate_escrow") return { ok: false, status: 400, error: "Bounty acceptance requires a gate_escrow purchase" };
  if (payment.status !== "reserved" && payment.status !== "captured") {
    return { ok: false, status: 409, error: `Escrow purchase is ${payment.status}, not reserved or captured` };
  }
  if (`${payment.owner}/${payment.repo}` !== bounty.delivered_harness || payment.version !== bounty.delivered_version) {
    return { ok: false, status: 400, error: "Escrow purchase target does not match delivered bounty" };
  }
  if (roundMoney(payment.amount_usd) !== bounty.budget_usd || payment.currency.toUpperCase() !== bounty.currency) {
    return { ok: false, status: 400, error: "Escrow purchase amount or currency does not match bounty budget" };
  }
  if (payment.status === "captured" && payment.escrow?.receipt_hash !== receiptHash) {
    return { ok: false, status: 409, error: "Captured escrow receipt does not match bounty delivery" };
  }
  return undefined;
}

function cleanTitle(value: string | undefined): string | undefined {
  const title = value?.trim();
  if (!title || title.length < 4 || title.length > 120) return undefined;
  return title;
}

function cleanSpec(value: string | undefined): string | undefined {
  const spec = value?.trim();
  if (!spec || spec.length < 20 || spec.length > 20_000) return undefined;
  return spec;
}

function cleanCurrency(value: string): string | undefined {
  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : undefined;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
