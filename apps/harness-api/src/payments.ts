import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { HarnessManifest } from "@harnesshub/schema";
import { verifyGateReceipt, type GateReceipt } from "./receipts.js";

const ESCROW_WINDOW_MS = 72 * 60 * 60 * 1000;

type PricingModel = HarnessManifest["pricing"]["model"];
type PurchaseStatus = "pending" | "paid" | "reserved" | "captured" | "refunded" | "failed";
type EntitlementKind = "one_time" | "subscription" | "escrow_reserved";
type CheckoutProviderId = "manual";
type PurchaseProviderId = CheckoutProviderId | "x402";

export type PaymentAccessInput = {
  owner: string;
  repo: string;
  version: string;
  manifest: HarnessManifest;
  authorization?: string;
  userId?: string;
};

export type EntitlementSubject = {
  type: "user" | "wallet" | "org";
  id: string;
};

export type EntitlementCheckInput = {
  owner: string;
  repo: string;
  version: string;
  manifest: HarnessManifest;
  subject: EntitlementSubject;
};

export type EntitlementCheckResult = {
  entitled: boolean;
  status: "free" | "entitled" | "payment_required";
};

export type PaymentAccessResult =
  | { allowed: true }
  | { allowed: false; status: 402; body: PaymentRequiredBody }
  | { allowed: false; status: 409; body: HostedExecutionUnavailableBody };

export type PaymentRequiredBody = {
  error: "Payment required";
  code: "PAYMENT_REQUIRED";
  owner: string;
  repo: string;
  version: string;
  pricing: HarnessManifest["pricing"];
  provider: "manual";
  checkout_url: string;
  payments_enabled: boolean;
  x402: {
    enabled: boolean;
    requirements: X402PaymentRequirements[];
    paymentRequired: X402PaymentRequired | null;
  };
  next: string;
};

export type HostedExecutionUnavailableBody = {
  error: "Hosted execution not available";
  code: "HOSTED_EXECUTION_NOT_AVAILABLE";
  owner: string;
  repo: string;
  version: string;
  pricing: HarnessManifest["pricing"];
  next: string;
};

export type X402PaymentRequirements = {
  scheme: "exact";
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: {
    name: string;
    version: string;
  };
};

export type X402PaymentRequired = {
  x402Version: 2;
  error: "Payment required";
  resource: {
    url: string;
    description: string;
    mimeType: "application/json";
  };
  accepts: X402PaymentRequirements[];
};

export type EntitlementRow = {
  version?: string | null;
  expires_at?: string | null;
  kind?: EntitlementKind;
};

export type CheckoutInput = {
  owner: string;
  repo: string;
  version: string;
  manifest: HarnessManifest;
  userId: string;
  referralCode?: string;
  creatorUserId?: string;
};

export type CheckoutSession = {
  provider: CheckoutProviderId;
  provider_ref: string;
  checkout_url: string;
  status: "pending";
  owner: string;
  repo: string;
  version: string;
  pricing: HarnessManifest["pricing"];
  next: string;
};

type PaymentProviderCheckoutInput = CheckoutInput & {
  amountUsd: number;
  currency: string;
};

type PaymentProviderCheckoutSession = Pick<CheckoutSession, "provider" | "provider_ref" | "checkout_url" | "status" | "next">;

type PaymentProvider = {
  id: CheckoutProviderId;
  createCheckoutSession(input: PaymentProviderCheckoutInput): PaymentProviderCheckoutSession;
  settleWebhook(input: { providerRef: string; status?: string }): Promise<PaymentWebhookResult>;
};

export type PaymentWebhookInput = {
  provider?: string;
  provider_ref?: string;
  status?: string;
};

export type X402SettlementInput = {
  owner: string;
  repo: string;
  version: string;
  manifest: HarnessManifest;
  payer: string;
  transaction: string;
  network: string;
  amount?: string;
};

export type PaymentWebhookResult =
  | { ok: true; status: "paid" | "already_paid" | "reserved" | "already_reserved" | "already_captured" | "already_refunded"; owner: string; repo: string; version: string; subject_id: string; purchase_id?: string; escrow_expires_at?: string | null }
  | { ok: false; status: number; error: string };

export type EscrowSettlementResult =
  | {
    ok: true;
    status: "captured" | "refunded" | "already_captured" | "already_refunded";
    owner: string;
    repo: string;
    version: string;
    subject_id: string;
    purchase_id: string;
    receipt_hash?: string;
    escrow_expires_at?: string | null;
    reason: "receipt_passed" | "receipt_failed" | "timeout";
  }
  | { ok: false; status: number; error: string; escrow_expires_at?: string | null };

export type PurchaseReceipt = {
  receipt_id: string;
  purchase_id: string;
  provider: PurchaseProviderId;
  provider_ref: string;
  status: PurchaseStatus;
  owner: string;
  repo: string;
  version: string;
  pricing_model?: PricingModel;
  amount_usd: number;
  currency: string;
  subject: {
    type: "user" | "wallet" | "org";
    id: string;
  };
  created_at: string;
  updated_at: string;
  entitlement: {
    granted: boolean;
    kind?: EntitlementKind;
    expires_at?: string | null;
  };
  escrow?: {
    expires_at?: string | null;
    receipt_hash?: string | null;
    captured_at?: string | null;
    refunded_at?: string | null;
  };
};

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseRestKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const checkoutBaseUrl = process.env.HARNESS_CHECKOUT_BASE_URL ?? "https://onlyharness.com/checkout";
const localPaymentStorePath = process.env.HARNESS_LOCAL_PAYMENTS_PATH ? path.resolve(process.env.HARNESS_LOCAL_PAYMENTS_PATH) : undefined;

export async function requireArchivePaymentAccess(input: PaymentAccessInput): Promise<PaymentAccessResult> {
  if (input.manifest.pricing.model === "free") return { allowed: true };
  if (input.manifest.pricing.model === "per_call") {
    return {
      allowed: false,
      status: 409,
      body: hostedExecutionUnavailableBody(input)
    };
  }
  if (await hasEntitlement(input)) return { allowed: true };
  const enabled = paymentsEnabled();
  const x402PaymentRequired = enabled ? buildX402PaymentRequired(input) : undefined;

  return {
    allowed: false,
    status: 402,
    body: {
      error: "Payment required",
      code: "PAYMENT_REQUIRED",
      owner: input.owner,
      repo: input.repo,
      version: input.version,
      pricing: input.manifest.pricing,
      provider: "manual",
      checkout_url: checkoutUrl(input),
      payments_enabled: enabled,
      x402: {
        enabled: Boolean(x402PaymentRequired),
        requirements: x402PaymentRequired?.accepts ?? [],
        paymentRequired: x402PaymentRequired ?? null
      },
      next: enabled
        ? "Complete checkout, get a manual entitlement, or retry hh install --pay with HH_WALLET_KEY."
        : "Payments are disabled in this environment; no checkout can be created."
    }
  };
}

export function x402PaymentRequiredHeader(body: PaymentRequiredBody): string | undefined {
  if (!body.x402.paymentRequired) return undefined;
  return Buffer.from(JSON.stringify(body.x402.paymentRequired), "utf8").toString("base64");
}

export function hostedExecutionUnavailableBody(input: PaymentAccessInput): HostedExecutionUnavailableBody {
  return {
    error: "Hosted execution not available",
    code: "HOSTED_EXECUTION_NOT_AVAILABLE",
    owner: input.owner,
    repo: input.repo,
    version: input.version,
    pricing: input.manifest.pricing,
    next: "Use hh pull/install only for file-based harnesses. Hosted per-call execution is not live yet."
  };
}

export async function checkEntitlement(input: EntitlementCheckInput): Promise<EntitlementCheckResult> {
  if (input.manifest.pricing.model === "free") return { entitled: true, status: "free" };
  if (await hasSubjectEntitlement(input)) return { entitled: true, status: "entitled" };
  return { entitled: false, status: "payment_required" };
}

async function hasEntitlement(input: PaymentAccessInput): Promise<boolean> {
  return hasManualEntitlement(input) || await hasLocalEntitlement(input) || await hasSupabaseEntitlement(input);
}

async function hasSubjectEntitlement(input: EntitlementCheckInput): Promise<boolean> {
  return await hasLocalSubjectEntitlement(input) || await hasSupabaseSubjectEntitlement(input);
}

function hasManualEntitlement(input: PaymentAccessInput): boolean {
  const token = bearerToken(input.authorization);
  if (!token) return false;
  const scope = `${input.owner}/${input.repo}`;
  const versionedScope = `${scope}@${input.version}`;
  for (const entry of (process.env.HARNESS_MANUAL_ENTITLEMENTS ?? "").split(",")) {
    const [entryToken, entryScope] = entry.split("=").map((part) => part.trim());
    if (!entryToken || !entryScope || entryToken !== token) continue;
    if (entryScope === scope || entryScope === versionedScope) return true;
  }
  return false;
}

async function hasSupabaseEntitlement(input: PaymentAccessInput): Promise<boolean> {
  if (!supabaseUrl || !supabaseRestKey || !input.userId || !isUuid(input.userId)) return false;
  const canonical = await fetchCanonicalEntitlements(input);
  if (canonical !== undefined) return entitlementRowsAllow(canonical, input.version);
  const legacy = await fetchLegacyEntitlements(input);
  return entitlementRowsAllow(legacy ?? [], input.version);
}

async function hasSupabaseSubjectEntitlement(input: EntitlementCheckInput): Promise<boolean> {
  if (!supabaseUrl || !supabaseRestKey) return false;
  const canonical = await fetchCanonicalEntitlementsForSubject(input);
  if (canonical !== undefined) return entitlementRowsAllow(settledEntitlements(canonical), input.version);
  if (input.subject.type !== "user" || !isUuid(input.subject.id)) return false;
  const legacy = await fetchLegacyEntitlementsForSubject(input);
  return entitlementRowsAllow(legacy ?? [], input.version);
}

export function entitlementRowsAllow(rows: EntitlementRow[], version: string, now = Date.now()): boolean {
  return rows.some((row) => {
    if (row.version && row.version !== version) return false;
    if (row.expires_at && Date.parse(row.expires_at) <= now) return false;
    return true;
  });
}

function settledEntitlements(rows: EntitlementRow[]): EntitlementRow[] {
  return rows.filter((row) => row.kind !== "escrow_reserved");
}

export async function createCheckoutSession(input: CheckoutInput): Promise<CheckoutSession | { error: string; status: number }> {
  if (input.manifest.pricing.model === "free") return { status: 400, error: "Free harnesses do not need checkout" };
  if (input.manifest.pricing.model === "per_call") {
    return { status: 409, error: "Hosted execution is not available for per_call pricing" };
  }
  const amount = input.manifest.pricing.amount_usd ?? 0;
  if (!Number.isFinite(amount) || amount <= 0) return { status: 400, error: "Paid harness is missing a positive amount_usd" };
  if (!paymentsEnabled()) return { status: 503, error: "Payments are disabled in this environment" };
  const provider = configuredPaymentProvider();
  if (!provider) return { status: 503, error: unsupportedPaymentProviderError(configuredPaymentProviderId()) };
  const currency = input.manifest.pricing.currency ?? "USD";
  const providerSession = provider.createCheckoutSession({ ...input, amountUsd: amount, currency });
  const purchase = {
    id: crypto.randomUUID(),
    subject_type: "user",
    subject_id: input.userId,
    owner: input.owner,
    repo: input.repo,
    version: input.version,
    amount_usd: amount,
    currency,
    provider: providerSession.provider,
    provider_ref: providerSession.provider_ref,
    referral_code: input.referralCode,
    creator_user_id: input.creatorUserId ?? null,
    pricing_model: input.manifest.pricing.model,
    status: "pending",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  } satisfies StoredPurchase;
  const persisted = await persistPendingPurchase(purchase);
  if ("error" in persisted) return persisted;
  return {
    ...providerSession,
    owner: input.owner,
    repo: input.repo,
    version: input.version,
    pricing: input.manifest.pricing
  };
}

export async function settlePaymentWebhook(input: PaymentWebhookInput): Promise<PaymentWebhookResult> {
  const provider = paymentProviderFor(input.provider ?? "manual");
  if (!provider) return { ok: false, status: 400, error: unsupportedPaymentProviderError(input.provider ?? "manual") };
  if (!input.provider_ref) return { ok: false, status: 400, error: "provider_ref is required" };
  return provider.settleWebhook({ providerRef: input.provider_ref, status: input.status });
}

export async function settleX402Purchase(input: X402SettlementInput): Promise<PaymentWebhookResult> {
  const payer = input.payer.trim().toLowerCase();
  const transaction = input.transaction.trim();
  if (!payer) return { ok: false, status: 400, error: "payer is required" };
  if (!transaction) return { ok: false, status: 400, error: "transaction is required" };
  if (!paymentsEnabled()) return { ok: false, status: 503, error: "Payments are disabled in this environment" };
  const amount = input.manifest.pricing.amount_usd ?? 0;
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, status: 400, error: "Paid harness is missing a positive amount_usd" };
  const purchase = {
    id: crypto.randomUUID(),
    subject_type: "wallet",
    subject_id: payer,
    owner: input.owner,
    repo: input.repo,
    version: input.version,
    amount_usd: amount,
    currency: input.manifest.pricing.currency ?? "USD",
    provider: "x402",
    provider_ref: x402ProviderRef(input.network, transaction),
    referral_code: undefined,
    creator_user_id: null,
    pricing_model: input.manifest.pricing.model,
    status: input.manifest.pricing.model === "gate_escrow" ? "reserved" : "paid",
    escrow_expires_at: input.manifest.pricing.model === "gate_escrow" ? escrowExpiresAt() : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  } satisfies StoredPurchase;
  if (supabaseUrl && supabaseRestKey) return settleSupabaseX402Purchase(purchase);
  return settleLocalX402Purchase(purchase);
}

export async function readPurchaseReceipt(input: { providerRef: string; userId: string }): Promise<PurchaseReceipt | { status: number; error: string }> {
  const providerRef = input.providerRef.trim();
  if (!providerRef) return { status: 400, error: "provider_ref is required" };
  if (supabaseUrl && supabaseRestKey) return readSupabasePurchaseReceipt(providerRef, input.userId);
  if (!localPaymentStorePath) return { status: 503, error: "Payment store unavailable" };
  const state = readLocalPaymentState();
  const purchase = state.purchases.find((row) => row.provider_ref === providerRef && row.subject_type === "user" && row.subject_id === input.userId);
  if (!purchase) return { status: 404, error: "Purchase receipt not found" };
  const entitlement = state.entitlements.find((row) => row.purchase_id === purchase.id || sameEntitlement(row, purchase));
  return receiptFromPurchase(purchase, entitlement);
}

export async function settleEscrowReceipt(input: { providerRef: string; userId: string; receipt: unknown; nowMs?: number }): Promise<EscrowSettlementResult> {
  const providerRef = input.providerRef.trim();
  if (!providerRef) return { ok: false, status: 400, error: "provider_ref is required" };
  const verified = verifyGateReceipt(input.receipt);
  if (!verified.ok) return { ok: false, status: verified.status, error: verified.error };
  const receipt = input.receipt as GateReceipt;
  if (supabaseUrl && supabaseRestKey) return settleSupabaseEscrowReceipt({ providerRef, userId: input.userId, receipt, verified, nowMs: input.nowMs });
  if (!localPaymentStorePath) return { ok: false, status: 503, error: "Payment store unavailable" };
  const state = readLocalPaymentState();
  const purchase = state.purchases.find((row) => row.provider_ref === providerRef && row.subject_type === "user" && row.subject_id === input.userId);
  if (!purchase) return { ok: false, status: 404, error: "Escrow purchase not found" };
  const result = applyEscrowReceipt(state, purchase, receipt, verified, input.nowMs);
  writeLocalPaymentState(state);
  return result;
}

export async function timeoutEscrowPurchase(input: { providerRef: string; userId: string; nowMs?: number }): Promise<EscrowSettlementResult> {
  const providerRef = input.providerRef.trim();
  if (!providerRef) return { ok: false, status: 400, error: "provider_ref is required" };
  if (supabaseUrl && supabaseRestKey) return timeoutSupabaseEscrowPurchase({ providerRef, userId: input.userId, nowMs: input.nowMs });
  if (!localPaymentStorePath) return { ok: false, status: 503, error: "Payment store unavailable" };
  const state = readLocalPaymentState();
  const purchase = state.purchases.find((row) => row.provider_ref === providerRef && row.subject_type === "user" && row.subject_id === input.userId);
  if (!purchase) return { ok: false, status: 404, error: "Escrow purchase not found" };
  const result = applyEscrowTimeout(state, purchase, input.nowMs);
  writeLocalPaymentState(state);
  return result;
}

async function fetchCanonicalEntitlements(input: PaymentAccessInput): Promise<EntitlementRow[] | undefined> {
  const params = new URLSearchParams({
    select: "version,expires_at",
    subject_type: "eq.user",
    subject_id: `eq.${input.userId}`,
    owner: `eq.${input.owner}`,
    repo: `eq.${input.repo}`,
    limit: "20"
  });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/entitlements?${params.toString()}`, {
      headers: supabaseRestHeaders()
    });
    if (!response.ok) return undefined;
    return await response.json() as EntitlementRow[];
  } catch {
    return undefined;
  }
}

async function fetchCanonicalEntitlementsForSubject(input: EntitlementCheckInput): Promise<EntitlementRow[] | undefined> {
  const params = new URLSearchParams({
    select: "version,expires_at,kind",
    subject_type: `eq.${input.subject.type}`,
    subject_id: `eq.${input.subject.id}`,
    owner: `eq.${input.owner}`,
    repo: `eq.${input.repo}`,
    limit: "20"
  });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/entitlements?${params.toString()}`, {
      headers: supabaseRestHeaders()
    });
    if (!response.ok) return undefined;
    return await response.json() as EntitlementRow[];
  } catch {
    return undefined;
  }
}

async function fetchLegacyEntitlements(input: PaymentAccessInput): Promise<EntitlementRow[] | undefined> {
  const params = new URLSearchParams({
    select: "version,expires_at",
    user_id: `eq.${input.userId}`,
    owner: `eq.${input.owner}`,
    repo: `eq.${input.repo}`,
    limit: "20"
  });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/harness_entitlements?${params.toString()}`, {
      headers: supabaseRestHeaders()
    });
    if (!response.ok) return undefined;
    return await response.json() as EntitlementRow[];
  } catch {
    return undefined;
  }
}

async function fetchLegacyEntitlementsForSubject(input: EntitlementCheckInput): Promise<EntitlementRow[] | undefined> {
  const params = new URLSearchParams({
    select: "version,expires_at",
    user_id: `eq.${input.subject.id}`,
    owner: `eq.${input.owner}`,
    repo: `eq.${input.repo}`,
    limit: "20"
  });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/harness_entitlements?${params.toString()}`, {
      headers: supabaseRestHeaders()
    });
    if (!response.ok) return undefined;
    return await response.json() as EntitlementRow[];
  } catch {
    return undefined;
  }
}

function checkoutUrl(input: PaymentAccessInput): string {
  let url: URL;
  try {
    url = new URL(checkoutBaseUrl);
  } catch {
    url = new URL("https://onlyharness.com/checkout");
  }
  url.searchParams.set("owner", input.owner);
  url.searchParams.set("repo", input.repo);
  url.searchParams.set("version", input.version);
  return url.toString();
}

async function persistPendingPurchase(purchase: StoredPurchase): Promise<{ ok: true } | { error: string; status: number }> {
  if (supabaseUrl && supabaseRestKey) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/purchases`, {
        method: "POST",
        headers: {
          ...supabaseRestHeaders(),
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify(purchase)
      });
      if (response.ok) return { ok: true };
      return { status: 502, error: `Purchase insert failed: HTTP ${response.status}` };
    } catch {
      return { status: 503, error: "Payment store unavailable" };
    }
  }
  if (!localPaymentStorePath) return { status: 503, error: "Payment store unavailable" };
  const state = readLocalPaymentState();
  state.purchases.push(purchase);
  writeLocalPaymentState(state);
  return { ok: true };
}

async function settlePurchase(provider: CheckoutProviderId, providerRef: string): Promise<PaymentWebhookResult> {
  if (supabaseUrl && supabaseRestKey) return settleSupabasePurchase(provider, providerRef);
  if (!localPaymentStorePath) return { ok: false, status: 503, error: "Payment store unavailable" };
  const state = readLocalPaymentState();
  const purchase = state.purchases.find((row) => row.provider === provider && row.provider_ref === providerRef);
  if (!purchase) return { ok: false, status: 404, error: "Purchase not found" };
  if (purchase.pricing_model === "gate_escrow") {
    const result = reserveLocalEscrowPurchase(state, purchase);
    writeLocalPaymentState(state);
    return result;
  }
  const alreadyPaid = purchase.status === "paid";
  purchase.status = "paid";
  purchase.updated_at = new Date().toISOString();
  if (!state.entitlements.some((row) => sameEntitlement(row, purchase))) {
    state.entitlements.push(entitlementFromPurchase(purchase));
  }
  writeLocalPaymentState(state);
  return {
    ok: true,
    status: alreadyPaid ? "already_paid" : "paid",
    owner: purchase.owner,
    repo: purchase.repo,
    version: purchase.version,
    subject_id: purchase.subject_id,
    purchase_id: purchase.id
  };
}

async function settleSupabasePurchase(provider: CheckoutProviderId, providerRef: string): Promise<PaymentWebhookResult> {
  const params = new URLSearchParams({
    select: storedPurchaseSelect(),
    provider: `eq.${provider}`,
    provider_ref: `eq.${providerRef}`,
    limit: "1"
  });
  try {
    const purchaseResponse = await fetch(`${supabaseUrl}/rest/v1/purchases?${params.toString()}`, {
      headers: supabaseRestHeaders()
    });
    if (!purchaseResponse.ok) return { ok: false, status: 502, error: `Purchase lookup failed: HTTP ${purchaseResponse.status}` };
    const purchases = await purchaseResponse.json() as StoredPurchase[];
    const purchase = purchases[0];
    if (!purchase) return { ok: false, status: 404, error: "Purchase not found" };
    if (purchase.pricing_model === "gate_escrow") return reserveSupabaseEscrowPurchase(purchase);
    const alreadyPaid = purchase.status === "paid";
    if (!alreadyPaid) {
      const updateResponse = await fetch(`${supabaseUrl}/rest/v1/purchases?id=eq.${purchase.id}`, {
        method: "PATCH",
        headers: {
          ...supabaseRestHeaders(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status: "paid", updated_at: new Date().toISOString() })
      });
      if (!updateResponse.ok) return { ok: false, status: 502, error: `Purchase update failed: HTTP ${updateResponse.status}` };
    }
    const entitlement = entitlementFromPurchase(purchase);
    const entitlementResponse = await fetch(`${supabaseUrl}/rest/v1/entitlements`, {
      method: "POST",
      headers: {
        ...supabaseRestHeaders(),
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal"
      },
      body: JSON.stringify(entitlement)
    });
    if (!entitlementResponse.ok && entitlementResponse.status !== 409) {
      return { ok: false, status: 502, error: `Entitlement insert failed: HTTP ${entitlementResponse.status}` };
    }
    return {
      ok: true,
      status: alreadyPaid ? "already_paid" : "paid",
      owner: purchase.owner,
      repo: purchase.repo,
      version: purchase.version,
      subject_id: purchase.subject_id,
      purchase_id: purchase.id
    };
  } catch {
    return { ok: false, status: 503, error: "Payment store unavailable" };
  }
}

function reserveLocalEscrowPurchase(state: LocalPaymentState, purchase: StoredPurchase): PaymentWebhookResult {
  const final = alreadyFinalWebhookResult(purchase);
  if (final) return final;
  const alreadyReserved = purchase.status === "reserved";
  if (!purchase.escrow_expires_at) purchase.escrow_expires_at = escrowExpiresAt();
  purchase.status = "reserved";
  purchase.updated_at = new Date().toISOString();
  if (!state.entitlements.some((row) => sameEntitlement(row, purchase))) {
    state.entitlements.push(entitlementFromPurchase(purchase));
  }
  return {
    ok: true,
    status: alreadyReserved ? "already_reserved" : "reserved",
    owner: purchase.owner,
    repo: purchase.repo,
    version: purchase.version,
    subject_id: purchase.subject_id,
    purchase_id: purchase.id,
    escrow_expires_at: purchase.escrow_expires_at ?? null
  };
}

async function reserveSupabaseEscrowPurchase(purchase: StoredPurchase): Promise<PaymentWebhookResult> {
  const final = alreadyFinalWebhookResult(purchase);
  if (final) return final;
  const alreadyReserved = purchase.status === "reserved";
  const expiresAt = purchase.escrow_expires_at ?? escrowExpiresAt();
  if (!alreadyReserved || !purchase.escrow_expires_at) {
    const update = await updateSupabasePurchase(purchase.id, {
      status: "reserved",
      escrow_expires_at: expiresAt,
      updated_at: new Date().toISOString()
    });
    if (!update.ok) return update;
  }
  const entitlement = entitlementFromPurchase({ ...purchase, status: "reserved", escrow_expires_at: expiresAt });
  const inserted = await insertSupabaseEntitlement(entitlement);
  if (!inserted.ok) return inserted;
  return {
    ok: true,
    status: alreadyReserved ? "already_reserved" : "reserved",
    owner: purchase.owner,
    repo: purchase.repo,
    version: purchase.version,
    subject_id: purchase.subject_id,
    purchase_id: purchase.id,
    escrow_expires_at: expiresAt
  };
}

function applyEscrowReceipt(
  state: LocalPaymentState,
  purchase: StoredPurchase,
  receipt: GateReceipt,
  verified: Extract<ReturnType<typeof verifyGateReceipt>, { ok: true }>,
  nowMs = Date.now()
): EscrowSettlementResult {
  const precheck = validateEscrowSettlement(purchase, verified, nowMs);
  if (precheck) return precheck;
  if (receipt.payload.verdict === "passed") return captureLocalEscrow(state, purchase, verified.receipt_hash);
  return refundLocalEscrow(state, purchase, verified.receipt_hash, "receipt_failed");
}

function applyEscrowTimeout(state: LocalPaymentState, purchase: StoredPurchase, nowMs = Date.now()): EscrowSettlementResult {
  const precheck = validateEscrowPurchase(purchase);
  if (precheck) return precheck;
  if (purchase.status !== "reserved") return { ok: false, status: 409, error: `Escrow purchase is ${purchase.status}, not reserved` };
  if (!escrowExpired(purchase, nowMs)) {
    return { ok: false, status: 409, error: "Escrow reservation has not expired", escrow_expires_at: purchase.escrow_expires_at ?? null };
  }
  return refundLocalEscrow(state, purchase, undefined, "timeout");
}

async function settleSupabaseEscrowReceipt(input: {
  providerRef: string;
  userId: string;
  receipt: GateReceipt;
  verified: Extract<ReturnType<typeof verifyGateReceipt>, { ok: true }>;
  nowMs?: number;
}): Promise<EscrowSettlementResult> {
  const purchase = await fetchSupabaseUserPurchase(input.providerRef, input.userId);
  if (purchase === undefined) return { ok: false, status: 502, error: "Escrow purchase lookup failed" };
  if (!purchase) return { ok: false, status: 404, error: "Escrow purchase not found" };
  const precheck = validateEscrowSettlement(purchase, input.verified, input.nowMs ?? Date.now());
  if (precheck) return precheck;
  if (input.receipt.payload.verdict === "passed") return captureSupabaseEscrow(purchase, input.verified.receipt_hash);
  return refundSupabaseEscrow(purchase, input.verified.receipt_hash, "receipt_failed");
}

async function timeoutSupabaseEscrowPurchase(input: { providerRef: string; userId: string; nowMs?: number }): Promise<EscrowSettlementResult> {
  const purchase = await fetchSupabaseUserPurchase(input.providerRef, input.userId);
  if (purchase === undefined) return { ok: false, status: 502, error: "Escrow purchase lookup failed" };
  if (!purchase) return { ok: false, status: 404, error: "Escrow purchase not found" };
  const precheck = validateEscrowPurchase(purchase);
  if (precheck) return precheck;
  if (purchase.status !== "reserved") return { ok: false, status: 409, error: `Escrow purchase is ${purchase.status}, not reserved` };
  if (!escrowExpired(purchase, input.nowMs ?? Date.now())) {
    return { ok: false, status: 409, error: "Escrow reservation has not expired", escrow_expires_at: purchase.escrow_expires_at ?? null };
  }
  return refundSupabaseEscrow(purchase, undefined, "timeout");
}

function validateEscrowSettlement(purchase: StoredPurchase, verified: Extract<ReturnType<typeof verifyGateReceipt>, { ok: true }>, nowMs: number): EscrowSettlementResult | undefined {
  const precheck = validateEscrowPurchase(purchase);
  if (precheck) return precheck;
  if (purchase.status !== "reserved") return { ok: false, status: 409, error: `Escrow purchase is ${purchase.status}, not reserved` };
  if (escrowExpired(purchase, nowMs)) return { ok: false, status: 409, error: "Escrow reservation expired; use timeout settlement", escrow_expires_at: purchase.escrow_expires_at ?? null };
  if (verified.harness !== `${purchase.owner}/${purchase.repo}`) return { ok: false, status: 400, error: "Gate receipt harness does not match purchase" };
  if (verified.version !== purchase.version) return { ok: false, status: 400, error: "Gate receipt version does not match purchase" };
  return undefined;
}

function validateEscrowPurchase(purchase: StoredPurchase): EscrowSettlementResult | undefined {
  if (purchase.pricing_model !== "gate_escrow") return { ok: false, status: 400, error: "Purchase is not gate_escrow" };
  if (purchase.status === "captured") return finalEscrowResult(purchase, "already_captured", "receipt_passed");
  if (purchase.status === "refunded") return finalEscrowResult(purchase, "already_refunded", "receipt_failed");
  return undefined;
}

function captureLocalEscrow(state: LocalPaymentState, purchase: StoredPurchase, receiptHash: string): EscrowSettlementResult {
  purchase.status = "captured";
  purchase.receipt_hash = receiptHash;
  purchase.captured_at = new Date().toISOString();
  purchase.updated_at = purchase.captured_at;
  removeEscrowEntitlements(state, purchase);
  const entitlement = entitlementFromPurchase(purchase);
  if (!state.entitlements.some((row) => sameEntitlement(row, purchase))) state.entitlements.push(entitlement);
  return finalEscrowResult(purchase, "captured", "receipt_passed");
}

function refundLocalEscrow(state: LocalPaymentState, purchase: StoredPurchase, receiptHash: string | undefined, reason: "receipt_failed" | "timeout"): EscrowSettlementResult {
  purchase.status = "refunded";
  if (receiptHash) purchase.receipt_hash = receiptHash;
  purchase.refunded_at = new Date().toISOString();
  purchase.updated_at = purchase.refunded_at;
  removeEscrowEntitlements(state, purchase);
  return finalEscrowResult(purchase, "refunded", reason);
}

async function captureSupabaseEscrow(purchase: StoredPurchase, receiptHash: string): Promise<EscrowSettlementResult> {
  const capturedAt = new Date().toISOString();
  const update = await updateSupabasePurchase(purchase.id, {
    status: "captured",
    receipt_hash: receiptHash,
    captured_at: capturedAt,
    updated_at: capturedAt
  });
  if (!update.ok) return update;
  const deleted = await deleteSupabaseEscrowEntitlement(purchase);
  if (!deleted.ok) return deleted;
  const inserted = await insertSupabaseEntitlement(entitlementFromPurchase({ ...purchase, status: "captured", receipt_hash: receiptHash, captured_at: capturedAt }));
  if (!inserted.ok) return inserted;
  return finalEscrowResult({ ...purchase, status: "captured", receipt_hash: receiptHash, captured_at: capturedAt }, "captured", "receipt_passed");
}

async function refundSupabaseEscrow(purchase: StoredPurchase, receiptHash: string | undefined, reason: "receipt_failed" | "timeout"): Promise<EscrowSettlementResult> {
  const refundedAt = new Date().toISOString();
  const update = await updateSupabasePurchase(purchase.id, {
    status: "refunded",
    ...(receiptHash ? { receipt_hash: receiptHash } : {}),
    refunded_at: refundedAt,
    updated_at: refundedAt
  });
  if (!update.ok) return update;
  const deleted = await deleteSupabaseEscrowEntitlement(purchase);
  if (!deleted.ok) return deleted;
  return finalEscrowResult({ ...purchase, status: "refunded", receipt_hash: receiptHash ?? purchase.receipt_hash, refunded_at: refundedAt }, "refunded", reason);
}

async function settleSupabaseX402Purchase(purchase: StoredPurchase): Promise<PaymentWebhookResult> {
  const existing = await fetchSupabasePurchase("x402", purchase.provider_ref);
  if (existing === undefined) return { ok: false, status: 502, error: "Purchase lookup failed" };
  let purchaseForEntitlement = existing;
  const alreadyPersisted = Boolean(existing);
  if (!purchaseForEntitlement) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/purchases`, {
        method: "POST",
        headers: {
          ...supabaseRestHeaders(),
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify(purchase)
      });
      if (!response.ok && response.status !== 409) return { status: 502, ok: false, error: `x402 purchase insert failed: HTTP ${response.status}` };
      if (response.status === 409) {
        const confirmed = await fetchSupabasePurchase("x402", purchase.provider_ref);
        purchaseForEntitlement = confirmed ?? null;
      } else {
        purchaseForEntitlement = purchase;
      }
      if (!purchaseForEntitlement) return { ok: false, status: 502, error: "x402 purchase insert could not be confirmed" };
    } catch {
      return { ok: false, status: 503, error: "Payment store unavailable" };
    }
  }
  const entitlement = entitlementFromPurchase(purchaseForEntitlement);
  try {
    const entitlementResponse = await fetch(`${supabaseUrl}/rest/v1/entitlements`, {
      method: "POST",
      headers: {
        ...supabaseRestHeaders(),
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal"
      },
      body: JSON.stringify(entitlement)
    });
    if (!entitlementResponse.ok && entitlementResponse.status !== 409) {
      return { ok: false, status: 502, error: `x402 entitlement insert failed: HTTP ${entitlementResponse.status}` };
    }
  } catch {
    return { ok: false, status: 503, error: "Payment store unavailable" };
  }
  const status = paymentWebhookStatusForPurchase(purchaseForEntitlement, alreadyPersisted);
  return {
    ok: true,
    status,
    owner: purchaseForEntitlement.owner,
    repo: purchaseForEntitlement.repo,
    version: purchaseForEntitlement.version,
    subject_id: purchaseForEntitlement.subject_id,
    purchase_id: purchaseForEntitlement.id,
    escrow_expires_at: purchaseForEntitlement.escrow_expires_at ?? null
  };
}

async function fetchSupabasePurchase(provider: StoredPurchase["provider"], providerRef: string): Promise<StoredPurchase | null | undefined> {
  const params = new URLSearchParams({
    select: storedPurchaseSelect(),
    provider: `eq.${provider}`,
    provider_ref: `eq.${providerRef}`,
    limit: "1"
  });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/purchases?${params.toString()}`, {
      headers: supabaseRestHeaders()
    });
    if (!response.ok) return undefined;
    const purchases = await response.json() as StoredPurchase[];
    return purchases[0] ?? null;
  } catch {
    return undefined;
  }
}

async function readSupabasePurchaseReceipt(providerRef: string, userId: string): Promise<PurchaseReceipt | { status: number; error: string }> {
  if (!isUuid(userId)) return { status: 404, error: "Purchase receipt not found" };
  const params = new URLSearchParams({
    select: storedPurchaseSelect(),
    provider_ref: `eq.${providerRef}`,
    subject_type: "eq.user",
    subject_id: `eq.${userId}`,
    limit: "1"
  });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/purchases?${params.toString()}`, {
      headers: supabaseRestHeaders()
    });
    if (!response.ok) return { status: 502, error: `Purchase receipt lookup failed: HTTP ${response.status}` };
    const purchases = await response.json() as StoredPurchase[];
    const purchase = purchases[0];
    if (!purchase) return { status: 404, error: "Purchase receipt not found" };
    const entitlement = await fetchSupabaseEntitlementForPurchase(purchase);
    if (entitlement === undefined) return { status: 502, error: "Purchase entitlement lookup failed" };
    return receiptFromPurchase(purchase, entitlement ?? undefined);
  } catch {
    return { status: 503, error: "Payment store unavailable" };
  }
}

async function fetchSupabaseEntitlementForPurchase(purchase: StoredPurchase): Promise<StoredEntitlement | null | undefined> {
  const byPurchase = new URLSearchParams({
    select: "id,subject_type,subject_id,owner,repo,version,kind,purchase_id,expires_at,created_at",
    purchase_id: `eq.${purchase.id}`,
    limit: "1"
  });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/entitlements?${byPurchase.toString()}`, {
      headers: supabaseRestHeaders()
    });
    if (!response.ok) return undefined;
    const rows = await response.json() as StoredEntitlement[];
    if (rows[0]) return rows[0];
  } catch {
    return undefined;
  }

  const bySubject = new URLSearchParams({
    select: "id,subject_type,subject_id,owner,repo,version,kind,purchase_id,expires_at,created_at",
    subject_type: `eq.${purchase.subject_type}`,
    subject_id: `eq.${purchase.subject_id}`,
    owner: `eq.${purchase.owner}`,
    repo: `eq.${purchase.repo}`,
    version: `eq.${purchase.version}`,
    limit: "1"
  });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/entitlements?${bySubject.toString()}`, {
      headers: supabaseRestHeaders()
    });
    if (!response.ok) return undefined;
    const rows = await response.json() as StoredEntitlement[];
    return rows[0] ?? null;
  } catch {
    return undefined;
  }
}

function receiptFromPurchase(purchase: StoredPurchase, entitlement: StoredEntitlement | undefined): PurchaseReceipt {
  return {
    receipt_id: `oh_receipt_${purchase.id}`,
    purchase_id: purchase.id,
    provider: purchase.provider,
    provider_ref: purchase.provider_ref,
    status: purchase.status,
    owner: purchase.owner,
    repo: purchase.repo,
    version: purchase.version,
    pricing_model: purchase.pricing_model,
    amount_usd: purchase.amount_usd,
    currency: purchase.currency,
    subject: {
      type: purchase.subject_type,
      id: purchase.subject_id
    },
    created_at: purchase.created_at,
    updated_at: purchase.updated_at,
    entitlement: {
      granted: ["paid", "reserved", "captured"].includes(purchase.status) && Boolean(entitlement),
      ...(entitlement?.kind ? { kind: entitlement.kind } : {}),
      ...(entitlement ? { expires_at: entitlement.expires_at ?? null } : {})
    },
    escrow: purchase.pricing_model === "gate_escrow"
      ? {
        expires_at: purchase.escrow_expires_at ?? null,
        receipt_hash: purchase.receipt_hash ?? null,
        captured_at: purchase.captured_at ?? null,
        refunded_at: purchase.refunded_at ?? null
      }
      : undefined
  };
}

function settleLocalX402Purchase(purchase: StoredPurchase): PaymentWebhookResult {
  if (!localPaymentStorePath) return { ok: false, status: 503, error: "Payment store unavailable" };
  const state = readLocalPaymentState();
  const existing = state.purchases.find((row) => row.provider === "x402" && row.provider_ref === purchase.provider_ref);
  const purchaseForEntitlement = existing ?? purchase;
  if (!existing) state.purchases.push(purchase);
  if (!state.entitlements.some((row) => sameEntitlement(row, purchaseForEntitlement))) {
    state.entitlements.push(entitlementFromPurchase(purchaseForEntitlement));
  }
  writeLocalPaymentState(state);
  return {
    ok: true,
    status: paymentWebhookStatusForPurchase(purchaseForEntitlement, Boolean(existing)),
    owner: purchaseForEntitlement.owner,
    repo: purchaseForEntitlement.repo,
    version: purchaseForEntitlement.version,
    subject_id: purchaseForEntitlement.subject_id,
    purchase_id: purchaseForEntitlement.id,
    escrow_expires_at: purchaseForEntitlement.escrow_expires_at ?? null
  };
}

async function hasLocalEntitlement(input: PaymentAccessInput): Promise<boolean> {
  if (!localPaymentStorePath || !input.userId) return false;
  const rows = readLocalPaymentState().entitlements
    .filter((row) => row.subject_type === "user"
      && row.subject_id === input.userId
      && row.owner === input.owner
      && row.repo === input.repo);
  return entitlementRowsAllow(rows, input.version);
}

async function hasLocalSubjectEntitlement(input: EntitlementCheckInput): Promise<boolean> {
  if (!localPaymentStorePath) return false;
  const rows = readLocalPaymentState().entitlements
    .filter((row) => row.subject_type === input.subject.type
      && row.subject_id === input.subject.id
      && row.owner === input.owner
      && row.repo === input.repo
      && row.kind !== "escrow_reserved");
  return entitlementRowsAllow(rows, input.version);
}

function readLocalPaymentState(): LocalPaymentState {
  if (!localPaymentStorePath || !existsSync(localPaymentStorePath)) return { purchases: [], entitlements: [] };
  try {
    const parsed = JSON.parse(readFileSync(localPaymentStorePath, "utf8")) as LocalPaymentState;
    return {
      purchases: Array.isArray(parsed.purchases) ? parsed.purchases : [],
      entitlements: Array.isArray(parsed.entitlements) ? parsed.entitlements : []
    };
  } catch {
    return { purchases: [], entitlements: [] };
  }
}

function writeLocalPaymentState(state: LocalPaymentState) {
  if (!localPaymentStorePath) return;
  mkdirSync(path.dirname(localPaymentStorePath), { recursive: true });
  writeFileSync(localPaymentStorePath, `${JSON.stringify(state, null, 2)}\n`);
}

function entitlementFromPurchase(purchase: StoredPurchase): StoredEntitlement {
  const kind = entitlementKindForPurchase(purchase);
  return {
    id: crypto.randomUUID(),
    subject_type: purchase.subject_type,
    subject_id: purchase.subject_id,
    owner: purchase.owner,
    repo: purchase.repo,
    version: purchase.version,
    kind,
    purchase_id: purchase.id,
    expires_at: kind === "escrow_reserved" ? purchase.escrow_expires_at ?? escrowExpiresAt() : null,
    created_at: new Date().toISOString()
  };
}

function sameEntitlement(left: StoredEntitlement, right: StoredPurchase): boolean {
  const kind = entitlementKindForPurchase(right);
  return left.subject_type === right.subject_type
    && left.subject_id === right.subject_id
    && left.owner === right.owner
    && left.repo === right.repo
    && left.version === right.version
    && left.kind === kind;
}

function entitlementKindForPurchase(purchase: StoredPurchase): EntitlementKind {
  if (purchase.pricing_model === "gate_escrow" && purchase.status === "reserved") return "escrow_reserved";
  return "one_time";
}

function removeEscrowEntitlements(state: LocalPaymentState, purchase: StoredPurchase) {
  state.entitlements = state.entitlements.filter((row) => !(row.kind === "escrow_reserved"
    && row.subject_type === purchase.subject_type
    && row.subject_id === purchase.subject_id
    && row.owner === purchase.owner
    && row.repo === purchase.repo
    && row.version === purchase.version
    && (!row.purchase_id || row.purchase_id === purchase.id)));
}

function finalEscrowResult(
  purchase: StoredPurchase,
  status: "captured" | "refunded" | "already_captured" | "already_refunded",
  reason: "receipt_passed" | "receipt_failed" | "timeout"
): Extract<EscrowSettlementResult, { ok: true }> {
  return {
    ok: true,
    status,
    owner: purchase.owner,
    repo: purchase.repo,
    version: purchase.version,
    subject_id: purchase.subject_id,
    purchase_id: purchase.id,
    ...(purchase.receipt_hash ? { receipt_hash: purchase.receipt_hash } : {}),
    escrow_expires_at: purchase.escrow_expires_at ?? null,
    reason
  };
}

function alreadyFinalWebhookResult(purchase: StoredPurchase): PaymentWebhookResult | undefined {
  if (purchase.status === "captured") {
    return {
      ok: true,
      status: "already_captured",
      owner: purchase.owner,
      repo: purchase.repo,
      version: purchase.version,
      subject_id: purchase.subject_id,
      purchase_id: purchase.id,
      escrow_expires_at: purchase.escrow_expires_at ?? null
    };
  }
  if (purchase.status === "refunded") {
    return {
      ok: true,
      status: "already_refunded",
      owner: purchase.owner,
      repo: purchase.repo,
      version: purchase.version,
      subject_id: purchase.subject_id,
      purchase_id: purchase.id,
      escrow_expires_at: purchase.escrow_expires_at ?? null
    };
  }
  return undefined;
}

function paymentWebhookStatusForPurchase(purchase: StoredPurchase, alreadyPersisted: boolean): Extract<PaymentWebhookResult, { ok: true }>["status"] {
  if (purchase.status === "reserved") return alreadyPersisted ? "already_reserved" : "reserved";
  if (purchase.status === "captured") return "already_captured";
  if (purchase.status === "refunded") return "already_refunded";
  return alreadyPersisted ? "already_paid" : "paid";
}

function escrowExpiresAt(nowMs = Date.now()): string {
  return new Date(nowMs + ESCROW_WINDOW_MS).toISOString();
}

function escrowExpired(purchase: StoredPurchase, nowMs: number): boolean {
  const expiresAt = purchase.escrow_expires_at ? Date.parse(purchase.escrow_expires_at) : NaN;
  return Number.isFinite(expiresAt) && expiresAt <= nowMs;
}

function storedPurchaseSelect(): string {
  return [
    "id",
    "subject_type",
    "subject_id",
    "owner",
    "repo",
    "version",
    "amount_usd",
    "currency",
    "provider",
    "provider_ref",
    "referral_code",
    "creator_user_id",
    "pricing_model",
    "status",
    "escrow_expires_at",
    "receipt_hash",
    "captured_at",
    "refunded_at",
    "created_at",
    "updated_at"
  ].join(",");
}

async function fetchSupabaseUserPurchase(providerRef: string, userId: string): Promise<StoredPurchase | null | undefined> {
  const params = new URLSearchParams({
    select: storedPurchaseSelect(),
    provider_ref: `eq.${providerRef}`,
    subject_type: "eq.user",
    subject_id: `eq.${userId}`,
    limit: "1"
  });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/purchases?${params.toString()}`, {
      headers: supabaseRestHeaders()
    });
    if (!response.ok) return undefined;
    const purchases = await response.json() as StoredPurchase[];
    return purchases[0] ?? null;
  } catch {
    return undefined;
  }
}

async function updateSupabasePurchase(id: string, patch: Record<string, unknown>): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/purchases?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        ...supabaseRestHeaders(),
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(patch)
    });
    if (response.ok) return { ok: true };
    return { ok: false, status: 502, error: `Purchase update failed: HTTP ${response.status}` };
  } catch {
    return { ok: false, status: 503, error: "Payment store unavailable" };
  }
}

async function insertSupabaseEntitlement(entitlement: StoredEntitlement): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/entitlements`, {
      method: "POST",
      headers: {
        ...supabaseRestHeaders(),
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal"
      },
      body: JSON.stringify(entitlement)
    });
    if (response.ok || response.status === 409) return { ok: true };
    return { ok: false, status: 502, error: `Entitlement insert failed: HTTP ${response.status}` };
  } catch {
    return { ok: false, status: 503, error: "Payment store unavailable" };
  }
}

async function deleteSupabaseEscrowEntitlement(purchase: StoredPurchase): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const params = new URLSearchParams({
    subject_type: `eq.${purchase.subject_type}`,
    subject_id: `eq.${purchase.subject_id}`,
    owner: `eq.${purchase.owner}`,
    repo: `eq.${purchase.repo}`,
    version: `eq.${purchase.version}`,
    kind: "eq.escrow_reserved"
  });
  params.append("purchase_id", `eq.${purchase.id}`);
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/entitlements?${params.toString()}`, {
      method: "DELETE",
      headers: {
        ...supabaseRestHeaders(),
        Prefer: "return=minimal"
      }
    });
    if (response.ok) return { ok: true };
    return { ok: false, status: 502, error: `Escrow entitlement delete failed: HTTP ${response.status}` };
  } catch {
    return { ok: false, status: 503, error: "Payment store unavailable" };
  }
}

function buildX402PaymentRequired(input: PaymentAccessInput): X402PaymentRequired | undefined {
  const requirement = x402Requirement(input);
  if (!requirement) return undefined;
  return {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: x402ResourceUrl(input),
      description: `${input.owner}/${input.repo}@${input.version}`,
      mimeType: "application/json"
    },
    accepts: [requirement]
  };
}

function x402Requirement(input: PaymentAccessInput): X402PaymentRequirements | undefined {
  if (!x402Enabled()) return undefined;
  const payTo = process.env.X402_PAY_TO?.trim();
  if (!payTo) return undefined;
  const network = (process.env.X402_NETWORK ?? "eip155:8453").trim();
  const asset = (process.env.X402_ASSET ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913").trim();
  if (!network || !asset) return undefined;
  return {
    scheme: "exact",
    network,
    asset,
    amount: String(Math.round((input.manifest.pricing.amount_usd ?? 0) * 1_000_000)),
    payTo,
    maxTimeoutSeconds: x402MaxTimeoutSeconds(),
    extra: {
      name: `${input.owner}/${input.repo}`,
      version: input.version
    }
  };
}

function x402ResourceUrl(input: PaymentAccessInput): string {
  const base = (process.env.HARNESS_PUBLIC_API_URL ?? "https://onlyharness.com/api").replace(/\/$/, "");
  return `${base}/repos/${input.owner}/${input.repo}/archive?version=${encodeURIComponent(input.version)}`;
}

function x402MaxTimeoutSeconds(): number {
  const value = Number(process.env.X402_MAX_TIMEOUT_SECONDS ?? 300);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 300;
}

function x402ProviderRef(network: string, transaction: string): string {
  return `x402:${network}:${transaction}`;
}

const manualPaymentProvider: PaymentProvider = {
  id: "manual",
  createCheckoutSession(input) {
    const providerRef = `manual_${crypto.randomUUID()}`;
    const checkout = new URL(checkoutUrl({
      owner: input.owner,
      repo: input.repo,
      version: input.version,
      manifest: input.manifest,
      userId: input.userId
    }));
    checkout.searchParams.set("provider_ref", providerRef);
    if (input.referralCode) checkout.searchParams.set("ref", input.referralCode);
    return {
      provider: "manual",
      provider_ref: providerRef,
      checkout_url: checkout.toString(),
      status: "pending",
      next: "Manual provider pending. After payment confirmation, retry hh install with HH_TOKEN."
    };
  },
  settleWebhook(input) {
    if (input.status && !["paid", "succeeded"].includes(input.status)) {
      return Promise.resolve({ ok: false, status: 400, error: "Unsupported payment status" });
    }
    return settlePurchase("manual", input.providerRef);
  }
};

function configuredPaymentProvider(): PaymentProvider | undefined {
  return paymentProviderFor(configuredPaymentProviderId());
}

function configuredPaymentProviderId(): string {
  return (process.env.PAYMENT_PROVIDER ?? "manual").trim() || "manual";
}

function paymentProviderFor(provider: string): PaymentProvider | undefined {
  if (provider === manualPaymentProvider.id) return manualPaymentProvider;
  return undefined;
}

function unsupportedPaymentProviderError(provider: string): string {
  return `Unsupported payment provider: ${provider}. Only manual is enabled.`;
}

function paymentsEnabled(): boolean {
  return process.env.PAYMENTS_ENABLED === "true";
}

function x402Enabled(): boolean {
  return process.env.X402_ENABLED === "true";
}

function supabaseRestHeaders() {
  return {
    apikey: supabaseRestKey ?? "",
    authorization: `Bearer ${supabaseRestKey}`
  };
}

function bearerToken(authorization: string | undefined): string | undefined {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

type LocalPaymentState = {
  purchases: StoredPurchase[];
  entitlements: StoredEntitlement[];
};

type StoredPurchase = {
  id: string;
  subject_type: "user" | "wallet" | "org";
  subject_id: string;
  owner: string;
  repo: string;
  version: string;
  amount_usd: number;
  currency: string;
  provider: PurchaseProviderId;
  provider_ref: string;
  referral_code?: string;
  creator_user_id?: string | null;
  pricing_model?: PricingModel;
  status: PurchaseStatus;
  escrow_expires_at?: string | null;
  receipt_hash?: string | null;
  captured_at?: string | null;
  refunded_at?: string | null;
  created_at: string;
  updated_at: string;
};

type StoredEntitlement = EntitlementRow & {
  id: string;
  subject_type: "user" | "wallet" | "org";
  subject_id: string;
  owner: string;
  repo: string;
  version: string;
  kind: EntitlementKind;
  purchase_id?: string;
  created_at: string;
};
