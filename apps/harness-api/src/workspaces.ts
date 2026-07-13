import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { workspaceRoot } from "./registry.js";
import { cleanOrgSlug, tokenHash, authorizeOrgToken, appendOrgAudit, readOrgAudit, type OrgRecord, type OrgAuditEntry } from "./orgs.js";
import * as resources from "./resources.js";

export type WorkspaceType = "company" | "community" | "team" | "course" | "agency" | "chat";
export type WorkspaceVisibility = "private" | "invite_only" | "gated" | "public" | "unlisted";
export type WorkspaceRole = "owner" | "admin" | "moderator" | "publisher" | "member" | "viewer";
export type WorkspaceMemberStatus = "invited" | "active" | "suspended" | "removed";
export type WorkspaceMemberSource = "direct" | "invite" | "email_domain" | "telegram" | "discord" | "entitlement" | "paid_entitlement" | "token_bootstrap";

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

export type WorkspaceMember = {
  id?: string;
  workspace_id?: string;
  workspace_slug?: string;
  user_id: string;
  role: WorkspaceRole;
  status: WorkspaceMemberStatus;
  source: WorkspaceMemberSource;
  joined_at: string;
  expires_at?: string | null;
  removed_at?: string | null;
};

export type WorkspaceInvite = {
  id?: string;
  workspace_id?: string;
  workspace_slug?: string;
  email?: string | null;
  code_hash: string;
  role: WorkspaceRole;
  max_uses?: number | null;
  uses_count: number;
  expires_at?: string | null;
  created_by?: string | null;
  created_at: string;
  revoked_at?: string | null;
};

export type WorkspaceJoinPolicyKind = "invite" | "email_domain" | "telegram" | "discord" | "entitlement" | "paid_subscription" | "manual_approval";
export type WorkspaceJoinPolicyStatus = "active" | "disabled";

export type WorkspaceJoinPolicy = {
  id: string;
  workspace_id?: string;
  workspace_slug?: string;
  kind: WorkspaceJoinPolicyKind;
  status: WorkspaceJoinPolicyStatus;
  role: Extract<WorkspaceRole, "member" | "viewer">;
  title?: string | null;
  instructions?: string | null;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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

export type WorkspaceSetupBundleConfig = {
  path: string;
  content: string;
};

export type WorkspaceSetupBundleResource = {
  id: string;
  name: string;
  title: string;
  resourceType: resources.Resource["resourceType"];
  source: "workspace_private" | "workspace_approved";
  hostedArchive: boolean;
  sourceResourceId?: string;
  approvalState?: WorkspaceApprovalState;
  collections: string[];
  detailCommand: string;
  openCommand: string;
  installCommand?: string;
  note?: string | null;
};

export type WorkspaceSetupBundle = {
  version: string;
  generatedAt: string;
  target: string;
  resources: WorkspaceSetupBundleResource[];
  configs: WorkspaceSetupBundleConfig[];
};

export type WorkspaceSetupBundleUpdateResult =
  | { ok: true; bundle: WorkspaceSetupBundle }
  | { ok: false; status: number; error: string; code: string };

type WorkspaceStore = {
  workspaces?: WorkspaceRecord[];
  members?: WorkspaceMember[];
  invites?: WorkspaceInvite[];
  joinPolicies?: WorkspaceJoinPolicy[];
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

type WorkspaceSetupBundleOverride = {
  configs: WorkspaceSetupBundleConfig[];
};

type WorkspaceJoinPoliciesFile = {
  generatedAt: string;
  policies: WorkspaceJoinPolicy[];
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

type SupabaseMemberRow = {
  id?: string;
  workspace_id?: string;
  user_id?: string;
  role?: string;
  status?: string;
  source?: string;
  joined_at?: string;
  expires_at?: string | null;
  removed_at?: string | null;
};

type SupabaseInviteRow = {
  id?: string;
  workspace_id?: string;
  email?: string | null;
  code_hash?: string;
  role?: string;
  max_uses?: number | null;
  uses_count?: number;
  expires_at?: string | null;
  created_by?: string | null;
  created_at?: string;
  revoked_at?: string | null;
};

type SupabaseJoinPolicyRow = {
  id?: string;
  workspace_id?: string;
  kind?: string;
  status?: string;
  role?: string;
  title?: string | null;
  instructions?: string | null;
  config?: unknown;
  created_at?: string;
  updated_at?: string;
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

type SupabaseSetupBundleRow = {
  version?: string;
  bundle?: unknown;
};

type SupabaseLoad<T> =
  | { status: "found"; value: T }
  | { status: "missing" }
  | { status: "unavailable" };

export type WorkspaceAuthResult =
  | { ok: true; workspace: WorkspaceRecord; tokenName?: string; userId?: string; role?: WorkspaceRole; via: "workspace_token" | "legacy_org_token" | "workspace_member" }
  | { ok: false; status: number; error: string; slug?: string; tokenName?: string; auditAction: string };

export type WorkspaceApprovalResult =
  | { ok: true; collection: WorkspaceCollection; item: WorkspaceCollectionItem; resource: resources.Resource; approvalState: WorkspaceApprovalState }
  | { ok: false; status: number; error: string; code: string };

export type WorkspaceCollectionItemRemoveResult =
  | { ok: true; collection: WorkspaceCollection; item: WorkspaceCollectionItem; removedResourceId?: string }
  | { ok: false; status: number; error: string; code: string };

export type WorkspaceMemberResult =
  | { ok: true; workspace: WorkspaceRecord; member: WorkspaceMember }
  | { ok: false; status: number; error: string; code: string };

export type WorkspaceInviteResult =
  | { ok: true; workspace: WorkspaceRecord; invite: WorkspaceInvite; code: string }
  | { ok: false; status: number; error: string; code: string };

export type WorkspaceJoinResult =
  | { ok: true; workspace: WorkspaceRecord; invite?: WorkspaceInvite; policy?: WorkspaceJoinPolicy; member: WorkspaceMember }
  | { ok: false; status: number; error: string; code: string };

export type WorkspaceJoinPoliciesResult =
  | { ok: true; workspace: WorkspaceRecord; policies: WorkspaceJoinPolicy[] }
  | { ok: false; status: number; error: string; code: string };

export type WorkspaceJoinPolicyUpdateResult =
  | { ok: true; workspace: WorkspaceRecord; policies: WorkspaceJoinPolicy[] }
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

export async function authorizeWorkspaceMember(slugValue: string | undefined, userIdValue: string | undefined, requiredScopes: string[]): Promise<WorkspaceAuthResult> {
  const slug = cleanWorkspaceSlug(slugValue);
  const userId = cleanUserId(userIdValue);
  if (!slug) return { ok: false, status: 400, error: "Invalid workspace slug", auditAction: "workspace_invalid_slug" };
  if (!userId) return { ok: false, status: 401, error: "Workspace member session required", slug, auditAction: "workspace_member_missing" };

  const workspace = await readWorkspaceBySlug(slug, false);
  if (workspace.status !== "found") return { ok: false, status: workspace.status === "missing" ? 404 : 503, error: workspace.status === "missing" ? "Workspace not found" : "Workspace unavailable", slug, auditAction: workspace.status === "missing" ? "workspace_missing" : "workspace_unavailable" };
  const member = await readWorkspaceMember(workspace.value, userId);
  if (!member || member.status !== "active" || member.removed_at) {
    return { ok: false, status: 403, error: "Workspace membership required", slug, auditAction: "workspace_member_denied" };
  }
  if (workspaceMemberExpired(member)) {
    return { ok: false, status: 403, error: "Workspace membership expired", slug, auditAction: "workspace_member_expired" };
  }
  if (!requiredScopes.some((scope) => roleAllowsScope(member.role, scope))) {
    return { ok: false, status: 403, error: "Workspace role cannot perform this action", slug, auditAction: "workspace_role_denied" };
  }
  return { ok: true, workspace: workspace.value, userId, role: member.role, via: "workspace_member" };
}

export async function listWorkspaceMembers(slugValue: string | undefined): Promise<WorkspaceMember[]> {
  const slug = cleanWorkspaceSlug(slugValue);
  if (!slug) return [];
  const workspace = await readWorkspaceBySlug(slug, false);
  if (workspace.status !== "found") return [];
  const remote = workspace.value.id ? await readSupabaseWorkspaceMembers(workspace.value.id) : undefined;
  if (remote) return remote;
  return readLocalWorkspaceMembers(workspace.value);
}

export async function upsertWorkspaceMember(slugValue: string | undefined, input: { userId?: string; role?: string; source?: string; expiresAt?: string | null; expires_at?: string | null }): Promise<WorkspaceMemberResult> {
  const slug = cleanWorkspaceSlug(slugValue);
  const userId = cleanUserId(input.userId);
  if (!slug) return { ok: false, status: 400, error: "Invalid workspace slug", code: "INVALID_WORKSPACE" };
  if (!userId) return { ok: false, status: 400, error: "userId is required", code: "INVALID_USER" };
  const workspace = await readWorkspaceBySlug(slug, false);
  if (workspace.status !== "found") return { ok: false, status: workspace.status === "missing" ? 404 : 503, error: workspace.status === "missing" ? "Workspace not found" : "Workspace unavailable", code: workspace.status === "missing" ? "WORKSPACE_NOT_FOUND" : "WORKSPACE_UNAVAILABLE" };
  const role = normalizeWorkspaceRole(input.role);
  const source = normalizeMemberSource(input.source);
  const expiresAt = normalizeMemberExpiresAt(input.expiresAt ?? input.expires_at);
  if (!expiresAt.ok) return { ok: false, status: 400, error: "Invalid member expiry timestamp", code: "INVALID_MEMBER_EXPIRY" };
  const member: WorkspaceMember = {
    id: existingLocalMember(workspace.value, userId)?.id,
    workspace_id: workspace.value.id,
    workspace_slug: workspace.value.slug,
    user_id: userId,
    role,
    status: "active",
    source,
    joined_at: new Date().toISOString(),
    expires_at: expiresAt.value,
    removed_at: null
  };
  const remote = workspace.value.id ? await upsertSupabaseWorkspaceMember(workspace.value, member) : undefined;
  return { ok: true, workspace: workspace.value, member: remote ?? upsertLocalWorkspaceMember(workspace.value, member) };
}

export async function removeWorkspaceMember(slugValue: string | undefined, userIdValue: string | undefined): Promise<WorkspaceMemberResult> {
  const slug = cleanWorkspaceSlug(slugValue);
  const userId = cleanUserId(userIdValue);
  if (!slug) return { ok: false, status: 400, error: "Invalid workspace slug", code: "INVALID_WORKSPACE" };
  if (!userId) return { ok: false, status: 400, error: "Invalid user id", code: "INVALID_USER" };
  const workspace = await readWorkspaceBySlug(slug, false);
  if (workspace.status !== "found") return { ok: false, status: workspace.status === "missing" ? 404 : 503, error: workspace.status === "missing" ? "Workspace not found" : "Workspace unavailable", code: workspace.status === "missing" ? "WORKSPACE_NOT_FOUND" : "WORKSPACE_UNAVAILABLE" };
  const existing = await readWorkspaceMember(workspace.value, userId);
  if (!existing) return { ok: false, status: 404, error: "Workspace member not found", code: "MEMBER_NOT_FOUND" };
  const removed: WorkspaceMember = { ...existing, status: "removed", removed_at: new Date().toISOString() };
  const remote = workspace.value.id ? await removeSupabaseWorkspaceMember(workspace.value, userId, removed.removed_at ?? new Date().toISOString()) : undefined;
  return { ok: true, workspace: workspace.value, member: remote ?? upsertLocalWorkspaceMember(workspace.value, removed) };
}

export async function createWorkspaceInvite(slugValue: string | undefined, input: { role?: string; maxUses?: number | null; expiresInSeconds?: number | null; email?: string | null; createdBy?: string | null }): Promise<WorkspaceInviteResult> {
  const slug = cleanWorkspaceSlug(slugValue);
  if (!slug) return { ok: false, status: 400, error: "Invalid workspace slug", code: "INVALID_WORKSPACE" };
  const workspace = await readWorkspaceBySlug(slug, false);
  if (workspace.status !== "found") return { ok: false, status: workspace.status === "missing" ? 404 : 503, error: workspace.status === "missing" ? "Workspace not found" : "Workspace unavailable", code: workspace.status === "missing" ? "WORKSPACE_NOT_FOUND" : "WORKSPACE_UNAVAILABLE" };
  const code = `ohwi_${randomBytes(18).toString("base64url")}`;
  const now = new Date().toISOString();
  const invite: WorkspaceInvite = {
    id: cryptoRandomId("invite"),
    workspace_id: workspace.value.id,
    workspace_slug: workspace.value.slug,
    email: cleanEmail(input.email),
    code_hash: tokenHash(code),
    role: normalizeWorkspaceRole(input.role, "member"),
    max_uses: normalizeMaxUses(input.maxUses),
    uses_count: 0,
    expires_at: expiresAtFromSeconds(input.expiresInSeconds),
    created_by: cleanUserId(input.createdBy) ?? null,
    created_at: now,
    revoked_at: null
  };
  const remote = workspace.value.id ? await createSupabaseWorkspaceInvite(workspace.value, invite) : undefined;
  return { ok: true, workspace: workspace.value, invite: remote ?? upsertLocalWorkspaceInvite(workspace.value, invite), code };
}

export async function listWorkspaceJoinPolicies(slugValue: string | undefined): Promise<WorkspaceJoinPoliciesResult> {
  const slug = cleanWorkspaceSlug(slugValue);
  if (!slug) return { ok: false, status: 400, error: "Invalid workspace slug", code: "INVALID_WORKSPACE" };
  const workspace = await readWorkspaceBySlug(slug, false);
  if (workspace.status !== "found") return { ok: false, status: workspace.status === "missing" ? 404 : 503, error: workspace.status === "missing" ? "Workspace not found" : "Workspace unavailable", code: workspace.status === "missing" ? "WORKSPACE_NOT_FOUND" : "WORKSPACE_UNAVAILABLE" };
  return { ok: true, workspace: workspace.value, policies: await readWorkspaceJoinPolicies(workspace.value) };
}

export async function upsertWorkspaceJoinPolicies(slugValue: string | undefined, input: { policies?: unknown }): Promise<WorkspaceJoinPolicyUpdateResult> {
  const slug = cleanWorkspaceSlug(slugValue);
  if (!slug) return { ok: false, status: 400, error: "Invalid workspace slug", code: "INVALID_WORKSPACE" };
  const workspace = await readWorkspaceBySlug(slug, false);
  if (workspace.status !== "found") return { ok: false, status: workspace.status === "missing" ? 404 : 503, error: workspace.status === "missing" ? "Workspace not found" : "Workspace unavailable", code: workspace.status === "missing" ? "WORKSPACE_NOT_FOUND" : "WORKSPACE_UNAVAILABLE" };
  const policies = normalizeJoinPolicies(input.policies, workspace.value);
  if (!policies) return { ok: false, status: 400, error: "Invalid workspace join policies", code: "INVALID_JOIN_POLICIES" };
  if (!workspaceSubscriptionsEnabled() && policies.some((policy) => policy.kind === "paid_subscription" && policy.status === "active")) {
    return { ok: false, status: 409, error: "Subscription-gated workspace joins are not available until subscription lifecycle is implemented", code: "SUBSCRIPTION_GATES_NOT_AVAILABLE" };
  }
  const remote = workspace.value.id ? await replaceSupabaseWorkspaceJoinPolicies(workspace.value, policies) : undefined;
  if (!remote) writeLocalWorkspaceJoinPolicies(workspace.value, policies);
  return { ok: true, workspace: workspace.value, policies: remote ?? policies };
}

export async function joinWorkspaceWithInvite(slugValue: string | undefined, input: { code?: string; userId?: string }): Promise<WorkspaceJoinResult> {
  const slug = cleanWorkspaceSlug(slugValue);
  const userId = cleanUserId(input.userId);
  if (!slug) return { ok: false, status: 400, error: "Invalid workspace slug", code: "INVALID_WORKSPACE" };
  if (!userId) return { ok: false, status: 401, error: "Sign in required before joining workspace", code: "AUTH_REQUIRED" };
  const inviteHash = cleanInviteCodeHash(input.code);
  if (!inviteHash) return { ok: false, status: 400, error: "Invite code is required", code: "INVALID_INVITE" };
  const workspace = await readWorkspaceBySlug(slug, false);
  if (workspace.status !== "found") return { ok: false, status: workspace.status === "missing" ? 404 : 503, error: workspace.status === "missing" ? "Workspace not found" : "Workspace unavailable", code: workspace.status === "missing" ? "WORKSPACE_NOT_FOUND" : "WORKSPACE_UNAVAILABLE" };
  const invite = await readWorkspaceInviteByHash(workspace.value, inviteHash);
  if (!invite || invite.revoked_at) return { ok: false, status: 404, error: "Invite not found", code: "INVITE_NOT_FOUND" };
  if (invite.expires_at && Date.parse(invite.expires_at) <= Date.now()) return { ok: false, status: 403, error: "Invite expired", code: "INVITE_EXPIRED" };
  if (invite.max_uses !== null && invite.max_uses !== undefined && invite.uses_count >= invite.max_uses) return { ok: false, status: 403, error: "Invite already used", code: "INVITE_EXHAUSTED" };
  const member = await upsertWorkspaceMember(workspace.value.slug, { userId, role: invite.role, source: "invite" });
  if (!member.ok) return member;
  const updatedInvite: WorkspaceInvite = { ...invite, uses_count: invite.uses_count + 1 };
  const persistedInvite = workspace.value.id ? await updateSupabaseWorkspaceInviteUses(workspace.value, updatedInvite) : undefined;
  return { ok: true, workspace: workspace.value, invite: persistedInvite ?? upsertLocalWorkspaceInvite(workspace.value, updatedInvite), member: member.member };
}

export async function joinWorkspaceWithEmailDomain(slugValue: string | undefined, input: { userId?: string; email?: string }): Promise<WorkspaceJoinResult> {
  const slug = cleanWorkspaceSlug(slugValue);
  const userId = cleanUserId(input.userId);
  const email = cleanEmail(input.email);
  if (!slug) return { ok: false, status: 400, error: "Invalid workspace slug", code: "INVALID_WORKSPACE" };
  if (!userId) return { ok: false, status: 401, error: "Sign in required before joining workspace", code: "AUTH_REQUIRED" };
  if (!email) return { ok: false, status: 400, error: "Signed-in user email is required for email-domain join", code: "EMAIL_REQUIRED" };
  const workspace = await readWorkspaceBySlug(slug, false);
  if (workspace.status !== "found") return { ok: false, status: workspace.status === "missing" ? 404 : 503, error: workspace.status === "missing" ? "Workspace not found" : "Workspace unavailable", code: workspace.status === "missing" ? "WORKSPACE_NOT_FOUND" : "WORKSPACE_UNAVAILABLE" };
  const domain = email.split("@")[1]?.toLowerCase();
  const policy = (await readWorkspaceJoinPolicies(workspace.value))
    .find((row) => row.status === "active" && row.kind === "email_domain" && joinPolicyEmailDomains(row).includes(domain));
  if (!policy) return { ok: false, status: 403, error: "Email domain is not allowed for this workspace", code: "EMAIL_DOMAIN_DENIED" };
  const member = await upsertWorkspaceMember(workspace.value.slug, { userId, role: policy.role, source: "email_domain" });
  if (!member.ok) return member;
  return { ok: true, workspace: workspace.value, policy, member: member.member };
}

export async function grantWorkspaceJoinPolicy(slugValue: string | undefined, input: { userId?: string; source?: string; policyId?: string }): Promise<WorkspaceJoinResult> {
  const slug = cleanWorkspaceSlug(slugValue);
  const userId = cleanUserId(input.userId);
  const source = normalizeGateMemberSource(input.source);
  if (!slug) return { ok: false, status: 400, error: "Invalid workspace slug", code: "INVALID_WORKSPACE" };
  if (!userId) return { ok: false, status: 400, error: "userId is required", code: "INVALID_USER" };
  if (!source) return { ok: false, status: 400, error: "Unsupported workspace join source", code: "INVALID_JOIN_SOURCE" };
  const workspace = await readWorkspaceBySlug(slug, false);
  if (workspace.status !== "found") return { ok: false, status: workspace.status === "missing" ? 404 : 503, error: workspace.status === "missing" ? "Workspace not found" : "Workspace unavailable", code: workspace.status === "missing" ? "WORKSPACE_NOT_FOUND" : "WORKSPACE_UNAVAILABLE" };
  const policy = (await readWorkspaceJoinPolicies(workspace.value)).find((row) =>
    row.status === "active"
      && joinPolicyAllowsSource(row, source)
      && (!input.policyId || row.id === input.policyId)
  );
  if (!policy) return { ok: false, status: 403, error: "Workspace join policy does not allow this source", code: "JOIN_POLICY_DENIED" };
  const member = await upsertWorkspaceMember(workspace.value.slug, { userId, role: policy.role, source });
  if (!member.ok) return member;
  return { ok: true, workspace: workspace.value, policy, member: member.member };
}

export async function appendWorkspaceAudit(input: { slug: string; action: string; tokenName?: string; subject?: string; target?: string; via?: "workspace_token" | "legacy_org_token" | "workspace_member" }): Promise<void> {
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
  const canonicalUrl = `https://superskill.sh/#/workspaces/${encodeURIComponent(slug)}/resources/${encodeURIComponent(name)}`;
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

export function removeWorkspaceCollectionItem(slugValue: string, collectionSlugValue: string, itemIdValue: string): WorkspaceCollectionItemRemoveResult {
  const slug = cleanWorkspaceSlug(slugValue);
  const collectionSlug = cleanCollectionSlug(collectionSlugValue);
  const itemId = decodeURIComponent(itemIdValue).trim();
  if (!slug) return { ok: false, status: 400, error: "Invalid workspace slug", code: "INVALID_WORKSPACE" };
  if (!collectionSlug) return { ok: false, status: 400, error: "Invalid workspace collection", code: "INVALID_COLLECTION" };
  if (!itemId) return { ok: false, status: 400, error: "Invalid workspace collection item", code: "INVALID_COLLECTION_ITEM" };

  const collections = withDefaultCollection(readWorkspaceCollectionsFile(slug).collections);
  const collection = collections.find((row) => row.slug === collectionSlug && !row.archivedAt);
  if (!collection) return { ok: false, status: 404, error: "Workspace collection not found", code: "COLLECTION_NOT_FOUND" };
  const item = collection.items.find((row) => row.id === itemId || row.itemRef === itemId || row.sourceResourceId === itemId);
  if (!item) return { ok: false, status: 404, error: "Workspace collection item not found", code: "COLLECTION_ITEM_NOT_FOUND" };

  const now = new Date().toISOString();
  const updated: WorkspaceCollection = {
    ...collection,
    updatedAt: now,
    items: collection.items.filter((row) => row.id !== item.id)
  };
  writeWorkspaceCollectionsFile(slug, [updated, ...collections.filter((row) => row.slug !== collectionSlug)]);
  const removedResourceId = removeWorkspaceResourceIfOrphanedApproval(slug, item);
  return { ok: true, collection: workspaceCollectionDetail(slug, collectionSlug) ?? updated, item, removedResourceId };
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

export async function workspaceSetupBundle(workspace: WorkspaceRecord, targetValue?: string): Promise<WorkspaceSetupBundle> {
  const target = cleanSetupTarget(targetValue) ?? "cli";
  const resources = readWorkspaceResourceCatalog(workspace.slug).resources.slice(0, 200);
  const collections = listWorkspaceCollections(workspace.slug);
  const override = await readWorkspaceSetupBundleOverride(workspace);
  const bundleResources = resources.map((resource) => setupBundleResource(workspace, resource, collections, target));
  const configs = dedupeSetupConfigs([
    defaultWorkspaceReadmeConfig(workspace, bundleResources, target),
    defaultWorkspaceCommandsConfig(workspace, bundleResources, target),
    ...(override?.configs ?? [])
  ]);
  const hash = createHash("sha256")
    .update(JSON.stringify({ target, resources: bundleResources, configs }))
    .digest("hex")
    .slice(0, 12);
  return {
    version: `workspace-${hash}`,
    generatedAt: new Date().toISOString(),
    target,
    resources: bundleResources,
    configs
  };
}

export async function upsertWorkspaceSetupBundle(workspace: WorkspaceRecord, input: { configs?: WorkspaceSetupBundleConfig[]; target?: string }): Promise<WorkspaceSetupBundleUpdateResult> {
  const configs = normalizeSetupConfigs(input.configs);
  if (!configs) {
    return { ok: false, status: 400, error: "Invalid setup bundle configs", code: "INVALID_SETUP_CONFIG" };
  }
  const override: WorkspaceSetupBundleOverride = { configs };
  const remote = workspace.id ? await upsertSupabaseWorkspaceSetupBundle(workspace, override) : undefined;
  if (!remote) writeLocalWorkspaceSetupBundleOverride(workspace.slug, override);
  return { ok: true, bundle: await workspaceSetupBundle(workspace, input.target) };
}

function removeWorkspaceResourceIfOrphanedApproval(slug: string, item: WorkspaceCollectionItem): string | undefined {
  if (item.itemSource !== "public_resource") return undefined;
  const collections = withDefaultCollection(readWorkspaceCollectionsFile(slug).collections).filter((collection) => !collection.archivedAt);
  const stillReferenced = collections.some((collection) => collection.items.some((row) => row.itemRef === item.itemRef));
  if (stillReferenced) return undefined;
  const catalog = readWorkspaceResourceCatalog(slug);
  const resource = catalog.resources.find((row) => row.id === item.itemRef && row.sourceCatalogId === item.sourceResourceId);
  if (!resource) return undefined;
  writeWorkspaceResourceCatalog(slug, catalog.resources.filter((row) => row.id !== resource.id));
  return resource.id;
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

export async function readWorkspaceMember(workspace: WorkspaceRecord, userId: string): Promise<WorkspaceMember | undefined> {
  if (workspace.id) {
    const rows = await supabaseRows<SupabaseMemberRow>("workspace_members", {
      select: "id,workspace_id,user_id,role,status,source,joined_at,expires_at,removed_at",
      workspace_id: `eq.${workspace.id}`,
      user_id: `eq.${userId}`,
      limit: "1"
    });
    if (rows) return normalizeSupabaseMember(rows[0], workspace.slug)[0];
  }
  return existingLocalMember(workspace, userId);
}

async function readSupabaseWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[] | undefined> {
  const rows = await supabaseRows<SupabaseMemberRow>("workspace_members", {
    select: "id,workspace_id,user_id,role,status,source,joined_at,expires_at,removed_at",
    workspace_id: `eq.${workspaceId}`,
    removed_at: "is.null",
    order: "joined_at.desc",
    limit: "200"
  });
  return rows?.flatMap((row) => normalizeSupabaseMember(row)).filter(workspaceMemberActive);
}

async function upsertSupabaseWorkspaceMember(workspace: WorkspaceRecord, member: WorkspaceMember): Promise<WorkspaceMember | undefined> {
  if (!workspace.id) return undefined;
  const response = await supabaseRequest("workspace_members", { on_conflict: "workspace_id,user_id" }, {
    method: "POST",
    headers: { ...supabaseHeaders(), "content-type": "application/json", prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      workspace_id: workspace.id,
      user_id: member.user_id,
      role: member.role,
      status: member.status,
      source: member.source,
      joined_at: member.joined_at,
      expires_at: member.expires_at ?? null,
      removed_at: member.removed_at ?? null
    })
  });
  if (!response?.ok) return undefined;
  try {
    const body = await response.json() as SupabaseMemberRow[];
    return normalizeSupabaseMember(body[0], workspace.slug)[0];
  } catch {
    return undefined;
  }
}

async function removeSupabaseWorkspaceMember(workspace: WorkspaceRecord, userId: string, removedAt: string): Promise<WorkspaceMember | undefined> {
  if (!workspace.id) return undefined;
  const response = await supabaseRequest("workspace_members", { workspace_id: `eq.${workspace.id}`, user_id: `eq.${userId}` }, {
    method: "PATCH",
    headers: { ...supabaseHeaders(), "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify({ status: "removed", removed_at: removedAt })
  });
  if (!response?.ok) return undefined;
  try {
    const body = await response.json() as SupabaseMemberRow[];
    return normalizeSupabaseMember(body[0], workspace.slug)[0];
  } catch {
    return undefined;
  }
}

async function createSupabaseWorkspaceInvite(workspace: WorkspaceRecord, invite: WorkspaceInvite): Promise<WorkspaceInvite | undefined> {
  if (!workspace.id) return undefined;
  const response = await supabaseRequest("workspace_invites", undefined, {
    method: "POST",
    headers: { ...supabaseHeaders(), "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify({
      workspace_id: workspace.id,
      email: invite.email ?? null,
      code_hash: invite.code_hash,
      role: invite.role,
      max_uses: invite.max_uses ?? null,
      uses_count: invite.uses_count,
      expires_at: invite.expires_at ?? null,
      created_by: invite.created_by ?? null,
      created_at: invite.created_at,
      revoked_at: invite.revoked_at ?? null
    })
  });
  if (!response?.ok) return undefined;
  try {
    const body = await response.json() as SupabaseInviteRow[];
    return normalizeSupabaseInvite(body[0], workspace.slug)[0];
  } catch {
    return undefined;
  }
}

async function readWorkspaceInviteByHash(workspace: WorkspaceRecord, codeHash: string): Promise<WorkspaceInvite | undefined> {
  if (workspace.id) {
    const rows = await supabaseRows<SupabaseInviteRow>("workspace_invites", {
      select: "id,workspace_id,email,code_hash,role,max_uses,uses_count,expires_at,created_by,created_at,revoked_at",
      workspace_id: `eq.${workspace.id}`,
      code_hash: `eq.${codeHash}`,
      limit: "1"
    });
    if (rows) return normalizeSupabaseInvite(rows[0], workspace.slug)[0];
  }
  return readLocalWorkspaceInvites(workspace).find((invite) => tokenMatchesRawHash(codeHash, invite.code_hash));
}

async function updateSupabaseWorkspaceInviteUses(workspace: WorkspaceRecord, invite: WorkspaceInvite): Promise<WorkspaceInvite | undefined> {
  if (!workspace.id || !invite.id) return undefined;
  const response = await supabaseRequest("workspace_invites", { id: `eq.${invite.id}` }, {
    method: "PATCH",
    headers: { ...supabaseHeaders(), "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify({ uses_count: invite.uses_count })
  });
  if (!response?.ok) return undefined;
  try {
    const body = await response.json() as SupabaseInviteRow[];
    return normalizeSupabaseInvite(body[0], workspace.slug)[0];
  } catch {
    return undefined;
  }
}

async function readWorkspaceJoinPolicies(workspace: WorkspaceRecord): Promise<WorkspaceJoinPolicy[]> {
  if (workspace.id) {
    const remote = await readSupabaseWorkspaceJoinPolicies(workspace);
    if (remote) return remote.length ? remote : defaultWorkspaceJoinPolicies(workspace);
  }
  const local = readLocalWorkspaceJoinPolicies(workspace);
  return local.length ? local : defaultWorkspaceJoinPolicies(workspace);
}

async function readSupabaseWorkspaceJoinPolicies(workspace: WorkspaceRecord): Promise<WorkspaceJoinPolicy[] | undefined> {
  if (!workspace.id) return undefined;
  const rows = await supabaseRows<SupabaseJoinPolicyRow>("workspace_join_policies", {
    select: "id,workspace_id,kind,status,role,title,instructions,config,created_at,updated_at",
    workspace_id: `eq.${workspace.id}`,
    order: "created_at.asc",
    limit: "50"
  });
  return rows?.flatMap((row) => normalizeSupabaseJoinPolicy(row, workspace));
}

async function replaceSupabaseWorkspaceJoinPolicies(workspace: WorkspaceRecord, policies: WorkspaceJoinPolicy[]): Promise<WorkspaceJoinPolicy[] | undefined> {
  if (!workspace.id) return undefined;
  const deleted = await supabaseRequest("workspace_join_policies", { workspace_id: `eq.${workspace.id}` }, {
    method: "DELETE",
    headers: supabaseHeaders()
  });
  if (!deleted?.ok) return undefined;
  if (!policies.length) return [];
  const response = await supabaseRequest("workspace_join_policies", undefined, {
    method: "POST",
    headers: { ...supabaseHeaders(), "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify(policies.map((policy) => ({
      workspace_id: workspace.id,
      kind: policy.kind,
      status: policy.status,
      role: policy.role,
      title: policy.title ?? null,
      instructions: policy.instructions ?? null,
      config: policy.config,
      created_at: policy.created_at,
      updated_at: policy.updated_at
    })))
  });
  if (!response?.ok) return undefined;
  try {
    const body = await response.json() as SupabaseJoinPolicyRow[];
    return body.flatMap((row) => normalizeSupabaseJoinPolicy(row, workspace));
  } catch {
    return undefined;
  }
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
  if (required === "workspace:setup") return scopes.some((scope) => ["setup", "workspace:setup"].includes(scope));
  if (required === "resource:publish") return scopes.includes("publish");
  if (required === "resource:read" || required === "resource:archive") return scopes.some((scope) => ["read", "setup", "publish"].includes(scope));
  if (required === "collection:write") return scopes.some((scope) => ["publish", "collection:write"].includes(scope));
  if (required === "member:write") return scopes.some((scope) => ["member:write", "workspace:admin"].includes(scope));
  if (required === "invite:write") return scopes.some((scope) => ["invite:write", "member:write", "workspace:admin"].includes(scope));
  if (required === "gate:verify") return scopes.some((scope) => ["gate:verify", "gate:write", "member:write", "workspace:admin"].includes(scope));
  if (required === "gate:write") return scopes.some((scope) => ["gate:write", "member:write", "workspace:admin"].includes(scope));
  return false;
}

function roleAllowsScope(role: WorkspaceRole, required: string): boolean {
  if (role === "owner") return true;
  if (required === "workspace:read" || required === "resource:read") return ["admin", "moderator", "publisher", "member", "viewer"].includes(role);
  if (required === "workspace:setup" || required === "resource:archive") return ["admin", "publisher", "member"].includes(role);
  if (required === "resource:publish" || required === "collection:write") return ["admin", "publisher"].includes(role);
  if (required === "member:write" || required === "invite:write") return role === "admin";
  if (required === "gate:verify" || required === "gate:write") return role === "admin";
  if (required === "audit:read") return role === "admin";
  return false;
}

function mapWorkspaceScopesToLegacyOrgScopes(scopes: string[]): string[] {
  const mapped = new Set<string>();
  for (const scope of scopes) {
    if (scope === "workspace:read" || scope === "resource:read" || scope === "resource:archive") mapped.add("read");
    if (scope === "workspace:setup") mapped.add("setup");
    if (scope === "resource:publish" || scope === "collection:write") mapped.add("publish");
    if (scope === "member:write" || scope === "invite:write" || scope === "gate:verify" || scope === "gate:write") mapped.add("publish");
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
    return {
      workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces.map(normalizeLocalWorkspace).filter((item): item is WorkspaceRecord => Boolean(item)) : [],
      members: Array.isArray(parsed.members) ? parsed.members.flatMap(normalizeLocalMember) : [],
      invites: Array.isArray(parsed.invites) ? parsed.invites.flatMap(normalizeLocalInvite) : [],
      joinPolicies: Array.isArray(parsed.joinPolicies) ? parsed.joinPolicies.flatMap((row) => normalizeLocalJoinPolicy(row)) : []
    };
  } catch {
    return { workspaces: [] };
  }
}

function writeWorkspaceStore(store: WorkspaceStore) {
  mkdirSync(path.dirname(localWorkspacesPath()), { recursive: true });
  writeFileSync(localWorkspacesPath(), `${JSON.stringify({
    workspaces: store.workspaces ?? [],
    members: store.members ?? [],
    invites: store.invites ?? [],
    joinPolicies: store.joinPolicies ?? []
  }, null, 2)}\n`);
}

function readLocalWorkspaceMembers(workspace: WorkspaceRecord): WorkspaceMember[] {
  return (readWorkspaceStore().members ?? [])
    .filter((member) => memberBelongsToWorkspace(member, workspace) && workspaceMemberActive(member))
    .sort((a, b) => Date.parse(b.joined_at) - Date.parse(a.joined_at));
}

function readLocalWorkspaceInvites(workspace: WorkspaceRecord): WorkspaceInvite[] {
  return (readWorkspaceStore().invites ?? [])
    .filter((invite) => inviteBelongsToWorkspace(invite, workspace));
}

function readLocalWorkspaceJoinPolicies(workspace: WorkspaceRecord): WorkspaceJoinPolicy[] {
  const filePolicies = readWorkspaceJoinPoliciesFile(workspace.slug).policies;
  if (filePolicies.length) return filePolicies.filter((policy) => policyBelongsToWorkspace(policy, workspace));
  return (readWorkspaceStore().joinPolicies ?? []).filter((policy) => policyBelongsToWorkspace(policy, workspace));
}

function existingLocalMember(workspace: WorkspaceRecord, userId: string): WorkspaceMember | undefined {
  return (readWorkspaceStore().members ?? []).find((member) => memberBelongsToWorkspace(member, workspace) && member.user_id === userId);
}

function upsertLocalWorkspaceMember(workspace: WorkspaceRecord, member: WorkspaceMember): WorkspaceMember {
  const store = readWorkspaceStore();
  const normalized = normalizeLocalMember({
    ...member,
    id: member.id ?? cryptoRandomId("member"),
    workspace_id: member.workspace_id ?? workspace.id,
    workspace_slug: workspace.slug
  })[0];
  if (!normalized) throw new Error("Invalid workspace member");
  const members = store.members ?? [];
  writeWorkspaceStore({
    ...store,
    members: [normalized, ...members.filter((row) => !(memberBelongsToWorkspace(row, workspace) && row.user_id === normalized.user_id))]
  });
  return normalized;
}

function upsertLocalWorkspaceInvite(workspace: WorkspaceRecord, invite: WorkspaceInvite): WorkspaceInvite {
  const store = readWorkspaceStore();
  const normalized = normalizeLocalInvite({
    ...invite,
    id: invite.id ?? cryptoRandomId("invite"),
    workspace_id: invite.workspace_id ?? workspace.id,
    workspace_slug: workspace.slug
  })[0];
  if (!normalized) throw new Error("Invalid workspace invite");
  const invites = store.invites ?? [];
  writeWorkspaceStore({
    ...store,
    invites: [normalized, ...invites.filter((row) => row.id !== normalized.id && row.code_hash !== normalized.code_hash)]
  });
  return normalized;
}

function writeLocalWorkspaceJoinPolicies(workspace: WorkspaceRecord, policies: WorkspaceJoinPolicy[]) {
  writeWorkspaceJoinPoliciesFile(workspace.slug, policies.flatMap((policy) => normalizeLocalJoinPolicy({
    ...policy,
    workspace_id: policy.workspace_id ?? workspace.id,
    workspace_slug: workspace.slug
  })));
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

function writeWorkspaceResourceCatalog(slug: string, rows: resources.Resource[]) {
  const catalogPath = workspaceResourceCatalogPath(slug);
  const now = new Date().toISOString();
  mkdirSync(path.dirname(catalogPath), { recursive: true });
  writeFileSync(catalogPath, `${JSON.stringify({
    generatedAt: now,
    source: {
      catalog: path.relative(workspaceRoot, catalogPath),
      sourceCheckedAt: now,
      externalSeedCount: rows.length
    },
    resources: rows
  }, null, 2)}\n`);
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

async function readWorkspaceSetupBundleOverride(workspace: WorkspaceRecord): Promise<WorkspaceSetupBundleOverride | undefined> {
  if (workspace.id) {
    const remote = await readSupabaseWorkspaceSetupBundle(workspace.id);
    if (remote) return remote;
  }
  return readLocalWorkspaceSetupBundleOverride(workspace.slug);
}

async function readSupabaseWorkspaceSetupBundle(workspaceId: string): Promise<WorkspaceSetupBundleOverride | undefined> {
  const rows = await supabaseRows<SupabaseSetupBundleRow>("workspace_setup_bundles", {
    select: "version,bundle",
    workspace_id: `eq.${workspaceId}`,
    limit: "1"
  });
  if (!rows) return undefined;
  return normalizeSetupBundleOverride(rows[0]?.bundle);
}

async function upsertSupabaseWorkspaceSetupBundle(workspace: WorkspaceRecord, override: WorkspaceSetupBundleOverride): Promise<WorkspaceSetupBundleOverride | undefined> {
  if (!workspace.id) return undefined;
  const response = await supabaseRequest("workspace_setup_bundles", { on_conflict: "workspace_id" }, {
    method: "POST",
    headers: { ...supabaseHeaders(), "content-type": "application/json", prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      workspace_id: workspace.id,
      version: "manual-config",
      bundle: override,
      updated_at: new Date().toISOString()
    })
  });
  if (!response?.ok) return undefined;
  return override;
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

function readLocalWorkspaceSetupBundleOverride(slug: string): WorkspaceSetupBundleOverride | undefined {
  const filePath = workspaceSetupBundlePath(slug);
  if (!existsSync(filePath)) return undefined;
  try {
    return normalizeSetupBundleOverride(JSON.parse(readFileSync(filePath, "utf8")));
  } catch {
    return undefined;
  }
}

function writeLocalWorkspaceSetupBundleOverride(slug: string, override: WorkspaceSetupBundleOverride) {
  const filePath = workspaceSetupBundlePath(slug);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(override, null, 2)}\n`);
}

function readWorkspaceJoinPoliciesFile(slug: string): WorkspaceJoinPoliciesFile {
  const filePath = workspaceJoinPoliciesPath(slug);
  if (!existsSync(filePath)) return { generatedAt: new Date(0).toISOString(), policies: [] };
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<WorkspaceJoinPoliciesFile>;
    return {
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : new Date(0).toISOString(),
      policies: Array.isArray(parsed.policies) ? parsed.policies.flatMap((row) => normalizeLocalJoinPolicy(row)) : []
    };
  } catch {
    return { generatedAt: new Date(0).toISOString(), policies: [] };
  }
}

function writeWorkspaceJoinPoliciesFile(slug: string, policies: WorkspaceJoinPolicy[]) {
  const filePath = workspaceJoinPoliciesPath(slug);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({ generatedAt: new Date().toISOString(), policies }, null, 2)}\n`);
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

function normalizeSupabaseMember(row: SupabaseMemberRow | undefined, workspaceSlug?: string): WorkspaceMember[] {
  const userId = cleanUserId(row?.user_id);
  if (!row || !userId || !row.workspace_id) return [];
  return [{
    id: row.id,
    workspace_id: row.workspace_id,
    workspace_slug: workspaceSlug,
    user_id: userId,
    role: normalizeWorkspaceRole(row.role),
    status: normalizeMemberStatus(row.status),
    source: normalizeMemberSource(row.source),
    joined_at: typeof row.joined_at === "string" ? row.joined_at : new Date().toISOString(),
    expires_at: typeof row.expires_at === "string" ? row.expires_at : null,
    removed_at: typeof row.removed_at === "string" ? row.removed_at : null
  }];
}

function normalizeLocalMember(row: WorkspaceMember | undefined): WorkspaceMember[] {
  const userId = cleanUserId(row?.user_id);
  if (!row || !userId || (!row.workspace_id && !cleanWorkspaceSlug(row.workspace_slug))) return [];
  return [{
    id: typeof row.id === "string" && row.id ? row.id : cryptoRandomId("member"),
    workspace_id: typeof row.workspace_id === "string" ? row.workspace_id : undefined,
    workspace_slug: cleanWorkspaceSlug(row.workspace_slug),
    user_id: userId,
    role: normalizeWorkspaceRole(row.role),
    status: normalizeMemberStatus(row.status),
    source: normalizeMemberSource(row.source),
    joined_at: typeof row.joined_at === "string" ? row.joined_at : new Date().toISOString(),
    expires_at: typeof row.expires_at === "string" ? row.expires_at : null,
    removed_at: typeof row.removed_at === "string" ? row.removed_at : null
  }];
}

function normalizeSupabaseInvite(row: SupabaseInviteRow | undefined, workspaceSlug?: string): WorkspaceInvite[] {
  if (!row?.workspace_id || !row.code_hash?.startsWith("sha256:")) return [];
  return [{
    id: row.id,
    workspace_id: row.workspace_id,
    workspace_slug: workspaceSlug,
    email: cleanEmail(row.email),
    code_hash: row.code_hash,
    role: normalizeWorkspaceRole(row.role, "member"),
    max_uses: normalizeMaxUses(row.max_uses),
    uses_count: normalizeUsesCount(row.uses_count),
    expires_at: typeof row.expires_at === "string" ? row.expires_at : null,
    created_by: cleanUserId(row.created_by) ?? null,
    created_at: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
    revoked_at: typeof row.revoked_at === "string" ? row.revoked_at : null
  }];
}

function normalizeLocalInvite(row: WorkspaceInvite | undefined): WorkspaceInvite[] {
  if (!row?.code_hash?.startsWith("sha256:") || (!row.workspace_id && !cleanWorkspaceSlug(row.workspace_slug))) return [];
  return [{
    id: typeof row.id === "string" && row.id ? row.id : cryptoRandomId("invite"),
    workspace_id: typeof row.workspace_id === "string" ? row.workspace_id : undefined,
    workspace_slug: cleanWorkspaceSlug(row.workspace_slug),
    email: cleanEmail(row.email),
    code_hash: row.code_hash,
    role: normalizeWorkspaceRole(row.role, "member"),
    max_uses: normalizeMaxUses(row.max_uses),
    uses_count: normalizeUsesCount(row.uses_count),
    expires_at: typeof row.expires_at === "string" ? row.expires_at : null,
    created_by: cleanUserId(row.created_by) ?? null,
    created_at: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
    revoked_at: typeof row.revoked_at === "string" ? row.revoked_at : null
  }];
}

function normalizeSupabaseJoinPolicy(row: SupabaseJoinPolicyRow | undefined, workspace: WorkspaceRecord): WorkspaceJoinPolicy[] {
  if (!row?.workspace_id) return [];
  const kind = normalizeJoinPolicyKind(row.kind);
  if (!kind) return [];
  const now = new Date().toISOString();
  return [{
    id: typeof row.id === "string" && row.id ? row.id : joinPolicyId(kind, row.config),
    workspace_id: row.workspace_id,
    workspace_slug: workspace.slug,
    kind,
    status: normalizeJoinPolicyStatus(row.status),
    role: normalizeJoinPolicyRole(row.role),
    title: cleanPolicyText(row.title, 80),
    instructions: cleanPolicyText(row.instructions, 1000),
    config: sanitizeJoinPolicyConfig(row.config),
    created_at: typeof row.created_at === "string" ? row.created_at : now,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : now
  }];
}

function normalizeLocalJoinPolicy(row: WorkspaceJoinPolicy | undefined): WorkspaceJoinPolicy[] {
  const kind = normalizeJoinPolicyKind(row?.kind);
  if (!row || !kind || (!row.workspace_id && !cleanWorkspaceSlug(row.workspace_slug))) return [];
  const now = new Date().toISOString();
  const config = sanitizeJoinPolicyConfig(row.config);
  return [{
    id: cleanPolicyId(row.id) ?? joinPolicyId(kind, config),
    workspace_id: typeof row.workspace_id === "string" ? row.workspace_id : undefined,
    workspace_slug: cleanWorkspaceSlug(row.workspace_slug),
    kind,
    status: normalizeJoinPolicyStatus(row.status),
    role: normalizeJoinPolicyRole(row.role),
    title: cleanPolicyText(row.title, 80),
    instructions: cleanPolicyText(row.instructions, 1000),
    config,
    created_at: typeof row.created_at === "string" ? row.created_at : now,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : now
  }];
}

function normalizeJoinPolicies(value: unknown, workspace: WorkspaceRecord): WorkspaceJoinPolicy[] | undefined {
  if (!Array.isArray(value) || value.length > 20) return undefined;
  const now = new Date().toISOString();
  const rows: WorkspaceJoinPolicy[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined;
    const row = item as Partial<WorkspaceJoinPolicy>;
    const kind = normalizeJoinPolicyKind(row.kind);
    if (!kind) return undefined;
    const config = sanitizeJoinPolicyConfig(row.config);
    const id = cleanPolicyId(row.id) ?? joinPolicyId(kind, config);
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      workspace_id: workspace.id,
      workspace_slug: workspace.slug,
      kind,
      status: normalizeJoinPolicyStatus(row.status),
      role: normalizeJoinPolicyRole(row.role),
      title: cleanPolicyText(row.title, 80) ?? defaultJoinPolicyTitle(kind),
      instructions: cleanPolicyText(row.instructions, 1000),
      config,
      created_at: typeof row.created_at === "string" ? row.created_at : now,
      updated_at: now
    });
  }
  return rows;
}

function defaultWorkspaceJoinPolicies(workspace: WorkspaceRecord): WorkspaceJoinPolicy[] {
  if (workspace.visibility === "public") return [];
  const now = new Date().toISOString();
  return [{
    id: "invite",
    workspace_id: workspace.id,
    workspace_slug: workspace.slug,
    kind: "invite",
    status: "active",
    role: "member",
    title: "Invite code",
    instructions: "Join with a workspace invite code created by an admin.",
    config: {},
    created_at: now,
    updated_at: now
  }];
}

function joinPolicyAllowsSource(policy: WorkspaceJoinPolicy, source: WorkspaceMemberSource): boolean {
  if (source === "telegram") return policy.kind === "telegram";
  if (source === "discord") return policy.kind === "discord";
  if (source === "entitlement") return policy.kind === "entitlement" || policy.kind === "manual_approval";
  if (source === "paid_entitlement") return policy.kind === "paid_subscription";
  return false;
}

function joinPolicyEmailDomains(policy: WorkspaceJoinPolicy): string[] {
  const domains = policy.config.emailDomains;
  return Array.isArray(domains)
    ? domains.filter((domain): domain is string => typeof domain === "string" && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain))
    : [];
}

function sanitizeJoinPolicyConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of ["provider", "chatId", "guildId", "roleId", "externalUrl", "entitlement", "subscriptionProduct"]) {
    const clean = cleanPolicyText(input[key], key === "externalUrl" ? 500 : 160);
    if (clean) output[key] = clean;
  }
  if (Array.isArray(input.emailDomains)) {
    const domains = input.emailDomains
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toLowerCase().replace(/^@/, ""))
      .filter((item) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(item))
      .slice(0, 20);
    if (domains.length) output.emailDomains = Array.from(new Set(domains));
  }
  const periodDays = Number(input.periodDays);
  if (Number.isInteger(periodDays) && periodDays > 0 && periodDays <= 366) output.periodDays = periodDays;
  const graceDays = Number(input.graceDays);
  if (Number.isInteger(graceDays) && graceDays >= 0 && graceDays <= 60) output.graceDays = graceDays;
  return output;
}

function policyBelongsToWorkspace(policy: WorkspaceJoinPolicy, workspace: WorkspaceRecord): boolean {
  return Boolean((workspace.id && policy.workspace_id === workspace.id) || (policy.workspace_slug && policy.workspace_slug === workspace.slug));
}

function cleanPolicyId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_.:-]{1,96}$/.test(value) ? value : undefined;
}

function cleanPolicyText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/\s+/g, " ").slice(0, maxLength);
  return clean || null;
}

function joinPolicyId(kind: WorkspaceJoinPolicyKind, config: unknown): string {
  return `${kind}:${createHash("sha256").update(JSON.stringify(config ?? {})).digest("hex").slice(0, 12)}`;
}

function defaultJoinPolicyTitle(kind: WorkspaceJoinPolicyKind): string {
  if (kind === "email_domain") return "Email domain";
  if (kind === "paid_subscription") return "Paid subscription";
  return kind.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
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

function tokenMatchesRawHash(actualHash: string, storedHash: string | undefined): boolean {
  if (!actualHash.startsWith("sha256:") || typeof storedHash !== "string" || !storedHash.startsWith("sha256:")) return false;
  const actual = Buffer.from(actualHash);
  const expected = Buffer.from(storedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function normalizeWorkspaceType(value: unknown): WorkspaceType {
  return ["company", "community", "team", "course", "agency", "chat"].includes(String(value)) ? value as WorkspaceType : "team";
}

function normalizeWorkspaceVisibility(value: unknown): WorkspaceVisibility {
  return ["private", "invite_only", "gated", "public", "unlisted"].includes(String(value)) ? value as WorkspaceVisibility : "private";
}

function normalizeWorkspaceRole(value: unknown, fallback: WorkspaceRole = "member"): WorkspaceRole {
  return ["owner", "admin", "moderator", "publisher", "member", "viewer"].includes(String(value)) ? value as WorkspaceRole : fallback;
}

function normalizeMemberStatus(value: unknown): WorkspaceMemberStatus {
  return ["invited", "active", "suspended", "removed"].includes(String(value)) ? value as WorkspaceMemberStatus : "active";
}

function normalizeMemberSource(value: unknown): WorkspaceMemberSource {
  return ["direct", "invite", "email_domain", "telegram", "discord", "entitlement", "paid_entitlement", "token_bootstrap"].includes(String(value)) ? value as WorkspaceMemberSource : "direct";
}

function normalizeGateMemberSource(value: unknown): Extract<WorkspaceMemberSource, "telegram" | "discord" | "entitlement" | "paid_entitlement"> | undefined {
  return value === "telegram" || value === "discord" || value === "entitlement" || value === "paid_entitlement" ? value : undefined;
}

function normalizeJoinPolicyKind(value: unknown): WorkspaceJoinPolicyKind | undefined {
  return ["invite", "email_domain", "telegram", "discord", "entitlement", "paid_subscription", "manual_approval"].includes(String(value)) ? value as WorkspaceJoinPolicyKind : undefined;
}

function normalizeJoinPolicyStatus(value: unknown): WorkspaceJoinPolicyStatus {
  return value === "disabled" ? "disabled" : "active";
}

function normalizeJoinPolicyRole(value: unknown): Extract<WorkspaceRole, "member" | "viewer"> {
  return value === "viewer" ? "viewer" : "member";
}

function normalizePlan(value: unknown): WorkspaceRecord["plan"] {
  return value === "team" || value === "enterprise" ? value : "free";
}

function cleanUserId(value: string | undefined | null): string | undefined {
  const clean = value?.trim();
  return clean && /^[A-Za-z0-9._:@-]{2,128}$/.test(clean) ? clean : undefined;
}

function cleanEmail(value: string | undefined | null): string | null {
  const clean = value?.trim().toLowerCase();
  return clean && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean) && clean.length <= 254 ? clean : null;
}

function normalizeMaxUses(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 10_000 ? number : null;
}

function normalizeUsesCount(value: unknown): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function expiresAtFromSeconds(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60 * 60 * 24 * 365) return null;
  return new Date(Date.now() + Math.floor(seconds) * 1000).toISOString();
}

function normalizeMemberExpiresAt(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return { ok: false };
  return { ok: true, value: new Date(ms).toISOString() };
}

function workspaceMemberActive(member: WorkspaceMember): boolean {
  return member.status === "active" && !member.removed_at && !workspaceMemberExpired(member);
}

function workspaceMemberExpired(member: WorkspaceMember): boolean {
  if (!member.expires_at) return false;
  const ms = Date.parse(member.expires_at);
  return !Number.isFinite(ms) || ms <= Date.now();
}

function workspaceSubscriptionsEnabled(): boolean {
  return process.env.WORKSPACE_SUBSCRIPTIONS_ENABLED === "true";
}

function cleanInviteCodeHash(code: string | undefined): string | undefined {
  const clean = code?.trim();
  return clean && /^ohwi_[A-Za-z0-9_-]{16,80}$/.test(clean) ? tokenHash(clean) : undefined;
}

function cryptoRandomId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

function memberBelongsToWorkspace(member: WorkspaceMember, workspace: WorkspaceRecord): boolean {
  return Boolean((workspace.id && member.workspace_id === workspace.id) || (member.workspace_slug && member.workspace_slug === workspace.slug));
}

function inviteBelongsToWorkspace(invite: WorkspaceInvite, workspace: WorkspaceRecord): boolean {
  return Boolean((workspace.id && invite.workspace_id === workspace.id) || (invite.workspace_slug && invite.workspace_slug === workspace.slug));
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

function cleanSetupTarget(value: string | undefined): string | undefined {
  return value && /^(cli|claude-code|codex|cursor|mcp)$/.test(value) ? value : undefined;
}

function setupBundleResource(workspace: WorkspaceRecord, resource: resources.Resource, collections: WorkspaceCollection[], target: string): WorkspaceSetupBundleResource {
  const name = resource.id.replace(/^@[^/]+\//, "");
  const collectionSlugs = collections
    .filter((collection) => collection.items.some((item) => item.itemRef === resource.id))
    .map((collection) => collection.slug);
  const installAction = resource.actions.find((action) => action.id === "install" && "command" in action) as Extract<resources.ResourceAction, { id: "install" }> | undefined;
  const hostedArchive = Boolean(workspaceResourceArchivePath(workspace.slug, resource.id));
  return {
    id: resource.id,
    name,
    title: resource.title,
    resourceType: resource.resourceType,
    source: resource.workspaceApproval ? "workspace_approved" : "workspace_private",
    hostedArchive,
    sourceResourceId: resource.workspaceApproval?.sourceResourceId,
    approvalState: resource.workspaceApproval?.approvalState,
    collections: collectionSlugs,
    detailCommand: `HH_WORKSPACE_TOKEN=<token> npx onlyharness@latest resources detail ${resource.id} --json`,
    openCommand: `npx onlyharness@latest resources open ${resource.id}`,
    ...(installAction?.command ? { installCommand: installAction.command } : hostedArchive ? { installCommand: `HH_WORKSPACE_TOKEN=<token> npx onlyharness@latest workspace setup ${workspace.slug} --target ${target} --json` } : {}),
    note: resource.workspaceApproval?.note ?? null
  };
}

function defaultWorkspaceReadmeConfig(workspace: WorkspaceRecord, bundleResources: WorkspaceSetupBundleResource[], target: string): WorkspaceSetupBundleConfig {
  const hosted = bundleResources.filter((resource) => resource.hostedArchive);
  const approved = bundleResources.filter((resource) => resource.source === "workspace_approved");
  const lines = [
    `# ${workspace.name} OnlyHarness Setup`,
    "",
    `Workspace: @${workspace.slug}`,
    `Target: ${target}`,
    "",
    "This setup was generated by OnlyHarness from workspace-private packages and workspace-approved public resources.",
    "Workspace approval is not an OnlyHarness Verified badge.",
    "",
    "## Hosted Workspace Packages",
    hosted.length ? hosted.map((resource) => `- ${resource.id} (${resource.resourceType})`).join("\n") : "- None",
    "",
    "## Approved Public Resources",
    approved.length ? approved.map((resource) => `- ${resource.id}${resource.sourceResourceId ? ` from ${resource.sourceResourceId}` : ""} (${resource.approvalState ?? "approved"})`).join("\n") : "- None",
    "",
    "## Commands",
    "",
    `- Search: \`HH_WORKSPACE_TOKEN=<token> npx onlyharness@latest resources search --workspace ${workspace.slug}\``,
    `- Setup: \`HH_WORKSPACE_TOKEN=<token> npx onlyharness@latest workspace setup ${workspace.slug} --target ${target} --json\``,
    ""
  ];
  return { path: "README.md", content: `${lines.join("\n")}\n` };
}

function defaultWorkspaceCommandsConfig(workspace: WorkspaceRecord, bundleResources: WorkspaceSetupBundleResource[], target: string): WorkspaceSetupBundleConfig {
  return {
    path: `.onlyharness/workspaces/${workspace.slug}.md`,
    content: [
      `# @${workspace.slug} commands`,
      "",
      `HH_WORKSPACE_TOKEN=<token> npx onlyharness@latest workspace setup ${workspace.slug} --target ${target} --json`,
      `HH_WORKSPACE_TOKEN=<token> npx onlyharness@latest resources search --workspace ${workspace.slug}`,
      "",
      ...bundleResources.flatMap((resource) => [
        `## ${resource.id}`,
        "",
        `- Detail: \`${resource.detailCommand}\``,
        `- Open: \`${resource.openCommand}\``,
        resource.hostedArchive
          ? `- Hosted archive: installed by workspace setup into \`resources/${resource.name}\`.`
          : "- Hosted archive: not provided by this workspace; use the public/resource-specific instructions above.",
        ""
      ])
    ].join("\n")
  };
}

function normalizeSetupBundleOverride(value: unknown): WorkspaceSetupBundleOverride | undefined {
  if (!value || typeof value !== "object") return { configs: [] };
  const input = value as { configs?: unknown };
  const configs = normalizeSetupConfigs(input.configs);
  return configs ? { configs } : undefined;
}

function normalizeSetupConfigs(value: unknown): WorkspaceSetupBundleConfig[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) return undefined;
  const configs: WorkspaceSetupBundleConfig[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined;
    const row = item as Partial<WorkspaceSetupBundleConfig>;
    const cleanPath = cleanSetupConfigPath(row.path);
    const content = typeof row.content === "string" ? row.content : undefined;
    if (!cleanPath || content === undefined || Buffer.byteLength(content, "utf8") > 128 * 1024) return undefined;
    configs.push({ path: cleanPath, content });
  }
  return dedupeSetupConfigs(configs);
}

function dedupeSetupConfigs(configs: WorkspaceSetupBundleConfig[]): WorkspaceSetupBundleConfig[] {
  const rows = new Map<string, WorkspaceSetupBundleConfig>();
  for (const config of configs) rows.set(config.path, config);
  return [...rows.values()];
}

function cleanSetupConfigPath(value: string | undefined): string | undefined {
  if (!value || value.includes("\0") || path.isAbsolute(value)) return undefined;
  const normalized = path.posix.normalize(value.replace(/\\/g, "/"));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) return undefined;
  return /^[a-zA-Z0-9._/@-]+$/.test(normalized) ? normalized : undefined;
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

function workspaceSetupBundlePath(slug: string): string {
  const base = process.env.WORKSPACE_SETUP_BUNDLES_PATH ? path.resolve(process.env.WORKSPACE_SETUP_BUNDLES_PATH, slug) : workspaceDataRoot(slug);
  return path.join(base, "setup-bundle.json");
}

function workspaceJoinPoliciesPath(slug: string): string {
  const base = process.env.WORKSPACE_JOIN_POLICIES_PATH ? path.resolve(process.env.WORKSPACE_JOIN_POLICIES_PATH, slug) : workspaceDataRoot(slug);
  return path.join(base, "join-policies.json");
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
