import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "hh-orgs-test-"));
process.env.HARNESS_ORGS_PATH = path.join(tempRoot, "orgs.json");
process.env.HARNESS_ORG_AUDIT_PATH = path.join(tempRoot, "org-audit.jsonl");
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const orgs = await import("../src/orgs.ts");

test("readOrgBundle requires hashed org token, scope and expiry", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  writeOrgStore({
    organizations: [
      {
        slug: "acme",
        name: "Acme",
        plan: "team",
        tokens: [
          { name: "setup", hash: hashToken("valid-token"), scopes: ["setup"], expires_at: null },
          { name: "publish", hash: hashToken("publish-token"), scopes: ["publish"], expires_at: null },
          { name: "entitlements", hash: hashToken("entitlements-token"), scopes: ["entitlements:read"], expires_at: null },
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

  const missing = await orgs.readOrgBundle("@acme", undefined);
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 401);
  assert.equal(missing.auditAction, "org_token_missing");

  const invalid = await orgs.readOrgBundle("@acme", "wrong-token");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, 403);
  assert.equal(invalid.auditAction, "org_token_denied");

  const expired = await orgs.readOrgBundle("@acme", "expired-token");
  assert.equal(expired.ok, false);
  assert.equal(expired.status, 403);
  assert.equal(expired.auditAction, "org_token_expired");

  const badExpiry = await orgs.readOrgBundle("@acme", "bad-expiry-token");
  assert.equal(badExpiry.ok, false);
  assert.equal(badExpiry.status, 403);
  assert.equal(badExpiry.auditAction, "org_token_expired");

  const noscope = await orgs.readOrgBundle("@acme", "noscope-token");
  assert.equal(noscope.ok, false);
  assert.equal(noscope.status, 403);
  assert.equal(noscope.auditAction, "org_scope_denied");

  const valid = await orgs.readOrgBundle("@acme", "valid-token");
  assert.equal(valid.ok, true);
  assert.equal(valid.bundle.version, "0.1.0");
  assert.equal(valid.bundle.configs.length, 1);
  assert.equal(valid.bundle.configs[0]?.path, ".claude/onlyharness/acme.md");

  const publish = await orgs.authorizeOrgToken("@acme", "publish-token", ["publish"]);
  assert.equal(publish.ok, true);
  assert.equal(publish.tokenName, "publish");

  const entitlements = await orgs.authorizeAnyOrgToken("entitlements-token", ["entitlements:read"]);
  assert.equal(entitlements.ok, true);
  assert.equal(entitlements.tokenName, "entitlements");

  const setupForEntitlements = await orgs.authorizeAnyOrgToken("valid-token", ["entitlements:read"]);
  assert.equal(setupForEntitlements.ok, false);
  assert.equal(setupForEntitlements.status, 403);
  assert.equal(setupForEntitlements.auditAction, "org_scope_denied");
});

test("appendOrgAudit writes no raw token values", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  await orgs.appendOrgAudit({
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

test("org auth, bundle and audit can use Supabase service-role rows", async () => {
  const originalFetch = globalThis.fetch;
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  const tokenHash = hashToken("remote-token");
  const writes: unknown[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw);
    const table = url.pathname.split("/").pop();
    if (table === "organizations") {
      const slug = url.searchParams.get("slug");
      const id = url.searchParams.get("id");
      if (slug === "eq.acme" || id === "eq.org-1") return jsonResponse([{ id: "org-1", slug: "acme", name: "Acme Remote", plan: "team" }]);
      return jsonResponse([]);
    }
    if (table === "org_tokens") {
      const orgId = url.searchParams.get("org_id");
      const hash = url.searchParams.get("token_hash");
      if (orgId === "eq.org-1" || hash === `eq.${tokenHash}`) {
        return jsonResponse([{
          id: "token-1",
          org_id: "org-1",
          name: "remote",
          token_hash: tokenHash,
          scopes: ["setup", "entitlements:read"],
          expires_at: null
        }]);
      }
      return jsonResponse([]);
    }
    if (table === "org_setup_bundles") {
      return jsonResponse([{
        version: "0.2.0",
        bundle: {
          harnesses: [{ owner: "harnesses", name: "deep-market-researcher", version: "0.1.0" }],
          configs: [{ path: ".claude/onlyharness/acme.md", content: "# Remote Acme\n" }]
        }
      }]);
    }
    if (table === "org_audit_log" && init?.method === "POST") {
      writes.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 201 });
    }
    if (table === "org_audit_log") {
      return jsonResponse([{
        action: "bundle_read",
        target: "setup",
        metadata: { token_name: "remote", subject: "anonymous" },
        created_at: "2026-07-07T00:00:00.000Z"
      }]);
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  try {
    const entitlements = await orgs.authorizeAnyOrgToken("remote-token", ["entitlements:read"]);
    assert.equal(entitlements.ok, true);
    assert.equal(entitlements.tokenName, "remote");

    const bundle = await orgs.readOrgBundle("@acme", "remote-token");
    assert.equal(bundle.ok, true);
    assert.equal(bundle.bundle.version, "0.2.0");
    assert.equal(bundle.bundle.configs[0]?.content, "# Remote Acme\n");

    await orgs.appendOrgAudit({ slug: "acme", action: "bundle_read", tokenName: "remote", subject: "anonymous", target: "setup" });
    assert.deepEqual(writes, [{
      org_id: "org-1",
      action: "bundle_read",
      target: "setup",
      metadata: { token_name: "remote", subject: "anonymous" }
    }]);

    const audit = await orgs.readOrgAudit("@acme", 10);
    assert.deepEqual(audit, [{
      slug: "acme",
      action: "bundle_read",
      token_name: "remote",
      subject: "anonymous",
      target: "setup",
      at: "2026-07-07T00:00:00.000Z"
    }]);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
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

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
