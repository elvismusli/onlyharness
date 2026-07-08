import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import YAML from "yaml";
import { riskMarkdown, type HarnessManifest, type RiskReport } from "@harnesshub/schema";
import { diffHarnessDirs, semanticDiffMarkdown } from "@harnesshub/semantic-diff";
import { decodePaymentSignatureHeader, encodePaymentResponseHeader, HTTPFacilitatorClient } from "@x402/core/http";
import type { PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from "@x402/core/types";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer, type PublishMarkdownHandler, type PublishResourcePackageHandler, type PullHarnessHandler } from "./mcp.js";
import { acceptBounty, claimBounty, createBounty, deliverBounty, listBounties } from "./bounties.js";
import { createCommunityInviteCode, verifyCommunityInviteCode } from "./community.js";
import { openapi } from "./openapi.js";
import { fetchLastVerificationAt, recordEvent, sanitizeEvent } from "./events.js";
import { classifyGitHubResource, GitHubImportError, type GitHubResourceImportRequest } from "./github-import.js";
import { appendOrgAudit, authorizeAnyOrgToken, authorizeOrgToken, readOrgAudit, readOrgBundle } from "./orgs.js";
import { checkEntitlement, createCheckoutSession, hostedExecutionUnavailableBody, readPurchaseReceipt, requireArchivePaymentAccess, settleEscrowReceipt, settlePaymentWebhook, settleX402Purchase, timeoutEscrowPurchase, x402PaymentRequiredHeader, type EntitlementSubject, type PaymentRequiredBody, type X402PaymentRequirements } from "./payments.js";
import { verifyGateReceipt } from "./receipts.js";
import { fetchCountersMap, HEAT_SIGNAL_THRESHOLD } from "./social.js";
import { fetchMyStorefront, fetchStorefrontByHandle, resolveCheckoutAttribution, upsertHarnessCreator, upsertStorefrontProfile } from "./storefront.js";
import * as registry from "./registry.js";
import * as resources from "./resources.js";
import * as workspaces from "./workspaces.js";

const statePath = path.resolve(process.env.HARNESS_STATE_PATH ?? path.join(registry.workspaceRoot, "data/harness-state.json"));
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseRestKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? supabaseAnonKey;
const webhookToken = process.env.HARNESS_WEBHOOK_TOKEN;
const corsOrigins = parseCsv(process.env.HARNESS_CORS_ORIGINS);
const orgsEnabled = process.env.ORGS_ENABLED === "true";
const workspacesEnabled = process.env.WORKSPACES_ENABLED === "true";
const resourceMetadataUrl = "https://onlyharness.com/.well-known/oauth-protected-resource";

type ImportRequest = {
  name?: string;
  markdown: string;
};

type HarnessDirPublishRequest = {
  name?: string;
  files?: Array<{
    path?: string;
    content?: string;
    truncated?: boolean;
  }>;
};

type ResourcePackageImportRequest = {
  name?: string;
  title?: string;
  summary?: string;
  resourceType?: string;
  sourceUrl?: string;
  worksWith?: string[];
  tags?: string[];
  files?: Array<{
    path?: string;
    content?: string;
    truncated?: boolean;
  }>;
};

type GitHubResourceRequest = GitHubResourceImportRequest;

type ImportOptions = {
  orgSlug?: string;
  owner?: string;
  eventTarget?: string;
  stateType?: string;
  provenance?: unknown;
};

type ResourcePackageImportOptions = {
  workspaceSlug?: string;
  workspaceName?: string;
  actorLabel?: string;
};

type WorkspaceCollectionRequest = {
  slug?: string;
  title?: string;
  summary?: string;
  visibility?: string;
};

type WorkspaceResourceApproveRequest = {
  resourceId?: string;
  collection?: string;
  name?: string;
  note?: string;
};

type WorkspaceMemberRequest = {
  userId?: string;
  role?: string;
  source?: string;
};

type WorkspaceInviteRequest = {
  role?: string;
  maxUses?: number | null;
  expiresInSeconds?: number | null;
  email?: string | null;
};

type WorkspaceJoinRequest = {
  code?: string;
};

type WorkspaceSetupBundleRequest = {
  target?: string;
  configs?: workspaces.WorkspaceSetupBundleConfig[];
};

type CheckoutRequest = {
  owner?: string;
  repo?: string;
  version?: string;
  ref?: string;
};

type RemixRequest = {
  name?: string;
  title?: string;
  summary?: string;
  sourceVersion?: string;
  version?: string;
};

type StarRequest = {
  starred?: boolean;
};

type ThreadPostRequest = {
  kind?: string;
  body?: string;
};

type ReceiptQuery = {
  provider_ref?: string;
};

type EscrowReceiptRequest = {
  provider_ref?: string;
  receipt?: unknown;
};

type EscrowTimeoutRequest = {
  provider_ref?: string;
};

type BountyCreateRequest = {
  title?: string;
  spec?: string;
  budget_usd?: number;
  currency?: string;
};

type BountyDeliverRequest = {
  harness?: string;
  version?: string;
  receipt?: unknown;
};

type BountyAcceptRequest = {
  provider_ref?: string;
  receipt?: unknown;
};

type CommunityInviteRequest = {
  owner?: string;
  repo?: string;
  harness?: string;
  version?: string;
  ttl_seconds?: number;
};

type CommunityVerifyRequest = {
  code?: string;
};

type EntitlementCheckQuery = {
  subject?: string;
  harness?: string;
  version?: string;
};

type StorefrontRequest = {
  handle?: string;
  display_name?: string;
  displayName?: string;
  bio?: string;
};

type OrgWorkspacePermissionsSummary = {
  totalHarnesses: number;
  riskTiers: Record<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL", number>;
  maxRiskScore: number;
  maxRiskTier: RiskReport["tier"] | "NONE";
  permissionCounts: {
    unrestrictedNetwork: number;
    shell: number;
    browser: number;
    credentials: number;
    externalSend: number;
    moneyMovement: number;
    userData: number;
  };
  riskMarkdown: string;
};

type WorkspaceResourcePermissionsSummary = {
  totalResources: number;
  hostedArchives: number;
  unscanned: number;
  riskTiers: Record<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN", number>;
};

type ThreadItem = {
  id: string;
  author: string;
  userId?: string;
  role: string;
  kind: string;
  body: string;
  likes: number;
  at: string;
};

type AuthUser = { id: string; email?: string };

type AuthResult = {
  user?: AuthUser;
  status?: number;
  error?: string;
};

type ArchiveClientResponse = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

type ArchivePayload = {
  owner: string;
  repo: string;
  version: string;
  snapshot: boolean;
  files: registry.ArchiveFile[];
};

type DirectoryLinkOnlyBody = {
  error: "Directory link only";
  code: "DIRECTORY_LINK_ONLY";
  owner: string;
  repo: string;
  url?: string;
  item_count?: number;
  category?: string;
  notes?: string;
  next: string;
};

const app = Fastify({ logger: true });
await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || isAllowedOrigin(origin)) return callback(null, true);
    return callback(null, false);
  }
});

app.get("/healthz", async () => ({ ok: true }));

app.get("/openapi.json", async () => openapi);

app.get("/registry", async (request) => {
  const query = request.query as { q?: string; risk?: string; eval?: string; runtime?: string; job?: string; outcome?: string; sort?: string };
  const counters = await fetchCountersMap();
  return { items: registry.searchRegistry(query, counters) };
});

app.get("/resources", async (request) => {
  const query = request.query as resources.ResourceQuery;
  const counters = await fetchCountersMap();
  const registryItems = registry.scanRegistry(counters);
  return resources.searchResources(query, registryItems);
});

app.get("/resources/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const counters = await fetchCountersMap();
  const registryItems = registry.scanRegistry(counters);
  const resource = resources.resourceDetail(id, registryItems);
  if (!resource) return reply.code(404).send({ error: "Resource not found" });
  return resource;
});

app.get("/resources/:id/archive", async (request, reply) => {
  const { id } = request.params as { id: string };
  const counters = await fetchCountersMap();
  const registryItems = registry.scanRegistry(counters);
  const resource = resources.resourceDetail(id, registryItems);
  if (!resource) return reply.code(404).send({ error: "Resource not found" });
  const archivePath = resources.resourceArchivePath(resource.id);
  if (!archivePath) {
    return reply.code(409).send({
      error: "Resource archive not hosted",
      code: "RESOURCE_ARCHIVE_NOT_HOSTED",
      id: resource.id,
      next: "This resource is listed in OnlyHarness, but its files are not hosted by OnlyHarness yet."
    });
  }
  await recordEvent({
    kind: "pull",
    owner: resource.upstreamOwner,
    repo: resource.upstreamRepo ?? resource.title,
    target: "resource-archive",
    client: "api"
  });
  return reply
    .header("content-type", "application/gzip")
    .header("content-disposition", `attachment; filename="${resources.resourceArchiveFileName(resource)}"`)
    .send(createReadStream(archivePath));
});

app.get("/workspaces/:slug/workspace", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace layer is not enabled" });
  const { slug } = request.params as { slug: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["workspace:read"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "workspace" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const query = request.query as resources.ResourceQuery;
  const resourceResult = workspaces.searchWorkspaceResources(auth.workspace.slug, { ...query, limit: query.limit ?? 50 });
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "workspace_read", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: "workspace", via: auth.via });
  return {
    workspace: publicWorkspace(auth.workspace),
    resources: resourceResult.resources,
    items: resourceResult.resources,
    collections: workspaces.listWorkspaceCollections(auth.workspace.slug),
    permissions: workspaceResourcePermissionsSummary(auth.workspace.slug, resourceResult.resources),
    audit: await workspaces.readWorkspaceAudit(auth.workspace.slug, 80)
  };
});

app.get("/workspaces/:slug/setup-bundle", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace setup is not enabled" });
  const { slug } = request.params as { slug: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["workspace:setup"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "setup_bundle" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const query = request.query as { target?: string };
  const bundle = await workspaces.workspaceSetupBundle(auth.workspace, query.target);
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "setup_bundle_read", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: bundle.target, via: auth.via });
  await recordEvent({ kind: "install", owner: auth.workspace.slug, repo: "setup-bundle", version: bundle.version, subject: workspaceAuthSubject(auth), target: `workspace_setup:${bundle.target}`, client: "api" });
  return {
    workspace: publicWorkspace(auth.workspace),
    bundle,
    next: `HH_WORKSPACE_TOKEN=<token> npx onlyharness@latest workspace setup ${auth.workspace.slug} --target ${bundle.target} --json`
  };
});

app.put("/workspaces/:slug/setup-bundle", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace setup is not enabled" });
  const { slug } = request.params as { slug: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["resource:publish", "collection:write"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "setup_bundle_update" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const body = request.body && typeof request.body === "object" ? request.body as WorkspaceSetupBundleRequest : {};
  const result = await workspaces.upsertWorkspaceSetupBundle(auth.workspace, body);
  if (!result.ok) return reply.code(result.status).send({ error: result.error, code: result.code });
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "setup_bundle_updated", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: result.bundle.target, via: auth.via });
  return {
    workspace: publicWorkspace(auth.workspace),
    bundle: result.bundle,
    next: `HH_WORKSPACE_TOKEN=<token> npx onlyharness@latest workspace setup ${auth.workspace.slug} --target ${result.bundle.target} --json`
  };
});

app.get("/workspaces/:slug/members", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace members are not enabled" });
  const { slug } = request.params as { slug: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["workspace:read"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "members" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const members = await workspaces.listWorkspaceMembers(auth.workspace.slug);
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "members_read", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: "members", via: auth.via });
  return { workspace: publicWorkspace(auth.workspace), members };
});

app.post("/workspaces/:slug/members", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace members are not enabled" });
  const { slug } = request.params as { slug: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["member:write"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "member_add" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const body = request.body && typeof request.body === "object" ? request.body as WorkspaceMemberRequest : {};
  const result = await workspaces.upsertWorkspaceMember(auth.workspace.slug, body);
  if (!result.ok) return reply.code(result.status).send({ error: result.error, code: result.code });
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "member_upserted", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: result.member.user_id, via: auth.via });
  return reply.code(201).send({ workspace: publicWorkspace(auth.workspace), member: result.member });
});

app.delete("/workspaces/:slug/members/:userId", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace members are not enabled" });
  const { slug, userId } = request.params as { slug: string; userId: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["member:write"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "member_remove" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const result = await workspaces.removeWorkspaceMember(auth.workspace.slug, userId);
  if (!result.ok) return reply.code(result.status).send({ error: result.error, code: result.code });
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "member_removed", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: result.member.user_id, via: auth.via });
  return { workspace: publicWorkspace(auth.workspace), member: result.member };
});

app.post("/workspaces/:slug/invites", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace invites are not enabled" });
  const { slug } = request.params as { slug: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["invite:write"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "invite_create" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const body = request.body && typeof request.body === "object" ? request.body as WorkspaceInviteRequest : {};
  const result = await workspaces.createWorkspaceInvite(auth.workspace.slug, { ...body, createdBy: auth.userId });
  if (!result.ok) return reply.code(result.status).send({ error: result.error, code: result.code });
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "invite_created", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: result.invite.id, via: auth.via });
  return reply.code(201).send({ workspace: publicWorkspace(auth.workspace), invite: publicWorkspaceInvite(result.invite), code: result.code, next: "Show this invite code once. Only a hash is stored by OnlyHarness." });
});

app.post("/workspaces/:slug/join", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace join is not enabled" });
  const { slug } = request.params as { slug: string };
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = request.body && typeof request.body === "object" ? request.body as WorkspaceJoinRequest : {};
  const result = await workspaces.joinWorkspaceWithInvite(slug, { code: body.code, userId: user.id });
  if (!result.ok) return reply.code(result.status).send({ error: result.error, code: result.code });
  await workspaces.appendWorkspaceAudit({ slug: result.workspace.slug, action: "member_joined", subject: eventSubject(user.id), target: result.member.user_id, via: "workspace_member" });
  return reply.code(201).send({ workspace: publicWorkspace(result.workspace), member: result.member, next: "Workspace membership is active. Private install paths now require this signed-in user or a workspace token." });
});

app.get("/workspaces/:slug/resources", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace resources are not enabled" });
  const { slug } = request.params as { slug: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["resource:read"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "resources_search" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const result = workspaces.searchWorkspaceResources(auth.workspace.slug, request.query as resources.ResourceQuery);
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "resources_search", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: "resources", via: auth.via });
  return result;
});

app.post("/workspaces/:slug/resources/approve", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace resources are not enabled" });
  const { slug } = request.params as { slug: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["collection:write", "resource:publish"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "resource_approval" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const body = request.body && typeof request.body === "object" ? request.body as WorkspaceResourceApproveRequest : {};
  if (!body.resourceId) return reply.code(400).send({ error: "resourceId is required" });
  const counters = await fetchCountersMap();
  const registryItems = registry.scanRegistry(counters);
  const publicResource = resources.resourceDetail(body.resourceId, registryItems);
  if (!publicResource) {
    await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "resource_approval_missing", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: body.resourceId, via: auth.via });
    return reply.code(404).send({ error: "Public resource not found" });
  }
  const result = workspaces.approveWorkspacePublicResource(auth.workspace.slug, auth.workspace.name, publicResource, {
    collectionSlug: body.collection,
    name: body.name,
    note: body.note,
    actor: auth.tokenName ?? auth.userId
  });
  if (!result.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "resource_approval_rejected", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: publicResource.id, via: auth.via });
    return reply.code(result.status).send({ error: result.error, code: result.code });
  }
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "resource_approved", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: `${publicResource.id}->${result.resource.id}`, via: auth.via });
  return reply.code(201).send({
    workspace: publicWorkspace(auth.workspace),
    collection: result.collection,
    item: result.item,
    resource: result.resource,
    approvalState: result.approvalState,
    verified: false,
    next: "Workspace approval is a local recommendation. It is not an OnlyHarness Verified badge."
  });
});

app.get("/workspaces/:slug/resources/:id", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace resources are not enabled" });
  const { slug, id } = request.params as { slug: string; id: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["resource:read"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "resource_detail" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const resource = workspaces.workspaceResourceDetail(auth.workspace.slug, id);
  if (!resource) return reply.code(404).send({ error: "Workspace resource not found" });
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "resource_detail_read", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: resource.id, via: auth.via });
  return resource;
});

app.get("/workspaces/:slug/resources/:id/archive", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace resources are not enabled" });
  const { slug, id } = request.params as { slug: string; id: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["resource:archive"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "resource_archive" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const resource = workspaces.workspaceResourceDetail(auth.workspace.slug, id);
  if (!resource) return reply.code(404).send({ error: "Workspace resource not found" });
  const archivePath = workspaces.workspaceResourceArchivePath(auth.workspace.slug, resource.id);
  if (!archivePath) {
    return reply.code(409).send({
      error: "Workspace resource archive not hosted",
      code: "RESOURCE_ARCHIVE_NOT_HOSTED",
      id: resource.id,
      next: "This workspace resource is listed in OnlyHarness, but its files are not hosted by OnlyHarness yet."
    });
  }
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "resource_archive_read", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: resource.id, via: auth.via });
  await recordEvent({
    kind: "pull",
    owner: resource.upstreamOwner,
    repo: resource.upstreamRepo ?? resource.title,
    target: "workspace-resource-archive",
    client: "api"
  });
  return reply
    .header("content-type", "application/gzip")
    .header("content-disposition", `attachment; filename="${resources.resourceArchiveFileName(resource)}"`)
    .send(createReadStream(archivePath));
});

app.get("/workspaces/:slug/collections", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace collections are not enabled" });
  const { slug } = request.params as { slug: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["resource:read"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "collections" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const collections = workspaces.listWorkspaceCollections(auth.workspace.slug);
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "collections_read", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: "collections", via: auth.via });
  return { workspace: publicWorkspace(auth.workspace), collections };
});

app.post("/workspaces/:slug/collections", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace collections are not enabled" });
  const { slug } = request.params as { slug: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["collection:write", "resource:publish"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "collection_create" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const body = request.body && typeof request.body === "object" ? request.body as WorkspaceCollectionRequest : {};
  const collection = workspaces.upsertWorkspaceCollection(auth.workspace.slug, body);
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "collection_upserted", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: collection.slug, via: auth.via });
  return reply.code(201).send({ workspace: publicWorkspace(auth.workspace), collection });
});

app.get("/workspaces/:slug/collections/:collection", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace collections are not enabled" });
  const { slug, collection: collectionSlug } = request.params as { slug: string; collection: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["resource:read"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "collection_detail" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const collection = workspaces.workspaceCollectionDetail(auth.workspace.slug, collectionSlug);
  if (!collection) return reply.code(404).send({ error: "Workspace collection not found" });
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "collection_read", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: collection.slug, via: auth.via });
  return { workspace: publicWorkspace(auth.workspace), collection };
});

app.post("/workspaces/:slug/collections/:collection/items", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace collections are not enabled" });
  const { slug, collection } = request.params as { slug: string; collection: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["collection:write", "resource:publish"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "collection_item_add" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const body = request.body && typeof request.body === "object" ? request.body as WorkspaceResourceApproveRequest : {};
  if (!body.resourceId) return reply.code(400).send({ error: "resourceId is required" });
  const counters = await fetchCountersMap();
  const registryItems = registry.scanRegistry(counters);
  const publicResource = resources.resourceDetail(body.resourceId, registryItems);
  if (!publicResource) {
    await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "collection_item_missing", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: body.resourceId, via: auth.via });
    return reply.code(404).send({ error: "Public resource not found" });
  }
  const result = workspaces.approveWorkspacePublicResource(auth.workspace.slug, auth.workspace.name, publicResource, {
    collectionSlug: collection,
    name: body.name,
    note: body.note,
    actor: auth.tokenName ?? auth.userId
  });
  if (!result.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "collection_item_rejected", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: publicResource.id, via: auth.via });
    return reply.code(result.status).send({ error: result.error, code: result.code });
  }
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "collection_item_approved", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: `${collection}:${publicResource.id}->${result.resource.id}`, via: auth.via });
  return reply.code(201).send({
    workspace: publicWorkspace(auth.workspace),
    collection: result.collection,
    item: result.item,
    resource: result.resource,
    approvalState: result.approvalState,
    verified: false,
    next: "Workspace approval is a local recommendation. It is not an OnlyHarness Verified badge."
  });
});

app.delete("/workspaces/:slug/collections/:collection/items/:itemId", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace collections are not enabled" });
  const { slug, collection, itemId } = request.params as { slug: string; collection: string; itemId: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["collection:write", "resource:publish"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "collection_item_remove" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const result = workspaces.removeWorkspaceCollectionItem(auth.workspace.slug, collection, itemId);
  if (!result.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "collection_item_remove_missing", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: `${collection}:${itemId}`, via: auth.via });
    return reply.code(result.status).send({ error: result.error, code: result.code });
  }
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "collection_item_removed", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: `${collection}:${result.item.itemRef}`, via: auth.via });
  return {
    workspace: publicWorkspace(auth.workspace),
    collection: result.collection,
    item: result.item,
    removedResourceId: result.removedResourceId,
    next: "Workspace approval removed. If no other collection references it, the derived workspace resource is removed too."
  };
});

app.get("/leaderboard", async (request) => {
  const query = request.query as { limit?: string };
  const limit = Math.min(Number(query.limit ?? 10), 50);
  const counters = await fetchCountersMap();
  const items = registry.sortRegistry(registry.scanRegistry(counters).filter((item) => item.heatQualified), "heat").slice(0, limit);
  return { items, minimumSignals: HEAT_SIGNAL_THRESHOLD };
});

app.get("/repos/:owner/:repo/harness", async (request, reply) => {
  const { owner, repo } = request.params as { owner: string; repo: string };
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const { inspection, evalResult, security, contextCost, standard } = registry.registryDetailBasics(root);
  const orgGate = await gateOrgVisibility(owner, inspection.manifest, headerValue(request.headers.authorization), "detail");
  if (!orgGate.ok) return reply.code(orgGate.status).send({ error: orgGate.error });
  const counters = await fetchCountersMap();
  const item = registry.registryItemFromDir(owner, root, counters);
  const lastVerifiedAt = await fetchLastVerificationAt(owner, repo);
  const { rootDir, ...publicInspection } = inspection;
  void rootDir;
  return {
    owner,
    repo,
    ...(item?.forgeUrl ? { forgeUrl: item.forgeUrl } : {}),
    social: item ? registry.socialFromItem(item) : undefined,
    thread: await fetchThreadPosts(owner, repo),
    example: registry.readExample(root),
    files: registry.listHarnessFiles(root),
    versions: registry.listArchiveVersions(owner, repo, root),
    ...publicInspection,
    evalResult,
    security,
    contextCost,
    standard,
    verification: { lastVerifiedAt },
    readme: registry.readMaybe(path.join(root, "README.md")),
    prReview: samplePrReview(root, owner, repo)
  };
});

app.get("/repos/:owner/:repo/archive", async (request, reply) => {
  const { owner, repo } = request.params as { owner: string; repo: string };
  const query = request.query as { version?: string };
  const result = await archiveForClient(owner, repo, query.version, headerValue(request.headers.authorization), "api", paymentSignatureFromRequest(request));
  for (const [key, value] of Object.entries(result.headers ?? {})) reply.header(key, value);
  if (result.status === 402 && !result.headers?.["PAYMENT-REQUIRED"]) {
    const header = x402PaymentRequiredHeader(result.body as PaymentRequiredBody);
    if (header) reply.header("PAYMENT-REQUIRED", header);
  }
  return reply.code(result.status).send(result.body);
});

app.post("/repos/:owner/:repo/remixes", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const { owner, repo } = request.params as { owner: string; repo: string };
  const body = request.body && typeof request.body === "object" ? request.body as RemixRequest : {};
  const result = await remixHarnessForUser(owner, repo, body, user, headerValue(request.headers.authorization));
  if ("error" in result) return reply.code(result.status ?? 500).send(result.body ?? { error: result.error });
  return reply.code(201).send(result);
});

app.post("/billing/checkout", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = request.body && typeof request.body === "object" ? request.body as CheckoutRequest : {};
  const owner = body.owner;
  const repo = body.repo;
  if (!owner || !repo) return reply.code(400).send({ error: "owner and repo are required" });
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const manifest = registry.registryDetailBasics(root).inspection.manifest;
  if (!manifest) return reply.code(500).send({ error: "Harness manifest unavailable" });
  const orgGate = await gateOrgVisibility(owner, manifest, headerValue(request.headers.authorization), "checkout");
  if (!orgGate.ok) return reply.code(orgGate.status).send({ error: orgGate.error });
  const archive = registry.buildArchiveForVersion(owner, repo, root, body.version);
  if (!archive) return reply.code(404).send({ error: "Harness version not found" });
  if (manifest.pricing.model === "per_call") {
    return reply.code(409).send(hostedExecutionUnavailableBody({ owner, repo, version: archive.version, manifest, authorization: headerValue(request.headers.authorization), userId: user.id }));
  }
  const attribution = await resolveCheckoutAttribution({
    owner,
    repo,
    referralCode: body.ref
  });
  if (!attribution.ok) return reply.code(attribution.status).send({ error: attribution.error });
  const session = await createCheckoutSession({
    owner,
    repo,
    version: archive.version,
    manifest,
    userId: user.id,
    referralCode: attribution.value.referralCode,
    creatorUserId: attribution.value.creatorUserId
  });
  if ("error" in session) return reply.code(session.status).send({ error: session.error });
  await recordEvent({ kind: "checkout", owner, repo, version: archive.version, subject: eventSubject(user.id), target: "billing", client: "api" });
  return reply.code(201).send(session);
});

app.get("/billing/receipt", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const query = request.query as ReceiptQuery;
  const receipt = await readPurchaseReceipt({
    providerRef: query.provider_ref ?? "",
    userId: user.id
  });
  if ("error" in receipt) return reply.code(receipt.status).send({ error: receipt.error });
  return receipt;
});

app.post("/billing/escrow/receipt", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = request.body && typeof request.body === "object" ? request.body as EscrowReceiptRequest : {};
  const result = await settleEscrowReceipt({
    providerRef: body.provider_ref ?? "",
    userId: user.id,
    receipt: body.receipt
  });
  if (!result.ok) return reply.code(result.status).send({ error: result.error, escrow_expires_at: result.escrow_expires_at });
  await recordEscrowSettlementEvent(result, result.reason === "receipt_passed" ? "receipt:passed" : "receipt:failed");
  return result;
});

app.post("/billing/escrow/timeout", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = request.body && typeof request.body === "object" ? request.body as EscrowTimeoutRequest : {};
  const result = await timeoutEscrowPurchase({
    providerRef: body.provider_ref ?? "",
    userId: user.id
  });
  if (!result.ok) return reply.code(result.status).send({ error: result.error, escrow_expires_at: result.escrow_expires_at });
  await recordEscrowSettlementEvent(result, "timeout");
  return result;
});

app.get("/entitlements/check", async (request, reply) => {
  if (!orgsEnabled) return reply.code(404).send({ error: "Entitlement checks are not enabled" });
  const token = orgTokenFromRequest(request);
  const auth = await authorizeAnyOrgToken(token, ["entitlements:read"]);
  if (!auth.ok) {
    await appendOrgAudit({ slug: auth.slug ?? "unknown", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "entitlements_check" });
    return reply.code(auth.status).send({ error: auth.error });
  }

  const query = request.query as EntitlementCheckQuery;
  const subject = parseEntitlementSubject(query.subject);
  if (!subject) return reply.code(400).send({ error: "subject must be user:<id>, wallet:<id> or org:<slug>" });
  const harness = parseHarnessRef(query.harness);
  if (!harness) return reply.code(400).send({ error: "harness must be owner/name" });

  const root = registry.resolveHarnessPath(harness.owner, harness.repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const manifest = registry.registryDetailBasics(root).inspection.manifest;
  if (!manifest) return reply.code(500).send({ error: "Harness manifest unavailable" });
  const orgGate = gateEntitlementCheckVisibility(harness.owner, manifest, auth.org.slug);
  if (!orgGate.ok) {
    await appendOrgAudit({ slug: auth.org.slug, action: orgGate.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: `${harness.owner}/${harness.repo}` });
    return reply.code(orgGate.status).send({ error: orgGate.error });
  }

  const archive = registry.buildArchiveForVersion(harness.owner, harness.repo, root, query.version);
  if (!archive) return reply.code(404).send({ error: "Harness version not found" });
  const result = await checkEntitlement({
    owner: harness.owner,
    repo: harness.repo,
    version: archive.version,
    manifest,
    subject
  });
  await appendOrgAudit({ slug: auth.org.slug, action: "entitlement_check_read", tokenName: auth.tokenName, subject: `${subject.type}:${subject.id}`, target: `${harness.owner}/${harness.repo}@${archive.version}` });
  return {
    ok: true,
    entitled: result.entitled,
    status: result.status,
    owner: harness.owner,
    repo: harness.repo,
    version: archive.version,
    subject_type: subject.type,
    subject_id: subject.id,
    pricing: manifest.pricing
  };
});

app.post("/community/invite-code", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = request.body && typeof request.body === "object" ? request.body as CommunityInviteRequest : {};
  const harness = body.harness ? parseHarnessRef(body.harness) : parseHarnessRef(`${body.owner ?? ""}/${body.repo ?? ""}`);
  if (!harness) return reply.code(400).send({ error: "harness must be owner/name, or owner and repo are required" });
  const root = registry.resolveHarnessPath(harness.owner, harness.repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const manifest = registry.registryDetailBasics(root).inspection.manifest;
  if (!manifest) return reply.code(500).send({ error: "Harness manifest unavailable" });
  const communityGate = gateCommunityCodeVisibility(harness.owner, manifest);
  if (!communityGate.ok) return reply.code(communityGate.status).send({ error: communityGate.error });
  const archive = registry.buildArchiveForVersion(harness.owner, harness.repo, root, body.version);
  if (!archive) return reply.code(404).send({ error: "Harness version not found" });
  const entitlement = await checkEntitlement({
    owner: harness.owner,
    repo: harness.repo,
    version: archive.version,
    manifest,
    subject: { type: "user", id: user.id }
  });
  if (!entitlement.entitled) {
    return reply.code(402).send({
      error: "Payment required",
      code: "PAYMENT_REQUIRED",
      owner: harness.owner,
      repo: harness.repo,
      version: archive.version,
      status: entitlement.status,
      pricing: manifest.pricing,
      next: "Complete checkout before creating a community invite code."
    });
  }
  const secret = communityInviteSecret();
  if (!secret) return reply.code(503).send({ error: "Community invite codes are not configured" });
  const code = createCommunityInviteCode({
    subject: { type: "user", id: user.id },
    owner: harness.owner,
    repo: harness.repo,
    version: archive.version,
    ttlSeconds: typeof body.ttl_seconds === "number" ? body.ttl_seconds : undefined,
    secret
  });
  if (!code.ok) return reply.code(503).send({ error: code.error });
  return reply.code(201).send({
    ok: true,
    code: code.code,
    owner: harness.owner,
    repo: harness.repo,
    version: archive.version,
    subject_type: code.payload.subject.type,
    subject_id: code.payload.subject.id,
    expires_at: new Date(code.payload.exp * 1000).toISOString(),
    next: "Paste this short-lived code into the creator's Telegram gate bot."
  });
});

app.post("/community/verify-code", async (request, reply) => {
  if (!orgsEnabled) return reply.code(404).send({ error: "Community code verification is not enabled" });
  const token = orgTokenFromRequest(request);
  const auth = await authorizeAnyOrgToken(token, ["entitlements:read"]);
  if (!auth.ok) {
    await appendOrgAudit({ slug: auth.slug ?? "unknown", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "community_code" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const secret = communityInviteSecret();
  if (!secret) return reply.code(503).send({ error: "Community invite codes are not configured" });
  const body = request.body && typeof request.body === "object" ? request.body as CommunityVerifyRequest : {};
  if (!body.code) return reply.code(400).send({ error: "code is required" });
  const verified = verifyCommunityInviteCode({ code: body.code, secret });
  if (!verified.ok) {
    await appendOrgAudit({ slug: auth.org.slug, action: verified.status === 410 ? "community_code_expired" : "community_code_denied", tokenName: auth.tokenName, subject: eventSubject(undefined), target: "community_code" });
    return reply.code(verified.status).send({ error: verified.error });
  }

  const { owner, repo, version, subject } = verified.payload;
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const manifest = registry.registryDetailBasics(root).inspection.manifest;
  if (!manifest) return reply.code(500).send({ error: "Harness manifest unavailable" });
  const orgGate = gateEntitlementCheckVisibility(owner, manifest, auth.org.slug);
  if (!orgGate.ok) {
    await appendOrgAudit({ slug: auth.org.slug, action: orgGate.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: `${owner}/${repo}` });
    return reply.code(orgGate.status).send({ error: orgGate.error });
  }
  const archive = registry.buildArchiveForVersion(owner, repo, root, version);
  if (!archive) return reply.code(404).send({ error: "Harness version not found" });
  const entitlement = await checkEntitlement({ owner, repo, version: archive.version, manifest, subject });
  await appendOrgAudit({ slug: auth.org.slug, action: "community_code_verified", tokenName: auth.tokenName, subject: `${subject.type}:${subject.id}`, target: `${owner}/${repo}@${archive.version}` });
  return {
    ok: true,
    allowed: entitlement.entitled,
    entitled: entitlement.entitled,
    status: entitlement.status,
    owner,
    repo,
    version: archive.version,
    subject_type: subject.type,
    subject_id: subject.id,
    pricing: manifest.pricing
  };
});

app.get("/me/storefront", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const result = await fetchMyStorefront(user.id);
  if (!result.ok) return reply.code(result.status).send({ error: result.error });
  return result.value;
});

app.put("/me/storefront", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = request.body && typeof request.body === "object" ? request.body as StorefrontRequest : {};
  const result = await upsertStorefrontProfile({
    userId: user.id,
    handle: body.handle,
    displayName: body.display_name ?? body.displayName,
    bio: body.bio
  });
  if (!result.ok) return reply.code(result.status).send({ error: result.error });
  return result.value;
});

app.get("/storefront/:handle", async (request, reply) => {
  const { handle } = request.params as { handle: string };
  const result = await fetchStorefrontByHandle(handle);
  if (!result.ok) return reply.code(result.status).send({ error: result.error });
  const counters = await fetchCountersMap();
  const registryItems = new Map(registry.scanRegistry(counters).map((item) => [`${item.owner}/${item.name}`, item]));
  const items = result.value.harnesses
    .map((ref) => registryItems.get(`${ref.owner}/${ref.repo}`))
    .filter(Boolean);
  return {
    profile: result.value.profile,
    referralCode: result.value.referralCode,
    items
  };
});

app.get("/bounties", async () => ({ items: await listBounties() }));

app.post("/bounties", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = request.body && typeof request.body === "object" ? request.body as BountyCreateRequest : {};
  const result = await createBounty({
    title: body.title,
    spec: body.spec,
    budgetUsd: body.budget_usd,
    currency: body.currency,
    userId: user.id
  });
  if (!result.ok) return reply.code(result.status).send({ error: result.error });
  return reply.code(201).send(result.value);
});

app.post("/bounties/:id/claim", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const { id } = request.params as { id: string };
  const result = await claimBounty({ id, userId: user.id });
  if (!result.ok) return reply.code(result.status).send({ error: result.error });
  return result.value;
});

app.post("/bounties/:id/deliver", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const { id } = request.params as { id: string };
  const body = request.body && typeof request.body === "object" ? request.body as BountyDeliverRequest : {};
  const result = await deliverBounty({
    id,
    userId: user.id,
    harness: body.harness,
    version: body.version,
    receipt: body.receipt
  });
  if (!result.ok) return reply.code(result.status).send({ error: result.error });
  return result.value;
});

app.post("/bounties/:id/accept", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const { id } = request.params as { id: string };
  const body = request.body && typeof request.body === "object" ? request.body as BountyAcceptRequest : {};
  const result = await acceptBounty({
    id,
    userId: user.id,
    providerRef: body.provider_ref,
    receipt: body.receipt
  });
  if (!result.ok) return reply.code(result.status).send({ error: result.error });
  const paidHarness = parseHarnessRef(result.value.delivered_harness ?? undefined);
  if (paidHarness) {
    await recordEvent({
      kind: "escrow_captured",
      owner: paidHarness.owner,
      repo: paidHarness.repo,
      version: result.value.delivered_version,
      subject: eventSubject(user.id),
      target: "bounty_accept",
      client: "api"
    });
  }
  await recordEvent({ kind: "purchase", owner: "bounties", repo: id, subject: eventSubject(user.id), target: "bounty_paid", client: "api" });
  return result.value;
});

app.get("/orgs/:slug/bundle", async (request, reply) => {
  if (!orgsEnabled) return reply.code(404).send({ error: "Org setup is not enabled" });
  const { slug } = request.params as { slug: string };
  const token = orgTokenFromRequest(request);
  const result = await readOrgBundle(slug, token);
  if (!result.ok) {
    await appendOrgAudit({ slug: result.slug ?? "invalid", action: result.auditAction, tokenName: result.tokenName, subject: eventSubject(undefined), target: "setup" });
    return reply.code(result.status).send({ error: result.error });
  }
  await appendOrgAudit({ slug: result.org.slug, action: "bundle_read", tokenName: result.tokenName, subject: eventSubject(undefined), target: "setup" });
  await recordEvent({ kind: "install", owner: result.org.slug, repo: "bundle", version: result.bundle.version, subject: eventSubject(undefined), target: "org_setup", client: "api" });
  return {
    organization: {
      slug: result.org.slug,
      name: result.org.name,
      plan: result.org.plan
    },
    bundle: result.bundle
  };
});

app.get("/orgs/:slug/workspace", async (request, reply) => {
  if (!orgsEnabled) return reply.code(404).send({ error: "Org workspace is not enabled" });
  const { slug } = request.params as { slug: string };
  const token = orgTokenFromRequest(request);
  const auth = await authorizeOrgToken(slug, token, ["read", "setup", "publish"]);
  if (!auth.ok) {
    await appendOrgAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "workspace" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const counters = await fetchCountersMap();
  const owner = `@${auth.org.slug}`;
  const items = registry.sortRegistry(registry.scanHarnessRoot(owner, registry.orgImportRoot(auth.org.slug), counters), "new");
  await appendOrgAudit({ slug: auth.org.slug, action: "workspace_read", tokenName: auth.tokenName, subject: eventSubject(undefined), target: "network_neighborhood" });
  return {
    organization: {
      slug: auth.org.slug,
      name: auth.org.name,
      plan: auth.org.plan
    },
    items,
    permissions: orgWorkspacePermissionsSummary(items),
    audit: await readOrgAudit(auth.org.slug, 80)
  };
});

app.post("/orgs/:slug/imports/markdown-to-harness", async (request, reply) => {
  if (!orgsEnabled) return reply.code(404).send({ error: "Org publishing is not enabled" });
  const { slug } = request.params as { slug: string };
  const token = orgTokenFromRequest(request);
  const auth = await authorizeOrgToken(slug, token, ["publish"]);
  if (!auth.ok) {
    await appendOrgAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "publish" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const body = request.body as ImportRequest;
  const result = await importMarkdownToHarness(body, { id: `org:${auth.org.slug}` }, { orgSlug: auth.org.slug, owner: `@${auth.org.slug}` });
  if ("error" in result) return reply.code(result.status ?? 500).send({ error: result.error });
  await appendOrgAudit({ slug: auth.org.slug, action: "publish_import", tokenName: auth.tokenName, subject: eventSubject(undefined), target: result.item?.name });
  return result;
});

app.post("/orgs/:slug/imports/harness-dir", async (request, reply) => {
  if (!orgsEnabled) return reply.code(404).send({ error: "Org publishing is not enabled" });
  const { slug } = request.params as { slug: string };
  const token = orgTokenFromRequest(request);
  const auth = await authorizeOrgToken(slug, token, ["publish"]);
  if (!auth.ok) {
    await appendOrgAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "verified_publish" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const body = request.body && typeof request.body === "object" ? request.body as HarnessDirPublishRequest : {};
  const result = await importVerifiedHarnessDir(body, { id: `org:${auth.org.slug}` }, { orgSlug: auth.org.slug, owner: `@${auth.org.slug}` });
  if ("error" in result) {
    const payload: { error: string; failures?: string[] } = { error: result.error ?? "Publish failed" };
    if ("failures" in result && result.failures) payload.failures = result.failures;
    await appendOrgAudit({ slug: auth.org.slug, action: "verified_publish_rejected", tokenName: auth.tokenName, subject: eventSubject(undefined), target: body.name });
    return reply.code(result.status ?? 500).send(payload);
  }
  await appendOrgAudit({ slug: auth.org.slug, action: "verified_publish", tokenName: auth.tokenName, subject: eventSubject(undefined), target: result.item?.name });
  return result;
});

app.post("/workspaces/:slug/imports/resource-package", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace publishing is not enabled" });
  const { slug } = request.params as { slug: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["resource:publish"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "resource_publish" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const body = request.body && typeof request.body === "object" ? request.body as ResourcePackageImportRequest : {};
  const result = await importResourcePackage(body, { id: auth.userId ?? `workspace:${auth.workspace.slug}`, email: auth.workspace.name }, { workspaceSlug: auth.workspace.slug, workspaceName: auth.workspace.name, actorLabel: auth.tokenName ?? auth.userId });
  if ("error" in result) {
    const payload: { error: string; code?: string; failures?: string[] } = { error: result.error ?? "Workspace resource package import failed" };
    if ("code" in result && result.code) payload.code = result.code;
    if ("failures" in result && result.failures) payload.failures = result.failures;
    await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "resource_publish_rejected", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: body.name, via: auth.via });
    return reply.code(result.status ?? 500).send(payload);
  }
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "resource_package_publish", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: result.resource?.id, via: auth.via });
  return reply.code(201).send(result);
});

app.get("/repos/:owner/:repo/thread", async (request, reply) => {
  const { owner, repo } = request.params as { owner: string; repo: string };
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const manifest = registry.registryDetailBasics(root).inspection.manifest;
  const orgGate = await gateOrgVisibility(owner, manifest, headerValue(request.headers.authorization), "thread");
  if (!orgGate.ok) return reply.code(orgGate.status).send({ error: orgGate.error });
  return { items: await fetchThreadPosts(owner, repo) };
});

app.post("/repos/:owner/:repo/star", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const { owner, repo } = request.params as { owner: string; repo: string };
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const manifest = registry.registryDetailBasics(root).inspection.manifest;
  const orgGate = await gateOrgVisibility(owner, manifest, headerValue(request.headers.authorization), "star");
  if (!orgGate.ok) return reply.code(orgGate.status).send({ error: orgGate.error });
  const body = request.body && typeof request.body === "object" ? request.body as StarRequest : {};
  const starred = body.starred !== false;
  const result = await writeHarnessStar({ owner, repo, userId: user.id, starred });
  if (!result.ok) return reply.code(result.status).send({ error: result.error, code: result.code, next: result.next });
  return { owner, repo, starred };
});

app.post("/repos/:owner/:repo/thread", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const { owner, repo } = request.params as { owner: string; repo: string };
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const manifest = registry.registryDetailBasics(root).inspection.manifest;
  const orgGate = await gateOrgVisibility(owner, manifest, headerValue(request.headers.authorization), "thread");
  if (!orgGate.ok) return reply.code(orgGate.status).send({ error: orgGate.error });
  const body = request.body && typeof request.body === "object" ? request.body as ThreadPostRequest : {};
  const result = await writeHarnessThreadPost({ owner, repo, user, kind: body.kind, body: body.body });
  if (!result.ok) return reply.code(result.status).send({ error: result.error, code: result.code, next: result.next });
  return reply.code(201).send({ owner, repo, item: result.item });
});

app.get("/repos/:owner/:repo/security-report", async (request, reply) => {
  const { owner, repo } = request.params as { owner: string; repo: string };
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const { inspection, security } = registry.registryDetailBasics(root);
  const orgGate = await gateOrgVisibility(owner, inspection.manifest, headerValue(request.headers.authorization), "security");
  if (!orgGate.ok) return reply.code(orgGate.status).send({ error: orgGate.error });
  return security;
});

app.get("/prs/:owner/:repo/:number/semantic-diff", async (request, reply) => {
  const { owner, repo, number } = request.params as { owner: string; repo: string; number: string };
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const manifest = registry.registryDetailBasics(root).inspection.manifest;
  const orgGate = await gateOrgVisibility(owner, manifest, headerValue(request.headers.authorization), "semantic_diff");
  if (!orgGate.ok) return reply.code(orgGate.status).send({ error: orgGate.error });
  return reply.code(501).send({
    error: "Real forge PR semantic diff is not available yet",
    code: "PR_SEMANTIC_DIFF_NOT_AVAILABLE",
    owner,
    repo,
    number,
    demo: samplePrReview(root, owner, repo),
    next: "Use `hh diff --base-dir <base> --head-dir <head>` locally, or inspect the Maintainer Review demo in the harness detail payload."
  });
});

app.post("/mcp", async (request, reply) => {
  const server = buildMcpServer({
    publishMarkdown: publishMarkdownFromMcp,
    publishResourcePackage: publishResourcePackageFromMcp,
    pullHarness: pullHarnessFromMcp,
    harnessDetail: harnessDetailFromMcp,
    pullInstructions: pullInstructionsFromMcp
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  reply.raw.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  } catch (error) {
    request.log.error({ error }, "MCP request failed");
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(500, { "content-type": "application/json" });
      reply.raw.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null
      }));
    }
  }
});

app.get("/mcp", async (_request, reply) => mcpMethodNotAllowed(reply));
app.delete("/mcp", async (_request, reply) => mcpMethodNotAllowed(reply));

app.post("/imports/markdown-to-harness", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = request.body as ImportRequest;
  const result = await importMarkdownToHarness(body, user);
  if ("error" in result) return reply.code(result.status ?? 500).send({ error: result.error });
  return result;
});

app.post("/imports/harness-dir", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = request.body && typeof request.body === "object" ? request.body as HarnessDirPublishRequest : {};
  const result = await importVerifiedHarnessDir(body, user);
  if ("error" in result) {
    const payload: { error: string; failures?: string[] } = { error: result.error ?? "Publish failed" };
    if ("failures" in result && result.failures) payload.failures = result.failures;
    return reply.code(result.status ?? 500).send(payload);
  }
  return result;
});

app.post("/imports/resource-package", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = request.body && typeof request.body === "object" ? request.body as ResourcePackageImportRequest : {};
  const result = await importResourcePackage(body, user);
  if ("error" in result) {
    const payload: { error: string; code?: string; failures?: string[] } = { error: result.error ?? "Resource package import failed" };
    if ("code" in result && result.code) payload.code = result.code;
    if ("failures" in result && result.failures) payload.failures = result.failures;
    return reply.code(result.status ?? 500).send(payload);
  }
  return reply.code(201).send(result);
});

app.post("/imports/github-resource", async (request, reply) => {
  const body = request.body && typeof request.body === "object" ? request.body as GitHubResourceRequest : {};
  try {
    return await classifyGitHubResource(body);
  } catch (error) {
    if (error instanceof GitHubImportError) {
      return reply.code(error.status).send({ error: error.message, code: error.code });
    }
    request.log.error({ error }, "GitHub resource classify failed");
    return reply.code(500).send({ error: "GitHub resource classify failed" });
  }
});

app.post("/events", async (request, reply) => {
  const authorization = headerValue(request.headers.authorization);
  const auth = authorization ? await userFromAuthorization(authorization) : {};
  const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
  const event = sanitizeEvent({
    kind: String(body.kind ?? ""),
    owner: typeof body.owner === "string" ? body.owner : undefined,
    repo: typeof body.repo === "string" ? body.repo : undefined,
    version: typeof body.version === "string" ? body.version : undefined,
    target: typeof body.target === "string" ? body.target : undefined,
    client: typeof body.client === "string" ? body.client : undefined,
    subject: eventSubject(auth.user?.id)
  });
  if (!event) return reply.code(400).send({ error: "Invalid event" });
  await recordEvent(event);
  return reply.code(202).send({ ok: true });
});

app.post("/receipts", async (request, reply) => {
  const result = verifyGateReceipt(request.body);
  if (!result.ok) return reply.code(result.status).send({ error: result.error });
  return result;
});

app.post("/webhooks/gitea", async (request, reply) => {
  if (!requireInternalToken(request, reply)) return;
  appendState({ type: "webhook", headers: safeHeaders(request.headers), payload: request.body, at: new Date().toISOString() });
  return { ok: true, mode: "recorded-local-webhook" };
});

app.post("/webhooks/payments", async (request, reply) => {
  if (!requirePaymentWebhookToken(request, reply)) return;
  const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
  const result = await settlePaymentWebhook({
    provider: typeof body.provider === "string" ? body.provider : "manual",
    provider_ref: typeof body.provider_ref === "string" ? body.provider_ref : undefined,
    status: typeof body.status === "string" ? body.status : "paid"
  });
  if (!result.ok) return reply.code(result.status).send({ error: result.error });
  await recordPaymentTransitionEvent(result.status, result.owner, result.repo, result.version, eventSubject(result.subject_id), "webhook", "api");
  return result;
});

app.post("/internal/eval-result", async (request, reply) => {
  if (!requireInternalToken(request, reply)) return;
  appendState({ type: "eval-result", payload: request.body, at: new Date().toISOString() });
  return { ok: true };
});

const port = Number(process.env.HARNESS_API_PORT ?? 8787);
const host = process.env.HARNESS_API_HOST ?? "127.0.0.1";
await app.listen({ port, host });

function parseEntitlementSubject(value: string | undefined): EntitlementSubject | undefined {
  const match = value?.match(/^(user|wallet|org):(.+)$/);
  if (!match) return undefined;
  const type = match[1] as EntitlementSubject["type"];
  const id = match[2]?.trim();
  if (!id || id.length > 160) return undefined;
  if (type === "org") {
    return /^[a-z][a-z0-9_-]{1,48}$/.test(id) ? { type, id } : undefined;
  }
  return /^[A-Za-z0-9._:@-]+$/.test(id) ? { type, id } : undefined;
}

function parseHarnessRef(value: string | undefined): { owner: string; repo: string } | undefined {
  const match = value?.match(/^(@?[a-z0-9][a-z0-9_-]{1,80})\/([a-z0-9][a-z0-9_-]{1,80})$/);
  if (!match) return undefined;
  return { owner: match[1], repo: match[2] };
}

function gateEntitlementCheckVisibility(owner: string, manifest: HarnessManifest | undefined, tokenOrgSlug: string):
  | { ok: true }
  | { ok: false; status: number; error: string; auditAction: string } {
  if (owner.startsWith("@") && manifest?.visibility !== "org") {
    return { ok: false, status: 403, error: "Org harness visibility mismatch", auditAction: "entitlement_check_visibility_mismatch" };
  }
  if (manifest?.visibility === "private") {
    return { ok: false, status: 403, error: "Private harness is not available through this API", auditAction: "entitlement_check_private_denied" };
  }
  if (manifest?.visibility !== "org") return { ok: true };
  const slug = manifest.org;
  if (!slug || owner !== `@${slug}`) {
    return { ok: false, status: 403, error: "Org harness owner mismatch", auditAction: "entitlement_check_owner_mismatch" };
  }
  if (tokenOrgSlug !== slug) {
    return { ok: false, status: 403, error: "Org token cannot check this harness", auditAction: "entitlement_check_org_denied" };
  }
  return { ok: true };
}

function gateCommunityCodeVisibility(owner: string, manifest: HarnessManifest | undefined):
  | { ok: true }
  | { ok: false; status: number; error: string } {
  if (owner.startsWith("@") && manifest?.visibility !== "org") return { ok: false, status: 403, error: "Org harness visibility mismatch" };
  if (manifest?.visibility === "private") return { ok: false, status: 403, error: "Private harness is not available for community invite codes" };
  if (manifest?.visibility === "org") return { ok: false, status: 403, error: "Org-private harness community invite codes require a dedicated org flow" };
  return { ok: true };
}

function communityInviteSecret(): string | undefined {
  const secret = process.env.COMMUNITY_INVITE_SECRET?.trim() || process.env.HARNESS_COMMUNITY_INVITE_SECRET?.trim();
  return secret && secret.length >= 24 ? secret : undefined;
}

function parseCsv(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((origin) => origin.trim()).filter(Boolean));
}

function isAllowedOrigin(origin: string): boolean {
  if (corsOrigins.size === 0 || corsOrigins.has("*") || corsOrigins.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}

async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<AuthUser | undefined> {
  const result = await userFromAuthorization(headerValue(request.headers.authorization));
  if (result.user) return result.user;
  if (result.status === 401) {
    reply.header("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl}"`);
  }
  reply.code(result.status ?? 401).send({ error: result.error ?? "Sign in required" });
  return undefined;
}

async function userFromAuthorization(authorization: string | undefined): Promise<AuthResult> {
  if (!supabaseUrl || !supabaseAnonKey) {
    const local = authorization?.match(/^Bearer\s+local:([A-Za-z0-9._:-]{2,80})$/);
    return { user: { id: local?.[1] ?? "local-dev" } };
  }
  if (!authorization?.startsWith("Bearer ")) {
    return { status: 401, error: "Sign in required" };
  }
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: supabaseAnonKey,
        authorization
      }
    });
    if (!response.ok) {
      return { status: 401, error: "Invalid or expired session" };
    }
    const user = await response.json() as { id?: string; email?: string };
    if (!user.id) {
      return { status: 401, error: "Invalid session user" };
    }
    return { user: { id: user.id, email: user.email } };
  } catch {
    return { status: 503, error: "Auth provider unavailable" };
  }
}

const publishMarkdownFromMcp: PublishMarkdownHandler = async (body, authorization) => {
  const auth = await userFromAuthorization(authorization);
  if (!auth.user) {
    return {
      error: auth.error ?? "Authorization required",
      status: auth.status ?? 401,
      resource_metadata: resourceMetadataUrl
    };
  }
  const result = await importMarkdownToHarness(body, auth.user);
  return "error" in result ? result : result;
};

const publishResourcePackageFromMcp: PublishResourcePackageHandler = async (body, authorization) => {
  const auth = await userFromAuthorization(authorization);
  if (!auth.user) {
    return {
      error: auth.error ?? "Authorization required",
      status: auth.status ?? 401,
      resource_metadata: resourceMetadataUrl
    };
  }
  const result = await importResourcePackage(body, auth.user);
  return "error" in result ? result : result;
};

const pullHarnessFromMcp: PullHarnessHandler = async ({ owner, name, version }, authorization) => {
  const result = await archiveForClient(owner, name, version, authorization, "mcp");
  if (result.status === 200) return result.body;
  const body = result.body && typeof result.body === "object" ? result.body as { error?: string } & Record<string, unknown> : {};
  return {
    ...body,
    error: body.error ?? "Pull failed",
    status: result.status,
    payment: result.status === 402 ? result.body : undefined
  };
};

const harnessDetailFromMcp = async ({ owner, name }: { owner: string; name: string }, authorization?: string) => {
  return harnessDetailPayload(owner, name, authorization);
};

const pullInstructionsFromMcp = async ({ owner, name }: { owner: string; name: string }, authorization?: string) => {
  const detail = await harnessDetailPayload(owner, name, authorization);
  if ("error" in detail) return detail;
  if (detail.manifest?.content?.type === "directory") {
    const directory = detail.manifest.content.directory;
    return {
      command: directory?.url ? `open ${directory.url}` : `hh search ${name}`,
      archiveUrl: null,
      contentType: "directory",
      directory,
      access: detail.access,
      payment: detail.access.payment,
      next: ["Open the upstream directory", "Review source state and licensing before importing entries"]
    };
  }
  const version = detail.manifest?.version ?? "current";
  const command = `npx onlyharness install ${owner}/${name}`;
  const localCommand = `node packages/harness-cli/dist/hh.mjs install ${owner}/${name}`;
  return {
    command,
    localCommand,
    npmStatus: "published",
    archiveUrl: `https://onlyharness.com/api/repos/${owner}/${name}/archive?version=${encodeURIComponent(version)}`,
    contextCost: detail.contextCost,
    access: detail.access,
    payment: detail.access.payment,
    next: [`npx onlyharness run ${name} --json`, `npx onlyharness eval ${name} --json`, `npx onlyharness gate --dir ${name} --json`]
  };
};

async function harnessDetailPayload(owner: string, repo: string, authorization: string | undefined) {
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return { status: 404, error: "Harness not found" };
  const { inspection, evalResult, security, contextCost, standard } = registry.registryDetailBasics(root);
  const manifest = inspection.manifest;
  if (!manifest) return { status: 500, error: "Harness manifest unavailable" };
  const orgGate = await gateOrgVisibility(owner, manifest, authorization, "detail");
  if (!orgGate.ok) return { status: orgGate.status, error: orgGate.error };
  const counters = await fetchCountersMap();
  const item = registry.registryItemFromDir(owner, root, counters);
  const lastVerifiedAt = await fetchLastVerificationAt(owner, repo);
  const access = await mcpAccessSummary(owner, repo, manifest, manifest.version, authorization);
  return {
    owner,
    name: repo,
    social: item ? registry.socialFromItem(item) : undefined,
    manifest,
    valid: inspection.valid,
    issues: inspection.issues,
    risk: inspection.risk,
    security,
    contextCost,
    standard,
    evalResult,
    verification: { lastVerifiedAt },
    access,
    example: registry.readExample(root),
    files: registry.listHarnessFiles(root)
  };
}

async function mcpAccessSummary(owner: string, repo: string, manifest: HarnessManifest, version: string, authorization: string | undefined) {
  if (manifest.content.type === "directory") {
    const directory = manifest.content.directory;
    return {
      canPull: false,
      status: "directory_link_only",
      payment: { required: false },
      next: directory?.url
        ? `Open ${directory.url} and review upstream source/licensing before importing entries.`
        : "Open the upstream directory and review source/licensing before importing entries."
    };
  }

  const auth = authorization ? await userFromAuthorization(authorization) : {};
  const access = await requireArchivePaymentAccess({
    owner,
    repo,
    version,
    manifest,
    authorization,
    userId: auth.user?.id
  });
  if (access.allowed) {
    return {
      canPull: true,
      status: manifest.pricing.model === "free" ? "free" : "entitled",
      payment: { required: false }
    };
  }
  if (access.status === 402) {
    return {
      canPull: false,
      status: "payment_required",
      code: access.body.code,
      payment: {
        required: true,
        provider: access.body.provider,
        pricing: access.body.pricing,
        checkout_url: access.body.checkout_url,
        payments_enabled: access.body.payments_enabled,
        x402: {
          enabled: access.body.x402.enabled,
          requirements: access.body.x402.requirements
        },
        tokenEnv: "HH_TOKEN",
        paymentExitCode: 5,
        next: access.body.next
      }
    };
  }
  return {
    canPull: false,
    status: "hosted_unavailable",
    code: access.body.code,
    payment: { required: false },
    pricing: access.body.pricing,
    next: access.body.next
  };
}

async function archiveForClient(owner: string, repo: string, version: string | undefined, authorization: string | undefined, client: "api" | "mcp", paymentSignature?: string): Promise<ArchiveClientResponse> {
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return { status: 404, body: { error: "Harness not found" } };
  const manifest = registry.registryDetailBasics(root).inspection.manifest;
  if (!manifest) return { status: 500, body: { error: "Harness manifest unavailable" } };
  const orgGate = await gateOrgVisibility(owner, manifest, authorization, "archive");
  if (!orgGate.ok) return { status: orgGate.status, body: { error: orgGate.error } };
  if (manifest.content.type === "directory") {
    return { status: 409, body: directoryLinkOnlyBody(owner, repo, manifest) };
  }
  const archive = registry.buildArchiveForVersion(owner, repo, root, version);
  if (!archive) return { status: 404, body: { error: "Harness version not found" } };
  const auth = authorization ? await userFromAuthorization(authorization) : {};
  const payment = await requireArchivePaymentAccess({
    owner,
    repo,
    version: archive.version,
    manifest,
    authorization,
    userId: auth.user?.id
  });
  if (!payment.allowed) {
    const x402 = payment.status === 402 && paymentSignature
      ? await settleX402ArchivePayment({ owner, repo, version: archive.version, manifest, paymentRequired: payment.body, paymentSignature })
      : undefined;
    if (x402?.ok) {
      await recordPaymentTransitionEvent(x402.status, owner, repo, archive.version, `wallet:${x402.payer}`, "x402", client);
      await recordEvent({ kind: "pull", owner, repo, version: archive.version, subject: `wallet:${x402.payer}`, target: "archive", client });
      return { status: 200, headers: x402.headers, body: { owner, repo, version: archive.version, snapshot: archive.snapshot, files: archive.files } };
    }
    await recordEvent({
      kind: payment.status === 402 ? "checkout" : "view",
      owner,
      repo,
      version: archive.version,
      subject: eventSubject(auth.user?.id),
      target: payment.status === 402 ? "archive" : "hosted_unavailable",
      client
    });
    return { status: payment.status, body: payment.body };
  }
  await recordEvent({ kind: "pull", owner, repo, version: archive.version, subject: eventSubject(auth.user?.id), target: "archive", client });
  return { status: 200, body: { owner, repo, version: archive.version, snapshot: archive.snapshot, files: archive.files } };
}

function directoryLinkOnlyBody(owner: string, repo: string, manifest: HarnessManifest): DirectoryLinkOnlyBody {
  const directory = manifest.content.directory;
  return {
    error: "Directory link only",
    code: "DIRECTORY_LINK_ONLY",
    owner,
    repo,
    ...(directory?.url ? { url: directory.url } : {}),
    ...(directory?.item_count !== undefined ? { item_count: directory.item_count } : {}),
    ...(directory?.category ? { category: directory.category } : {}),
    ...(directory?.notes ? { notes: directory.notes } : {}),
    next: directory?.url
      ? `Open ${directory.url} and review upstream source/licensing before importing entries.`
      : "Open the upstream directory and review source/licensing before importing entries."
  };
}

async function settleX402ArchivePayment(input: {
  owner: string;
  repo: string;
  version: string;
  manifest: HarnessManifest;
  paymentRequired: PaymentRequiredBody;
  paymentSignature: string;
}): Promise<{ ok: true; payer: string; status: string; headers: Record<string, string> } | { ok: false }> {
  const facilitatorUrl = process.env.X402_FACILITATOR_URL?.trim();
  const requirement = input.paymentRequired.x402.requirements[0];
  if (!facilitatorUrl || !input.paymentRequired.x402.paymentRequired || !requirement) return { ok: false };
  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = decodePaymentSignatureHeader(input.paymentSignature);
  } catch {
    return { ok: false };
  }
  const accepted = paymentPayload.accepted;
  if (!accepted || !x402RequirementMatches(requirement, accepted)) return { ok: false };
  const facilitator = new HTTPFacilitatorClient(x402FacilitatorConfig(facilitatorUrl));
  let verify: VerifyResponse;
  try {
    verify = await facilitator.verify(paymentPayload, accepted);
  } catch {
    return { ok: false };
  }
  if (!verify.isValid) return { ok: false };
  let settle: SettleResponse;
  try {
    settle = await facilitator.settle(paymentPayload, accepted);
  } catch {
    return { ok: false };
  }
  if (!settle.success) return { ok: false };
  const payer = (settle.payer ?? verify.payer)?.trim().toLowerCase();
  if (!payer) return { ok: false };
  const persisted = await settleX402Purchase({
    owner: input.owner,
    repo: input.repo,
    version: input.version,
    manifest: input.manifest,
    payer,
    transaction: settle.transaction,
    network: settle.network,
    amount: settle.amount
  });
  if (!persisted.ok) {
    console.warn("x402 entitlement persistence failed", {
      owner: input.owner,
      repo: input.repo,
      version: input.version,
      payer,
      error: persisted.error
    });
    return { ok: false };
  }
  return {
    ok: true,
    payer,
    status: persisted.status,
    headers: {
      "PAYMENT-RESPONSE": encodePaymentResponseHeader(settle)
    }
  };
}

async function remixHarnessForUser(owner: string, repo: string, body: RemixRequest, user: AuthUser, authorization: string | undefined) {
  const requestedName = slugify(body.name ?? `my-${repo}`);
  if (!requestedName || !safePublicHarnessName(requestedName)) return { status: 400, error: "remix name is not publishable" };
  const target = path.join(registry.importRoot, requestedName);
  if (existsSync(path.join(target, "harness.yaml"))) {
    return { status: 409, error: "Remix name already exists", body: { error: "Remix name already exists", code: "NAME_EXISTS", owner: "local", repo: requestedName } };
  }

  const sourceVersion = body.sourceVersion ?? body.version;
  const archive = await archiveForClient(owner, repo, sourceVersion, authorization, "api");
  if (archive.status !== 200) {
    return {
      status: archive.status,
      error: archiveError(archive.body),
      body: archive.body
    };
  }

  const source = archive.body as Partial<ArchivePayload>;
  if (!Array.isArray(source.files) || typeof source.version !== "string") {
    return { status: 500, error: "archive payload is invalid" };
  }

  const files = source.files
    .filter((file) => file.path !== ".harnesshub/results.json" && !file.path.startsWith(".harnesshub/"))
    .map((file) => ({ ...file }));
  const manifestFile = files.find((file) => file.path === "harness.yaml");
  if (!manifestFile) return { status: 500, error: "archive payload is missing harness.yaml" };
  const rewritten = rewriteManifestForRemix(manifestFile.content, {
    owner,
    repo,
    version: source.version,
    name: requestedName,
    title: body.title,
    summary: body.summary
  });
  if ("error" in rewritten) return rewritten;
  manifestFile.content = rewritten.content;

  const temp = path.join(registry.workspaceRoot, "data", `.remix-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    for (const file of files) {
      const safe = safePublishFile(file);
      if (!safe.ok) return { status: safe.status, error: safe.error };
      const fileTarget = path.join(temp, safe.path);
      mkdirSync(path.dirname(fileTarget), { recursive: true });
      writeFileSync(fileTarget, safe.content);
    }

    const basics = registry.registryDetailBasics(temp);
    const manifest = basics.inspection.manifest;
    if (!manifest) return { status: 400, error: "remix harness.yaml is invalid" };
    if (!basics.inspection.valid) {
      return {
        status: 422,
        error: "Remix validation failed",
        body: {
          error: "Remix validation failed",
          failures: basics.inspection.issues.map((issue) => `${issue.severity}: ${issue.path} ${issue.message}`)
        }
      };
    }
    if (basics.security.verdict !== "pass") {
      return {
        status: 422,
        error: "Security scan must pass before remix",
        body: {
          error: "Security scan must pass before remix",
          failures: basics.security.findings.map((finding) => `${finding.severity}: ${finding.rule} ${finding.file}`)
        }
      };
    }

    let snapshot: registry.ArchiveSnapshot;
    try {
      snapshot = registry.assertArchiveSnapshotWritable("local", requestedName, temp);
    } catch (error) {
      if (error instanceof registry.ArchiveSnapshotConflictError) {
        return { status: 409, error: error.message, body: { error: error.message, code: "SNAPSHOT_VERSION_CONFLICT", version: error.version } };
      }
      throw error;
    }

    mkdirSync(path.dirname(target), { recursive: true });
    renameSync(temp, target);
    const writtenSnapshot = registry.writeArchiveSnapshot("local", requestedName, target, snapshot.version);
    const item = registry.registryItemFromDir("local", target, new Map());
    await upsertHarnessCreator("local", requestedName, user.id);
    await recordEvent({ kind: "applied", owner: "local", repo: requestedName, version: writtenSnapshot?.version, subject: eventSubject(user.id), target: "server-remix", client: "api" });
    const fork = await recordHarnessFork({
      source: { owner, repo, version: source.version },
      fork: { owner: "local", repo: requestedName, version: writtenSnapshot?.version },
      userId: user.id
    });
    appendState({ type: "remix", name: requestedName, target, userId: user.id, provenance: { owner, repo, version: source.version }, forkStored: fork.remote, at: fork.at });

    return {
      owner: "local",
      repo: requestedName,
      item,
      snapshotVersion: writtenSnapshot?.version,
      verified: false,
      remix: {
        owner: "local",
        name: requestedName,
        source: { owner, repo, version: source.version },
        forkGraph: {
          recorded: true,
          source: { owner, repo, version: source.version },
          fork: { owner: "local", repo: requestedName, version: writtenSnapshot?.version }
        }
      }
    };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function rewriteManifestForRemix(content: string, input: { owner: string; repo: string; version: string; name: string; title?: string; summary?: string }):
  | { content: string }
  | { status: number; error: string } {
  let manifest: Record<string, unknown>;
  try {
    manifest = YAML.parse(content) as Record<string, unknown>;
  } catch {
    return { status: 400, error: "source harness.yaml is invalid" };
  }
  if (!manifest || typeof manifest !== "object") return { status: 400, error: "source harness.yaml is invalid" };
  const visibility = typeof manifest.visibility === "string" ? manifest.visibility : "public";
  if (visibility === "org" || visibility === "private" || input.owner.startsWith("@")) {
    return { status: 403, error: "Org-private harnesses cannot be remixed into the public namespace yet" };
  }
  const pricing = manifest.pricing && typeof manifest.pricing === "object" && !Array.isArray(manifest.pricing)
    ? manifest.pricing as { model?: unknown }
    : {};
  if (pricing.model && pricing.model !== "free") {
    return { status: 409, error: "Paid harnesses cannot be server-remixed into the public local namespace yet" };
  }
  const contentType = manifest.content && typeof manifest.content === "object" && !Array.isArray(manifest.content)
    ? (manifest.content as { type?: unknown }).type
    : "harness";
  if (contentType === "directory") return { status: 409, error: "Directory entries are link-only and cannot be server-remixed" };
  if (typeof manifest.license !== "string" || manifest.license.toUpperCase() === "UNSPECIFIED") {
    return { status: 409, error: "Source license must be explicit before server remix" };
  }

  const originalTitle = typeof manifest.title === "string" ? manifest.title : input.repo;
  const originalSummary = typeof manifest.summary === "string" ? manifest.summary : `Remix of ${input.owner}/${input.repo}.`;
  const source = manifest.source && typeof manifest.source === "object" && !Array.isArray(manifest.source)
    ? manifest.source as Record<string, unknown>
    : {};
  if (source.vendor_policy === "link-only") {
    return { status: 409, error: "Link-only sources cannot be server-remixed into local files" };
  }
  const tags = Array.isArray(manifest.tags) ? manifest.tags.filter((tag): tag is string => typeof tag === "string") : [];

  manifest.name = input.name;
  manifest.title = input.title?.trim() || `${originalTitle} Remix`;
  manifest.summary = input.summary?.trim() || `${originalSummary} Remix draft from ${input.owner}/${input.repo}@${input.version}; run eval/gate before treating it as verified.`;
  manifest.visibility = "public";
  manifest.pricing = { model: "free", currency: "USD" };
  manifest.source = {
    ...source,
    authors: Array.isArray(source.authors) ? source.authors : [],
    vendor_policy: "vendored",
    attribution: `Remixed from ${input.owner}/${input.repo}@${input.version}`
  };
  manifest.tags = tags.includes("remix") ? tags : [...tags, "remix"];
  delete manifest.org;

  return { content: YAML.stringify(manifest) };
}

async function recordHarnessFork(input: {
  source: { owner: string; repo: string; version: string };
  fork: { owner: string; repo: string; version?: string };
  userId: string;
}): Promise<{ remote: boolean; at: string }> {
  const at = new Date().toISOString();
  const userSubject = eventSubject(input.userId);
  const remote = await upsertSupabaseHarnessFork({
    source_owner: input.source.owner,
    source_repo: input.source.repo,
    source_version: input.source.version,
    fork_owner: input.fork.owner,
    fork_repo: input.fork.repo,
    fork_version: input.fork.version,
    user_subject: userSubject
  });
  appendState({
    type: "fork",
    source: input.source,
    fork: input.fork,
    userId: input.userId,
    userSubject,
    remote,
    at
  });
  return { remote, at };
}

async function upsertSupabaseHarnessFork(row: {
  source_owner: string;
  source_repo: string;
  source_version: string;
  fork_owner: string;
  fork_repo: string;
  fork_version?: string;
  user_subject: string;
}): Promise<boolean> {
  if (!supabaseUrl || !supabaseRestKey) return false;
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/harness_forks?on_conflict=user_subject,source_owner,source_repo,fork_owner,fork_repo`, {
      method: "POST",
      headers: {
        ...supabaseRestHeaders(),
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(row)
    });
    return response.ok;
  } catch {
    return false;
  }
}

function archiveError(body: unknown): string {
  if (body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string") return (body as { error: string }).error;
  return "archive pull failed";
}

async function importMarkdownToHarness(body: ImportRequest, user: AuthUser, options: ImportOptions = {}) {
  if (!body?.markdown || body.markdown.length < 20) {
    return { status: 400, error: "markdown must be at least 20 characters" };
  }
  const licenseWarning = markdownLicenseWarning(body.markdown);
  const name = slugify(body.name ?? firstHeading(body.markdown) ?? "imported-harness");
  const owner = options.owner ?? "local";
  const target = options.orgSlug ? path.join(registry.orgImportRoot(options.orgSlug), name) : path.join(registry.importRoot, name);
  const tempTarget = path.join(registry.workspaceRoot, "data", `.import-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(path.dirname(target), { recursive: true });
  const tempSource = path.join(registry.workspaceRoot, "data", `${name}.source.md`);
  try {
    writeFileSync(tempSource, body.markdown);
    const cliCommand = importCliCommand(tempSource, tempTarget, name);
    const cli = spawnSync(cliCommand.command, cliCommand.args, {
      cwd: registry.workspaceRoot,
      encoding: "utf8"
    });
    if (cli.status !== 0) {
      return { status: 500, error: cli.stderr || cli.stdout || "import failed" };
    }
    if (options.orgSlug) applyOrgManifest(tempTarget, options.orgSlug);
    let snapshot: registry.ArchiveSnapshot;
    try {
      snapshot = registry.assertArchiveSnapshotWritable(owner, name, tempTarget);
    } catch (error) {
      if (error instanceof registry.ArchiveSnapshotConflictError) {
        return { status: 409, error: error.message, code: "SNAPSHOT_VERSION_CONFLICT", version: error.version };
      }
      throw error;
    }
    rmSync(target, { recursive: true, force: true });
    mkdirSync(path.dirname(target), { recursive: true });
    renameSync(tempTarget, target);
    const writtenSnapshot = registry.writeArchiveSnapshot(owner, name, target, snapshot.version);
    const item = registry.registryItemFromDir(owner, target, new Map());
    if (!options.orgSlug) await upsertHarnessCreator("local", name, user.id);
    await recordEvent({ kind: "applied", owner, repo: name, version: writtenSnapshot?.version, subject: eventSubject(user.id), target: "publish", client: "api" });
    appendState({ type: "import", name, target, userId: user.id, at: new Date().toISOString() });
    return {
      item,
      output: cli.stdout,
      snapshotVersion: writtenSnapshot?.version,
      ...(licenseWarning ? {
        warnings: [licenseWarning],
        next: "Markdown imports keep license UNSPECIFIED. Publish a verified harness directory with harness.yaml license set before remixing or paid distribution."
      } : {})
    };
  } finally {
    rmSync(tempTarget, { recursive: true, force: true });
  }
}

function markdownLicenseWarning(markdown: string): string | undefined {
  const match = markdown.match(/(?:^|\n)\s*(?:license|licen[cs]e)\s*:\s*([A-Za-z0-9._+ -]{2,40})(?:\n|$)/i);
  const license = match?.[1]?.trim();
  if (!license || license.toUpperCase() === "UNSPECIFIED") return undefined;
  return `Detected markdown license "${license}", but markdown imports cannot safely promote it into harness.yaml; generated harness stays UNSPECIFIED until explicitly verified.`;
}

async function importVerifiedHarnessDir(body: HarnessDirPublishRequest, user: AuthUser, options: ImportOptions = {}) {
  const files = Array.isArray(body.files) ? body.files : [];
  if (!files.length) return { status: 400, error: "files are required" };
  if (files.length > 120) return { status: 400, error: "too many files" };
  if (!files.some((file) => file.path === "harness.yaml")) return { status: 400, error: "harness.yaml is required" };

  const requestedName = body.name ? slugify(body.name) : undefined;
  if (body.name && !requestedName) return { status: 400, error: "name is not publishable" };
  const temp = path.join(registry.workspaceRoot, "data", `.publish-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    for (const file of files) {
      const safe = safePublishFile(file);
      if (!safe.ok) return { status: safe.status, error: safe.error };
      const target = path.join(temp, safe.path);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, safe.content);
    }

    if (requestedName) rewriteManifestName(temp, requestedName);
    if (options.orgSlug) applyOrgManifest(temp, options.orgSlug);

    const basics = registry.registryDetailBasics(temp);
    const manifest = basics.inspection.manifest;
    if (!manifest) return { status: 400, error: "harness.yaml is invalid" };
    if (manifest.content.type === "directory") return { status: 400, error: "directory entries are link-only and cannot be published as verified harness dirs" };
    if (!safePublicHarnessName(manifest.name)) return { status: 400, error: "manifest name is not publishable" };
    if (!basics.inspection.valid) {
      return {
        status: 422,
        error: "Harness validation failed",
        failures: basics.inspection.issues.map((issue) => `${issue.severity}: ${issue.path} ${issue.message}`)
      };
    }
    if (basics.security.verdict !== "pass") {
      return {
        status: 422,
        error: "Security scan must pass before verified publish",
        failures: basics.security.findings.map((finding) => `${finding.severity}: ${finding.rule} ${finding.file}`)
      };
    }
    const gate = gateFailures(basics);
    if (gate.failures.length) {
      return { status: 422, error: "Eval/gate must pass before verified publish", failures: gate.failures };
    }

    const name = manifest.name;
    const owner = options.owner ?? "local";
    const targetRoot = options.orgSlug ? registry.orgImportRoot(options.orgSlug) : registry.importRoot;
    const target = path.join(targetRoot, name);
    let snapshot: registry.ArchiveSnapshot;
    try {
      snapshot = registry.assertArchiveSnapshotWritable(owner, name, temp);
    } catch (error) {
      if (error instanceof registry.ArchiveSnapshotConflictError) {
        return { status: 409, error: error.message, code: "SNAPSHOT_VERSION_CONFLICT", version: error.version };
      }
      throw error;
    }
    rmSync(target, { recursive: true, force: true });
    mkdirSync(path.dirname(target), { recursive: true });
    renameSync(temp, target);
    const item = registry.registryItemFromDir(owner, target, new Map());
    const writtenSnapshot = registry.writeArchiveSnapshot(owner, name, target, snapshot.version);
    if (!options.orgSlug) await upsertHarnessCreator("local", name, user.id);
    await recordEvent({ kind: "applied", owner, repo: name, version: writtenSnapshot?.version, subject: eventSubject(user.id), target: options.eventTarget ?? "verified_publish", client: "api" });
    await recordEvent({ kind: "gate", owner, repo: name, version: writtenSnapshot?.version, subject: eventSubject(user.id), target: "passed", client: "api" });
    appendState({ type: options.stateType ?? (options.orgSlug ? "org_verified_publish" : "verified_publish"), org: options.orgSlug, name, target, userId: user.id, provenance: options.provenance, at: new Date().toISOString() });
    return {
      item,
      snapshotVersion: writtenSnapshot?.version,
      verified: true,
      gate: {
        score: gate.score,
        risk: gate.risk,
        cost: gate.cost,
        failures: []
      }
    };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

async function importResourcePackage(body: ResourcePackageImportRequest, user: AuthUser, options: ResourcePackageImportOptions = {}) {
  const files = Array.isArray(body.files) ? body.files : [];
  if (!files.length) return { status: 400, error: "files are required" };
  if (files.length > 120) return { status: 400, error: "too many files" };

  const temp = path.join(registry.workspaceRoot, "data", `.resource-package-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const safeFiles: Array<{ path: string; content: string }> = [];
  try {
    for (const file of files) {
      const safe = safeResourcePackageFile(file);
      if (!safe.ok) return { status: safe.status, error: safe.error, code: safe.code };
      const target = path.join(temp, safe.path);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, safe.content);
      safeFiles.push({ path: safe.path, content: safe.content });
    }

    const readme = safeFiles.find((file) => /(^|\/)readme\.md$/i.test(file.path));
    const requested = body.name ?? body.title ?? (readme ? firstHeading(readme.content) : undefined);
    if (!requested) return { status: 400, error: "name or title is required" };
    const name = slugify(requested);
    if (!safePublicHarnessName(name)) return { status: 400, error: "name is not publishable" };

    const resourceType = normalizeResourceType(body.resourceType, safeFiles.map((file) => file.path));
    const title = cleanTitle(body.title) ?? (readme ? firstHeading(readme.content) : undefined) ?? titleizeName(name);
    const summary = cleanSummary(body.summary) ?? `Hosted ${resourceType.replace(/_/g, " ")} package published to OnlyHarness.`;
    const worksWith = normalizeWorksWith(body.worksWith, resourceType);
    const sourceUrl = cleanPublicUrl(body.sourceUrl);
    if (body.sourceUrl && !sourceUrl) return { status: 400, error: "sourceUrl must be a public http(s) URL without credentials" };

    const workspaceSlug = options.workspaceSlug ? workspaces.cleanWorkspaceSlug(options.workspaceSlug) : undefined;
    const id = workspaceSlug ? workspaces.workspaceResourceId(workspaceSlug, name) : `onlyharness:packages/${name}`;
    const archiveRoot = workspaceSlug ? workspaces.workspaceResourceArchiveRoot(workspaceSlug) : resources.resourceArchiveRoot();
    const archivePath = path.join(archiveRoot, `${resources.resourceArchiveKey(id)}.tar.gz`);
    const archiveTemp = path.join(archiveRoot, `${resources.resourceArchiveKey(id)}.${Date.now()}.tmp`);
    const tar = spawnSync("tar", ["-czf", archiveTemp, "-C", temp, "."], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
    if (tar.status !== 0) {
      rmSync(archiveTemp, { force: true });
      return { status: 500, error: "failed to create hosted resource archive", failures: [tar.stderr || tar.stdout || "tar exited with an error"] };
    }
    renameSync(archiveTemp, archivePath);

    const now = new Date().toISOString();
    const signals = { stars: 0, opens: 0, imports: 1, installs: 0, threads: 0, passedGates: 0 };
    const canonicalUrl = workspaceSlug
      ? `https://onlyharness.com/#/workspaces/${encodeURIComponent(workspaceSlug)}/resources/${encodeURIComponent(name)}`
      : `https://onlyharness.com/#/resources/${encodeURIComponent(id)}`;
    const archiveUrl = workspaceSlug
      ? `https://onlyharness.com/api/workspaces/${encodeURIComponent(workspaceSlug)}/resources/${encodeURIComponent(name)}/archive`
      : `https://onlyharness.com/api/resources/${encodeURIComponent(id)}/archive`;
    const base: Omit<resources.Resource, "popularityScore" | "popularityBreakdown"> = {
      id,
      identity: { scheme: "onlyharness", key: workspaceSlug ? `workspaces/${workspaceSlug}/packages/${name}` : `packages/${name}` },
      title,
      summary,
      resourceType,
      sourcePlatform: "manual",
      canonicalUrl,
      upstreamId: workspaceSlug ? `@${workspaceSlug}/${name}` : `packages/${name}`,
      upstreamOwner: workspaceSlug ? `@${workspaceSlug}` : "onlyharness",
      upstreamRepo: name,
      creatorName: options.workspaceName ?? user.email ?? "OnlyHarness user",
      licenseStatus: "unknown",
      sourceCheckedAt: now,
      sourceCheckMethod: "manual_research",
      sourceCheckStatus: "active",
      lastSeenAt: now,
      installability: "importable",
      tags: dedupeStrings([resourceType, "hosted", "agent-resource", ...(body.tags ?? [])]),
      worksWith,
      upstreamPopularity: { sourceLabel: "OnlyHarness hosted resource package" },
      onlyHarnessSignals: signals,
      trust: { sourceChecked: true, securityScan: "not_scanned", riskTier: "UNKNOWN" },
      actions: [
        { id: "open_onlyharness", label: "Use in OnlyHarness", url: canonicalUrl },
        { id: "download_archive", label: "Download archive", url: archiveUrl },
        ...(sourceUrl ? [{ id: "open_upstream" as const, label: "Open source", url: sourceUrl }] : [])
      ],
      ...(sourceUrl ? {
        source: {
          platform: "manual",
          url: sourceUrl,
          checkedAt: now,
          checkedBy: "manual_research"
        }
      } : {})
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
    if (workspaceSlug) workspaces.upsertWorkspaceResource(workspaceSlug, resource);
    else resources.upsertImportedResource(resource);
    await recordEvent({ kind: "applied", owner: workspaceSlug ? `@${workspaceSlug}` : "onlyharness", repo: name, subject: eventSubject(user.id), target: workspaceSlug ? "workspace_resource_package" : "resource_package", client: "api" });
    appendState({
      type: workspaceSlug ? "workspace_resource_package_import" : "resource_package_import",
      id,
      name,
      resourceType,
      archive: archivePath,
      files: safeFiles.length,
      userId: user.id,
      workspace: workspaceSlug,
      actor: options.actorLabel,
      sourceUrl,
      at: now
    });
    return {
      resource,
      archive: {
        url: archiveUrl,
        fileName: resources.resourceArchiveFileName(resource)
      },
      hosted: true,
      verified: false,
      next: workspaceSlug
        ? "This is a workspace-hosted agent resource package, not a public Verified harness. Workspace members can pull it with a workspace token."
        : "This is a hosted agent resource package, not a verified harness. Run eval/gate and publish a native verified package only when you need a Verified install badge."
    };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function applyOrgManifest(root: string, orgSlug: string) {
  const manifestPath = path.join(root, "harness.yaml");
  const manifest = YAML.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.schemaVersion = "harness.v0.2";
  manifest.visibility = "org";
  manifest.org = orgSlug;
  writeFileSync(manifestPath, YAML.stringify(manifest));
}

function rewriteManifestName(root: string, name: string) {
  const manifestPath = path.join(root, "harness.yaml");
  const manifest = YAML.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.name = name;
  writeFileSync(manifestPath, YAML.stringify(manifest));
}

function safePublishFile(file: NonNullable<HarnessDirPublishRequest["files"]>[number]):
  | { ok: true; path: string; content: string }
  | { ok: false; status: number; error: string } {
  if (file.truncated) return { ok: false, status: 400, error: "truncated files cannot be published" };
  if (typeof file.path !== "string" || typeof file.content !== "string") return { ok: false, status: 400, error: "each file needs path and content" };
  const normalized = file.path.split("\\").join("/");
  if (!safePublishPath(normalized)) return { ok: false, status: 400, error: `unsafe publish path: ${file.path}` };
  if (Buffer.byteLength(file.content, "utf8") > registry.MAX_ARCHIVE_FILE_BYTES) return { ok: false, status: 400, error: `file too large: ${normalized}` };
  return { ok: true, path: normalized, content: file.content };
}

function safeResourcePackageFile(file: NonNullable<ResourcePackageImportRequest["files"]>[number]):
  | { ok: true; path: string; content: string }
  | { ok: false; status: number; error: string; code?: string } {
  if (file.truncated) return { ok: false, status: 400, error: "truncated files cannot be published", code: "TRUNCATED_FILE" };
  if (typeof file.path !== "string" || typeof file.content !== "string") return { ok: false, status: 400, error: "each file needs path and content", code: "INVALID_FILE" };
  const normalized = file.path.split("\\").join("/");
  if (!safeAgentResourcePath(normalized)) return { ok: false, status: 400, error: `unsafe resource package path: ${file.path}`, code: "UNSAFE_PATH" };
  if (Buffer.byteLength(file.content, "utf8") > registry.MAX_ARCHIVE_FILE_BYTES) return { ok: false, status: 400, error: `file too large: ${normalized}`, code: "FILE_TOO_LARGE" };
  return { ok: true, path: normalized, content: file.content };
}

function safePublishPath(file: string): boolean {
  return safeAgentResourcePath(file);
}

function safeAgentResourcePath(file: string): boolean {
  if (!file || file.startsWith("/") || file.includes("\0")) return false;
  const normalized = path.posix.normalize(file);
  if (normalized !== file || normalized.startsWith("../") || normalized === "..") return false;
  if (/(^|\/)(node_modules|\.git|dist|build|coverage|\.next)(\/|$)/i.test(file)) return false;
  if (deniedAgentResourcePath(file)) return false;
  if (!safeTextResourceExtension(file)) return false;
  if (safeAgentResourceRootFile(file)) return true;
  if (file === ".harnesshub/results.json") return true;
  return /^(agents|skills|prompts|tools|scripts|commands|gates|evals|examples|runbooks|workflows|mcp|plugins|docs|src|lib|bin|\.claude|\.codex|\.claude-plugin|\.codex-plugin|\.gitea\/workflows)\//.test(file);
}

function safePublicHarnessName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,80}$/.test(name);
}

function safeAgentResourceRootFile(file: string): boolean {
  return [
    "harness.yaml",
    "harness.yml",
    "README.md",
    "AGENTS.md",
    "SKILL.md",
    "CLAUDE.md",
    "LICENSE",
    "LICENSE.md",
    "package.json",
    "requirements.txt",
    "pyproject.toml",
    "tsconfig.json",
    "server.json",
    "plugin.json",
    "workflow.md",
    "Dockerfile",
    "Makefile",
    ".gitignore",
    ".mcp.json"
  ].includes(file);
}

function deniedAgentResourcePath(file: string): boolean {
  const lower = file.toLowerCase();
  const segments = lower.split("/");
  if (segments.some((segment) => segment === ".env" || segment.startsWith(".env.") || segment === ".npmrc" || segment === ".pypirc" || segment === ".netrc")) return true;
  if (segments.some((segment) => /^(id_rsa|id_dsa|id_ecdsa|id_ed25519|known_hosts|secrets?|private|credentials?)$/.test(segment))) return true;
  return /\.(pem|key|p12|pfx|crt|cer|sqlite|sqlite3|db|zip|tar|tgz|gz|png|jpe?g|gif|webp|pdf|mp4|mov|avi|dmg|pkg)$/i.test(file);
}

function safeTextResourceExtension(file: string): boolean {
  const base = path.posix.basename(file);
  if (["Dockerfile", "Makefile", "LICENSE"].includes(base)) return true;
  if (base.startsWith(".")) return [".gitignore", ".mcp.json"].includes(base);
  return /\.(md|mdx|txt|ya?ml|json|jsonc|toml|xml|js|mjs|cjs|ts|tsx|jsx|py|sh|bash|zsh|fish|rb|go|rs|java|cs|php|lua|sql|css|html|env\.example)$/i.test(base);
}

const resourceTypeValues = new Set<resources.ResourceType>([
  "harness",
  "skill",
  "plugin",
  "workflow",
  "mcp_server",
  "service_endpoint",
  "agent_team",
  "subagent_pack",
  "command_pack",
  "config",
  "guide",
  "framework",
  "agent_runtime",
  "directory"
]);

function normalizeResourceType(value: string | undefined, paths: string[]): resources.ResourceType {
  if (value && resourceTypeValues.has(value as resources.ResourceType) && value !== "directory") return value as resources.ResourceType;
  const lower = paths.map((item) => item.toLowerCase());
  if (lower.some((file) => /(^|\/)harness\.ya?ml$/.test(file))) return "harness";
  if (lower.some((file) => /(^|\/)skill\.md$/.test(file) || file.includes("/.claude/skills/") || file.includes("/.codex/skills/"))) return "skill";
  if (lower.some((file) => file.endsWith(".claude-plugin/plugin.json") || file.endsWith(".codex-plugin/plugin.json") || file.includes("/plugins/"))) return "plugin";
  if (lower.some((file) => file.endsWith(".mcp.json") || file.endsWith("server.json") || file.includes("/mcp/"))) return "mcp_server";
  if (lower.some((file) => file.includes("/commands/") || file.includes("/scripts/") || file.includes("/bin/"))) return "command_pack";
  if (lower.some((file) => file.includes("/workflows/") || file.endsWith("workflow.md"))) return "workflow";
  if (lower.some((file) => file.includes("/docs/"))) return "guide";
  return "workflow";
}

function normalizeWorksWith(input: string[] | undefined, resourceType: resources.ResourceType): resources.Resource["worksWith"] {
  const allowed = new Set<resources.Resource["worksWith"][number]>(["claude-code", "codex", "cursor", "mcp", "cli", "github"]);
  const explicit = (input ?? []).filter((value): value is resources.Resource["worksWith"][number] => allowed.has(value as resources.Resource["worksWith"][number]));
  if (explicit.length) return [...new Set(explicit)];
  if (resourceType === "mcp_server") return ["mcp", "claude-code", "codex"];
  if (resourceType === "plugin" || resourceType === "skill") return ["claude-code", "codex", "github"];
  if (resourceType === "command_pack") return ["cli", "claude-code", "codex", "cursor"];
  return ["claude-code", "codex", "cursor", "cli", "github"];
}

function dedupeStrings(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const clean = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    if (clean && !result.includes(clean)) result.push(clean);
  }
  return result.slice(0, 12);
}

function cleanTitle(value: string | undefined): string | undefined {
  const clean = value?.trim().replace(/\s+/g, " ");
  return clean && clean.length <= 120 ? clean : undefined;
}

function cleanSummary(value: string | undefined): string | undefined {
  const clean = value?.trim().replace(/\s+/g, " ");
  return clean && clean.length <= 500 ? clean : undefined;
}

function cleanPublicUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    if (url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function titleizeName(value: string): string {
  return value.split("-").filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function gateFailures(basics: ReturnType<typeof registry.registryDetailBasics>) {
  const manifest = basics.inspection.manifest;
  const evalResult = basics.evalResult as { status?: string; verified?: boolean; score?: number; cost_usd?: number } | undefined;
  const score = Number(evalResult?.score ?? 0);
  const cost = Number(evalResult?.cost_usd ?? 0);
  const failures: string[] = [];
  if (!manifest) failures.push("manifest unavailable");
  if (!evalResult) failures.push("missing .harnesshub/results.json; run hh eval");
  if (evalResult?.status !== "passed" || evalResult.verified !== true) failures.push(`eval status ${evalResult?.status ?? "missing"} is not verified passed`);
  if (manifest && score < manifest.quality_gates.min_score) failures.push(`score ${score} below ${manifest.quality_gates.min_score}`);
  if (manifest && cost > manifest.quality_gates.max_cost_usd_per_run) failures.push(`cost ${cost} above ${manifest.quality_gates.max_cost_usd_per_run}`);
  if (manifest && basics.inspection.risk.score > manifest.quality_gates.max_risk_score) failures.push(`risk ${basics.inspection.risk.score} above ${manifest.quality_gates.max_risk_score}`);
  failures.push(...basics.inspection.risk.blocking);
  return { score, cost, risk: basics.inspection.risk.score, failures };
}

function publicWorkspace(workspace: workspaces.WorkspaceRecord) {
  return {
    slug: workspace.slug,
    name: workspace.name,
    type: workspace.type,
    visibility: workspace.visibility,
    plan: workspace.plan,
    description: workspace.description ?? null,
    avatarUrl: workspace.avatar_url ?? null
  };
}

function publicWorkspaceInvite(invite: workspaces.WorkspaceInvite) {
  return {
    id: invite.id,
    workspaceId: invite.workspace_id,
    workspaceSlug: invite.workspace_slug,
    email: invite.email ?? null,
    role: invite.role,
    maxUses: invite.max_uses ?? null,
    usesCount: invite.uses_count,
    expiresAt: invite.expires_at ?? null,
    createdBy: invite.created_by ?? null,
    createdAt: invite.created_at,
    revokedAt: invite.revoked_at ?? null
  };
}

function workspaceResourcePermissionsSummary(slug: string, rows: resources.Resource[]): WorkspaceResourcePermissionsSummary {
  const summary: WorkspaceResourcePermissionsSummary = {
    totalResources: rows.length,
    hostedArchives: 0,
    unscanned: 0,
    riskTiers: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0, UNKNOWN: 0 }
  };
  for (const resource of rows) {
    if (workspaces.workspaceResourceArchivePath(slug, resource.id)) summary.hostedArchives += 1;
    const scan = resource.trust?.securityScan ?? "not_scanned";
    if (scan === "not_scanned") summary.unscanned += 1;
    const tier = resource.trust?.riskTier && summary.riskTiers[resource.trust.riskTier] !== undefined ? resource.trust.riskTier : "UNKNOWN";
    summary.riskTiers[tier] += 1;
  }
  return summary;
}

function orgWorkspacePermissionsSummary(items: registry.RegistryItem[]): OrgWorkspacePermissionsSummary {
  const summary: OrgWorkspacePermissionsSummary = {
    totalHarnesses: items.length,
    riskTiers: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
    maxRiskScore: 0,
    maxRiskTier: "NONE",
    permissionCounts: {
      unrestrictedNetwork: 0,
      shell: 0,
      browser: 0,
      credentials: 0,
      externalSend: 0,
      moneyMovement: 0,
      userData: 0
    },
    riskMarkdown: "# Harness Risk\n\nNo org harnesses indexed."
  };
  let highestRisk: RiskReport | undefined;
  for (const item of items) {
    if (item.riskTier === "LOW" || item.riskTier === "MEDIUM" || item.riskTier === "HIGH" || item.riskTier === "CRITICAL") {
      summary.riskTiers[item.riskTier] += 1;
    }
    const root = registry.resolveHarnessPath(item.owner, item.name);
    if (!root) continue;
    const { inspection } = registry.registryDetailBasics(root);
    const report = inspection.risk;
    if (!highestRisk || report.score > highestRisk.score) highestRisk = report;
    const permissions = inspection.manifest?.permissions;
    if (!permissions) continue;
    if (permissions.network === "unrestricted") summary.permissionCounts.unrestrictedNetwork += 1;
    if (permissions.shell) summary.permissionCounts.shell += 1;
    if (permissions.browser) summary.permissionCounts.browser += 1;
    if (permissions.credentials !== "false") summary.permissionCounts.credentials += 1;
    if (permissions.external_send) summary.permissionCounts.externalSend += 1;
    if (permissions.money_movement) summary.permissionCounts.moneyMovement += 1;
    if (permissions.user_data) summary.permissionCounts.userData += 1;
  }
  if (highestRisk) {
    summary.maxRiskScore = highestRisk.score;
    summary.maxRiskTier = highestRisk.tier;
    summary.riskMarkdown = riskMarkdown(highestRisk);
  }
  return summary;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function paymentSignatureFromRequest(request: FastifyRequest): string | undefined {
  return headerValue(request.headers["payment-signature"]) ?? headerValue(request.headers["x-payment"]);
}

function orgTokenFromRequest(request: FastifyRequest): string | undefined {
  const authorization = headerValue(request.headers.authorization);
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : headerValue(request.headers["x-harness-org-token"]);
}

function workspaceTokenFromRequest(request: FastifyRequest): string | undefined {
  const authorization = headerValue(request.headers.authorization);
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : headerValue(request.headers["x-harness-workspace-token"]) ?? headerValue(request.headers["x-harness-org-token"]);
}

async function authorizeWorkspaceRequest(slug: string, request: FastifyRequest, requiredScopes: string[]): Promise<workspaces.WorkspaceAuthResult> {
  const token = workspaceTokenFromRequest(request);
  const tokenAuth = await workspaces.authorizeWorkspaceToken(slug, token, requiredScopes);
  if (tokenAuth.ok) return tokenAuth;

  const authorization = headerValue(request.headers.authorization);
  const canBeUserBearer = Boolean(authorization?.startsWith("Bearer ")) && (Boolean(supabaseUrl && supabaseAnonKey) || authorization?.startsWith("Bearer local:"));
  if (!canBeUserBearer) return tokenAuth;

  const userAuth = await userFromAuthorization(authorization);
  if (!userAuth.user) {
    return { ok: false, status: userAuth.status ?? 401, error: userAuth.error ?? "Sign in required", slug, auditAction: "workspace_member_auth_failed" };
  }
  return workspaces.authorizeWorkspaceMember(slug, userAuth.user.id, requiredScopes);
}

function workspaceAuthSubject(auth: workspaces.WorkspaceAuthResult): string {
  return auth.ok && auth.userId ? eventSubject(auth.userId) : eventSubject(undefined);
}

function orgTokenFromAuthorization(authorization: string | undefined): string | undefined {
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
}

async function gateOrgVisibility(owner: string, manifest: HarnessManifest | undefined, authorization: string | undefined, target: string): Promise<
  | { ok: true }
  | { ok: false; status: number; error: string }
> {
  if (owner.startsWith("@") && manifest?.visibility !== "org") return { ok: false, status: 403, error: "Org harness visibility mismatch" };
  if (manifest?.visibility === "private") return { ok: false, status: 403, error: "Private harness is not available through this API" };
  if (manifest?.visibility !== "org") return { ok: true };
  if (!orgsEnabled) return { ok: false, status: 404, error: "Org access is not enabled" };
  const slug = manifest.org;
  if (!slug || owner !== `@${slug}`) return { ok: false, status: 403, error: "Org harness owner mismatch" };
  const auth = await authorizeOrgToken(slug, orgTokenFromAuthorization(authorization), ["read", "setup", "publish"]);
  if (!auth.ok) {
    await appendOrgAudit({ slug: auth.slug ?? slug, action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target });
    return { ok: false, status: auth.status, error: auth.error };
  }
  await appendOrgAudit({ slug: auth.org.slug, action: `${target}_read`, tokenName: auth.tokenName, subject: eventSubject(undefined), target: manifest.name });
  return { ok: true };
}

function requireInternalToken(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!webhookToken) return true;
  const value = request.headers["x-harness-token"];
  const token = Array.isArray(value) ? value[0] : value;
  if (token === webhookToken) return true;
  reply.code(401).send({ error: "Invalid internal token" });
  return false;
}

function requirePaymentWebhookToken(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!webhookToken) {
    reply.code(503).send({ error: "Payment webhook token is not configured" });
    return false;
  }
  const value = request.headers["x-harness-token"];
  const token = Array.isArray(value) ? value[0] : value;
  if (token === webhookToken) return true;
  reply.code(401).send({ error: "Invalid payment webhook token" });
  return false;
}

function mcpMethodNotAllowed(reply: FastifyReply) {
  return reply.code(405).send({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null
  });
}

function safeHeaders(headers: FastifyRequest["headers"]) {
  const { authorization, cookie, "x-harness-token": token, ...safe } = headers;
  void authorization;
  void cookie;
  void token;
  return safe;
}

async function fetchThreadPosts(owner: string, repo: string): Promise<ThreadItem[]> {
  if (!supabaseUrl || !supabaseRestKey) return [];

  try {
    const params = new URLSearchParams({
      select: "id,user_id,kind,body,created_at",
      owner: `eq.${owner}`,
      repo: `eq.${repo}`,
      order: "created_at.desc",
      limit: "50"
    });
    const response = await fetch(`${supabaseUrl}/rest/v1/harness_thread_posts?${params.toString()}`, {
      headers: supabaseRestHeaders()
    });
    if (!response.ok) return [];

    const rows = await response.json() as Array<{
      id: string;
      user_id: string;
      kind: string;
      body: string;
      created_at: string;
    }>;
    const profiles = await fetchProfiles(rows.map((row) => row.user_id));

    return rows.reverse().map((row) => ({
      id: row.id,
      author: profiles.get(row.user_id) ?? `user-${row.user_id.slice(0, 6)}`,
      userId: row.user_id,
      role: "member",
      kind: row.kind,
      body: row.body,
      likes: 0,
      at: relativeTime(row.created_at)
    }));
  } catch {
    return [];
  }
}

async function fetchProfiles(userIds: string[]): Promise<Map<string, string>> {
  const profiles = new Map<string, string>();
  const ids = Array.from(new Set(userIds)).filter(Boolean);
  if (!ids.length || !supabaseUrl || !supabaseRestKey) return profiles;

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/profiles?select=id,display_name&id=in.(${ids.join(",")})`, {
      headers: supabaseRestHeaders()
    });
    if (!response.ok) return profiles;
    for (const row of await response.json() as Array<{ id: string; display_name?: string }>) {
      if (row.display_name) profiles.set(row.id, row.display_name);
    }
  } catch {
    return profiles;
  }

  return profiles;
}

async function writeHarnessStar(input: { owner: string; repo: string; userId: string; starred: boolean }): Promise<
  | { ok: true }
  | { ok: false; status: number; error: string; code: string; next: string }
> {
  if (!supabaseUrl || !supabaseRestKey) return socialStoreUnavailable();
  try {
    if (!input.starred) {
      const params = new URLSearchParams({
        user_id: `eq.${input.userId}`,
        owner: `eq.${input.owner}`,
        repo: `eq.${input.repo}`,
        action: "eq.star"
      });
      const response = await fetch(`${supabaseUrl}/rest/v1/user_harness_actions?${params.toString()}`, {
        method: "DELETE",
        headers: { ...supabaseRestHeaders(), Prefer: "return=minimal" }
      });
      if (!response.ok) return supabaseWriteFailed(response.status, await safeResponseText(response));
      return { ok: true };
    }

    const params = new URLSearchParams({ on_conflict: "user_id,owner,repo,action" });
    const response = await fetch(`${supabaseUrl}/rest/v1/user_harness_actions?${params.toString()}`, {
      method: "POST",
      headers: {
        ...supabaseRestHeaders(),
        "content-type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({ user_id: input.userId, owner: input.owner, repo: input.repo, action: "star" })
    });
    if (!response.ok) return supabaseWriteFailed(response.status, await safeResponseText(response));
    return { ok: true };
  } catch {
    return { ok: false, status: 503, error: "Social store unavailable", code: "SOCIAL_STORE_UNAVAILABLE", next: "Retry after the registry API can reach Supabase." };
  }
}

async function writeHarnessThreadPost(input: { owner: string; repo: string; user: AuthUser; kind?: string; body?: string }): Promise<
  | { ok: true; item: ThreadItem }
  | { ok: false; status: number; error: string; code: string; next: string }
> {
  if (!supabaseUrl || !supabaseRestKey) return socialStoreUnavailable();
  const kind = normalizeThreadKind(input.kind);
  if (!kind) return { ok: false, status: 400, error: "Invalid thread post kind", code: "INVALID_THREAD_KIND", next: "Use one of: question, recipe, result, proposal, bug/risk." };
  const body = input.body?.trim() ?? "";
  if (body.length < 2 || body.length > 2000) return { ok: false, status: 400, error: "Thread post body must be 2-2000 characters", code: "INVALID_THREAD_BODY", next: "Send a concise question, recipe, result, proposal, or bug/risk note." };

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/harness_thread_posts`, {
      method: "POST",
      headers: {
        ...supabaseRestHeaders(),
        "content-type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({ owner: input.owner, repo: input.repo, user_id: input.user.id, kind, body })
    });
    if (!response.ok) return supabaseWriteFailed(response.status, await safeResponseText(response));
    const rows = await response.json() as Array<{ id: string; kind: string; body: string; created_at: string }>;
    const row = rows[0];
    if (!row?.id) return { ok: false, status: 502, error: "Thread post was not returned by the social store", code: "SOCIAL_STORE_BAD_RESPONSE", next: "Retry and check Supabase REST health." };
    const profiles = await fetchProfiles([input.user.id]);
    return {
      ok: true,
      item: {
        id: row.id,
        author: profiles.get(input.user.id) ?? input.user.email?.split("@")[0] ?? `user-${input.user.id.slice(0, 6)}`,
        userId: input.user.id,
        role: "member",
        kind: row.kind,
        body: row.body,
        likes: 0,
        at: relativeTime(row.created_at)
      }
    };
  } catch {
    return { ok: false, status: 503, error: "Social store unavailable", code: "SOCIAL_STORE_UNAVAILABLE", next: "Retry after the registry API can reach Supabase." };
  }
}

function normalizeThreadKind(value: string | undefined): string | undefined {
  const kind = value ?? "question";
  return ["question", "recipe", "result", "proposal", "bug/risk"].includes(kind) ? kind : undefined;
}

function socialStoreUnavailable(): { ok: false; status: number; error: string; code: string; next: string } {
  return { ok: false, status: 503, error: "Social store unavailable", code: "SOCIAL_STORE_UNAVAILABLE", next: "Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for server-side social writes." };
}

function supabaseWriteFailed(status: number, detail: string): { ok: false; status: number; error: string; code: string; next: string } {
  return {
    ok: false,
    status: status >= 400 && status < 500 ? status : 503,
    error: detail || "Social write failed",
    code: "SOCIAL_WRITE_FAILED",
    next: "Check the authenticated user, target harness, and Supabase RLS/REST status."
  };
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    const body = await response.text();
    if (!body) return "";
    const parsed = JSON.parse(body) as { message?: string; error?: string };
    return parsed.message ?? parsed.error ?? body;
  } catch {
    return "";
  }
}

function supabaseRestHeaders() {
  return {
    apikey: supabaseRestKey ?? "",
    authorization: `Bearer ${supabaseRestKey ?? ""}`
  };
}

function eventSubject(userId: string | undefined): string {
  return userId ? `user:${userId}` : "anonymous";
}

async function recordPaymentTransitionEvent(
  status: string,
  owner: string,
  repo: string,
  version: string,
  subject: string,
  target: string,
  client: string
) {
  if (status === "reserved" || status === "already_reserved") {
    await recordEvent({ kind: "escrow_reserved", owner, repo, version, subject, target, client });
    return;
  }
  if (status === "captured" || status === "already_captured") {
    await recordEvent({ kind: "escrow_captured", owner, repo, version, subject, target, client });
    return;
  }
  if (status === "refunded" || status === "already_refunded") {
    await recordEvent({ kind: "escrow_refunded", owner, repo, version, subject, target, client });
    return;
  }
  await recordEvent({ kind: "purchase", owner, repo, version, subject, target, client });
}

async function recordEscrowSettlementEvent(
  result: { status: string; owner: string; repo: string; version: string; subject_id: string },
  target: string
) {
  await recordPaymentTransitionEvent(result.status, result.owner, result.repo, result.version, eventSubject(result.subject_id), target, "api");
}

function x402FacilitatorConfig(url: string) {
  const bearer = process.env.X402_FACILITATOR_TOKEN?.trim();
  const apiKey = process.env.X402_FACILITATOR_API_KEY?.trim();
  if (!bearer && !apiKey) return { url };
  const headers: Record<string, string> = bearer ? { Authorization: `Bearer ${bearer}` } : { "x-api-key": apiKey ?? "" };
  return {
    url,
    createAuthHeaders: async () => ({
      verify: headers,
      settle: headers,
      supported: headers
    })
  };
}

function x402RequirementMatches(expected: X402PaymentRequirements, accepted: PaymentRequirements): boolean {
  return expected.scheme === accepted.scheme
    && expected.network === accepted.network
    && expected.amount === accepted.amount
    && sameAddressish(expected.asset, accepted.asset)
    && sameAddressish(expected.payTo, accepted.payTo);
}

function sameAddressish(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function importCliCommand(tempSource: string, target: string, name: string) {
  const bundledCli = path.join(registry.workspaceRoot, "packages/harness-cli/dist/hh.mjs");
  if (existsSync(bundledCli)) {
    return { command: "node", args: [bundledCli, "import-md", tempSource, "--out", target, "--name", name] };
  }
  return {
    command: "npm",
    args: ["exec", "--", "tsx", "packages/harness-cli/src/index.ts", "import-md", tempSource, "--out", target, "--name", name]
  };
}

function samplePrReview(root: string, owner: string, repo: string) {
  const base = root;
  const head = createReviewVariant(root);
  const diff = diffHarnessDirs(base, head);
  return {
    owner,
    repo,
    number: null,
    title: "Local maintainer review preview",
    source: "local-demo",
    demo: true,
    status: diff.status,
    markdown: semanticDiffMarkdown(diff),
    diff,
    next: "Use `hh diff --base-dir <base> --head-dir <head>` for a real local comparison, or connect a forge PR source before treating this as a pull request."
  };
}

function createReviewVariant(root: string): string {
  const temp = path.join(registry.workspaceRoot, "data", ".review-variant");
  rmDir(temp);
  copyDir(root, temp);
  const manifestPath = path.join(temp, "harness.yaml");
  const manifest = YAML.parse(readFileSync(manifestPath, "utf8"));
  manifest.version = "0.1.1";
  if (manifest.permissions) {
    manifest.permissions.external_send = true;
    manifest.permissions.human_approval_required = Array.from(new Set([...(manifest.permissions.human_approval_required ?? []), "external_send"]));
  }
  writeFileSync(manifestPath, YAML.stringify(manifest));
  return temp;
}

function appendState(event: unknown) {
  mkdirSync(path.dirname(statePath), { recursive: true });
  const current = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : [];
  current.push(event);
  writeFileSync(statePath, JSON.stringify(current.slice(-200), null, 2));
}

function relativeTime(value: string): string {
  const diff = Date.now() - Date.parse(value);
  if (!Number.isFinite(diff) || diff < 60_000) return "now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function firstHeading(markdown: string): string | undefined {
  return markdown.split("\n").find((line) => line.startsWith("# "))?.replace(/^#\s+/, "").trim();
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "imported-harness";
}

function rmDir(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

function copyDir(source: string, target: string) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".harnesshub") continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else writeFileSync(to, readFileSync(from));
  }
}
