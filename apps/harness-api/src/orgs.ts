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
  id?: string;
  slug: string;
  name: string;
  plan: "free" | "team" | "enterprise";
  tokens?: Array<{
    id?: string;
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

export type OrgAuditEntry = {
  slug: string;
  action: string;
  token_name: string | null;
  subject: string | null;
  target: string | null;
  at: string;
};

type SupabaseOrgRow = {
  id?: string;
  slug?: string;
  name?: string;
  plan?: string;
};

type SupabaseTokenRow = {
  id?: string;
  org_id?: string;
  name?: string;
  token_hash?: string;
  scopes?: string[] | string | null;
  expires_at?: string | null;
};

type SupabaseBundleRow = {
  version?: string;
  bundle?: unknown;
};

type SupabaseAuditRow = {
  action?: string;
  target?: string | null;
  metadata?: {
    token_name?: unknown;
    subject?: unknown;
  } | null;
  created_at?: string;
};

type SupabaseLoad<T> =
  | { status: "found"; value: T }
  | { status: "missing" }
  | { status: "unavailable" };

export function tokenHash(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

export function cleanOrgSlug(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/^@/, "");
  return cleaned && /^[a-z][a-z0-9_-]{1,48}$/.test(cleaned) ? cleaned : undefined;
}

export async function readOrgBundle(slugValue: string | undefined, token: string | undefined): Promise<OrgBundleResult> {
  const auth = await authorizeOrgToken(slugValue, token, ["read", "setup"]);
  if (!auth.ok) return auth;
  const bundle = normalizeBundle(auth.org.bundle) ?? await readBundleForAuthorizedOrg(auth.org);
  if (!bundle) return { ok: false, status: 404, error: "Org setup bundle not found", slug: auth.org.slug, tokenName: auth.tokenName, auditAction: "bundle_missing" };
  return { ok: true, org: auth.org, bundle, tokenName: auth.tokenName };
}

export async function authorizeOrgToken(slugValue: string | undefined, token: string | undefined, allowedScopes: string[]): Promise<OrgAuthResult> {
  const slug = cleanOrgSlug(slugValue);
  if (!slug) return { ok: false, status: 400, error: "Invalid org slug", auditAction: "org_invalid_slug" };
  if (!token) return { ok: false, status: 401, error: "Org token required", slug, auditAction: "org_token_missing" };

  const remote = await readSupabaseOrgBySlug(slug, true);
  if (remote.status === "found") return authorizeTokenFromOrg(remote.value, token, allowedScopes);

  return authorizeTokenFromOrg(readLocalOrg(slug), token, allowedScopes, slug);
}

export async function authorizeAnyOrgToken(token: string | undefined, allowedScopes: string[]): Promise<OrgAuthResult> {
  if (!token) return { ok: false, status: 401, error: "Org token required", auditAction: "org_token_missing" };

  const remote = await readSupabaseToken(token);
  if (remote.status === "found") {
    const org = await readSupabaseOrgById(remote.value.orgId);
    if (org.status === "found") return authorizeTokenRow(org.value, remote.value.token, allowedScopes);
    if (org.status === "missing") return { ok: false, status: 404, error: "Org not found", auditAction: "org_missing" };
  }

  for (const org of readOrgStore().organizations ?? []) {
    const auth = authorizeTokenFromOrg(org, token, allowedScopes);
    if (auth.ok) return auth;
    if (auth.auditAction === "org_token_expired" || auth.auditAction === "org_scope_denied") return auth;
  }
  return { ok: false, status: 403, error: "Invalid org token", auditAction: "org_token_denied" };
}

export async function appendOrgAudit(input: { slug: string; action: string; tokenName?: string; subject?: string; target?: string }): Promise<void> {
  if (await appendSupabaseOrgAudit(input)) return;
  appendLocalOrgAudit(input);
}

export async function readOrgAudit(slugValue: string | undefined, limit = 50): Promise<OrgAuditEntry[]> {
  const remote = await readSupabaseOrgAudit(slugValue, limit);
  if (remote) return remote;
  return readLocalOrgAudit(slugValue, limit);
}

function authorizeTokenFromOrg(org: OrgRecord | undefined, token: string, allowedScopes: string[], slug?: string): OrgAuthResult {
  if (!org) return { ok: false, status: 404, error: "Org not found", ...(slug ? { slug } : {}), auditAction: "org_missing" };
  const tokens = Array.isArray(org.tokens) ? org.tokens : [];
  const tokenRow = tokens.find((row) => tokenMatches(token, row.hash));
  if (!tokenRow) return { ok: false, status: 403, error: "Invalid org token", slug: org.slug, auditAction: "org_token_denied" };
  return authorizeTokenRow(org, tokenRow, allowedScopes);
}

function authorizeTokenRow(org: OrgRecord, tokenRow: NonNullable<OrgRecord["tokens"]>[number], allowedScopes: string[]): OrgAuthResult {
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

async function readBundleForAuthorizedOrg(org: OrgRecord): Promise<OrgBundle | undefined> {
  if (org.id) {
    const remote = await readSupabaseBundle(org.id);
    if (remote.status === "found") return remote.value;
  }
  return normalizeBundle(readLocalOrg(org.slug)?.bundle);
}

function readOrgStore(): OrgStore {
  if (!existsSync(localOrgsPath())) return { organizations: [] };
  try {
    const parsed = JSON.parse(readFileSync(localOrgsPath(), "utf8")) as OrgStore;
    return { organizations: Array.isArray(parsed.organizations) ? parsed.organizations : [] };
  } catch {
    return { organizations: [] };
  }
}

function readLocalOrg(slug: string): OrgRecord | undefined {
  return readOrgStore().organizations?.find((row) => row.slug === slug);
}

function appendLocalOrgAudit(input: { slug: string; action: string; tokenName?: string; subject?: string; target?: string }) {
  mkdirSync(path.dirname(localOrgAuditPath()), { recursive: true });
  appendFileSync(localOrgAuditPath(), `${JSON.stringify({
    slug: input.slug,
    action: input.action,
    token_name: input.tokenName ?? null,
    subject: input.subject ?? null,
    target: input.target ?? null,
    at: new Date().toISOString()
  })}\n`);
}

function readLocalOrgAudit(slugValue: string | undefined, limit = 50): OrgAuditEntry[] {
  const slug = cleanOrgSlug(slugValue);
  if (!slug || !existsSync(localOrgAuditPath())) return [];
  const rows = readFileSync(localOrgAuditPath(), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as Partial<OrgAuditEntry>;
        if (parsed.slug !== slug) return [];
        return [{
          slug,
          action: typeof parsed.action === "string" ? parsed.action : "unknown",
          token_name: typeof parsed.token_name === "string" ? parsed.token_name : null,
          subject: typeof parsed.subject === "string" ? parsed.subject : null,
          target: typeof parsed.target === "string" ? parsed.target : null,
          at: typeof parsed.at === "string" ? parsed.at : ""
        }];
      } catch {
        return [];
      }
    });
  return rows.slice(-boundedLimit(limit)).reverse();
}

async function readSupabaseOrgBySlug(slug: string, withTokens: boolean): Promise<SupabaseLoad<OrgRecord>> {
  const rows = await supabaseRows<SupabaseOrgRow>("organizations", {
    select: "id,slug,name,plan",
    slug: `eq.${slug}`,
    limit: "1"
  });
  if (!rows) return { status: "unavailable" };
  const org = normalizeSupabaseOrg(rows[0]);
  if (!org) return { status: "missing" };
  if (!withTokens || !org.id) return { status: "found", value: org };
  const tokenRows = await supabaseRows<SupabaseTokenRow>("org_tokens", {
    select: "id,org_id,name,token_hash,scopes,expires_at",
    org_id: `eq.${org.id}`,
    revoked_at: "is.null"
  });
  if (!tokenRows) return { status: "unavailable" };
  return { status: "found", value: { ...org, tokens: tokenRows.flatMap(normalizeSupabaseToken) } };
}

async function readSupabaseOrgById(id: string | undefined): Promise<SupabaseLoad<OrgRecord>> {
  if (!id) return { status: "missing" };
  const rows = await supabaseRows<SupabaseOrgRow>("organizations", {
    select: "id,slug,name,plan",
    id: `eq.${id}`,
    limit: "1"
  });
  if (!rows) return { status: "unavailable" };
  const org = normalizeSupabaseOrg(rows[0]);
  return org ? { status: "found", value: org } : { status: "missing" };
}

async function readSupabaseToken(token: string): Promise<SupabaseLoad<{ orgId: string; token: NonNullable<OrgRecord["tokens"]>[number] }>> {
  const rows = await supabaseRows<SupabaseTokenRow>("org_tokens", {
    select: "id,org_id,name,token_hash,scopes,expires_at",
    token_hash: `eq.${tokenHash(token)}`,
    revoked_at: "is.null",
    limit: "1"
  });
  if (!rows) return { status: "unavailable" };
  const row = rows[0];
  const normalized = normalizeSupabaseToken(row)[0];
  if (!row?.org_id || !normalized) return { status: "missing" };
  return { status: "found", value: { orgId: row.org_id, token: normalized } };
}

async function readSupabaseBundle(orgId: string): Promise<SupabaseLoad<OrgBundle>> {
  const rows = await supabaseRows<SupabaseBundleRow>("org_setup_bundles", {
    select: "version,bundle",
    org_id: `eq.${orgId}`,
    limit: "1"
  });
  if (!rows) return { status: "unavailable" };
  const row = rows[0];
  const bundle = normalizeBundle({
    version: row?.version,
    ...(row?.bundle && typeof row.bundle === "object" ? row.bundle as Record<string, unknown> : {})
  });
  return bundle ? { status: "found", value: bundle } : { status: "missing" };
}

async function appendSupabaseOrgAudit(input: { slug: string; action: string; tokenName?: string; subject?: string; target?: string }): Promise<boolean> {
  const slug = cleanOrgSlug(input.slug);
  if (!slug) return false;
  const org = await readSupabaseOrgBySlug(slug, false);
  if (org.status !== "found" || !org.value.id) return false;
  const response = await supabaseRequest("org_audit_log", undefined, {
    method: "POST",
    headers: { ...supabaseHeaders(), "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({
      org_id: org.value.id,
      action: cleanAuditText(input.action, "unknown"),
      target: input.target ? cleanAuditText(input.target, "") : null,
      metadata: {
        token_name: input.tokenName ?? null,
        subject: input.subject ?? null
      }
    })
  });
  return response?.ok ?? false;
}

async function readSupabaseOrgAudit(slugValue: string | undefined, limit: number): Promise<OrgAuditEntry[] | undefined> {
  const slug = cleanOrgSlug(slugValue);
  if (!slug) return undefined;
  const org = await readSupabaseOrgBySlug(slug, false);
  if (org.status !== "found" || !org.value.id) return undefined;
  const rows = await supabaseRows<SupabaseAuditRow>("org_audit_log", {
    select: "action,target,metadata,created_at",
    org_id: `eq.${org.value.id}`,
    order: "created_at.desc",
    limit: String(boundedLimit(limit))
  });
  if (!rows) return undefined;
  return rows.map((row) => ({
    slug,
    action: typeof row.action === "string" ? row.action : "unknown",
    token_name: typeof row.metadata?.token_name === "string" ? row.metadata.token_name : null,
    subject: typeof row.metadata?.subject === "string" ? row.metadata.subject : null,
    target: typeof row.target === "string" ? row.target : null,
    at: typeof row.created_at === "string" ? row.created_at : ""
  }));
}

async function supabaseRows<T>(table: string, params: Record<string, string>): Promise<T[] | undefined> {
  const response = await supabaseRequest(table, params);
  if (!response?.ok) return undefined;
  try {
    const body = await response.json();
    return Array.isArray(body) ? body as T[] : undefined;
  } catch {
    return undefined;
  }
}

async function supabaseRequest(table: string, params?: Record<string, string>, init?: RequestInit): Promise<Response | undefined> {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return undefined;
  const query = params ? `?${new URLSearchParams(params).toString()}` : "";
  try {
    return await fetch(`${url}/rest/v1/${table}${query}`, {
      ...init,
      headers: {
        ...supabaseHeaders(),
        ...(init?.headers ?? {})
      }
    });
  } catch {
    return undefined;
  }
}

function normalizeSupabaseOrg(row: SupabaseOrgRow | undefined): OrgRecord | undefined {
  const slug = cleanOrgSlug(row?.slug);
  if (!slug || !row?.id) return undefined;
  const plan = row.plan === "team" || row.plan === "enterprise" ? row.plan : "free";
  return {
    id: row.id,
    slug,
    name: typeof row.name === "string" && row.name ? row.name : slug,
    plan
  };
}

function normalizeSupabaseToken(row: SupabaseTokenRow | undefined): NonNullable<OrgRecord["tokens"]> {
  if (!row?.token_hash?.startsWith("sha256:")) return [];
  return [{
    id: row.id,
    name: typeof row.name === "string" && row.name ? row.name : "unnamed",
    hash: row.token_hash,
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((scope): scope is string => typeof scope === "string") : [],
    expires_at: row.expires_at ?? null
  }];
}

function normalizeBundle(bundle: unknown): OrgBundle | undefined {
  if (!bundle || typeof bundle !== "object") return undefined;
  const input = bundle as Partial<OrgBundle>;
  if (!Array.isArray(input.harnesses)) return undefined;
  return {
    version: typeof input.version === "string" && input.version ? input.version : "0.1.0",
    harnesses: input.harnesses
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
    configs: (Array.isArray(input.configs) ? input.configs : [])
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

function cleanAuditText(value: string | undefined, fallback: string): string {
  const cleaned = value?.replace(/[^\w:@./-]+/g, "_").slice(0, 160);
  return cleaned || fallback;
}

function boundedLimit(limit: number): number {
  return Math.max(1, Math.min(limit, 200));
}

function localOrgsPath(): string {
  return path.resolve(process.env.HARNESS_ORGS_PATH ?? path.join(workspaceRoot, "data/orgs.json"));
}

function localOrgAuditPath(): string {
  return path.resolve(process.env.HARNESS_ORG_AUDIT_PATH ?? path.join(workspaceRoot, "data/org-audit.jsonl"));
}

function supabaseUrl(): string | undefined {
  return process.env.SUPABASE_URL?.replace(/\/$/, "");
}

function supabaseHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return {
    apikey: key,
    authorization: `Bearer ${key}`
  };
}
