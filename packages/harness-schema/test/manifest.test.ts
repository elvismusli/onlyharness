import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { harnessManifestSchema, parseManifestText } from "../src/index.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

test("all 12 managed seed candidates are honest instruction-only v0.2 manifests", () => {
  const seedRoot = path.join(repoRoot, "seed-harnesses");
  const manifests = readdirSync(seedRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(seedRoot, entry.name, "harness.yaml"))
    .sort();

  assert.equal(manifests.length, 12, "expected the complete Stage A seed set");
  for (const manifestPath of manifests) {
    const manifest = parseManifestText(readFileSync(manifestPath, "utf8"));
    const expectedVersion = path.basename(path.dirname(manifestPath)) === "deep-market-researcher" ? "0.2.1" : "0.2.0";
    assert.equal(manifest.schemaVersion, "harness.v0.2", manifestPath);
    assert.equal(manifest.version, expectedVersion, manifestPath);
    assert.equal(manifest.visibility, "public", manifestPath);
    assert.equal(manifest.pricing.model, "free", manifestPath);
    assert.equal(manifest.runtime.primary, "none", manifestPath);
    assert.equal(manifest.entrypoint, undefined, manifestPath);
    assert.deepEqual(manifest.secrets.required, [], manifestPath);
    assert.equal(manifest.source.upstream_license, "MIT", manifestPath);
    assert.match(manifest.source.upstream_url ?? "", /^https:\/\/github\.com\/elvismusli\/onlyharness\//, manifestPath);

    const resultPath = path.join(path.dirname(manifestPath), ".harnesshub/results.json");
    const result = JSON.parse(readFileSync(resultPath, "utf8")) as {
      verified?: boolean;
      verification_status?: string;
      evidenceLevel?: string;
      managedEligible?: boolean;
    };
    assert.equal(result.verified, true, `${resultPath}: legacy verified byte remains additive-compatible`);
    assert.equal(result.verification_status, "declared_case_scores", resultPath);
    assert.equal(result.evidenceLevel, "author_declared", resultPath);
    assert.equal(result.managedEligible, false, resultPath);
  }
});

test("paid pricing models require an explicit amount_usd", () => {
  for (const model of ["one_time", "per_call", "gate_escrow"] as const) {
    const result = harnessManifestSchema.safeParse({
      ...baseManifest(),
      pricing: { model, currency: "USD" }
    });
    assert.equal(result.success, false, model);
    assert.match(issueMessages(result).join("\n"), /amount_usd is required for paid pricing models/);
  }
});

test("subscription pricing requires amount_usd and period", () => {
  const missingAmount = harnessManifestSchema.safeParse({
    ...baseManifest(),
    pricing: { model: "subscription", period: "month", currency: "USD" }
  });
  assert.equal(missingAmount.success, false);
  assert.match(issueMessages(missingAmount).join("\n"), /amount_usd is required for subscription pricing/);

  const missingPeriod = harnessManifestSchema.safeParse({
    ...baseManifest(),
    pricing: { model: "subscription", amount_usd: 19, currency: "USD" }
  });
  assert.equal(missingPeriod.success, false);
  assert.match(issueMessages(missingPeriod).join("\n"), /period is required for subscription pricing/);

  const valid = harnessManifestSchema.safeParse({
    ...baseManifest(),
    pricing: { model: "subscription", amount_usd: 19, period: "month", currency: "USD" }
  });
  assert.equal(valid.success, true);
});

function issueMessages(result: ReturnType<typeof harnessManifestSchema.safeParse>): string[] {
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

function baseManifest() {
  return {
    schemaVersion: "harness.v0.2",
    name: "paid-contract-test",
    title: "Paid Contract Test",
    summary: "A paid pricing contract fixture for schema validation.",
    version: "0.1.0",
    license: "MIT",
    runtime: { primary: "none", adapters: [] },
    agents: [{ id: "operator", role: "operator", prompt: "agents/operator.md", tools: [], handoffs: [] }],
    workflow: { entrypoint: "operator", stages: [{ id: "operate", agent: "operator" }] },
    permissions: { filesystem: "readonly" },
    evals: { promptfoo_config: "evals/promptfooconfig.yaml", command: "node smoke.js" },
    quality_gates: {
      min_score: 0.82,
      max_regression: 0.03,
      max_cost_usd_per_run: 3,
      max_risk_score: 39,
      required_checks: ["schema_valid", "eval_passed"]
    }
  };
}
