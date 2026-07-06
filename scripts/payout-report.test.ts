import test from "node:test";
import assert from "node:assert/strict";
import { buildPayoutReport, formatPayoutReport, monthWindow, type PurchaseRow } from "./payout-report.ts";

const purchases: PurchaseRow[] = [
  {
    id: "catalog",
    owner: "creator",
    repo: "catalog-harness",
    creator_user_id: "creator-user",
    amount_usd: 100,
    status: "paid",
    created_at: "2026-07-10T12:00:00Z"
  },
  {
    id: "ref",
    owner: "creator",
    repo: "ref-harness",
    creator_user_id: "creator-user",
    amount_usd: 20,
    referral_code: "REF95",
    status: "paid",
    created_at: "2026-07-11T12:00:00Z"
  },
  {
    id: "anchor",
    owner: "anchor",
    repo: "anchor-harness",
    creator_user_id: "anchor-user",
    amount_usd: 50,
    status: "paid",
    created_at: "2026-07-12T12:00:00Z"
  },
  {
    id: "refunded",
    owner: "creator",
    repo: "refunded-harness",
    creator_user_id: "creator-user",
    amount_usd: 1000,
    status: "refunded",
    created_at: "2026-07-13T12:00:00Z"
  },
  {
    id: "missing-creator",
    owner: "harnesses",
    repo: "unknown-creator",
    amount_usd: 10,
    status: "paid",
    created_at: "2026-07-14T12:00:00Z"
  }
];

test("monthWindow returns UTC month boundaries", () => {
  assert.deepEqual(monthWindow("2026-07"), {
    start: "2026-07-01T00:00:00.000Z",
    end: "2026-08-01T00:00:00.000Z"
  });
});

test("buildPayoutReport applies payout rates and excludes unsettled purchases", () => {
  const report = buildPayoutReport({
    month: "2026-07",
    purchases,
    payoutAccounts: [
      { user_id: "creator-user", method: "usdc_wallet", address: "0xcreator" },
      { user_id: "anchor-user", method: "fiat_manual", address: "invoice-anchor" }
    ],
    anchors: { anchors: ["anchor-user"] }
  });

  const creator = report.rows.find((row) => row.recipient === "creator-user");
  const anchor = report.rows.find((row) => row.recipient === "anchor-user");
  const missing = report.rows.find((row) => row.recipient === "unresolved:harnesses/unknown-creator");

  assert.equal(creator?.grossUsd, 120);
  assert.equal(creator?.payoutUsd, 104);
  assert.equal(creator?.platformUsd, 16);
  assert.equal(creator?.catalogPurchases, 1);
  assert.equal(creator?.referralPurchases, 1);
  assert.equal(anchor?.grossUsd, 50);
  assert.equal(anchor?.payoutUsd, 50);
  assert.equal(anchor?.platformUsd, 0);
  assert.equal(missing?.grossUsd, 10);
  assert.equal(missing?.payoutUsd, 0);
  assert.equal(missing?.blockedReason, "MISSING_CREATOR_ID");
  assert.equal(report.totals.purchases, 4);
  assert.equal(report.totals.grossUsd, 180);
  assert.equal(report.totals.payoutUsd, 154);
});

test("formatPayoutReport makes blocked payout state visible", () => {
  const report = buildPayoutReport({
    month: "2026-07",
    purchases,
    payoutAccounts: [],
    anchors: { anchors: [] }
  });

  assert.match(formatPayoutReport(report), /MISSING_CREATOR_ID/);
  assert.match(formatPayoutReport(report), /MISSING_PAYOUT_ACCOUNT/);
});
