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
  payments_enabled: boolean;
  x402: {
    enabled: boolean;
    requirements: X402PaymentRequirements[];
    paymentRequired: X402PaymentRequired | null;
  };
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
  | { ok: true; status: "paid" | "already_paid"; owner: string; repo: string; version: string; subject_id: string; purchase_id?: string }
  | { ok: false; status: number; error: string };

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseRestKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const checkoutBaseUrl = process.env.HARNESS_CHECKOUT_BASE_URL ?? "https://onlyharness.com/checkout";
const localPaymentStorePath = process.env.HARNESS_LOCAL_PAYMENTS_PATH ? path.resolve(process.env.HARNESS_LOCAL_PAYMENTS_PATH) : undefined;

export async function requireArchivePaymentAccess(input: PaymentAccessInput): Promise<PaymentAccessResult> {
  if (input.manifest.pricing.model === "free") return { allowed: true };
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
  if (canonical !== undefined) return entitlementRowsAllow(canonical, input.version);
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

export async function createCheckoutSession(input: CheckoutInput): Promise<CheckoutSession | { error: string; status: number }> {
  if (input.manifest.pricing.model === "free") return { status: 400, error: "Free harnesses do not need checkout" };
  const amount = input.manifest.pricing.amount_usd ?? 0;
  if (!Number.isFinite(amount) || amount <= 0) return { status: 400, error: "Paid harness is missing a positive amount_usd" };
  if (!paymentsEnabled()) return { status: 503, error: "Payments are disabled in this environment" };
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
    creator_user_id: input.creatorUserId ?? null,
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
    next: "Manual provider pending. After payment confirmation, retry hh install with HH_TOKEN."
  };
}

export async function settlePaymentWebhook(input: PaymentWebhookInput): Promise<PaymentWebhookResult> {
  if (input.provider && input.provider !== "manual") return { ok: false, status: 400, error: "Unsupported payment provider" };
  if (input.status && !["paid", "succeeded"].includes(input.status)) return { ok: false, status: 400, error: "Unsupported payment status" };
  if (!input.provider_ref) return { ok: false, status: 400, error: "provider_ref is required" };
  return settlePurchase(input.provider_ref);
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
    status: "paid",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  } satisfies StoredPurchase;
  if (supabaseUrl && supabaseRestKey) return settleSupabaseX402Purchase(purchase);
  return settleLocalX402Purchase(purchase);
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
    select: "version,expires_at",
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

async function settleSupabaseX402Purchase(purchase: StoredPurchase): Promise<PaymentWebhookResult> {
  const existing = await fetchSupabasePurchase("x402", purchase.provider_ref);
  if (existing === undefined) return { ok: false, status: 502, error: "Purchase lookup failed" };
  let purchaseForEntitlement = existing;
  const alreadyPaid = Boolean(existing);
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
  return {
    ok: true,
    status: alreadyPaid ? "already_paid" : "paid",
    owner: purchaseForEntitlement.owner,
    repo: purchaseForEntitlement.repo,
    version: purchaseForEntitlement.version,
    subject_id: purchaseForEntitlement.subject_id,
    purchase_id: purchaseForEntitlement.id
  };
}

async function fetchSupabasePurchase(provider: StoredPurchase["provider"], providerRef: string): Promise<StoredPurchase | null | undefined> {
  const params = new URLSearchParams({
    select: "id,subject_type,subject_id,owner,repo,version,status",
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
    status: existing ? "already_paid" : "paid",
    owner: purchaseForEntitlement.owner,
    repo: purchaseForEntitlement.repo,
    version: purchaseForEntitlement.version,
    subject_id: purchaseForEntitlement.subject_id,
    purchase_id: purchaseForEntitlement.id
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
  provider: "manual" | "x402";
  provider_ref: string;
  referral_code?: string;
  creator_user_id?: string | null;
  status: "pending" | "paid";
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
  kind: "one_time";
  purchase_id?: string;
  created_at: string;
};
