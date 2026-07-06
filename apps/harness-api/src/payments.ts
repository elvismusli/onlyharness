import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { HarnessManifest } from "@harnesshub/schema";

export type PaymentAccessInput = {
  owner: string;
  repo: string;
  version: string;
  manifest: HarnessManifest;
  authorization?: string;
  userId?: string;
};

export type PaymentAccessResult =
  | { allowed: true }
  | { allowed: false; status: 402; body: PaymentRequiredBody };

export type PaymentRequiredBody = {
  error: "Payment required";
  code: "PAYMENT_REQUIRED";
  owner: string;
  repo: string;
  version: string;
  pricing: HarnessManifest["pricing"];
  provider: "manual";
  checkout_url: string;
  x402: {
    enabled: boolean;
    requirements: unknown[];
  };
  next: string;
};

export type EntitlementRow = {
  version?: string | null;
  expires_at?: string | null;
};

export type CheckoutInput = {
  owner: string;
  repo: string;
  version: string;
  manifest: HarnessManifest;
  userId: string;
  referralCode?: string;
};

export type CheckoutSession = {
  provider: "manual";
  provider_ref: string;
  checkout_url: string;
  status: "pending";
  owner: string;
  repo: string;
  version: string;
  pricing: HarnessManifest["pricing"];
  next: string;
};

export type PaymentWebhookInput = {
  provider?: string;
  provider_ref?: string;
  status?: string;
};

export type PaymentWebhookResult =
  | { ok: true; status: "paid" | "already_paid"; owner: string; repo: string; version: string; subject_id: string; purchase_id?: string }
  | { ok: false; status: number; error: string };

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseRestKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const checkoutBaseUrl = process.env.HARNESS_CHECKOUT_BASE_URL ?? "https://onlyharness.com/checkout";
const localPaymentStorePath = process.env.HARNESS_LOCAL_PAYMENTS_PATH ? path.resolve(process.env.HARNESS_LOCAL_PAYMENTS_PATH) : undefined;
const x402Enabled = process.env.X402_ENABLED === "true";

export async function requireArchivePaymentAccess(input: PaymentAccessInput): Promise<PaymentAccessResult> {
  if (input.manifest.pricing.model === "free") return { allowed: true };
  if (await hasEntitlement(input)) return { allowed: true };

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
      x402: {
        enabled: x402Enabled,
        requirements: x402Enabled ? [x402Requirement(input)] : []
      },
      next: "Complete checkout or get a manual entitlement, then retry hh pull with HH_TOKEN."
    }
  };
}

async function hasEntitlement(input: PaymentAccessInput): Promise<boolean> {
  return hasManualEntitlement(input) || await hasLocalEntitlement(input) || await hasSupabaseEntitlement(input);
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

export function entitlementRowsAllow(rows: EntitlementRow[], version: string, now = Date.now()): boolean {
  return rows.some((row) => {
    if (row.version && row.version !== version) return false;
    if (row.expires_at && Date.parse(row.expires_at) <= now) return false;
    return true;
  });
}

export async function createCheckoutSession(input: CheckoutInput): Promise<CheckoutSession | { error: string; status: number }> {
  if (input.manifest.pricing.model === "free") return { status: 400, error: "Free harnesses do not need checkout" };
  const amount = input.manifest.pricing.amount_usd ?? 0;
  if (!Number.isFinite(amount) || amount <= 0) return { status: 400, error: "Paid harness is missing a positive amount_usd" };
  const purchase = {
    id: crypto.randomUUID(),
    subject_type: "user",
    subject_id: input.userId,
    owner: input.owner,
    repo: input.repo,
    version: input.version,
    amount_usd: amount,
    currency: input.manifest.pricing.currency ?? "USD",
    provider: "manual",
    provider_ref: `manual_${crypto.randomUUID()}`,
    referral_code: input.referralCode,
    status: "pending",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  } satisfies StoredPurchase;
  const persisted = await persistPendingPurchase(purchase);
  if ("error" in persisted) return persisted;
  const checkout = new URL(checkoutUrl({ owner: input.owner, repo: input.repo, version: input.version, manifest: input.manifest, userId: input.userId }));
  checkout.searchParams.set("provider_ref", purchase.provider_ref);
  if (input.referralCode) checkout.searchParams.set("ref", input.referralCode);
  return {
    provider: "manual",
    provider_ref: purchase.provider_ref,
    checkout_url: checkout.toString(),
    status: "pending",
    owner: input.owner,
    repo: input.repo,
    version: input.version,
    pricing: input.manifest.pricing,
    next: "Manual provider pending. After payment confirmation, retry hh pull with HH_TOKEN."
  };
}

export async function settlePaymentWebhook(input: PaymentWebhookInput): Promise<PaymentWebhookResult> {
  if (input.provider && input.provider !== "manual") return { ok: false, status: 400, error: "Unsupported payment provider" };
  if (input.status && !["paid", "succeeded"].includes(input.status)) return { ok: false, status: 400, error: "Unsupported payment status" };
  if (!input.provider_ref) return { ok: false, status: 400, error: "provider_ref is required" };
  return settlePurchase(input.provider_ref);
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

async function settlePurchase(providerRef: string): Promise<PaymentWebhookResult> {
  if (supabaseUrl && supabaseRestKey) return settleSupabasePurchase(providerRef);
  if (!localPaymentStorePath) return { ok: false, status: 503, error: "Payment store unavailable" };
  const state = readLocalPaymentState();
  const purchase = state.purchases.find((row) => row.provider === "manual" && row.provider_ref === providerRef);
  if (!purchase) return { ok: false, status: 404, error: "Purchase not found" };
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

async function settleSupabasePurchase(providerRef: string): Promise<PaymentWebhookResult> {
  const params = new URLSearchParams({
    select: "id,subject_type,subject_id,owner,repo,version,status",
    provider: "eq.manual",
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

async function hasLocalEntitlement(input: PaymentAccessInput): Promise<boolean> {
  if (!localPaymentStorePath || !input.userId) return false;
  const rows = readLocalPaymentState().entitlements
    .filter((row) => row.subject_type === "user"
      && row.subject_id === input.userId
      && row.owner === input.owner
      && row.repo === input.repo);
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
  return {
    id: crypto.randomUUID(),
    subject_type: purchase.subject_type,
    subject_id: purchase.subject_id,
    owner: purchase.owner,
    repo: purchase.repo,
    version: purchase.version,
    kind: "one_time",
    purchase_id: purchase.id,
    expires_at: null,
    created_at: new Date().toISOString()
  };
}

function sameEntitlement(left: StoredEntitlement, right: StoredPurchase): boolean {
  return left.subject_type === right.subject_type
    && left.subject_id === right.subject_id
    && left.owner === right.owner
    && left.repo === right.repo
    && left.version === right.version
    && left.kind === "one_time";
}

function x402Requirement(input: PaymentAccessInput) {
  return {
    scheme: "exact",
    network: process.env.X402_NETWORK ?? "base",
    asset: process.env.X402_ASSET ?? "USDC",
    maxAmountRequired: String(Math.round((input.manifest.pricing.amount_usd ?? 0) * 1_000_000)),
    resource: `/repos/${input.owner}/${input.repo}/archive?version=${encodeURIComponent(input.version)}`,
    description: `${input.owner}/${input.repo}@${input.version}`
  };
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
  subject_type: "user";
  subject_id: string;
  owner: string;
  repo: string;
  version: string;
  amount_usd: number;
  currency: string;
  provider: "manual";
  provider_ref: string;
  referral_code?: string;
  status: "pending" | "paid";
  created_at: string;
  updated_at: string;
};

type StoredEntitlement = EntitlementRow & {
  id: string;
  subject_type: "user";
  subject_id: string;
  owner: string;
  repo: string;
  version: string;
  kind: "one_time";
  purchase_id?: string;
  created_at: string;
};
