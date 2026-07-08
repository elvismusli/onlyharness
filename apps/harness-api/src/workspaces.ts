import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { workspaceRoot } from "./registry.js";
import { cleanOrgSlug, tokenHash, authorizeOrgToken, appendOrgAudit, readOrgAudit, type OrgRecord, type OrgAuditEntry } from "./orgs.js";
import * as resources from "./resources.js";

export type WorkspaceType = "company" | "community" | "team" | "course" | "agency" | "chat";
export type WorkspaceVisibility = "private" | "invite_only" | "gated" | "public" | "unlisted";
export type WorkspaceRole = "owner" | "admin" | "moderator" | "publisher" | "member" | "viewer";

export type WorkspaceRecord = {
  id?: string;
  slug: string;
  name: string;
  type: WorkspaceType;
  visibility: WorkspaceVisibility;
  plan: "free" | "team" | "enterprise";
  description?: string | null;
  avatar_url?: string | null;
  tokens?: WorkspaceToken[];
};

export type WorkspaceToken = {
  id?: string;
  name: string;
  hash: string;
  scopes: string[];
  expires_at?: string | null;
};

export type WorkspaceAuditEntry = {
  slug: string;
  action: string;
  token_name: string | null;
  subject: string | null;
  target: string | null;
  at: string;
};

export type WorkspaceApprovalState = "pending_review" | "approved" | "approved_with_warning" | "blocked" | "blocked_by_scan" | "deprecated";
export type WorkspaceCollectionVisibility = "workspace" | "public" | "unlisted";

export type WorkspaceCollectionItem = {
  id: string;
  itemRef: string;
  itemSource: "public_resource" | "workspace_resource" | "native_harness" | "external_url";
  sourceResourceId?: string;
  pinnedVersion?: string | null;
  pinnedArchiveHash?: string | null;
  approvalState: WorkspaceApprovalState;
  approvedBy?: string | null;
  approvedAt?: string | null;
  note?: string | null;
  riskSnapshot?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceCollection = {
  slug: string;
  title: string;
  summary?: string | null;
  visibility: WorkspaceCollectionVisibility;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  items: WorkspaceCollectionItem[];
};

type WorkspaceStore = {
  workspaces?: WorkspaceRecord[];
};

type ResourceCatalogFile = {
  generatedAt: string;
  source: {
    catalog: string;
    sourceCheckedAt: string;
    externalSeedCount: number;
  };
  resources: resources.Resource[];
};

type WorkspaceCollectionsFile = {
  generatedAt: string;
  collections: WorkspaceCollection[];
};

type SupabaseWorkspaceRow = {
  id?: string;
  slug?: string;
  name?: string;
  type?: string;
  visibility?: string;
  plan?: string;
  description?: string | null;
  avatar_url?: string | null;
};

type SupabaseTokenRow = {
  id?: string;
  workspace_id?: string;
  name?: string;
  token_hash?: string;
  scopes?: string[] | string | null;
  expires_at?: string | null;
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

export type WorkspaceAuthResult =
  | { ok: true; workspace: WorkspaceRecord; tokenName: string; via: "workspace_token" | "legacy_org_token" }
  | { ok: false; status: number; error: string; slug?: string; tokenName?: string; auditAction: string };

export type WorkspaceApprovalResult =
  | { ok: true; collection: WorkspaceCollection; item: WorkspaceCollectionItem; resource: resources.Resource; approvalState: WorkspaceApprovalState }
  | { ok: false; status: number; error: string; code: string };

export function cleanWorkspaceSlug(value: string | undefined): string | undefined {
  return cleanOrgSlug(value);
}

export async function authorizeWorkspaceToken(slugValue: string | undefined, token: string | undefined, requiredScopes: string[]): Promise<WorkspaceAuthResult> {
  const slug = cleanWorkspaceSlug(slugValue);
  if (!slug) return { ok: false, status: 400, error: "Invalid workspace slug", auditAction: "workspace_invalid_slug" };
  if (!token) return { ok: false, status: 401, error: "Workspace token required", slug, auditAction: "workspace_token_missing" };

  const workspace = await readWorkspaceBySlug(slug, true);
  if (workspace.status === "found") return authorizeTokenFromWorkspace(workspace.value, token, requiredScopes);

  const legacy = await authorizeOrgToken(slug, token, mapWorkspaceScopesToLegacyOrgScopes(requiredScopes));
  if (legacy.ok) return { ok: true, workspace: workspaceFromLegacyOrg(legacy.org), tokenName: legacy.tokenName, via: "legacy_org_token" };
  if (legacy.status !== 404) {
    return {
      ok: false,
      status: legacy.status,
      error: legacy.error.replace(/^Org/, "Workspace"),
      slug: legacy.slug ?? slug,
      tokenName: legacy.tokenName,
      auditAction: legacy.auditAction.replace(/^org/, "workspace")
    };
  }
  return { ok: false, status: 404, error: "Workspace not found", slug, auditAction: "workspace_missing" };
}

export async function appendWorkspaceAudit(input: { slug: string; action: string; tokenName?: string; subject?: string; target?: string; via?: "workspace_token" | "legacy_org_token" }): Promise<void> {
  if (input.via === "legacy_org_token") {
    await appendOrgAudit({ slug: input.slug, action: `workspace_${input.action}`, tokenName: input.tokenName, subject: input.subject, target: input.target });
    return;
  }
  if (await appendSupabaseWorkspaceAudit(input)) return;
  appendLocalWorkspaceAudit(input);
}

export async function readWorkspaceAudit(slugValue: string | undefined, limit = 50): Promise<WorkspaceAuditEntry[]> {
  const remote = await readSupabaseWorkspaceAudit(slugValue, limit);
  if (remote) return remote;
  const local = readLocalWorkspaceAudit(slugValue, limit);
  if (local.length) return local;
  const legacy = await readOrgAudit(slugValue, limit);
  return legacy.map(workspaceAuditFromOrgAudit);
}

export function workspaceResourceId(slug: string, name: string): string {
  return `@${slug}/${name}`;
}

export function workspaceResourceArchiveRoot(slugValue: string): string {
  const slug = cleanWorkspaceSlug(slugValue);
  if (!slug) throw new Error("Invalid workspace slug");
  const root = process.env.WORKSPACE_RESOURCE_ARCHIVE_DIR
    ? path.resolve(process.env.WORKSPACE_RESOURCE_ARCHIVE_DIR, slug)
    : path.join(workspaceDataRoot(slug), "resource-archives");
  mkdirSync(root, { recursive: true });
  return root;
}

export function workspaceResourceArchivePath(slugValue: string, resourceId: string): string | undefined {
  const slug = cleanWorkspaceSlug(slugValue);
  if (!slug) return undefined;
  const archivePath = path.join(workspaceResourceArchiveRoot(slug), `${resources.resourceArchiveKey(resourceId)}.tar.gz`);
  return existsSync(archivePath) ? archivePath : undefined;
}

export function upsertWorkspaceResource(slugValue: string, resource: resources.Resource): ResourceCatalogFile {
  const slug = cleanWorkspaceSlug(slugValue);
  if (!slug) throw new Error("Invalid workspace slug");
  const existing = readWorkspaceResourceCatalog(slug);
  const rows = [resource, ...existing.resources.filter((item) => item.id !== resource.id)];
  const now = new Date().toISOString();
  const catalog: ResourceCatalogFile = {
    generatedAt: now,
    source: {
      catalog: path.relative(workspaceRoot, workspaceResourceCatalogPath(slug)),
      sourceCheckedAt: now,
      externalSeedCount: rows.length
    },
    resources: rows
  };
  mkdirSync(path.dirname(workspaceResourceCatalogPath(slug)), { recursive: true });
  writeFileSync(workspaceResourceCatalogPath(slug), `${JSON.stringify(catalog, null, 2)}\n`);
  return catalog;
}

export function listWorkspaceCollections(slugValue: string): WorkspaceCollection[] {
  const slug = cleanWorkspaceSlug(slugValue);
  if (!slug) return [];
  return withDefaultCollection(readWorkspaceCollectionsFile(slug).collections).filter((collection) => !collection.archivedAt);
}

export function workspaceCollectionDetail(slugValue: string, collectionSlugValue: string): WorkspaceCollection | undefined {
  const slug = cleanWorkspaceSlug(slugValue);
  const collectionSlug = cleanCollectionSlug(collectionSlugValue);
  if (!slug || !collectionSlug) return undefined;
  return listWorkspaceCollections(slug).find((collection) => collection.slug === collectionSlug);
}

export function upsertWorkspaceCollection(slugValue: string, input: { slug?: string; title?: string; summary?: string | null; visibility?: string }): WorkspaceCollection {
  const slug = cleanWorkspaceSlug(slugValue);
  if (!slug) throw new Error("Invalid workspace slug");
  const collectionSlug = cleanCollectionSlug(input.slug ?? input.title ?? "approved") ?? "approved";
  const existing = withDefaultCollection(readWorkspaceCollectionsFile(slug).collections);
  const previous = existing.find((collection) => collection.slug === collectionSlug);
  const now = new Date().toISOString();
  const collection: WorkspaceCollection = {
    slug: collectionSlug,
    title: cleanCollectionTitle(input.title) ?? previous?.title ?? titleizeCollectionSlug(collectionSlug),
    summary: cleanCollectionSummary(input.summary) ?? previous?.summary ?? null,
    visibility: normalizeCollectionVisibility(input.visibility ?? previous?.visibility),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    archivedAt: previous?.archivedAt ?? null,
    items: previous?.items ?? []
  };
  writeWorkspaceCollectionsFile(slug, [collection, ...existing.filter((item) => item.slug !== collectionSlug)]);
  return collection;
}

export function approveWorkspacePublicResource(slugValue: string, workspaceName: string, publicResource: resources.Resource, input: { collectionSlug?: string; name?: string; note?: string; actor?: string }): WorkspaceApprovalResult {
  const slug = cleanWorkspaceSlug(slugValue);
  if (!slug) return { ok: false, status: 400, error: "Invalid workspace slug", code: "INVALID_WORKSPACE" };
  const scan = publicResource.trust?.securityScan ?? "not_scanned";
  if (scan === "not_scanned") {
    return {
      ok: false,
      status: 409,
      error: "Resource has not been security scanned; it cannot be approved for workspace install paths.",
      code: "RESOURCE_NOT_SCANNED"
    };
  }
  if (scan === "fail") {
    return {
      ok: false,
      status: 409,
      error: "Resource security scan failed; it cannot be approved for workspace install paths.",
      code: "RESOURCE_SCAN_FAILED"
    };
  }

  const collectionSlug = cleanCollectionSlug(input.collectionSlug ?? "approved") ?? "approved";
  const collection = upsertWorkspaceCollection(slug, { slug: collectionSlug });
  const name = workspaceResourceNameForApproval(publicResource, input.name);
  if (!name) return { ok: false, status: 400, error: "Invalid approved resource name", code: "INVALID_RESOURCE_NAME" };

  const approvedId = workspaceResourceId(slug, name);
  const existing = workspaceResourceDetail(slug, approvedId);
  if (existing && existing.sourceCatalogId && existing.sourceCatalogId !== publicResource.id) {
    return {
      ok: false,
      status: 409,
      error: `Workspace resource ${approvedId} already points at ${existing.sourceCatalogId}.`,
      code: "WORKSPACE_RESOURCE_NAME_CONFLICT"
    };
  }
  if (existing && !existing.sourceCatalogId && existing.id === approvedId) {
    return {
      ok: false,
      status: 409,
      error: `Workspace resource ${approvedId} already exists as a hosted private package.`,
      code: "WORKSPACE_RESOURCE_NAME_CONFLICT"
    };
  }

  const now = new Date().toISOString();
  const approvalState: WorkspaceApprovalState = scan === "warn" ? "approved_with_warning" : "approved";
  const canonicalUrl = `https://onlyharness.com/#/workspaces/${encodeURIComponent(slug)}/resources/${encodeURIComponent(name)}`;
  const riskSnapshot = {
    sourceResourceId: publicResource.id,
    sourceCheckedAt: publicResource.sourceCheckedAt,
    sourceCheckStatus: publicResource.sourceCheckStatus,
    licenseStatus: publicResource.licenseStatus,
    trust: publicResource.trust
  };
  const base: Omit<resources.Resource, "popularityScore" | "popularityBreakdown"> = {
    ...publicResource,
    id: approvedId,
    identity: { scheme: "onlyharness", key: `workspaces/${slug}/approved/${name}`, subpath: publicResource.id },
    sourceCatalogId: publicResource.id,
    canonicalUrl,
    tags: dedupeWorkspaceTags(["workspace-approved", "approved", ...publicResource.tags]),
    actions: approvedResourceActions(publicResource, canonicalUrl, workspaceName),
    workspaceApproval: {
      workspaceSlug: slug,
      workspaceName,
      collectionSlug,
      sourceResourceId: publicResource.id,
      approvalState,
      approvedBy: input.actor,
      approvedAt: now,
      note: cleanCollectionSummary(input.note),
      riskSnapshot
    }
  };
  const score = resources.popularityScore(base);
  const resource: resources.Resource = {
    ...base,
    popularityScore: score.total,
    popularityBreakdown: {
      upstreamScore: round2(score.upstreamScore),
      onlyHarnessScore: round2(score.onlyHarnessScore),
      freshnessBoost: score.freshnessBoost,
      riskPenalty: score.riskPenalty
    }
  };

  upsertWorkspaceResource(slug, resource);
  const item = upsertCollectionItem(slug, collectionSlug, {
    itemRef: resource.id,
    itemSource: "public_resource",
    sourceResourceId: publicResource.id,
    approvalState,
    approvedBy: input.actor,
    approvedAt: now,
    note: cleanCollectionSummary(input.note) ?? null,
    riskSnapshot
  });
  const updatedCollection = workspaceCollectionDetail(slug, collectionSlug) ?? collection;
  return { ok: true, collection: updatedCollection, item, resource, approvalState };
}

export function searchWorkspaceResources(slugValue: string, query: resources.ResourceQuery): resources.ResourceSearchResult {
  const slug = cleanWorkspaceSlug(slugValue);
  const all = slug ? readWorkspaceResourceCatalog(slug).resources : [];
  let rows = all;
  if (query.q) {
    const terms = query.q.toLowerCase().split(/\s+/).filter(Boolean);
    rows = rows.filter((resource) => {
      const haystack = [
        resource.id,
        resource.title,
        resource.summary,
        resource.resourceType,
        resource.sourcePlatform,
        resource.upstreamId,
        resource.upstreamOwner,
        resource.upstreamRepo ?? "",
        resource.tags.join(" "),
        resource.worksWith.join(" ")
      ].join(" ").toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }
  if (query.type && query.type !== "all") rows = rows.filter((resource) => resource.resourceType === query.type);
  if (query.source && query.source !== "all") rows = rows.filter((resource) => resource.sourcePlatform === query.source);
  if (query.installability && query.installability !== "all") rows = rows.filter((resource) => resource.installability === query.installability);
  if (query.worksWith && query.worksWith !== "all") rows = rows.filter((resource) => resource.worksWith.includes(query.worksWith as resources.Resource["worksWith"][number]));
  if (query.license && query.license !== "all") rows = rows.filter((resource) => resource.licenseStatus === query.license);

  rows = sortWorkspaceResources(rows, query.sort ?? "popular");
  const limit = Number(query.limit ?? 50);
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 200)) : 50;
  const sliced = rows.slice(0, boundedLimit);
  return {
    resources: sliced,
    items: sliced,
    counts: {
      externalSeed: 0,
      internal: all.length,
      total: rows.length
    }
  };
}

export function workspaceResourceDetail(slugValue: string, idValue: string): resources.Resource | undefined {
  const slug = cleanWorkspaceSlug(slugValue);
  if (!slug) return undefined;
  const decoded = decodeURIComponent(idValue);
  const normalized = decoded.replace(/^@[^/]+\//, "").replace(/^packages\//, "");
  const expectedId = workspaceResourceId(slug, normalized);
  return readWorkspaceResourceCatalog(slug).resources.find((resource) => resource.id === decoded || resource.id === expectedId || resource.upstreamRepo === normalized);
}

async function readWorkspaceBySlug(slug: string, withTokens: boolean): Promise<SupabaseLoad<WorkspaceRecord>> {
  const remote = await readSupabaseWorkspaceBySlug(slug, withTokens);
  if (remote.status !== "unavailable") return remote;
  const local = readLocalWorkspace(slug);
  return local ? { status: "found", value: local } : { status: "missing" };
}

async function readSupabaseWorkspaceBySlug(slug: string, withTokens: boolean): Promise<SupabaseLoad<WorkspaceRecord>> {
  const rows = await supabaseRows<SupabaseWorkspaceRow>("workspaces", {
    select: "id,slug,name,type,visibility,plan,description,avatar_url",
    slug: `eq.${slug}`,
    archived_at: "is.null",
    limit: "1"
  });
  if (!rows) return { status: "unavailable" };
  const workspace = normalizeSupabaseWorkspace(rows[0]);
  if (!workspace) return { status: "missing" };
  if (!withTokens || !workspace.id) return { status: "found", value: workspace };
  const tokenRows = await supabaseRows<SupabaseTokenRow>("workspace_tokens", {
    select: "id,workspace_id,name,token_hash,scopes,expires_at",
    workspace_id: `eq.${workspace.id}`,
    revoked_at: "is.null"
  });
  if (!tokenRows) return { status: "unavailable" };
  return { status: "found", value: { ...workspace, tokens: tokenRows.flatMap(normalizeSupabaseToken) } };
}

function authorizeTokenFromWorkspace(workspace: WorkspaceRecord, token: string, requiredScopes: string[]): WorkspaceAuthResult {
  const tokenRow = (workspace.tokens ?? []).find((row) => tokenMatches(token, row.hash));
  if (!tokenRow) return { ok: false, status: 403, error: "Invalid workspace token", slug: workspace.slug, auditAction: "workspace_token_denied" };
  const tokenName = typeof tokenRow.name === "string" && tokenRow.name ? tokenRow.name : "unnamed";
  const expiresAt = tokenRow.expires_at ? Date.parse(tokenRow.expires_at) : Number.POSITIVE_INFINITY;
  if (tokenRow.expires_at && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) {
    return { ok: false, status: 403, error: "Workspace token expired", slug: workspace.slug, tokenName, auditAction: "workspace_token_expired" };
  }
  const scopes = Array.isArray(tokenRow.scopes) ? tokenRow.scopes : [];
  if (!requiredScopes.some((scope) => scopeAllowed(scope, scopes))) {
    return { ok: false, status: 403, error: "Workspace token cannot perform this action", slug: workspace.slug, tokenName, auditAction: "workspace_scope_denied" };
  }
  return { ok: true, workspace, tokenName, via: "workspace_token" };
}

function scopeAllowed(required: string, scopes: string[]): boolean {
  if (scopes.includes(required) || scopes.includes("workspace:*")) return true;
  if (required === "workspace:read") return scopes.includes("read");
  if (required === "workspace:setup") return scopes.includes("setup");
  if (required === "resource:publish") return scopes.includes("publish");
  if (required === "resource:read" || required === "resource:archive") return scopes.some((scope) => ["read", "setup", "publish"].includes(scope));
  if (required === "collection:write") return scopes.some((scope) => ["publish", "collection:write"].includes(scope));
  return false;
}

function mapWorkspaceScopesToLegacyOrgScopes(scopes: string[]): string[] {
  const mapped = new Set<string>();
  for (const scope of scopes) {
    if (scope === "workspace:read" || scope === "resource:read" || scope === "resource:archive") mapped.add("read");
    if (scope === "workspace:setup") mapped.add("setup");
    if (scope === "resource:publish" || scope === "collection:write") mapped.add("publish");
  }
  if (!mapped.size) mapped.add("read");
  return [...mapped];
}

function readLocalWorkspace(slug: string): WorkspaceRecord | undefined {
  return readWorkspaceStore().workspaces?.find((row) => row.slug === slug);
}

function readWorkspaceStore(): WorkspaceStore {
  if (!existsSync(localWorkspacesPath())) return { workspaces: [] };
  try {
    const parsed = JSON.parse(readFileSync(localWorkspacesPath(), "utf8")) as WorkspaceStore;
    return { workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces.map(normalizeLocalWorkspace).filter((item): item is WorkspaceRecord => Boolean(item)) : [] };
  } catch {
    return { workspaces: [] };
  }
}

function readWorkspaceResourceCatalog(slug: string): ResourceCatalogFile {
  const catalogPath = workspaceResourceCatalogPath(slug);
  if (!existsSync(catalogPath)) {
    return {
      generatedAt: new Date(0).toISOString(),
      source: { catalog: path.relative(workspaceRoot, catalogPath), sourceCheckedAt: "", externalSeedCount: 0 },
      resources: []
    };
  }
  try {
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as ResourceCatalogFile;
    return { ...catalog, resources: Array.isArray(catalog.resources) ? catalog.resources : [] };
  } catch {
    return {
      generatedAt: new Date(0).toISOString(),
      source: { catalog: path.relative(workspaceRoot, catalogPath), sourceCheckedAt: "", externalSeedCount: 0 },
      resources: []
    };
  }
}

function readWorkspaceCollectionsFile(slug: string): WorkspaceCollectionsFile {
  const filePath = workspaceCollectionsPath(slug);
  if (!existsSync(filePath)) return { generatedAt: new Date(0).toISOString(), collections: [] };
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as WorkspaceCollectionsFile;
    return {
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : new Date(0).toISOString(),
      collections: Array.isArray(parsed.collections) ? parsed.collections.flatMap(normalizeWorkspaceCollection) : []
    };
  } catch {
    return { generatedAt: new Date(0).toISOString(), collections: [] };
  }
}

function writeWorkspaceCollectionsFile(slug: string, collections: WorkspaceCollection[]) {
  const filePath = workspaceCollectionsPath(slug);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const active = withDefaultCollection(collections).filter((collection) => !collection.archivedAt);
  writeFileSync(filePath, `${JSON.stringify({ generatedAt: new Date().toISOString(), collections: active }, null, 2)}\n`);
}

function upsertCollectionItem(slug: string, collectionSlug: string, input: Omit<WorkspaceCollectionItem, "id" | "createdAt" | "updatedAt">): WorkspaceCollectionItem {
  const file = readWorkspaceCollectionsFile(slug);
  const collections = withDefaultCollection(file.collections);
  const collection = collections.find((item) => item.slug === collectionSlug) ?? upsertWorkspaceCollection(slug, { slug: collectionSlug });
  const now = new Date().toISOString();
  const itemId = collectionItemId(collectionSlug, input.sourceResourceId ?? input.itemRef);
  const previous = collection.items.find((item) => item.id === itemId);
  const item: WorkspaceCollectionItem = {
    id: itemId,
    itemRef: input.itemRef,
    itemSource: input.itemSource,
    sourceResourceId: input.sourceResourceId,
    pinnedVersion: input.pinnedVersion ?? null,
    pinnedArchiveHash: input.pinnedArchiveHash ?? null,
    approvalState: input.approvalState,
    approvedBy: input.approvedBy ?? null,
    approvedAt: input.approvedAt ?? null,
    note: input.note ?? null,
    riskSnapshot: input.riskSnapshot,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now
  };
  const updated: WorkspaceCollection = {
    ...collection,
    updatedAt: now,
    items: [item, ...collection.items.filter((row) => row.id !== itemId)]
  };
  writeWorkspaceCollectionsFile(slug, [updated, ...collections.filter((row) => row.slug !== collectionSlug)]);
  return item;
}

async function appendSupabaseWorkspaceAudit(input: { slug: string; action: string; tokenName?: string; subject?: string; target?: string }): Promise<boolean> {
  const slug = cleanWorkspaceSlug(input.slug);
  if (!slug) return false;
  const workspace = await readSupabaseWorkspaceBySlug(slug, false);
  if (workspace.status !== "found" || !workspace.value.id) return false;
  const response = await supabaseRequest("workspace_audit", undefined, {
    method: "POST",
    headers: { ...supabaseHeaders(), "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({
      workspace_id: workspace.value.id,
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

async function readSupabaseWorkspaceAudit(slugValue: string | undefined, limit: number): Promise<WorkspaceAuditEntry[] | undefined> {
  const slug = cleanWorkspaceSlug(slugValue);
  if (!slug) return undefined;
  const workspace = await readSupabaseWorkspaceBySlug(slug, false);
  if (workspace.status !== "found" || !workspace.value.id) return undefined;
  const rows = await supabaseRows<SupabaseAuditRow>("workspace_audit", {
    select: "action,target,metadata,created_at",
    workspace_id: `eq.${workspace.value.id}`,
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

function appendLocalWorkspaceAudit(input: { slug: string; action: string; tokenName?: string; subject?: string; target?: string }) {
  mkdirSync(path.dirname(localWorkspaceAuditPath()), { recursive: true });
  appendFileSync(localWorkspaceAuditPath(), `${JSON.stringify({
    slug: input.slug,
    action: input.action,
    token_name: input.tokenName ?? null,
    subject: input.subject ?? null,
    target: input.target ?? null,
    at: new Date().toISOString()
  })}\n`);
}

function readLocalWorkspaceAudit(slugValue: string | undefined, limit = 50): WorkspaceAuditEntry[] {
  const slug = cleanWorkspaceSlug(slugValue);
  if (!slug || !existsSync(localWorkspaceAuditPath())) return [];
  const rows = readFileSync(localWorkspaceAuditPath(), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as Partial<WorkspaceAuditEntry>;
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

function normalizeSupabaseWorkspace(row: SupabaseWorkspaceRow | undefined): WorkspaceRecord | undefined {
  const slug = cleanWorkspaceSlug(row?.slug);
  if (!slug || !row?.id) return undefined;
  return {
    id: row.id,
    slug,
    name: typeof row.name === "string" && row.name ? row.name : slug,
    type: normalizeWorkspaceType(row.type),
    visibility: normalizeWorkspaceVisibility(row.visibility),
    plan: normalizePlan(row.plan),
    description: typeof row.description === "string" ? row.description : null,
    avatar_url: typeof row.avatar_url === "string" ? row.avatar_url : null
  };
}

function normalizeLocalWorkspace(row: WorkspaceRecord | undefined): WorkspaceRecord | undefined {
  const slug = cleanWorkspaceSlug(row?.slug);
  const input = row;
  if (!input || !slug) return undefined;
  return {
    id: input.id,
    slug,
    name: typeof input.name === "string" && input.name ? input.name : slug,
    type: normalizeWorkspaceType(input.type),
    visibility: normalizeWorkspaceVisibility(input.visibility),
    plan: normalizePlan(input.plan),
    description: typeof input.description === "string" ? input.description : null,
    avatar_url: typeof input.avatar_url === "string" ? input.avatar_url : null,
    tokens: Array.isArray(input.tokens) ? input.tokens.filter((token) => token.hash?.startsWith("sha256:")) : []
  };
}

function normalizeWorkspaceCollection(row: WorkspaceCollection | undefined): WorkspaceCollection[] {
  const slug = cleanCollectionSlug(row?.slug);
  if (!row || !slug) return [];
  const now = new Date().toISOString();
  return [{
    slug,
    title: cleanCollectionTitle(row.title) ?? titleizeCollectionSlug(slug),
    summary: typeof row.summary === "string" ? row.summary.slice(0, 500) : null,
    visibility: normalizeCollectionVisibility(row.visibility),
    createdAt: typeof row.createdAt === "string" ? row.createdAt : now,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : now,
    archivedAt: typeof row.archivedAt === "string" ? row.archivedAt : null,
    items: Array.isArray(row.items) ? row.items.flatMap(normalizeCollectionItem) : []
  }];
}

function normalizeCollectionItem(row: WorkspaceCollectionItem | undefined): WorkspaceCollectionItem[] {
  if (!row || typeof row.itemRef !== "string" || !row.itemRef) return [];
  const source = ["public_resource", "workspace_resource", "native_harness", "external_url"].includes(String(row.itemSource)) ? row.itemSource : "workspace_resource";
  const state = normalizeApprovalState(row.approvalState);
  const now = new Date().toISOString();
  return [{
    id: typeof row.id === "string" && row.id ? row.id : collectionItemId("item", row.sourceResourceId ?? row.itemRef),
    itemRef: row.itemRef,
    itemSource: source,
    sourceResourceId: typeof row.sourceResourceId === "string" ? row.sourceResourceId : undefined,
    pinnedVersion: typeof row.pinnedVersion === "string" ? row.pinnedVersion : null,
    pinnedArchiveHash: typeof row.pinnedArchiveHash === "string" ? row.pinnedArchiveHash : null,
    approvalState: state,
    approvedBy: typeof row.approvedBy === "string" ? row.approvedBy : null,
    approvedAt: typeof row.approvedAt === "string" ? row.approvedAt : null,
    note: typeof row.note === "string" ? row.note.slice(0, 500) : null,
    riskSnapshot: row.riskSnapshot,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : now,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : now
  }];
}

function normalizeSupabaseToken(row: SupabaseTokenRow | undefined): WorkspaceToken[] {
  if (!row?.token_hash?.startsWith("sha256:")) return [];
  return [{
    id: row.id,
    name: typeof row.name === "string" && row.name ? row.name : "unnamed",
    hash: row.token_hash,
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((scope): scope is string => typeof scope === "string") : [],
    expires_at: row.expires_at ?? null
  }];
}

function workspaceFromLegacyOrg(org: OrgRecord): WorkspaceRecord {
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    type: "company",
    visibility: "private",
    plan: org.plan
  };
}

function workspaceAuditFromOrgAudit(row: OrgAuditEntry): WorkspaceAuditEntry {
  return {
    slug: row.slug,
    action: row.action,
    token_name: row.token_name,
    subject: row.subject,
    target: row.target,
    at: row.at
  };
}

function sortWorkspaceResources(rows: resources.Resource[], sort: NonNullable<resources.ResourceQuery["sort"]>): resources.Resource[] {
  const sorted = [...rows];
  if (sort === "github-stars") return sorted.sort((a, b) => (b.upstreamPopularity.githubStarsCurrent ?? b.upstreamPopularity.githubStarsSnapshot ?? 0) - (a.upstreamPopularity.githubStarsCurrent ?? a.upstreamPopularity.githubStarsSnapshot ?? 0));
  if (sort === "new") return sorted.sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  if (sort === "source-checked") return sorted.sort((a, b) => Date.parse(b.sourceCheckedAt) - Date.parse(a.sourceCheckedAt));
  if (sort === "onlyharness") return sorted.sort((a, b) => b.popularityBreakdown.onlyHarnessScore - a.popularityBreakdown.onlyHarnessScore || b.popularityScore - a.popularityScore);
  return sorted.sort((a, b) => b.popularityScore - a.popularityScore || Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
}

function tokenMatches(token: string, storedHash: string | undefined): boolean {
  if (typeof storedHash !== "string" || !storedHash.startsWith("sha256:")) return false;
  const actual = Buffer.from(tokenHash(token));
  const expected = Buffer.from(storedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function normalizeWorkspaceType(value: unknown): WorkspaceType {
  return ["company", "community", "team", "course", "agency", "chat"].includes(String(value)) ? value as WorkspaceType : "team";
}

function normalizeWorkspaceVisibility(value: unknown): WorkspaceVisibility {
  return ["private", "invite_only", "gated", "public", "unlisted"].includes(String(value)) ? value as WorkspaceVisibility : "private";
}

function normalizePlan(value: unknown): WorkspaceRecord["plan"] {
  return value === "team" || value === "enterprise" ? value : "free";
}

function cleanAuditText(value: string | undefined, fallback: string): string {
  const cleaned = value?.replace(/[^\w:@./-]+/g, "_").slice(0, 160);
  return cleaned || fallback;
}

function withDefaultCollection(collections: WorkspaceCollection[]): WorkspaceCollection[] {
  if (collections.some((collection) => collection.slug === "approved")) return collections;
  const now = new Date().toISOString();
  return [{
    slug: "approved",
    title: "Approved resources",
    summary: "Workspace-approved public and private resources. Approval is not OnlyHarness verification.",
    visibility: "workspace",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    items: []
  }, ...collections];
}

function cleanCollectionSlug(value: string | undefined): string | undefined {
  const base = value?.toLowerCase().trim().replace(/^@/, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return base && /^[a-z0-9][a-z0-9._-]{0,80}$/.test(base) ? base : undefined;
}

function cleanCollectionTitle(value: string | undefined): string | undefined {
  const clean = value?.trim().replace(/\s+/g, " ");
  return clean && clean.length <= 120 ? clean : undefined;
}

function cleanCollectionSummary(value: string | undefined | null): string | undefined {
  const clean = value?.trim().replace(/\s+/g, " ");
  return clean && clean.length <= 500 ? clean : undefined;
}

function normalizeCollectionVisibility(value: unknown): WorkspaceCollectionVisibility {
  return value === "public" || value === "unlisted" ? value : "workspace";
}

function normalizeApprovalState(value: unknown): WorkspaceApprovalState {
  return ["pending_review", "approved", "approved_with_warning", "blocked", "blocked_by_scan", "deprecated"].includes(String(value)) ? value as WorkspaceApprovalState : "pending_review";
}

function titleizeCollectionSlug(value: string): string {
  return value.split(/[-_.]+/).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

function workspaceResourceNameForApproval(resource: resources.Resource, requested: string | undefined): string | undefined {
  const candidates = [
    requested,
    resource.upstreamRepo,
    resource.title,
    resource.id.split("/").pop()
  ];
  for (const candidate of candidates) {
    const slug = cleanCollectionSlug(candidate);
    if (slug && /^[a-z0-9][a-z0-9-]{1,80}$/.test(slug.replace(/[._]+/g, "-"))) return slug.replace(/[._]+/g, "-");
  }
  return undefined;
}

function approvedResourceActions(resource: resources.Resource, workspaceUrl: string, workspaceName: string): resources.ResourceAction[] {
  const actions: resources.ResourceAction[] = [{ id: "open_onlyharness", label: `Use via ${workspaceName}`, url: workspaceUrl }];
  const publicListing = resource.actions.find((action) => action.id === "open_onlyharness" && "url" in action);
  if (publicListing && "url" in publicListing) actions.push({ id: "open_mirror", label: "Open public OnlyHarness listing", url: publicListing.url });
  for (const action of resource.actions) {
    if (action.id === "download_archive" && "url" in action) actions.push({ ...action, label: "Download public OnlyHarness archive" });
    if (action.id === "install" || action.id === "copy_mcp_config") actions.push(action);
    if (action.id === "open_upstream" && "url" in action) actions.push(action);
  }
  return dedupeActions(actions);
}

function dedupeActions(actions: resources.ResourceAction[]): resources.ResourceAction[] {
  const seen = new Set<string>();
  const result: resources.ResourceAction[] = [];
  for (const action of actions) {
    const key = `${action.id}:${"url" in action ? action.url : "command" in action ? action.command ?? "" : action.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(action);
  }
  return result;
}

function dedupeWorkspaceTags(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const clean = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    if (clean && !result.includes(clean)) result.push(clean);
  }
  return result.slice(0, 16);
}

function collectionItemId(collectionSlug: string, ref: string): string {
  return `${collectionSlug}:${resources.resourceArchiveKey(ref).slice(0, 32)}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function boundedLimit(limit: number): number {
  return Math.max(1, Math.min(limit, 200));
}

function workspaceDataRoot(slug: string): string {
  return path.join(workspaceRoot, "data/workspaces", slug);
}

function workspaceResourceCatalogPath(slug: string): string {
  const base = process.env.WORKSPACE_RESOURCES_PATH ? path.resolve(process.env.WORKSPACE_RESOURCES_PATH, slug) : workspaceDataRoot(slug);
  return path.join(base, "resources.json");
}

function workspaceCollectionsPath(slug: string): string {
  const base = process.env.WORKSPACE_COLLECTIONS_PATH ? path.resolve(process.env.WORKSPACE_COLLECTIONS_PATH, slug) : workspaceDataRoot(slug);
  return path.join(base, "collections.json");
}

function localWorkspacesPath(): string {
  return path.resolve(process.env.HARNESS_WORKSPACES_PATH ?? path.join(workspaceRoot, "data/workspaces.json"));
}

function localWorkspaceAuditPath(): string {
  return path.resolve(process.env.HARNESS_WORKSPACE_AUDIT_PATH ?? path.join(workspaceRoot, "data/workspace-audit.jsonl"));
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
