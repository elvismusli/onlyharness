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

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseRestKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const checkoutBaseUrl = process.env.HARNESS_CHECKOUT_BASE_URL ?? "https://onlyharness.com/checkout";
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
  return hasManualEntitlement(input) || await hasSupabaseEntitlement(input);
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
