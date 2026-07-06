import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "hh-orgs-test-"));
process.env.HARNESS_ORGS_PATH = path.join(tempRoot, "orgs.json");
process.env.HARNESS_ORG_AUDIT_PATH = path.join(tempRoot, "org-audit.jsonl");

const orgs = await import("../src/orgs.ts");

test("readOrgBundle requires hashed org token, scope and expiry", () => {
  writeOrgStore({
    organizations: [
      {
        slug: "acme",
        name: "Acme",
        plan: "team",
        tokens: [
          { name: "setup", hash: hashToken("valid-token"), scopes: ["setup"], expires_at: null },
          { name: "publish", hash: hashToken("publish-token"), scopes: ["publish"], expires_at: null },
          { name: "expired", hash: hashToken("expired-token"), scopes: ["setup"], expires_at: "2026-01-01T00:00:00Z" },
          { name: "badexpiry", hash: hashToken("bad-expiry-token"), scopes: ["setup"], expires_at: "not-a-date" },
          { name: "noscope", hash: hashToken("noscope-token"), scopes: ["billing"], expires_at: null }
        ],
        bundle: {
          version: "0.1.0",
          harnesses: [{ owner: "harnesses", name: "deep-market-researcher", version: "0.1.0" }],
          configs: [
            { path: ".claude/onlyharness/acme.md", content: "# Acme\n" },
            { path: "../secret.md", content: "skip\n" }
          ]
        }
      }
    ]
  });

  const missing = orgs.readOrgBundle("@acme", undefined);
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 401);
  assert.equal(missing.auditAction, "org_token_missing");

  const invalid = orgs.readOrgBundle("@acme", "wrong-token");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, 403);
  assert.equal(invalid.auditAction, "org_token_denied");

  const expired = orgs.readOrgBundle("@acme", "expired-token");
  assert.equal(expired.ok, false);
  assert.equal(expired.status, 403);
  assert.equal(expired.auditAction, "org_token_expired");

  const badExpiry = orgs.readOrgBundle("@acme", "bad-expiry-token");
  assert.equal(badExpiry.ok, false);
  assert.equal(badExpiry.status, 403);
  assert.equal(badExpiry.auditAction, "org_token_expired");

  const noscope = orgs.readOrgBundle("@acme", "noscope-token");
  assert.equal(noscope.ok, false);
  assert.equal(noscope.status, 403);
  assert.equal(noscope.auditAction, "org_scope_denied");

  const valid = orgs.readOrgBundle("@acme", "valid-token");
  assert.equal(valid.ok, true);
  assert.equal(valid.bundle.version, "0.1.0");
  assert.equal(valid.bundle.configs.length, 1);
  assert.equal(valid.bundle.configs[0]?.path, ".claude/onlyharness/acme.md");

  const publish = orgs.authorizeOrgToken("@acme", "publish-token", ["publish"]);
  assert.equal(publish.ok, true);
  assert.equal(publish.tokenName, "publish");
});

test("appendOrgAudit writes no raw token values", () => {
  orgs.appendOrgAudit({
    slug: "acme",
    action: "bundle_token_denied",
    tokenName: "setup",
    subject: "anonymous",
    target: "setup"
  });

  const audit = readFileSync(process.env.HARNESS_ORG_AUDIT_PATH!, "utf8");
  assert.match(audit, /bundle_token_denied/);
  assert.match(audit, /setup/);
  assert.doesNotMatch(audit, /valid-token|wrong-token/);
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function writeOrgStore(value: unknown) {
  writeFileSync(process.env.HARNESS_ORGS_PATH!, `${JSON.stringify(value, null, 2)}\n`);
}

function hashToken(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}
