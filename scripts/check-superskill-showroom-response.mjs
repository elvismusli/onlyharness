#!/usr/bin/env node

const expectedSelectedIds = [
  "agent-harness-refactorer",
  "data-quality-sentinel",
  "deep-market-researcher",
  "finance-payment-safety-reviewer",
  "founder-decision-memo",
  "gtm-research-sprint",
  "incident-rca-commander",
  "launch-readiness-reviewer",
  "product-strategy-critic",
  "repo-truth-auditor",
  "security-permission-auditor",
  "support-triage-agent"
].sort();

const mode = process.argv[2];
if (mode !== "approved" && mode !== "selected") fail("Usage: check-superskill-showroom-response.mjs approved|selected");

let body = "";
for await (const chunk of process.stdin) body += chunk;

let value;
try {
  value = JSON.parse(body);
} catch {
  fail("Showroom response is not valid JSON");
}

if (!Array.isArray(value.items) || !Number.isInteger(value.total)) fail("Showroom response is missing items or total");

if (mode === "approved") {
  if (value.total !== 0 || value.items.length !== 0) fail("Approved showroom must remain empty before real attestations");
  process.exit(0);
}

const actualIds = value.items.map((item) => item?.capability?.id).sort();
if (value.total !== expectedSelectedIds.length || value.items.length !== expectedSelectedIds.length) {
  fail(`Selected showroom must contain exactly ${expectedSelectedIds.length} items`);
}
if (new Set(actualIds).size !== expectedSelectedIds.length || JSON.stringify(actualIds) !== JSON.stringify(expectedSelectedIds)) {
  fail("Selected showroom IDs do not match the exact reviewed-intake set");
}
for (const item of value.items) {
  if (item.status !== "selected_unreviewed" || item?.capability?.trust?.status !== "candidate") {
    fail(`Selected showroom item ${item?.capability?.id ?? "unknown"} is not an unreviewed candidate`);
  }
  if (item?.managedHandoff?.status !== "blocked" || item?.managedHandoff?.reason !== "review_required") {
    fail(`Selected showroom item ${item.capability.id} does not block managed handoff`);
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
