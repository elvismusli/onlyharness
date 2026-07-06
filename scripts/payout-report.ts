import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type PurchaseRow = {
  id?: string;
  owner: string;
  repo: string;
  creator_user_id?: string | null;
  creatorUserId?: string | null;
  owner_user_id?: string | null;
  ownerUserId?: string | null;
  amount_usd?: number | string;
  amountUsd?: number | string;
  currency?: string | null;
  referral_code?: string | null;
  referralCode?: string | null;
  status: string;
  created_at?: string;
  createdAt?: string;
};

export type PayoutAccountRow = {
  user_id?: string | null;
  userId?: string | null;
  handle?: string | null;
  owner?: string | null;
  method: "usdc_wallet" | "fiat_manual" | string;
  address: string;
};

export type AnchorConfig = {
  anchors?: Array<string | {
    owner?: string;
    repo?: string;
    key?: string;
    user_id?: string;
    rate?: number;
  }>;
  rates?: {
    anchor?: number;
    referral?: number;
    catalog?: number;
  };
};

export type PayoutReportRow = {
  recipient: string;
  method: string;
  address: string;
  purchases: number;
  grossUsd: number;
  payoutUsd: number;
  platformUsd: number;
  anchorPurchases: number;
  referralPurchases: number;
  catalogPurchases: number;
  missingPayoutAccount: boolean;
  blockedReason?: "MISSING_CREATOR_ID" | "MISSING_PAYOUT_ACCOUNT";
};

export type PayoutReport = {
  month: string;
  start: string;
  end: string;
  rows: PayoutReportRow[];
  totals: {
    purchases: number;
    grossUsd: number;
    payoutUsd: number;
    platformUsd: number;
    missingPayoutAccounts: number;
  };
};

type RateKind = "anchor" | "referral" | "catalog";

type LoadedData = {
  purchases: PurchaseRow[];
  payoutAccounts: PayoutAccountRow[];
};

const DEFAULT_RATES = {
  anchor: 1,
  referral: 0.95,
  catalog: 0.85
};

const workspaceRoot = path.resolve(import.meta.dirname, "..");

export function buildPayoutReport(input: {
  month: string;
  purchases: PurchaseRow[];
  payoutAccounts: PayoutAccountRow[];
  anchors?: AnchorConfig;
}): PayoutReport {
  const { start, end } = monthWindow(input.month);
  const rows = new Map<string, PayoutReportRow>();
  const rates = { ...DEFAULT_RATES, ...(input.anchors?.rates ?? {}) };

  for (const purchase of input.purchases) {
    if (!isSettledPurchase(purchase.status)) continue;
    const createdAt = createdAtOf(purchase);
    if (createdAt && (createdAt < start || createdAt >= end)) continue;
    const amount = amountUsd(purchase);
    if (amount <= 0) continue;

    const recipient = recipientKey(purchase);
    if (!recipient) {
      addBlockedPurchase(rows, purchase, amount, "MISSING_CREATOR_ID");
      continue;
    }
    const account = payoutAccountFor(recipient, input.payoutAccounts);
    const kind = rateKindFor(purchase, recipient, input.anchors);
    const rate = rates[kind];
    const payout = roundMoney(amount * rate);
    const platform = roundMoney(amount - payout);
    const key = `${recipient}\u0000${account?.method ?? "missing"}\u0000${account?.address ?? ""}`;
    const row = rows.get(key) ?? {
      recipient,
      method: account?.method ?? "missing",
      address: account?.address ?? "",
      purchases: 0,
      grossUsd: 0,
      payoutUsd: 0,
      platformUsd: 0,
      anchorPurchases: 0,
      referralPurchases: 0,
      catalogPurchases: 0,
      missingPayoutAccount: !account,
      blockedReason: account ? undefined : "MISSING_PAYOUT_ACCOUNT"
    };

    row.purchases += 1;
    row.grossUsd = roundMoney(row.grossUsd + amount);
    row.payoutUsd = roundMoney(row.payoutUsd + payout);
    row.platformUsd = roundMoney(row.platformUsd + platform);
    if (kind === "anchor") row.anchorPurchases += 1;
    else if (kind === "referral") row.referralPurchases += 1;
    else row.catalogPurchases += 1;
    rows.set(key, row);
  }

  const sortedRows = [...rows.values()].sort((a, b) => b.payoutUsd - a.payoutUsd || a.recipient.localeCompare(b.recipient));
  return {
    month: input.month,
    start,
    end,
    rows: sortedRows,
    totals: {
      purchases: sortedRows.reduce((sum, row) => sum + row.purchases, 0),
      grossUsd: roundMoney(sortedRows.reduce((sum, row) => sum + row.grossUsd, 0)),
      payoutUsd: roundMoney(sortedRows.reduce((sum, row) => sum + row.payoutUsd, 0)),
      platformUsd: roundMoney(sortedRows.reduce((sum, row) => sum + row.platformUsd, 0)),
      missingPayoutAccounts: sortedRows.filter((row) => row.missingPayoutAccount).length
    }
  };
}

export function monthWindow(month: string): { start: string; end: string } {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error("Month must be YYYY-MM");
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  if (start.getUTCFullYear() !== year || start.getUTCMonth() !== monthIndex) throw new Error("Month must be YYYY-MM");
  return { start: start.toISOString(), end: end.toISOString() };
}

export function formatPayoutReport(report: PayoutReport): string {
  const lines = [
    `# OnlyHarness payout report ${report.month}`,
    "",
    `Window: ${report.start} <= created_at < ${report.end}`,
    "",
    "| recipient | method | address | purchases | gross | payout | platform | mix | status |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |"
  ];
  for (const row of report.rows) {
    lines.push([
      row.recipient,
      row.method,
      row.address || "-",
      String(row.purchases),
      money(row.grossUsd),
      money(row.payoutUsd),
      money(row.platformUsd),
      `anchor:${row.anchorPurchases} ref:${row.referralPurchases} catalog:${row.catalogPurchases}`,
      row.blockedReason ?? "ready_manual_payout"
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  lines.push(
    "",
    `Totals: ${report.totals.purchases} purchases · gross ${money(report.totals.grossUsd)} · payout ${money(report.totals.payoutUsd)} · platform ${money(report.totals.platformUsd)} · missing accounts ${report.totals.missingPayoutAccounts}`
  );
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const month = args.month ?? currentUtcMonth();
  const anchors = readAnchors(args.anchors ?? path.join(workspaceRoot, "data/anchors.json"));
  const data = await loadData(args);
  const report = buildPayoutReport({ month, purchases: data.purchases, payoutAccounts: data.payoutAccounts, anchors });
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatPayoutReport(report));
  if (args.failOnMissing && report.totals.missingPayoutAccounts > 0) process.exit(1);
}

async function loadData(args: ReturnType<typeof parseArgs>): Promise<LoadedData> {
  if (args.purchases || args.payoutAccounts) {
    return {
      purchases: readRows<PurchaseRow>(args.purchases, "purchases"),
      payoutAccounts: readRows<PayoutAccountRow>(args.payoutAccounts, "payoutAccounts")
    };
  }
  return fetchSupabaseRows(args.month ?? currentUtcMonth());
}

async function fetchSupabaseRows(month: string): Promise<LoadedData> {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --purchases and --payout-accounts JSON files.");
  }
  const { start, end } = monthWindow(month);
  const purchasesParams = new URLSearchParams({ select: "*" });
  purchasesParams.append("status", "in.(paid,captured)");
  purchasesParams.append("created_at", `gte.${start}`);
  purchasesParams.append("created_at", `lt.${end}`);
  purchasesParams.append("order", "created_at.asc");

  return {
    purchases: await restFetch<PurchaseRow>(supabaseUrl, serviceKey, "purchases", purchasesParams),
    payoutAccounts: await restFetch<PayoutAccountRow>(supabaseUrl, serviceKey, "payout_accounts", new URLSearchParams({ select: "*" }))
  };
}

async function restFetch<T>(supabaseUrl: string, serviceKey: string, table: string, params: URLSearchParams): Promise<T[]> {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${params.toString()}`, {
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`
    }
  });
  if (!response.ok) throw new Error(`Supabase ${table} query failed: HTTP ${response.status}`);
  return await response.json() as T[];
}

function parseArgs(argv: string[]) {
  const args: {
    month?: string;
    purchases?: string;
    payoutAccounts?: string;
    anchors?: string;
    json: boolean;
    failOnMissing: boolean;
  } = { json: false, failOnMissing: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--month") args.month = requireValue(argv, ++index, arg);
    else if (arg === "--purchases") args.purchases = requireValue(argv, ++index, arg);
    else if (arg === "--payout-accounts") args.payoutAccounts = requireValue(argv, ++index, arg);
    else if (arg === "--anchors") args.anchors = requireValue(argv, ++index, arg);
    else if (arg === "--json") args.json = true;
    else if (arg === "--fail-on-missing") args.failOnMissing = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(helpText());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}\n${helpText()}`);
    }
  }
  return args;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function readRows<T>(file: string | undefined, key: "purchases" | "payoutAccounts"): T[] {
  if (!file) return [];
  const parsed = JSON.parse(readFileSync(path.resolve(file), "utf8")) as unknown;
  if (Array.isArray(parsed)) return parsed as T[];
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>)[key])) {
    return (parsed as Record<string, unknown>)[key] as T[];
  }
  throw new Error(`${file} must be a JSON array or an object with ${key}`);
}

function readAnchors(file: string): AnchorConfig {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as AnchorConfig;
}

function recipientKey(purchase: PurchaseRow): string | undefined {
  return purchase.creator_user_id
    ?? purchase.creatorUserId
    ?? purchase.owner_user_id
    ?? purchase.ownerUserId
    ?? undefined;
}

function payoutAccountFor(recipient: string, accounts: PayoutAccountRow[]): PayoutAccountRow | undefined {
  return accounts.find((account) => account.user_id === recipient
    || account.userId === recipient
    || account.handle === recipient
    || account.owner === recipient);
}

function rateKindFor(purchase: PurchaseRow, recipient: string, anchors: AnchorConfig | undefined): RateKind {
  if (isAnchorPurchase(purchase, recipient, anchors)) return "anchor";
  if (purchase.referral_code || purchase.referralCode) return "referral";
  return "catalog";
}

function isAnchorPurchase(purchase: PurchaseRow, recipient: string, anchors: AnchorConfig | undefined): boolean {
  for (const anchor of anchors?.anchors ?? []) {
    if (typeof anchor === "string") {
      if (anchor === recipient || anchor === `${purchase.owner}/${purchase.repo}`) return true;
      continue;
    }
    if (anchor.key && anchor.key === recipient) return true;
    if (anchor.user_id && anchor.user_id === recipient) return true;
    if (anchor.owner === purchase.owner && (!anchor.repo || anchor.repo === purchase.repo)) return true;
  }
  return false;
}

function amountUsd(purchase: PurchaseRow): number {
  const value = purchase.amount_usd ?? purchase.amountUsd ?? 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function addBlockedPurchase(
  rows: Map<string, PayoutReportRow>,
  purchase: PurchaseRow,
  amount: number,
  blockedReason: "MISSING_CREATOR_ID"
) {
  const recipient = `unresolved:${purchase.owner}/${purchase.repo}`;
  const row = rows.get(recipient) ?? {
    recipient,
    method: "missing",
    address: "",
    purchases: 0,
    grossUsd: 0,
    payoutUsd: 0,
    platformUsd: 0,
    anchorPurchases: 0,
    referralPurchases: 0,
    catalogPurchases: 0,
    missingPayoutAccount: true,
    blockedReason
  };
  row.purchases += 1;
  row.grossUsd = roundMoney(row.grossUsd + amount);
  rows.set(recipient, row);
}

function isSettledPurchase(status: string): boolean {
  return status === "paid" || status === "captured";
}

function createdAtOf(purchase: PurchaseRow): string | undefined {
  const value = purchase.created_at ?? purchase.createdAt;
  return value ? new Date(value).toISOString() : undefined;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function currentUtcMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function helpText(): string {
  return `Usage: tsx scripts/payout-report.ts [--month YYYY-MM] [--json] [--fail-on-missing]

Sources:
  SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
  or --purchases purchases.json --payout-accounts payout_accounts.json

Rates:
  anchor purchases: 100%
  referral-attributed purchases: 95%
  catalog purchases: 85%
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
