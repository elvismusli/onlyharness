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
import { buildMcpServer, MCP_TOOL_NAMES, mcpError, mcpToolCallPreflight, type McpErrorCode, type PublishMarkdownHandler, type PublishResourcePackageHandler, type PullHarnessHandler } from "./mcp.js";
import { acceptBounty, claimBounty, createBounty, deliverBounty, listBounties } from "./bounties.js";
import { createCommunityInviteCode, createWorkspaceJoinCode, verifyCommunityInviteCode, verifyWorkspaceJoinCode } from "./community.js";
import { ManagedCatalog } from "./capabilities.js";
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
import * as resourceReleases from "./resource-releases.js";
import { scanHarnessFiles } from "./security-scan.js";
import { encodeResourceShareKey, registerSharePreviewRoutes, type SharePreviewResult } from "./share-preview.js";
import * as workspaceSubscriptions from "./workspace-subscriptions.js";
import * as workspaces from "./workspaces.js";
import { registerSuperskillRoutes, resolveManagedAccess } from "./routes/superskill.js";
import { handleManagedEventRequest } from "./routes/superskill-events.js";
import { createSupabaseSuperskillAccessResolver, fetchSupabaseAuthIdentity, normalizeSupabaseOrigin, supabaseAuthTimeoutMs, superskillUserSubject } from "./superskill/access.js";
import { AGENT_ACCESS_TOKEN_PREFIX, createAgentAuthService, registerAgentAuthRoutes, type AgentAuthScope } from "./superskill/agent-auth.js";
import { createAgentMutationService } from "./superskill/agent-idempotency.js";
import { registerSuperskillDeviceAuthRoutes } from "./superskill/device-auth.js";
import { SUPERSKILL_DEVICE_TOKEN_PREFIX } from "./superskill/device-token.js";

const statePath = path.resolve(process.env.HARNESS_STATE_PATH ?? path.join(registry.workspaceRoot, "data/harness-state.json"));
const supabaseUrl = normalizeSupabaseOrigin(process.env.SUPABASE_URL);
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseRestKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? supabaseAnonKey;
const supabaseAuthTimeout = supabaseAuthTimeoutMs(process.env.SUPABASE_AUTH_TIMEOUT_MS);
const webhookToken = process.env.HARNESS_WEBHOOK_TOKEN;
const corsOrigins = parseCsv(process.env.HARNESS_CORS_ORIGINS);
const orgsEnabled = process.env.ORGS_ENABLED === "true";
const workspacesEnabled = process.env.WORKSPACES_ENABLED === "true";
const hostedResourcePublishEnabled = process.env.HOSTED_RESOURCE_PUBLISH_ENABLED === "true";
const resourceMetadataUrl = "https://superskill.sh/.well-known/oauth-protected-resource";
const resourcePackageRouteBodyLimit = 12 * 1024 * 1024;
const resourcePackageTotalFileBytes = 8 * 1024 * 1024;

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
  version?: string;
  idempotencyKey?: string;
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

type WorkspaceCreateRequest = {
  slug?: string;
  name?: string;
  type?: string;
  visibility?: string;
  description?: string | null;
};

type WorkspaceResourceApproveRequest = {
  resourceId?: string;
  collection?: string;
  name?: string;
  note?: string;
  resourceVersion?: string;
  artifactDigest?: string;
};

type WorkspaceMemberRequest = {
  userId?: string;
  role?: string;
  source?: string;
  expiresAt?: string | null;
  expires_at?: string | null;
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

type WorkspaceJoinPolicyRequest = {
  policies?: unknown[];
};

type WorkspaceSubscriptionCheckoutRequest = {
  policyId?: string;
  provider?: string;
};

type WorkspaceSubscriptionWebhookRequest = {
  provider?: string;
  provider_subscription_ref?: string;
  provider_event_ref?: string;
  event_type?: string;
  status?: string;
  current_period_start?: string | null;
  current_period_end?: string | null;
  grace_until?: string | null;
  cancel_at_period_end?: boolean;
  provider_customer_ref?: string | null;
};

type WorkspaceJoinCodeRequest = {
  source?: string;
  policyId?: string;
  ttl_seconds?: number;
  ttlSeconds?: number;
};

type WorkspaceJoinCodeVerifyRequest = {
  code?: string;
};

type WorkspaceJoinGrantRequest = {
  code?: string;
  source?: string;
  externalSubject?: string;
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

type AuthUser = {
  id: string;
  email?: string;
  subject?: string;
  confirmed?: boolean;
  authKind?: "agent_access";
  clientId?: string;
  sessionId?: string;
  scopes?: readonly AgentAuthScope[];
  expiresAt?: Date;
};

type AuthResult = {
  user?: AuthUser;
  status?: number;
  error?: string;
  code?: "AUTH_REQUIRED" | "AUTH_INVALID" | "AUTH_UNAVAILABLE" | "FORBIDDEN";
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
const agentAuthService = createAgentAuthService();
const agentMutationService = createAgentMutationService();
const superskillAccessResolver = createSupabaseSuperskillAccessResolver({ agentTokenResolver: agentAuthService.resolveAccessToken });
const shareCapabilityCatalog = new ManagedCatalog();
await app.register(cors, {
  credentials: true,
  origin: (origin, callback) => {
    if (!origin || isAllowedOrigin(origin)) return callback(null, true);
    return callback(null, false);
  }
});
await registerAgentAuthRoutes(app, agentAuthService);
await registerSuperskillDeviceAuthRoutes(app);
await registerSuperskillRoutes(app, { accessResolver: superskillAccessResolver });
await registerSharePreviewRoutes(app, {
  resource: resolveResourceSharePreview,
  capability: resolveCapabilitySharePreview,
  workspace: resolveWorkspaceSharePreview
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
  const release = resourceReleases.activeReleaseMetadata(resource.id);
  if (!release) return resource;
  const detail = resourceReleases.activeReleaseDetail(resource.id, release.version);
  if (!detail) return reply.code(503).send({
    error: "Hosted resource archive storage unavailable",
    code: "ARCHIVE_STORAGE_UNAVAILABLE",
    id: resource.id,
    version: release.version,
    next: "Retry later; no download action is returned without verified archive bytes."
  });
  return { ...detail.resource, release: detail.release };
});

app.get("/resources/:id/releases/:version", async (request, reply) => {
  const { id, version } = request.params as { id: string; version: string };
  if (!resourceReleases.isReleaseSemver(version)) return reply.code(404).send({ error: "Resource release not found", code: "RESOURCE_RELEASE_NOT_FOUND" });
  const release = resourceReleases.activeReleaseMetadata(id, version);
  if (!release) return reply.code(404).send({ error: "Resource release not found", code: "RESOURCE_RELEASE_NOT_FOUND" });
  const detail = resourceReleases.activeReleaseDetail(id, version);
  if (!detail) return reply.code(503).send({ error: "Hosted resource archive storage unavailable", code: "ARCHIVE_STORAGE_UNAVAILABLE", id, version, next: "Retry later; no download action is returned without verified archive bytes." });
  return { ...detail.resource, release: detail.release };
});

app.get("/resources/:id/archive", async (request, reply) => {
  const { id } = request.params as { id: string };
  const counters = await fetchCountersMap();
  const registryItems = registry.scanRegistry(counters);
  const resource = resources.resourceDetail(id, registryItems);
  if (!resource) return reply.code(404).send({ error: "Resource not found" });
  return sendPublicResourceArchive(resource, undefined, reply);
});

app.get("/resources/:id/releases/:version/archive", async (request, reply) => {
  const { id, version } = request.params as { id: string; version: string };
  if (!resourceReleases.isReleaseSemver(version)) return reply.code(404).send({ error: "Resource release not found", code: "RESOURCE_RELEASE_NOT_FOUND" });
  const release = resourceReleases.activeReleaseMetadata(id, version);
  if (!release) return reply.code(404).send({ error: "Resource release not found", code: "RESOURCE_RELEASE_NOT_FOUND" });
  const exact = resourceReleases.activeReleaseDetail(id, version);
  if (!exact) return reply.code(503).send({ error: "Hosted resource archive storage unavailable", code: "ARCHIVE_STORAGE_UNAVAILABLE", id, version, next: "Retry later; the archive will not be served without verified bytes." });
  return sendPublicResourceArchive(exact.resource, version, reply);
});

async function resolveResourceSharePreview(id: string, version?: string): Promise<SharePreviewResult> {
  const counters = await fetchCountersMap();
  const registryItems = registry.scanRegistry(counters);
  let resource = resources.resourceDetail(id, registryItems);
  let release: ReturnType<typeof resourceReleases.activeReleaseMetadata>;
  if (version) {
    release = resourceReleases.activeReleaseMetadata(id, version);
    if (!release) return { ok: false, status: 404, code: "SHARE_NOT_FOUND" };
    const exact = resourceReleases.activeReleaseDetail(id, version);
    if (!exact) return { ok: false, status: 503, code: "SHARE_UNAVAILABLE" };
    resource = exact.resource;
  } else if (resource) {
    release = resourceReleases.activeReleaseMetadata(resource.id);
    if (release) {
      const active = resourceReleases.activeReleaseDetail(resource.id, release.version);
      if (!active) return { ok: false, status: 503, code: "SHARE_UNAVAILABLE" };
      resource = active.resource;
    }
  }
  if (!resource) return { ok: false, status: 404, code: "SHARE_NOT_FOUND" };

  const key = encodeResourceShareKey(resource.id);
  const exactPath = version ? `/${encodeURIComponent(version)}` : "";
  const scan = resource.trust.securityScan ?? "not_scanned";
  const facts = [
    ...(release ? [`v${release.version}`] : []),
    `scan ${scan.replaceAll("_", " ")}`,
    ...(release ? [shortShareDigest(release.artifactDigest)] : resource.worksWith.length ? [`for ${resource.worksWith.slice(0, 2).join(" + ")}`] : [])
  ];
  return {
    ok: true,
    value: {
      kind: "resource",
      title: resource.title,
      summary: resource.summary,
      eyebrow: `${resource.resourceType.replaceAll("_", " ")} · ${version ? "exact release" : "public catalog"}`,
      badge: resource.resourceType.replaceAll("_", " "),
      facts,
      canonicalPath: `/r/${key}${exactPath}`,
      imagePath: `/og/r/${key}${version ? `?version=${encodeURIComponent(version)}` : ""}`,
      redirectHash: `#/superskill/resources/${encodeURIComponent(resource.id)}${version ? `/releases/${encodeURIComponent(version)}` : ""}`,
      immutable: Boolean(version && release)
    }
  };
}

async function resolveCapabilitySharePreview(id: string): Promise<SharePreviewResult> {
  try {
    const capability = shareCapabilityCatalog.detail(id);
    if (!capability) return { ok: false, status: 404, code: "SHARE_NOT_FOUND" };
    const candidate = capability.trust.status === "candidate";
    const [owner, ...skillParts] = capability.release.ref.split("/");
    const selectedHash = owner && skillParts.length
      ? `#/superskill/selected/${encodeURIComponent(owner)}/${encodeURIComponent(skillParts.join("/"))}`
      : `#/superskill/c/${encodeURIComponent(capability.id)}`;
    return {
      ok: true,
      value: {
        kind: "capability",
        title: capability.title,
        summary: capability.summary,
        eyebrow: `managed skill · ${candidate ? "selected for review" : "exact trust report"}`,
        badge: candidate ? "selected · unreviewed" : capability.trust.status,
        facts: [`v${capability.release.version}`, shortShareDigest(capability.release.artifactDigest), `${capability.trust.checks.length} named checks`],
        canonicalPath: `/c/${encodeURIComponent(capability.id)}`,
        imagePath: `/og/c/${encodeURIComponent(capability.id)}`,
        redirectHash: candidate ? selectedHash : `#/superskill/c/${encodeURIComponent(capability.id)}`
      }
    };
  } catch {
    return { ok: false, status: 503, code: "SHARE_UNAVAILABLE" };
  }
}

async function resolveWorkspaceSharePreview(inviteId: string): Promise<SharePreviewResult> {
  const result = await workspaces.readWorkspaceInvitePreview(inviteId);
  if (!result.ok) {
    if (result.status === 410) return { ok: false, status: 410, code: "SHARE_EXPIRED" };
    if (result.status === 503) return { ok: false, status: 503, code: "SHARE_UNAVAILABLE" };
    return { ok: false, status: 404, code: "SHARE_NOT_FOUND" };
  }
  return {
    ok: true,
    value: {
      kind: "workspace",
      title: result.workspace.name,
      summary: `Join @${result.workspace.slug} on SuperSkill. Sign in to verify this private workspace invitation.`,
      eyebrow: "private workspace · invitation",
      badge: "invite only",
      facts: ["private catalog", "membership checked on open"],
      canonicalPath: `/w/${encodeURIComponent(result.invite.id ?? inviteId)}`,
      imagePath: `/og/w/${encodeURIComponent(result.invite.id ?? inviteId)}`,
      redirectHash: `#/superskill/workspaces?workspace=${encodeURIComponent(result.workspace.slug)}`,
      noIndex: true,
      workspaceSlug: result.workspace.slug
    }
  };
}

function shortShareDigest(digest: string): string {
  const clean = digest.replace(/^sha256:/, "");
  return `sha256 ${clean.slice(0, 8)}…${clean.slice(-6)}`;
}

async function sendPublicResourceArchive(resource: resources.Resource, version: string | undefined, reply: FastifyReply) {
  if (resource.trust.securityScan === "fail") {
    return reply.code(409).send({
      error: "Resource release failed the static security scan",
      code: "RESOURCE_SCAN_FAILED",
      id: resource.id,
      next: "Do not download this release. Publish a corrected new version."
    });
  }
  const release = resourceReleases.activeReleaseMetadata(resource.id, version);
  const archivePath = release
    ? resourceReleases.resourceArchivePathForRead(resource.id, release.version)
    : resources.resourceArchivePath(resource.id, version);
  if (!archivePath) {
    if (release) return reply.code(503).send({
      error: "Hosted resource archive storage unavailable",
      code: "ARCHIVE_STORAGE_UNAVAILABLE",
      id: resource.id,
      version: release.version,
      next: "Retry later; the archive will not be served without verified bytes."
    });
    if (version) return reply.code(404).send({ error: "Resource release not found", code: "RESOURCE_RELEASE_NOT_FOUND", id: resource.id, version });
    return reply.code(409).send({
      error: "Resource archive not hosted",
      code: "RESOURCE_ARCHIVE_NOT_HOSTED",
      id: resource.id,
      next: "This resource is listed in SuperSkill, but its files are not hosted by SuperSkill yet."
    });
  }
  if (!release) return reply.code(503).send({
    error: "Hosted resource release metadata unavailable",
    code: "ARCHIVE_STORAGE_UNAVAILABLE",
    id: resource.id,
    next: "Retry later; the archive will not be served without its immutable digest metadata."
  });
  await recordEvent({
    kind: "pull",
    owner: resource.upstreamOwner,
    repo: resource.upstreamRepo ?? resource.title,
    version: release.version,
    target: "resource-archive",
    client: "api"
  });
  return reply
    .header("content-type", "application/gzip")
    .header("content-disposition", `attachment; filename="${resources.resourceArchiveFileName(resource)}"`)
    .header("content-length", String(release.archiveSize))
    .header("etag", `"sha256:${release.artifactDigest}"`)
    .header("x-onlyharness-resource-version", release.version)
    .header("x-superskill-artifact-sha256", release.artifactDigest)
    .send(createReadStream(archivePath));
}

app.post("/workspaces", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace layer is not enabled" });
  const user = await requireUser(request, reply, ["workspaces:write"]);
  if (!user) return;
  if (!user.confirmed) return reply.code(403).send({ error: "Confirmed account required", code: "EMAIL_CONFIRMATION_REQUIRED" });
  const body = request.body && typeof request.body === "object" ? request.body as WorkspaceCreateRequest : {};
  const idempotency = await claimAgentMutation(request, reply, user, "/workspaces", body);
  if (!idempotency.proceed) return;
  const result = await workspaces.createWorkspaceForUser({ ...body, userId: user.id });
  if (!result.ok) {
    const payload = { error: result.error, code: result.code };
    if (!await completeAgentMutation(idempotency, user.id, "/workspaces", result.status, payload)) return idempotencyCommitFailed(reply);
    return reply.code(result.status).send(payload);
  }
  await workspaces.appendWorkspaceAudit({
    slug: result.workspace.slug,
    action: result.replay ? "workspace_create_replayed" : "workspace_create_confirmed",
    subject: eventSubject(user.id),
    target: result.workspace.slug,
    via: "workspace_member"
  });
  const status = result.replay ? 200 : 201;
  const payload = {
    workspace: publicWorkspace(result.workspace),
    member: result.member,
    replay: result.replay,
    next: `Create a bounded invite or publish a private resource under @${result.workspace.slug}.`
  };
  if (!await completeAgentMutation(idempotency, user.id, "/workspaces", status, payload)) return idempotencyCommitFailed(reply);
  return reply.code(status).send(payload);
});

app.get("/workspaces/:slug/workspace", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace layer is not enabled" });
  const { slug } = request.params as { slug: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["workspace:read"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "workspace" });
    return reply.code(auth.status).send(workspaceAuthFailure(auth));
  }
  const query = request.query as resources.ResourceQuery;
  const resourceResult = workspaces.searchWorkspaceResources(auth.workspace.slug, { ...query, limit: query.limit ?? 50 });
  const joinPolicies = await workspaces.listWorkspaceJoinPolicies(auth.workspace.slug);
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "workspace_read", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: "workspace", via: auth.via });
  return {
    workspace: publicWorkspace(auth.workspace),
    resources: resourceResult.resources,
    items: resourceResult.resources,
    collections: workspaces.listWorkspaceCollections(auth.workspace.slug),
    joinPolicies: joinPolicies.ok ? joinPolicies.policies.map(publicWorkspaceJoinPolicy) : [],
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
    return reply.code(auth.status).send(workspaceAuthFailure(auth));
  }
  const query = request.query as { target?: string };
  const bundle = await workspaces.workspaceSetupBundle(auth.workspace, query.target);
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "setup_bundle_read", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: bundle.target, via: auth.via });
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
  const shareUrl = result.invite.id
    ? `https://superskill.sh/w/${encodeURIComponent(result.invite.id)}#invite=${encodeURIComponent(result.code)}`
    : undefined;
  return reply.code(201).send({
    workspace: publicWorkspace(auth.workspace),
    invite: publicWorkspaceInvite(result.invite),
    code: result.code,
    ...(shareUrl ? { shareUrl } : {}),
    next: "Show this invite once. The raw code stays after # and is never sent to the preview server. The workspace name is visible to recipients and may be cached by their messenger."
  });
});

app.get("/workspaces/:slug/join-policies", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace join policies are not enabled" });
  const { slug } = request.params as { slug: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["workspace:read"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "join_policies" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const result = await workspaces.listWorkspaceJoinPolicies(auth.workspace.slug);
  if (!result.ok) return reply.code(result.status).send({ error: result.error, code: result.code });
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "join_policies_read", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: "join_policies", via: auth.via });
  return { workspace: publicWorkspace(auth.workspace), policies: result.policies.map(publicWorkspaceJoinPolicy) };
});

app.put("/workspaces/:slug/join-policies", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace join policies are not enabled" });
  const { slug } = request.params as { slug: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["member:write", "invite:write"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "join_policies_update" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const body = request.body && typeof request.body === "object" ? request.body as WorkspaceJoinPolicyRequest : {};
  const result = await workspaces.upsertWorkspaceJoinPolicies(auth.workspace.slug, { policies: body.policies });
  if (!result.ok) return reply.code(result.status).send({ error: result.error, code: result.code });
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "join_policies_updated", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: "join_policies", via: auth.via });
  return { workspace: publicWorkspace(auth.workspace), policies: result.policies.map(publicWorkspaceJoinPolicy) };
});

app.post("/workspaces/:slug/subscriptions/checkout", async (request, reply) => {
  if (!workspacesEnabled || !workspaceSubscriptions.workspaceSubscriptionsEnabled()) return reply.code(404).send({ error: "Workspace subscriptions are not enabled" });
  const { slug } = request.params as { slug: string };
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = request.body && typeof request.body === "object" ? request.body as WorkspaceSubscriptionCheckoutRequest : {};
  const result = await workspaceSubscriptions.createWorkspaceSubscriptionCheckout(slug, { userId: user.id, policyId: body.policyId, provider: body.provider });
  if (!result.ok) return reply.code(result.status).send({ error: result.error, code: result.code });
  await workspaces.appendWorkspaceAudit({ slug: result.workspace.slug, action: "subscription_checkout_created", subject: eventSubject(user.id), target: result.policy.id, via: "workspace_member" });
  return reply.code(201).send({
    workspace: publicWorkspace(result.workspace),
    policy: publicWorkspaceJoinPolicy(result.policy),
    subscription: publicWorkspaceSubscription(result.subscription),
    checkout_url: result.checkout_url,
    next: result.next
  });
});

app.get("/workspaces/:slug/subscriptions/me", async (request, reply) => {
  if (!workspacesEnabled || !workspaceSubscriptions.workspaceSubscriptionsEnabled()) return reply.code(404).send({ error: "Workspace subscriptions are not enabled" });
  const { slug } = request.params as { slug: string };
  const user = await requireUser(request, reply);
  if (!user) return;
  const result = await workspaceSubscriptions.listWorkspaceSubscriptions(slug, { userId: user.id });
  if (!result.ok) return reply.code(result.status).send({ error: result.error, code: result.code });
  await workspaces.appendWorkspaceAudit({ slug: result.workspace.slug, action: "subscriptions_read_self", subject: eventSubject(user.id), target: "subscriptions", via: "workspace_member" });
  return { workspace: publicWorkspace(result.workspace), subscriptions: result.subscriptions.map(publicWorkspaceSubscription) };
});

app.post("/workspaces/:slug/subscriptions/sweep", async (request, reply) => {
  if (!workspacesEnabled || !workspaceSubscriptions.workspaceSubscriptionsEnabled()) return reply.code(404).send({ error: "Workspace subscriptions are not enabled" });
  const { slug } = request.params as { slug: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["member:write", "workspace:admin"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "subscription_sweep" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const result = await workspaceSubscriptions.sweepExpiredWorkspaceSubscriptions(auth.workspace.slug);
  if (!result.ok) return reply.code(result.status).send({ error: result.error, code: result.code });
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "subscription_sweep", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: String(result.expired.length), via: auth.via });
  return {
    workspace: publicWorkspace(result.workspace),
    checked: result.checked,
    expired: result.expired.map(publicWorkspaceSubscription)
  };
});

app.post("/workspaces/:slug/join-code", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace join codes are not enabled" });
  const { slug } = request.params as { slug: string };
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = request.body && typeof request.body === "object" ? request.body as WorkspaceJoinCodeRequest : {};
  const source = workspaceJoinSource(body.source);
  if (!source) return reply.code(400).send({ error: "source must be telegram, discord, or entitlement", code: "INVALID_JOIN_SOURCE" });
  const policies = await workspaces.listWorkspaceJoinPolicies(slug);
  if (!policies.ok) return reply.code(policies.status).send({ error: policies.error, code: policies.code });
  const policy = policies.policies.find((row) => workspaceJoinPolicyMatchesSource(row, source) && (!body.policyId || row.id === body.policyId));
  if (!policy) return reply.code(403).send({ error: "Workspace join policy does not allow this source", code: "JOIN_POLICY_DENIED" });
  const secret = workspaceJoinSecret();
  if (!secret) return reply.code(503).send({ error: "Workspace join codes are not configured" });
  const code = createWorkspaceJoinCode({
    workspace: policies.workspace.slug,
    userId: user.id,
    source,
    policyId: policy.id,
    ttlSeconds: typeof body.ttl_seconds === "number" ? body.ttl_seconds : typeof body.ttlSeconds === "number" ? body.ttlSeconds : undefined,
    secret
  });
  if (!code.ok) return reply.code(400).send({ error: code.error });
  await workspaces.appendWorkspaceAudit({ slug: policies.workspace.slug, action: "join_code_created", subject: eventSubject(user.id), target: policy.id, via: "workspace_member" });
  return reply.code(201).send({
    ok: true,
    workspace: publicWorkspace(policies.workspace),
    policy: publicWorkspaceJoinPolicy(policy),
    code: code.code,
    source,
    subject_type: "user",
    subject_id: user.id,
    expires_at: new Date(code.payload.exp * 1000).toISOString(),
    next: "Give this short-lived code to the workspace gate bot or moderator. Verification is read-only; membership requires an explicit grant."
  });
});

app.post("/workspaces/:slug/join-code/verify", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace join code verification is not enabled" });
  const { slug } = request.params as { slug: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["gate:verify"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "join_code_verify" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const verified = await verifyWorkspaceJoinCodeForWorkspace(slug, request.body);
  if (!verified.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: verified.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "join_code", via: auth.via });
    return reply.code(verified.status).send({ error: verified.error, code: verified.code });
  }
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "join_code_verified", tokenName: auth.tokenName, subject: eventSubject(verified.subjectId), target: verified.policy.id, via: auth.via });
  return {
    ok: true,
    workspace: publicWorkspace(auth.workspace),
    policy: publicWorkspaceJoinPolicy(verified.policy),
    allowed: true,
    source: verified.source,
    subject_type: "user",
    subject_id: verified.subjectId,
    expires_at: verified.expiresAt,
    next: "Verification is read-only. Call /workspaces/{slug}/join-grants after the external membership check passes."
  };
});

app.post("/workspaces/:slug/join-grants", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace join grants are not enabled" });
  const { slug } = request.params as { slug: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["gate:write"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "join_grant" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const body = request.body && typeof request.body === "object" ? request.body as WorkspaceJoinGrantRequest : {};
  const verified = await verifyWorkspaceJoinCodeForWorkspace(slug, body);
  if (!verified.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: verified.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "join_grant", via: auth.via });
    return reply.code(verified.status).send({ error: verified.error, code: verified.code });
  }
  const requestedSource = workspaceJoinSource(body.source);
  if (requestedSource && requestedSource !== verified.source) {
    return reply.code(400).send({ error: "Join grant source does not match join code", code: "JOIN_SOURCE_MISMATCH" });
  }
  const result = await workspaces.grantWorkspaceJoinPolicy(auth.workspace.slug, { userId: verified.subjectId, source: verified.source, policyId: verified.policy.id });
  if (!result.ok) return reply.code(result.status).send({ error: result.error, code: result.code });
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "member_joined", tokenName: auth.tokenName, subject: eventSubject(verified.subjectId), target: result.member.user_id, via: auth.via });
  return reply.code(201).send({
    workspace: publicWorkspace(result.workspace),
    policy: result.policy ? publicWorkspaceJoinPolicy(result.policy) : undefined,
    member: result.member,
    next: "Workspace membership is active. Private install paths still require this signed-in user or a workspace token."
  });
});

app.post("/workspaces/:slug/join", async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace join is not enabled" });
  const { slug } = request.params as { slug: string };
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!user.confirmed) return reply.code(403).send({ error: "Confirmed account required", code: "EMAIL_CONFIRMATION_REQUIRED" });
  const body = request.body && typeof request.body === "object" ? request.body as WorkspaceJoinRequest : {};
  const result = body.code
    ? await workspaces.joinWorkspaceWithInvite(slug, { code: body.code, userId: user.id, email: user.email })
    : await workspaces.joinWorkspaceWithEmailDomain(slug, { userId: user.id, email: user.email });
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
  const resolved = resolveWorkspaceApprovalResource(body, registryItems);
  if (!resolved.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "resource_approval_missing", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: body.resourceId, via: auth.via });
    return reply.code(resolved.status).send({ error: resolved.error, code: resolved.code });
  }
  const publicResource = resolved.resource;
  const result = workspaces.approveWorkspacePublicResource(auth.workspace.slug, auth.workspace.name, publicResource, {
    collectionSlug: body.collection,
    name: body.name,
    note: body.note,
    actor: auth.tokenName ?? auth.userId,
    pinnedVersion: resolved.pinnedVersion,
    pinnedArchiveHash: resolved.pinnedArchiveHash
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
    next: "Workspace approval is local curation. It is not a SuperSkill reviewed badge."
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
      next: "This workspace resource is listed in SuperSkill, but its files are not hosted by SuperSkill yet."
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
  const resolved = resolveWorkspaceApprovalResource(body, registryItems);
  if (!resolved.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "collection_item_missing", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: body.resourceId, via: auth.via });
    return reply.code(resolved.status).send({ error: resolved.error, code: resolved.code });
  }
  const publicResource = resolved.resource;
  const result = workspaces.approveWorkspacePublicResource(auth.workspace.slug, auth.workspace.name, publicResource, {
    collectionSlug: collection,
    name: body.name,
    note: body.note,
    actor: auth.tokenName ?? auth.userId,
    pinnedVersion: resolved.pinnedVersion,
    pinnedArchiveHash: resolved.pinnedArchiveHash
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
    next: "Workspace approval is local curation. It is not a SuperSkill reviewed badge."
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
  const { slug } = request.params as { slug: string };
  if (workspacesEnabled) {
    const auth = await authorizeWorkspaceRequest(slug, request, ["workspace:setup"]);
    if (!auth.ok) {
      await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "legacy_org_bundle" });
      return reply.code(auth.status).send({ error: auth.error });
    }
    const query = request.query as { target?: string };
    const bundle = await workspaces.workspaceSetupBundle(auth.workspace, query.target);
    await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "setup_bundle_read", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: "legacy_org_bundle", via: auth.via });
    await recordEvent({ kind: "install", owner: auth.workspace.slug, repo: "bundle", version: bundle.version, subject: workspaceAuthSubject(auth), target: "org_setup_workspace_alias", client: "api" });
    return {
      organization: {
        slug: auth.workspace.slug,
        name: auth.workspace.name,
        plan: auth.workspace.plan
      },
      workspace: publicWorkspace(auth.workspace),
      bundle
    };
  }

  if (!orgsEnabled) return reply.code(404).send({ error: "Org setup is not enabled" });
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
  const { slug } = request.params as { slug: string };
  if (workspacesEnabled) {
    const auth = await authorizeWorkspaceRequest(slug, request, ["workspace:read"]);
    if (!auth.ok) {
      await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "legacy_org_workspace" });
      return reply.code(auth.status).send({ error: auth.error });
    }
    const query = request.query as resources.ResourceQuery;
    const resourceResult = workspaces.searchWorkspaceResources(auth.workspace.slug, { ...query, limit: query.limit ?? 50 });
    const joinPolicies = await workspaces.listWorkspaceJoinPolicies(auth.workspace.slug);
    await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "workspace_read", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: "legacy_org_workspace", via: auth.via });
    return {
      organization: {
        slug: auth.workspace.slug,
        name: auth.workspace.name,
        plan: auth.workspace.plan
      },
      workspace: publicWorkspace(auth.workspace),
      resources: resourceResult.resources,
      items: resourceResult.resources,
      collections: workspaces.listWorkspaceCollections(auth.workspace.slug),
      joinPolicies: joinPolicies.ok ? joinPolicies.policies.map(publicWorkspaceJoinPolicy) : [],
      permissions: workspaceResourcePermissionsSummary(auth.workspace.slug, resourceResult.resources),
      audit: await workspaces.readWorkspaceAudit(auth.workspace.slug, 80)
    };
  }

  if (!orgsEnabled) return reply.code(404).send({ error: "Org workspace is not enabled" });
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

app.post("/workspaces/:slug/imports/resource-package", { bodyLimit: resourcePackageRouteBodyLimit }, async (request, reply) => {
  if (!workspacesEnabled) return reply.code(404).send({ error: "Workspace publishing is not enabled" });
  const { slug } = request.params as { slug: string };
  const auth = await authorizeWorkspaceRequest(slug, request, ["resource:publish"]);
  if (!auth.ok) {
    await workspaces.appendWorkspaceAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "resource_publish" });
    return reply.code(auth.status).send(workspaceAuthFailure(auth));
  }
  const body = request.body && typeof request.body === "object" ? request.body as ResourcePackageImportRequest : {};
  const route = `/workspaces/${auth.workspace.slug}/imports/resource-package`;
  const agentUser: AuthUser = {
    id: auth.userId ?? `workspace:${auth.workspace.slug}`,
    ...(headerValue(request.headers.authorization)?.startsWith(`Bearer ${AGENT_ACCESS_TOKEN_PREFIX}`) ? { authKind: "agent_access" as const } : {})
  };
  const idempotency = await claimAgentMutation(request, reply, agentUser, route, body);
  if (!idempotency.proceed) return;
  const result = await importResourcePackage(body, { id: auth.userId ?? `workspace:${auth.workspace.slug}`, email: auth.workspace.name }, { workspaceSlug: auth.workspace.slug, workspaceName: auth.workspace.name, actorLabel: auth.tokenName ?? auth.userId });
  if ("error" in result) {
    const payload: { error: string; code?: string; failures?: string[] } = { error: result.error ?? "Workspace resource package import failed" };
    if ("code" in result && result.code) payload.code = result.code;
    if ("failures" in result && Array.isArray(result.failures)) payload.failures = result.failures;
    await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "resource_publish_rejected", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: body.name, via: auth.via });
    if (!await completeAgentMutation(idempotency, agentUser.id, route, result.status ?? 500, payload)) return idempotencyCommitFailed(reply);
    return reply.code(result.status ?? 500).send(payload);
  }
  await workspaces.appendWorkspaceAudit({ slug: auth.workspace.slug, action: "resource_package_publish", tokenName: auth.tokenName, subject: workspaceAuthSubject(auth), target: result.resource?.id, via: auth.via });
  if (!await completeAgentMutation(idempotency, agentUser.id, route, 201, result)) return idempotencyCommitFailed(reply);
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

app.post("/mcp", { bodyLimit: resourcePackageRouteBodyLimit }, async (request, reply) => {
  const mcpBody = normalizeMcpToolCallBody(request.body);
  const preflight = await preflightMcpToolCall(mcpBody, headerValue(request.headers.authorization));
  if (preflight) {
    return reply.code(200).send({
      jsonrpc: "2.0",
      id: mcpRequestId(mcpBody),
      result: preflight
    });
  }
  const server = buildMcpServer({
    publishMarkdown: publishMarkdownFromMcp,
    publishResourcePackage: publishResourcePackageFromMcp,
    pullHarness: pullHarnessFromMcp,
    harnessDetail: harnessDetailFromMcp,
    pullInstructions: pullInstructionsFromMcp,
    resourceRelease: resourceReleases.activeReleaseDetail,
    resourceReleaseMetadata: resourceReleases.activeReleaseMetadata
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  reply.raw.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, mcpBody);
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

function normalizeMcpToolCallBody(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const request = body as { method?: unknown; params?: unknown };
  if (request.method !== "tools/call" || !request.params || typeof request.params !== "object" || Array.isArray(request.params)) return body;
  const params = request.params as Record<string, unknown>;
  if (params.arguments !== undefined && params.arguments !== null) return body;
  return { ...request, params: { ...params, arguments: {} } };
}

async function preflightMcpToolCall(body: unknown, authorization: string | undefined) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const request = body as { method?: unknown; params?: unknown };
  if (request.method !== "tools/call" || !request.params || typeof request.params !== "object" || Array.isArray(request.params)) return undefined;
  const params = request.params as { name?: unknown; arguments?: unknown };
  if (typeof params.name !== "string" || !MCP_TOOL_NAMES.includes(params.name as typeof MCP_TOOL_NAMES[number])) {
    return mcpToolCallPreflight(params.name, params.arguments);
  }
  if (params.name !== "publish_markdown_to_harness" && params.name !== "publish_resource_package") {
    return mcpToolCallPreflight(params.name, params.arguments);
  }

  const auth = await authenticatePublicResourcePublish(authorization);
  if (!auth.user) {
    const code: McpErrorCode = auth.code === "AUTH_REQUIRED"
      ? "AUTH_REQUIRED"
      : auth.code === "AUTH_INVALID"
        ? "AUTH_INVALID"
        : auth.code === "FORBIDDEN"
          ? "FORBIDDEN"
          : "SERVICE_UNAVAILABLE";
    return mcpError({
      code,
      status: auth.status ?? (code === "SERVICE_UNAVAILABLE" ? 503 : 401),
      details: { resource_metadata: resourceMetadataUrl }
    });
  }
  if (params.name === "publish_resource_package" && !hostedResourcePublishEnabled) {
    return mcpError({ code: "PUBLISH_DISABLED", status: 503, next: publicResourcePublishDisabled().next });
  }
  return mcpToolCallPreflight(params.name, params.arguments);
}

function mcpRequestId(body: unknown): string | number | null {
  if (!body || typeof body !== "object" || Array.isArray(body) || !("id" in body)) return null;
  const id = (body as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" || id === null ? id : null;
}

app.get("/mcp", async (_request, reply) => mcpMethodNotAllowed(reply));
app.delete("/mcp", async (_request, reply) => mcpMethodNotAllowed(reply));

app.post("/imports/markdown-to-harness", async (request, reply) => {
  const user = await requireUser(request, reply, ["resources:publish"]);
  if (!user) return;
  const body = request.body as ImportRequest;
  const route = "/imports/markdown-to-harness";
  const idempotency = await claimAgentMutation(request, reply, user, route, body);
  if (!idempotency.proceed) return;
  const result = await importMarkdownToHarness(body, user);
  if ("error" in result) {
    const status = result.status ?? 500;
    const payload = { error: result.error };
    if (!await completeAgentMutation(idempotency, user.id, route, status, payload)) return idempotencyCommitFailed(reply);
    return reply.code(status).send(payload);
  }
  if (!await completeAgentMutation(idempotency, user.id, route, 200, result)) return idempotencyCommitFailed(reply);
  return result;
});

app.post("/imports/harness-dir", async (request, reply) => {
  const user = await requireUser(request, reply, ["resources:publish"]);
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

app.post("/imports/resource-package", { bodyLimit: resourcePackageRouteBodyLimit }, async (request, reply) => {
  const auth = await authenticatePublicResourcePublish(headerValue(request.headers.authorization));
  if (!auth.user) return sendPublicResourcePublishAuthFailure(reply, auth);
  if (!hostedResourcePublishEnabled) return reply.code(503).send(publicResourcePublishDisabled());
  const requestedBody = request.body && typeof request.body === "object" ? request.body as ResourcePackageImportRequest : {};
  const headerIdempotencyKey = idempotencyKeyFromRequest(request);
  if (headerIdempotencyKey && requestedBody.idempotencyKey && headerIdempotencyKey !== requestedBody.idempotencyKey) {
    return reply.code(409).send({ error: "Idempotency-Key header conflicts with body idempotencyKey", code: "IDEMPOTENCY_KEY_CONFLICT" });
  }
  const body = headerIdempotencyKey ? { ...requestedBody, idempotencyKey: headerIdempotencyKey } : requestedBody;
  const result = await importResourcePackage(body, auth.user);
  if ("error" in result) {
    const payload: { error: string; code?: string; failures?: string[] } = { error: result.error ?? "Resource package import failed" };
    if ("code" in result && result.code) payload.code = result.code;
    if ("failures" in result && Array.isArray(result.failures)) payload.failures = result.failures;
    return reply.code(result.status ?? 500).send(payload);
  }
  return reply.code("replay" in result && result.replay ? 200 : 201).send(result);
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
  const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
  const managed = await handleManagedEventRequest(authorization, body, { accessResolver: superskillAccessResolver });
  if (managed) {
    for (const [name, value] of Object.entries(managed.headers ?? {})) reply.header(name, value);
    return reply.code(managed.status).send(managed.body);
  }
  const kind = String(body.kind ?? "");
  const auth = authorization ? await userFromAuthorization(authorization) : {};
  const event = sanitizeEvent({
    kind,
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

app.post("/webhooks/workspace-subscriptions", async (request, reply) => {
  if (!workspacesEnabled || !workspaceSubscriptions.workspaceSubscriptionsEnabled()) return reply.code(404).send({ error: "Workspace subscriptions are not enabled" });
  if (!requirePaymentWebhookToken(request, reply)) return;
  const body = request.body && typeof request.body === "object" ? request.body as WorkspaceSubscriptionWebhookRequest : {};
  const result = await workspaceSubscriptions.settleWorkspaceSubscriptionWebhook(body);
  if (!result.ok) return reply.code(result.status).send({ error: result.error, code: result.code });
  await workspaces.appendWorkspaceAudit({
    slug: result.workspace.slug,
    action: `subscription_${result.status}`,
    subject: eventSubject(result.subscription.user_id),
    target: result.subscription.provider_subscription_ref
  });
  return {
    status: result.status,
    workspace: publicWorkspace(result.workspace),
    policy: result.policy ? publicWorkspaceJoinPolicy(result.policy) : undefined,
    subscription: publicWorkspaceSubscription(result.subscription),
    member: result.member,
    next: result.next
  };
});

app.post("/internal/eval-result", async (request, reply) => {
  if (!requireInternalToken(request, reply)) return;
  appendState({ type: "eval-result", payload: request.body, at: new Date().toISOString() });
  return { ok: true };
});

const port = Number(process.env.HARNESS_API_PORT ?? 8787);
const host = process.env.HARNESS_API_HOST ?? "127.0.0.1";
const releaseReconcile = await resourceReleases.reconcileResourceReleases();
if (releaseReconcile.store === "unavailable") {
  app.log.error({ operation: "resource_release_reconcile", code: "RELEASE_STORE_UNAVAILABLE" }, "Resource release metadata reconciliation unavailable");
  if (hostedResourcePublishEnabled) throw new Error("RELEASE_STORE_UNAVAILABLE");
}
if (hostedResourcePublishEnabled && !resourceReleases.probeResourceImportArchiveStorage().ok) {
  throw new Error("ARCHIVE_STORAGE_UNAVAILABLE");
}
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

function workspaceJoinSecret(): string | undefined {
  const secret = process.env.WORKSPACE_JOIN_SECRET?.trim() || process.env.HARNESS_WORKSPACE_JOIN_SECRET?.trim() || communityInviteSecret();
  return secret && secret.length >= 24 ? secret : undefined;
}

type WorkspaceJoinSource = "telegram" | "discord" | "entitlement";

function workspaceJoinSource(value: unknown): WorkspaceJoinSource | undefined {
  return value === "telegram" || value === "discord" || value === "entitlement" ? value : undefined;
}

function workspaceJoinPolicyMatchesSource(policy: workspaces.WorkspaceJoinPolicy, source: WorkspaceJoinSource): boolean {
  if (policy.status !== "active") return false;
  if (source === "telegram") return policy.kind === "telegram";
  if (source === "discord") return policy.kind === "discord";
  return policy.kind === "entitlement" || policy.kind === "manual_approval";
}

async function verifyWorkspaceJoinCodeForWorkspace(slugValue: string, bodyValue: unknown): Promise<
  | { ok: true; subjectId: string; source: WorkspaceJoinSource; policy: workspaces.WorkspaceJoinPolicy; expiresAt: string }
  | { ok: false; status: number; error: string; code: string; auditAction: string }
> {
  const slug = workspaces.cleanWorkspaceSlug(slugValue);
  if (!slug) return { ok: false, status: 400, error: "Invalid workspace slug", code: "INVALID_WORKSPACE", auditAction: "join_code_invalid_workspace" };
  const body = bodyValue && typeof bodyValue === "object" ? bodyValue as WorkspaceJoinCodeVerifyRequest & WorkspaceJoinGrantRequest : {};
  if (!body.code) return { ok: false, status: 400, error: "code is required", code: "JOIN_CODE_REQUIRED", auditAction: "join_code_missing" };
  const secret = workspaceJoinSecret();
  if (!secret) return { ok: false, status: 503, error: "Workspace join codes are not configured", code: "WORKSPACE_JOIN_SECRET_MISSING", auditAction: "join_code_secret_missing" };
  const verified = verifyWorkspaceJoinCode({ code: body.code, secret });
  if (!verified.ok) {
    return { ok: false, status: verified.status, error: verified.error, code: verified.status === 410 ? "JOIN_CODE_EXPIRED" : "JOIN_CODE_DENIED", auditAction: verified.status === 410 ? "join_code_expired" : "join_code_denied" };
  }
  if (verified.payload.workspace !== slug) {
    return { ok: false, status: 403, error: "Workspace join code does not belong to this workspace", code: "JOIN_CODE_WORKSPACE_MISMATCH", auditAction: "join_code_workspace_mismatch" };
  }
  const policies = await workspaces.listWorkspaceJoinPolicies(slug);
  if (!policies.ok) return { ok: false, status: policies.status, error: policies.error, code: policies.code, auditAction: "join_code_workspace_unavailable" };
  const policy = policies.policies.find((row) => row.id === verified.payload.policyId && workspaceJoinPolicyMatchesSource(row, verified.payload.source));
  if (!policy) return { ok: false, status: 403, error: "Workspace join policy does not allow this source", code: "JOIN_POLICY_DENIED", auditAction: "join_policy_denied" };
  return {
    ok: true,
    subjectId: verified.payload.subject.id,
    source: verified.payload.source,
    policy,
    expiresAt: new Date(verified.payload.exp * 1000).toISOString()
  };
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

async function requireUser(request: FastifyRequest, reply: FastifyReply, agentScopes?: readonly AgentAuthScope[]): Promise<AuthUser | undefined> {
  const result = await userFromAuthorization(headerValue(request.headers.authorization), agentScopes);
  if (result.user) return result.user;
  if (result.status === 401) {
    reply.header("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl}"`);
  }
  reply.code(result.status ?? 401).send({ error: result.error ?? "Sign in required", code: result.code ?? "AUTH_REQUIRED" });
  return undefined;
}

type AgentMutationClaim =
  | { proceed: true; claim?: { keyHash: string; payloadHash: string } }
  | { proceed: false };

async function claimAgentMutation(
  request: FastifyRequest,
  reply: FastifyReply,
  user: AuthUser,
  route: string,
  payload: unknown
): Promise<AgentMutationClaim> {
  if (user.authKind !== "agent_access") return { proceed: true };
  const result = await agentMutationService.begin({ key: idempotencyKeyFromRequest(request), userId: user.id, route, payload });
  if (result.kind === "claimed") return { proceed: true, claim: { keyHash: result.keyHash, payloadHash: result.payloadHash } };
  if (result.kind === "replay") {
    reply.header("Idempotency-Replayed", "true");
    reply.code(result.response.status).send(result.response.body);
    return { proceed: false };
  }
  if (result.kind === "conflict") {
    reply.code(409).send({ error: "Idempotency-Key was already used with a different payload", code: "IDEMPOTENCY_KEY_CONFLICT" });
    return { proceed: false };
  }
  if (result.kind === "in_progress") {
    reply.code(409).send({
      error: "The original mutation is still running or its final result is indeterminate",
      code: "IDEMPOTENCY_INDETERMINATE",
      next: "Reconcile the resource or workspace state. Do not repeat this mutation automatically."
    });
    return { proceed: false };
  }
  if (result.kind === "unavailable") {
    reply.code(503).send({ error: "Idempotency service unavailable", code: "IDEMPOTENCY_UNAVAILABLE" });
    return { proceed: false };
  }
  reply.code(400).send({ error: "Agent mutations require a 16-200 character Idempotency-Key", code: "IDEMPOTENCY_KEY_REQUIRED" });
  return { proceed: false };
}

async function completeAgentMutation(
  claim: AgentMutationClaim,
  userId: string,
  route: string,
  status: number,
  body: Record<string, unknown>
): Promise<boolean> {
  if (!claim.proceed || !claim.claim) return true;
  return agentMutationService.complete({ ...claim.claim, userId, route, status, body });
}

function idempotencyCommitFailed(reply: FastifyReply) {
  return reply.code(503).send({
    error: "The mutation completed but its replay receipt could not be stored",
    code: "IDEMPOTENCY_COMMIT_FAILED",
    next: "The result is indeterminate. Reconcile the resource or workspace state and do not repeat this mutation automatically."
  });
}

function idempotencyKeyFromRequest(request: FastifyRequest): string | undefined {
  return headerValue(request.headers["idempotency-key"]);
}

async function authenticatePublicResourcePublish(authorization: string | undefined): Promise<AuthResult> {
  if (!authorization) {
    return { status: 401, error: "Sign in required", code: "AUTH_REQUIRED" };
  }
  if (authorization.startsWith(`Bearer ${SUPERSKILL_DEVICE_TOKEN_PREFIX}`)) {
    const managed = await resolveManagedAccess(authorization, {}, superskillAccessResolver, new Date());
    if (managed.ok && managed.evidence === "confirmed_user" && managed.publicGoEligible && /^user:[a-f0-9]{64}$/.test(managed.subject)) {
      return { user: { id: managed.subject, subject: managed.subject, confirmed: true } };
    }
    return {
      status: managed.ok ? 403 : managed.status,
      error: !managed.ok && managed.reasonCode === "SUPERSKILL_AUTH_UNAVAILABLE"
        ? "Authentication service unavailable"
        : "Invalid or expired device session",
      code: !managed.ok && managed.status === 503 ? "AUTH_UNAVAILABLE" : "AUTH_INVALID"
    };
  }

  const signedIn = await userFromAuthorization(authorization, ["resources:publish"]);
  if (!signedIn.user) return signedIn;
  if (!signedIn.user.confirmed) return { status: 403, error: "Email confirmation required", code: "FORBIDDEN" };
  const subjectSalt = process.env.SUPERSKILL_SUBJECT_SALT
    ?? (process.env.NODE_ENV !== "production" ? "onlyharness-local-dev-subject-salt" : "");
  if (Buffer.byteLength(subjectSalt, "utf8") < 32) {
    return { status: 503, error: "Authentication service unavailable", code: "AUTH_UNAVAILABLE" };
  }
  return {
    user: {
      id: signedIn.user.id,
      email: signedIn.user.email,
      confirmed: true,
      subject: superskillUserSubject(signedIn.user.id, subjectSalt)
    }
  };
}

function sendPublicResourcePublishAuthFailure(reply: FastifyReply, auth: AuthResult) {
  if ((auth.status ?? 401) === 401) {
    reply.header("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl}"`);
  }
  return reply.code(auth.status ?? 401).send({
    error: auth.error ?? "Sign in required",
    code: auth.code ?? "AUTH_REQUIRED",
    resource_metadata: resourceMetadataUrl
  });
}

function publicResourcePublishDisabled() {
  return {
    error: "Hosted resource publishing is temporarily unavailable",
    code: "PUBLISH_DISABLED",
    status: 503,
    next: "Retry after hosted archive storage has passed production readiness checks."
  } as const;
}

async function userFromAuthorization(authorization: string | undefined, agentScopes?: readonly AgentAuthScope[]): Promise<AuthResult> {
  const accessToken = authorization?.match(/^Bearer\s+([^\s]{1,8192})$/i)?.[1];
  if (accessToken?.startsWith(AGENT_ACCESS_TOKEN_PREFIX)) {
    if (!agentScopes?.length) {
      return { status: 403, error: "Agent sessions are not accepted for this account route", code: "FORBIDDEN" };
    }
    const agent = await agentAuthService.resolveAccessToken(accessToken, agentScopes);
    if (!agent.ok) {
      if (agent.kind === "unavailable") return { status: 503, error: "Authentication service unavailable", code: "AUTH_UNAVAILABLE" };
      if (agent.kind === "forbidden") return { status: 403, error: "Agent session lacks the required scope", code: "FORBIDDEN" };
      return { status: 401, error: "Invalid or expired session", code: "AUTH_INVALID" };
    }
    return {
      user: {
        id: agent.principal.userId,
        subject: agent.principal.subject,
        confirmed: true,
        authKind: "agent_access",
        clientId: agent.principal.clientId,
        sessionId: agent.principal.sessionId,
        scopes: agent.principal.scopes,
        expiresAt: agent.principal.expiresAt
      }
    };
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    if (process.env.NODE_ENV === "production") {
      return { status: 503, error: "Authentication service unavailable", code: "AUTH_UNAVAILABLE" };
    }
    if (!authorization) return { status: 401, error: "Sign in required", code: "AUTH_REQUIRED" };
    const local = authorization?.match(/^Bearer\s+local:([A-Za-z0-9._:-]{2,80})$/);
    if (!local) return { status: 401, error: "Invalid or expired session", code: "AUTH_INVALID" };
    return { user: { id: local[1], confirmed: true } };
  }
  if (!authorization?.startsWith("Bearer ")) {
    return { status: 401, error: "Sign in required", code: "AUTH_REQUIRED" };
  }
  const identity = await fetchSupabaseAuthIdentity({
    supabaseUrl,
    anonKey: supabaseAnonKey,
    authorization,
    timeoutMs: supabaseAuthTimeout
  });
  if (!identity.ok) {
    return identity.kind === "invalid"
      ? { status: 401, error: "Invalid or expired session", code: "AUTH_INVALID" }
      : { status: 503, error: "Authentication service unavailable", code: "AUTH_UNAVAILABLE" };
  }
  const confirmedAt = typeof identity.user.emailConfirmedAt === "string" ? Date.parse(identity.user.emailConfirmedAt) : Number.NaN;
  return { user: { id: identity.user.id, email: identity.user.email, confirmed: Number.isFinite(confirmedAt) && confirmedAt <= Date.now() } };
}

const publishMarkdownFromMcp: PublishMarkdownHandler = async (body, authorization) => {
  const auth = await userFromAuthorization(authorization, ["resources:publish"]);
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
  const auth = await authenticatePublicResourcePublish(authorization);
  if (!auth.user) {
    return {
      error: auth.error ?? "Authorization required",
      status: auth.status ?? 401,
      code: auth.code ?? "AUTH_REQUIRED",
      resource_metadata: resourceMetadataUrl
    };
  }
  if (!hostedResourcePublishEnabled) return publicResourcePublishDisabled();
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
    archiveUrl: `https://superskill.sh/api/repos/${owner}/${name}/archive?version=${encodeURIComponent(version)}`,
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
      return { status: 200, headers: x402.headers, body: { owner, repo, version: archive.version, snapshot: archive.snapshot, artifactDigest: archive.artifactDigest, totalFileCount: archive.totalFileCount, archiveTruncated: archive.archiveTruncated, files: archive.files } };
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
  return { status: 200, body: { owner, repo, version: archive.version, snapshot: archive.snapshot, artifactDigest: archive.artifactDigest, totalFileCount: archive.totalFileCount, archiveTruncated: archive.archiveTruncated, files: archive.files } };
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
  const tempTarget = path.join(registry.workspaceRoot, "data", `.import-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(path.dirname(target), { recursive: true });
  const tempSource = `${tempTarget}.source.md`;
  try {
    writeFileSync(tempSource, body.markdown);
    const cliCommand = importCliCommand(tempSource, tempTarget, name);
    const cli = spawnSync(cliCommand.command, cliCommand.args, {
      cwd: registry.workspaceRoot,
      encoding: "utf8"
    });
    if (cli.status !== 0) {
      app.log.error({ operation: "markdown_import", processStatus: cli.status, processSignal: cli.signal }, "Markdown import command failed");
      return { status: 500, error: "Markdown import failed", code: "IMPORT_FAILED" };
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
      snapshotVersion: writtenSnapshot?.version,
      ...(licenseWarning ? {
        warnings: [licenseWarning],
        next: "Markdown imports keep license UNSPECIFIED. Publish a verified harness directory with harness.yaml license set before remixing or paid distribution."
      } : {})
    };
  } finally {
    rmSync(tempTarget, { recursive: true, force: true });
    rmSync(tempSource, { force: true });
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
  if ([body.name, body.title, body.summary, body.resourceType, body.sourceUrl, body.version, body.idempotencyKey]
    .some((value) => value !== undefined && typeof value !== "string")
    || (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.some((value) => typeof value !== "string")))
    || (body.worksWith !== undefined && (!Array.isArray(body.worksWith) || body.worksWith.some((value) => typeof value !== "string")))) {
    return { status: 400, error: "Package metadata has invalid field types", code: "VALIDATION_FAILED" };
  }
  const files = Array.isArray(body.files) ? body.files : [];
  if (!files.length) return { status: 400, error: "files are required", code: "VALIDATION_FAILED" };
  if (files.length > 120) return { status: 400, error: "too many files", code: "VALIDATION_FAILED" };

  const temp = path.join(registry.workspaceRoot, "data", `.resource-package-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const safeFiles: Array<{ path: string; content: string }> = [];
  let totalFileBytes = 0;
  try {
    for (const file of files) {
      const safe = safeResourcePackageFile(file);
      if (!safe.ok) return { status: safe.status, error: safe.error, code: "VALIDATION_FAILED" };
      totalFileBytes += Buffer.byteLength(safe.content, "utf8");
      if (totalFileBytes > resourcePackageTotalFileBytes) {
        return { status: 413, error: "Package text files exceed the 8 MiB total limit", code: "VALIDATION_FAILED" };
      }
      safeFiles.push({ path: safe.path, content: safe.content });
    }
    const canonicalValidation = resourceReleases.validateCanonicalResourceFiles(safeFiles);
    if (!canonicalValidation.ok) return { status: 400, error: canonicalValidation.error, code: "VALIDATION_FAILED" };
    const securityScan = scanHarnessFiles(safeFiles, { includeCapabilitySignals: false });
    if (securityScan.verdict === "fail") return securityScanFailure(securityScan);
    for (const file of safeFiles) {
      const target = path.join(temp, file.path);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }

    const readme = safeFiles.find((file) => /(^|\/)readme\.md$/i.test(file.path));
    const requested = body.name ?? body.title ?? (readme ? firstHeading(readme.content) : undefined);
    if (typeof requested !== "string" || !requested) return { status: 400, error: "name or title is required", code: "VALIDATION_FAILED" };
    const metadataScan = scanHarnessFiles([{
      path: "package-metadata.json",
      content: JSON.stringify({ name: body.name, title: body.title, summary: body.summary, sourceUrl: body.sourceUrl, tags: body.tags })
    }], { includeCapabilitySignals: false });
    if (metadataScan.verdict === "fail") return securityScanFailure(metadataScan);
    const name = slugify(requested);
    if (!safePublicHarnessName(name)) return { status: 400, error: "name is not publishable", code: "VALIDATION_FAILED" };

    const resourceType = normalizeResourceType(body.resourceType, safeFiles.map((file) => file.path));
    const title = cleanTitle(body.title) ?? (readme ? firstHeading(readme.content) : undefined) ?? titleizeName(name);
    const summary = cleanSummary(body.summary) ?? `Hosted ${resourceType.replace(/_/g, " ")} package published to SuperSkill.`;
    const worksWith = normalizeWorksWith(body.worksWith, resourceType);
    const sourceUrl = cleanPublicUrl(body.sourceUrl);
    if (body.sourceUrl && !sourceUrl) return { status: 400, error: "sourceUrl must be a public http(s) URL without credentials, query or fragment", code: "VALIDATION_FAILED" };

    const workspaceSlug = options.workspaceSlug ? workspaces.cleanWorkspaceSlug(options.workspaceSlug) : undefined;
    const id = workspaceSlug ? workspaces.workspaceResourceId(workspaceSlug, name) : `onlyharness:packages/${name}`;
    const version = workspaceSlug ? undefined : body.version;
    const idempotencyKey = workspaceSlug ? undefined : body.idempotencyKey;
    if (!workspaceSlug && !resourceReleases.isReleaseSemver(version)) {
      return { status: 400, error: "version must be valid semantic version", code: "VALIDATION_FAILED" };
    }
    if (!workspaceSlug && !resourceReleases.isValidIdempotencyKey(idempotencyKey)) {
      return { status: 400, error: "idempotencyKey must be 16-200 safe characters", code: "VALIDATION_FAILED" };
    }
    if (!workspaceSlug) {
      const existingCatalogEntry = resources.readResourceCatalog().resources.some((resource) => resource.id === id);
      if (existingCatalogEntry && !resourceReleases.resourceReleaseOwnerSubject(id)) {
        return {
          status: 409,
          error: "Existing hosted resource ownership has not completed durable migration",
          code: "PUBLISH_CONFLICT",
          next: "Choose a new resource name or ask an operator to complete the legacy ownership inventory."
        };
      }
    }
    let archiveTemp: string | undefined;
    if (workspaceSlug) try {
      const archiveRoot = workspaces.workspaceResourceArchiveRoot(workspaceSlug);
      const archivePath = path.join(archiveRoot, `${resources.resourceArchiveKey(id)}.tar.gz`);
      archiveTemp = path.join(archiveRoot, `${resources.resourceArchiveKey(id)}.${Date.now()}.tmp`);
      const tar = spawnSync("tar", ["-czf", archiveTemp, "-C", temp, "."], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
      if (tar.status !== 0) {
        rmSync(archiveTemp, { force: true });
        app.log.error({ operation: "resource_archive_create", processStatus: tar.status, processSignal: tar.signal }, "Hosted resource archive creation failed");
        return archiveStorageUnavailable();
      }
      renameSync(archiveTemp, archivePath);
    } catch (error) {
      if (archiveTemp) rmSync(archiveTemp, { force: true });
      app.log.error({ operation: "resource_archive_commit", errorCode: filesystemErrorCode(error) }, "Hosted resource archive storage unavailable");
      return archiveStorageUnavailable();
    }

    const now = new Date().toISOString();
    const signals = { stars: 0, opens: 0, imports: 1, installs: 0, threads: 0, passedGates: 0 };
    const canonicalUrl = workspaceSlug
      ? `https://superskill.sh/#/superskill/workspaces?workspace=${encodeURIComponent(workspaceSlug)}&resource=${encodeURIComponent(name)}`
      : `https://superskill.sh/#/superskill/resources/${encodeURIComponent(id)}`;
    const archiveUrl = workspaceSlug
      ? `https://superskill.sh/api/workspaces/${encodeURIComponent(workspaceSlug)}/resources/${encodeURIComponent(name)}/archive`
      : `https://superskill.sh/api/resources/${encodeURIComponent(id)}/releases/${encodeURIComponent(version!)}/archive`;
    const tags = dedupeStrings([resourceType, "hosted", "agent-resource", ...(body.tags ?? [])]);
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
      creatorName: options.workspaceName ?? "SuperSkill publisher",
      licenseStatus: "unknown",
      sourceCheckedAt: now,
      sourceCheckMethod: "manual_research",
      sourceCheckStatus: "active",
      lastSeenAt: now,
      installability: "importable",
      tags,
      worksWith,
      upstreamPopularity: { sourceLabel: "SuperSkill hosted resource package" },
      onlyHarnessSignals: signals,
      trust: { sourceChecked: true, securityScan: securityScan.verdict, riskTier: resourceRiskTier(securityScan.verdict) },
      actions: [
        { id: "open_onlyharness", label: "Use in SuperSkill", url: canonicalUrl },
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
    let release: resourceReleases.ResourceRelease | undefined;
    let replay = false;
    if (workspaceSlug) {
      workspaces.upsertWorkspaceResource(workspaceSlug, resource);
    } else {
      const payloadDigest = resourceReleases.canonicalPayloadDigest({
        name,
        version: version!,
        resourceType,
        title,
        summary,
        sourceUrl,
        worksWith,
        tags,
        files: safeFiles
      });
      const committed = await resourceReleases.commitResourceRelease({
        resource,
        version: version!,
        idempotencyKey: idempotencyKey!,
        ownerSubject: user.subject!,
        payloadDigest,
        files: safeFiles
      });
      if (!committed.ok) return committed;
      release = committed.release;
      replay = committed.replay;
    }
    if (workspaceSlug || !replay) {
      await recordEvent({ kind: "applied", owner: workspaceSlug ? `@${workspaceSlug}` : "onlyharness", repo: name, subject: workspaceSlug ? eventSubject(user.id) : user.subject, target: workspaceSlug ? "workspace_resource_package" : "resource_package", client: "api" });
      appendState({
        type: workspaceSlug ? "workspace_resource_package_import" : "resource_package_import",
        id,
        name,
        resourceType,
        archiveStorageKey: workspaceSlug ? resources.resourceArchiveKey(id) : release?.storageKey,
        files: safeFiles.length,
        subject: workspaceSlug ? eventSubject(user.id) : user.subject,
        workspace: workspaceSlug,
        actor: options.actorLabel,
        sourceUrl,
        at: now
      });
    }
    return {
      resource,
      resourceId: id,
      version: release?.version,
      artifactDigest: release?.artifactDigest,
      size: release?.archiveSize,
      trust: release?.trust ?? "unreviewed",
      replay,
      archive: {
        url: archiveUrl,
        fileName: resources.resourceArchiveFileName(resource)
      },
      archiveUrl,
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

function archiveStorageUnavailable() {
  return {
    status: 503,
    error: "Hosted resource archive storage is temporarily unavailable",
    code: "ARCHIVE_STORAGE_UNAVAILABLE",
    next: "Retry later. No resource package was published."
  } as const;
}

function resolveWorkspaceApprovalResource(
  body: WorkspaceResourceApproveRequest,
  registryItems: ReturnType<typeof registry.scanRegistry>
):
  | { ok: true; resource: resources.Resource; pinnedVersion?: string; pinnedArchiveHash?: string }
  | { ok: false; status: number; error: string; code: string } {
  const publicResource = body.resourceId ? resources.resourceDetail(body.resourceId, registryItems) : undefined;
  if (!publicResource) return { ok: false, status: 404, error: "Public resource not found", code: "RESOURCE_NOT_FOUND" };

  const hasVersion = body.resourceVersion !== undefined;
  const hasDigest = body.artifactDigest !== undefined;
  if (!hasVersion && !hasDigest) return { ok: true, resource: publicResource };
  if (!hasVersion || !hasDigest) {
    return {
      ok: false,
      status: 400,
      error: "resourceVersion and artifactDigest must be provided together",
      code: "RESOURCE_RELEASE_PIN_INCOMPLETE"
    };
  }

  const version = typeof body.resourceVersion === "string" ? body.resourceVersion.trim() : "";
  const artifactDigest = typeof body.artifactDigest === "string" ? body.artifactDigest.trim() : "";
  if (!resourceReleases.isReleaseSemver(version) || !/^[a-f0-9]{64}$/.test(artifactDigest)) {
    return {
      ok: false,
      status: 400,
      error: "resourceVersion must be semantic version and artifactDigest must be a lowercase SHA-256 hex digest",
      code: "INVALID_RESOURCE_RELEASE_PIN"
    };
  }

  const metadata = resourceReleases.activeReleaseMetadata(publicResource.id, version);
  if (!metadata) {
    return {
      ok: false,
      status: 404,
      error: "Exact public resource release not found",
      code: "RESOURCE_RELEASE_NOT_FOUND"
    };
  }
  const exact = resourceReleases.activeReleaseDetail(publicResource.id, version);
  if (!exact) {
    return {
      ok: false,
      status: 503,
      error: "Exact public resource archive storage unavailable",
      code: "ARCHIVE_STORAGE_UNAVAILABLE"
    };
  }
  if (exact.release.artifactDigest !== artifactDigest) {
    return {
      ok: false,
      status: 409,
      error: "artifactDigest does not match the exact public resource release",
      code: "RESOURCE_RELEASE_DIGEST_MISMATCH"
    };
  }
  return {
    ok: true,
    resource: exact.resource,
    pinnedVersion: exact.release.version,
    pinnedArchiveHash: exact.release.artifactDigest
  };
}

function resourceRiskTier(verdict: "pass" | "warn" | "fail"): "UNKNOWN" | "CRITICAL" {
  // static-v2 detects dangerous signatures; it does not infer complete
  // permissions or runtime capability risk for an arbitrary uploaded package.
  if (verdict !== "fail") return "UNKNOWN";
  return "CRITICAL";
}

function securityScanFailure(scan: ReturnType<typeof scanHarnessFiles>) {
  return {
    status: 422,
    error: "Package failed the static security scan and was not published",
    code: "SECURITY_SCAN_FAILED",
    failures: [...new Set(scan.findings
      .filter((finding) => finding.severity === "fail")
      .map((finding) => `${finding.rule}:${finding.file}`))]
  } as const;
}

function filesystemErrorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "UNKNOWN";
  const code = String((error as { code?: unknown }).code ?? "UNKNOWN");
  return /^[A-Z0-9_]{1,40}$/.test(code) ? code : "UNKNOWN";
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
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(?:md|mdx|txt|ya?ml)$/i.test(file) && !/^(?:secrets?|private|credentials?)(?:\.|$)/i.test(file)) return true;
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
  if (segments.some((segment) => /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519|known_hosts)(?:\.|$)/.test(segment)
    || /^(?:secrets?|private|credentials?)(?:[._-]|$)/.test(segment))) return true;
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
  if (typeof value !== "string") return undefined;
  const clean = value?.trim().replace(/\s+/g, " ");
  return clean && clean.length <= 120 ? clean : undefined;
}

function cleanSummary(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value?.trim().replace(/\s+/g, " ");
  return clean && clean.length <= 500 ? clean : undefined;
}

function cleanPublicUrl(value: string | undefined): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    if (url.username || url.password || url.search || url.hash) return undefined;
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

function publicWorkspaceJoinPolicy(policy: workspaces.WorkspaceJoinPolicy) {
  return {
    id: policy.id,
    workspaceId: policy.workspace_id,
    workspaceSlug: policy.workspace_slug,
    kind: policy.kind,
    status: policy.status,
    role: policy.role,
    title: policy.title ?? null,
    instructions: policy.instructions ?? null,
    config: policy.config,
    createdAt: policy.created_at,
    updatedAt: policy.updated_at
  };
}

function publicWorkspaceSubscription(subscription: workspaceSubscriptions.WorkspaceSubscription) {
  return {
    id: subscription.id,
    workspaceSlug: subscription.workspace_slug,
    userId: subscription.user_id,
    policyId: subscription.policy_id,
    provider: subscription.provider,
    providerSubscriptionRef: subscription.provider_subscription_ref,
    status: subscription.status,
    currentPeriodStart: subscription.current_period_start ?? null,
    currentPeriodEnd: subscription.current_period_end ?? null,
    graceUntil: subscription.grace_until ?? null,
    accessUntil: subscription.access_until ?? null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: subscription.canceled_at ?? null,
    checkoutUrl: subscription.checkout_url ?? null,
    portalUrl: subscription.portal_url ?? null,
    createdAt: subscription.created_at,
    updatedAt: subscription.updated_at
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
  const canBeUserBearer = Boolean(authorization?.startsWith("Bearer ")) && (Boolean(supabaseUrl && supabaseAnonKey) || authorization?.startsWith("Bearer local:") || authorization?.startsWith(`Bearer ${AGENT_ACCESS_TOKEN_PREFIX}`));
  if (!canBeUserBearer) return tokenAuth;

  const methodMutates = request.method !== "GET" && request.method !== "HEAD";
  const scopeMutates = requiredScopes.some((scope) => !scope.endsWith(":read") && scope !== "gate:verify");
  const mutating = methodMutates && scopeMutates;
  const agentScopes: AgentAuthScope[] = [mutating ? "workspaces:write" : "workspaces:read"];
  if (requiredScopes.includes("resource:publish")) agentScopes.push("resources:publish");
  const userAuth = await userFromAuthorization(authorization, agentScopes);
  if (!userAuth.user) {
    return { ok: false, status: userAuth.status ?? 401, error: userAuth.error ?? "Sign in required", slug, auditAction: "workspace_member_auth_failed" };
  }
  return workspaces.authorizeWorkspaceMember(slug, userAuth.user.id, requiredScopes);
}

function workspaceAuthSubject(auth: workspaces.WorkspaceAuthResult): string {
  return auth.ok && auth.userId ? eventSubject(auth.userId) : eventSubject(undefined);
}

function workspaceAuthFailure(auth: Extract<workspaces.WorkspaceAuthResult, { ok: false }>) {
  const code = auth.auditAction === "workspace_member_expired"
    ? "WORKSPACE_MEMBERSHIP_EXPIRED"
    : auth.auditAction === "workspace_role_denied"
      ? "WORKSPACE_ROLE_FORBIDDEN"
      : auth.auditAction === "workspace_member_denied"
        ? "WORKSPACE_MEMBERSHIP_REQUIRED"
        : auth.status === 401
          ? "AUTH_REQUIRED"
          : auth.status === 403
            ? "WORKSPACE_ACCESS_DENIED"
            : auth.status === 404
              ? "WORKSPACE_NOT_FOUND"
              : "WORKSPACE_UNAVAILABLE";
  return { error: auth.error, code };
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
