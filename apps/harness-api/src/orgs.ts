import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { workspaceRoot } from "./registry.js";

export type OrgBundleHarness = {
  owner: string;
  name: string;
  version?: string;
  target?: string;
};

export type OrgBundleConfig = {
  path: string;
  content: string;
};

export type OrgBundle = {
  version: string;
  harnesses: OrgBundleHarness[];
  configs: OrgBundleConfig[];
};

export type OrgRecord = {
  slug: string;
  name: string;
  plan: "free" | "team" | "enterprise";
  tokens?: Array<{
    name: string;
    hash: string;
    scopes: string[];
    expires_at?: string | null;
  }>;
  bundle?: OrgBundle;
};

type OrgStore = {
  organizations?: OrgRecord[];
};

export type OrgBundleResult =
  | { ok: true; org: OrgRecord; bundle: OrgBundle; tokenName: string }
  | { ok: false; status: number; error: string; slug?: string; tokenName?: string; auditAction: string };

export type OrgAuthResult =
  | { ok: true; org: OrgRecord; tokenName: string }
  | { ok: false; status: number; error: string; slug?: string; tokenName?: string; auditAction: string };

const orgsPath = path.resolve(process.env.HARNESS_ORGS_PATH ?? path.join(workspaceRoot, "data/orgs.json"));
const orgAuditPath = path.resolve(process.env.HARNESS_ORG_AUDIT_PATH ?? path.join(workspaceRoot, "data/org-audit.jsonl"));

export function tokenHash(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

export function cleanOrgSlug(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/^@/, "");
  return cleaned && /^[a-z][a-z0-9_-]{1,48}$/.test(cleaned) ? cleaned : undefined;
}

export function readOrgBundle(slugValue: string | undefined, token: string | undefined): OrgBundleResult {
  const auth = authorizeOrgToken(slugValue, token, ["read", "setup"]);
  if (!auth.ok) return auth;
  const bundle = normalizeBundle(auth.org.bundle);
  if (!bundle) return { ok: false, status: 404, error: "Org setup bundle not found", slug: auth.org.slug, tokenName: auth.tokenName, auditAction: "bundle_missing" };
  return { ok: true, org: auth.org, bundle, tokenName: auth.tokenName };
}

export function authorizeOrgToken(slugValue: string | undefined, token: string | undefined, allowedScopes: string[]): OrgAuthResult {
  const slug = cleanOrgSlug(slugValue);
  if (!slug) return { ok: false, status: 400, error: "Invalid org slug", auditAction: "org_invalid_slug" };
  const store = readOrgStore();
  const org = store.organizations?.find((row) => row.slug === slug);
  if (!org) return { ok: false, status: 404, error: "Org not found", slug, auditAction: "org_missing" };
  if (!token) return { ok: false, status: 401, error: "Org token required", slug, auditAction: "org_token_missing" };
  const tokens = Array.isArray(org.tokens) ? org.tokens : [];
  const tokenRow = tokens.find((row) => tokenMatches(token, row.hash));
  if (!tokenRow) return { ok: false, status: 403, error: "Invalid org token", slug, auditAction: "org_token_denied" };
  const tokenName = typeof tokenRow.name === "string" && tokenRow.name ? tokenRow.name : "unnamed";
  const expiresAt = tokenRow.expires_at ? Date.parse(tokenRow.expires_at) : Number.POSITIVE_INFINITY;
  if (tokenRow.expires_at && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) {
    return { ok: false, status: 403, error: "Org token expired", slug, tokenName, auditAction: "org_token_expired" };
  }
  const scopes = Array.isArray(tokenRow.scopes) ? tokenRow.scopes : [];
  if (!allowedScopes.some((scope) => scopes.includes(scope))) {
    return { ok: false, status: 403, error: "Org token cannot perform this action", slug, tokenName, auditAction: "org_scope_denied" };
  }
  return { ok: true, org, tokenName };
}

export function authorizeAnyOrgToken(token: string | undefined, allowedScopes: string[]): OrgAuthResult {
  if (!token) return { ok: false, status: 401, error: "Org token required", auditAction: "org_token_missing" };
  const store = readOrgStore();
  for (const org of store.organizations ?? []) {
    const tokens = Array.isArray(org.tokens) ? org.tokens : [];
    const tokenRow = tokens.find((row) => tokenMatches(token, row.hash));
    if (!tokenRow) continue;
    const tokenName = typeof tokenRow.name === "string" && tokenRow.name ? tokenRow.name : "unnamed";
    const expiresAt = tokenRow.expires_at ? Date.parse(tokenRow.expires_at) : Number.POSITIVE_INFINITY;
    if (tokenRow.expires_at && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) {
      return { ok: false, status: 403, error: "Org token expired", slug: org.slug, tokenName, auditAction: "org_token_expired" };
    }
    const scopes = Array.isArray(tokenRow.scopes) ? tokenRow.scopes : [];
    if (!allowedScopes.some((scope) => scopes.includes(scope))) {
      return { ok: false, status: 403, error: "Org token cannot perform this action", slug: org.slug, tokenName, auditAction: "org_scope_denied" };
    }
    return { ok: true, org, tokenName };
  }
  return { ok: false, status: 403, error: "Invalid org token", auditAction: "org_token_denied" };
}

export function appendOrgAudit(input: { slug: string; action: string; tokenName?: string; subject?: string; target?: string }) {
  mkdirSync(path.dirname(orgAuditPath), { recursive: true });
  appendFileSync(orgAuditPath, `${JSON.stringify({
    slug: input.slug,
    action: input.action,
    token_name: input.tokenName ?? null,
    subject: input.subject ?? null,
    target: input.target ?? null,
    at: new Date().toISOString()
  })}\n`);
}

function readOrgStore(): OrgStore {
  if (!existsSync(orgsPath)) return { organizations: [] };
  try {
    const parsed = JSON.parse(readFileSync(orgsPath, "utf8")) as OrgStore;
    return { organizations: Array.isArray(parsed.organizations) ? parsed.organizations : [] };
  } catch {
    return { organizations: [] };
  }
}

function normalizeBundle(bundle: OrgRecord["bundle"]): OrgBundle | undefined {
  if (!bundle || !Array.isArray(bundle.harnesses)) return undefined;
  return {
    version: typeof bundle.version === "string" && bundle.version ? bundle.version : "0.1.0",
    harnesses: bundle.harnesses
      .flatMap((item) => {
        const owner = cleanOwnerSegment(item.owner);
        const name = cleanRefSegment(item.name);
        if (!owner || !name) return [];
        const version = cleanVersion(item.version);
        const target = cleanTarget(item.target);
        return [{
          owner,
          name,
          ...(version ? { version } : {}),
          ...(target ? { target } : {})
        }];
      }),
    configs: (Array.isArray(bundle.configs) ? bundle.configs : [])
      .map((item) => ({ path: cleanConfigPath(item.path), content: typeof item.content === "string" ? item.content : "" }))
      .filter((item): item is OrgBundleConfig => Boolean(item.path && item.content.length <= 128 * 1024))
  };
}

function tokenMatches(token: string, storedHash: string | undefined): boolean {
  if (typeof storedHash !== "string" || !storedHash.startsWith("sha256:")) return false;
  const actual = Buffer.from(tokenHash(token));
  const expected = Buffer.from(storedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function cleanRefSegment(value: string | undefined): string | undefined {
  return value && /^[a-z0-9][a-z0-9_-]{1,80}$/.test(value) ? value : undefined;
}

function cleanOwnerSegment(value: string | undefined): string | undefined {
  return value && /^@?[a-z0-9][a-z0-9_-]{1,80}$/.test(value) ? value : undefined;
}

function cleanVersion(value: string | undefined): string | undefined {
  return value && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,60}$/.test(value) ? value : undefined;
}

function cleanTarget(value: string | undefined): string | undefined {
  return value && /^[a-z0-9][a-z0-9._/-]{1,100}$/.test(value) && !value.includes("..") ? value : undefined;
}

function cleanConfigPath(value: string | undefined): string | undefined {
  if (!value || value.includes("..") || path.isAbsolute(value)) return undefined;
  return /^[a-zA-Z0-9._/@-]+$/.test(value) ? value : undefined;
}
