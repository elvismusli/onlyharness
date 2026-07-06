import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import YAML from "yaml";
import { riskMarkdown, type HarnessManifest, type RiskReport } from "@harnesshub/schema";
import { diffHarnessDirs, semanticDiffMarkdown } from "@harnesshub/semantic-diff";
import { decodePaymentSignatureHeader, encodePaymentResponseHeader, HTTPFacilitatorClient } from "@x402/core/http";
import type { PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from "@x402/core/types";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer, type PublishMarkdownHandler, type PullHarnessHandler } from "./mcp.js";
import { createCommunityInviteCode, verifyCommunityInviteCode } from "./community.js";
import { openapi } from "./openapi.js";
import { recordEvent, sanitizeEvent } from "./events.js";
import { appendOrgAudit, authorizeAnyOrgToken, authorizeOrgToken, readOrgAudit, readOrgBundle } from "./orgs.js";
import { checkEntitlement, createCheckoutSession, requireArchivePaymentAccess, settlePaymentWebhook, settleX402Purchase, x402PaymentRequiredHeader, type EntitlementSubject, type PaymentRequiredBody, type X402PaymentRequirements } from "./payments.js";
import { fetchCountersMap } from "./social.js";
import { fetchMyStorefront, fetchStorefrontByHandle, resolveCheckoutAttribution, upsertHarnessCreator, upsertStorefrontProfile } from "./storefront.js";
import * as registry from "./registry.js";

const statePath = path.resolve(process.env.HARNESS_STATE_PATH ?? path.join(registry.workspaceRoot, "data/harness-state.json"));
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseRestKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? supabaseAnonKey;
const webhookToken = process.env.HARNESS_WEBHOOK_TOKEN;
const corsOrigins = parseCsv(process.env.HARNESS_CORS_ORIGINS);
const orgsEnabled = process.env.ORGS_ENABLED === "true";
const resourceMetadataUrl = "https://onlyharness.com/.well-known/oauth-protected-resource";

type ImportRequest = {
  name?: string;
  markdown: string;
};

type ImportOptions = {
  orgSlug?: string;
  owner?: string;
};

type CheckoutRequest = {
  owner?: string;
  repo?: string;
  version?: string;
  ref?: string;
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

const app = Fastify({ logger: true });
await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || isAllowedOrigin(origin)) return callback(null, true);
    return callback(null, false);
  }
});

app.get("/healthz", async () => ({ ok: true, workspaceRoot: registry.workspaceRoot }));

app.get("/openapi.json", async () => openapi);

app.get("/registry", async (request) => {
  const query = request.query as { q?: string; risk?: string; eval?: string; runtime?: string; outcome?: string; sort?: string };
  const counters = await fetchCountersMap();
  return { items: registry.searchRegistry(query, counters) };
});

app.get("/leaderboard", async (request) => {
  const query = request.query as { limit?: string };
  const limit = Math.min(Number(query.limit ?? 10), 50);
  const counters = await fetchCountersMap();
  return { items: registry.sortRegistry(registry.scanRegistry(counters), "heat").slice(0, limit) };
});

app.get("/repos/:owner/:repo/harness", async (request, reply) => {
  const { owner, repo } = request.params as { owner: string; repo: string };
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const { inspection, evalResult, security, contextCost, standard } = registry.registryDetailBasics(root);
  const orgGate = gateOrgVisibility(owner, inspection.manifest, headerValue(request.headers.authorization), "detail");
  if (!orgGate.ok) return reply.code(orgGate.status).send({ error: orgGate.error });
  const counters = await fetchCountersMap();
  const item = registry.registryItemFromDir(owner, root, counters);
  return {
    owner,
    repo,
    root,
    forgeUrl: owner === "harnesses" ? `${process.env.GITEA_BASE_URL ?? "http://127.0.0.1:3000"}/${owner}/${repo}` : `file://${root}`,
    social: item ? registry.socialFromItem(item) : undefined,
    thread: await fetchThreadPosts(owner, repo),
    example: registry.readExample(root),
    files: registry.listHarnessFiles(root),
    ...inspection,
    evalResult,
    security,
    contextCost,
    standard,
    readme: registry.readMaybe(path.join(root, "README.md")),
    prReview: samplePrReview(root)
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
  const orgGate = gateOrgVisibility(owner, manifest, headerValue(request.headers.authorization), "checkout");
  if (!orgGate.ok) return reply.code(orgGate.status).send({ error: orgGate.error });
  const archive = registry.buildArchiveForVersion(owner, repo, root, body.version);
  if (!archive) return reply.code(404).send({ error: "Harness version not found" });
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

app.get("/entitlements/check", async (request, reply) => {
  if (!orgsEnabled) return reply.code(404).send({ error: "Entitlement checks are not enabled" });
  const token = orgTokenFromRequest(request);
  const auth = authorizeAnyOrgToken(token, ["entitlements:read"]);
  if (!auth.ok) {
    appendOrgAudit({ slug: auth.slug ?? "unknown", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "entitlements_check" });
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
    appendOrgAudit({ slug: auth.org.slug, action: orgGate.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: `${harness.owner}/${harness.repo}` });
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
  appendOrgAudit({ slug: auth.org.slug, action: "entitlement_check_read", tokenName: auth.tokenName, subject: `${subject.type}:${subject.id}`, target: `${harness.owner}/${harness.repo}@${archive.version}` });
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
  const auth = authorizeAnyOrgToken(token, ["entitlements:read"]);
  if (!auth.ok) {
    appendOrgAudit({ slug: auth.slug ?? "unknown", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "community_code" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const secret = communityInviteSecret();
  if (!secret) return reply.code(503).send({ error: "Community invite codes are not configured" });
  const body = request.body && typeof request.body === "object" ? request.body as CommunityVerifyRequest : {};
  if (!body.code) return reply.code(400).send({ error: "code is required" });
  const verified = verifyCommunityInviteCode({ code: body.code, secret });
  if (!verified.ok) {
    appendOrgAudit({ slug: auth.org.slug, action: verified.status === 410 ? "community_code_expired" : "community_code_denied", tokenName: auth.tokenName, subject: eventSubject(undefined), target: "community_code" });
    return reply.code(verified.status).send({ error: verified.error });
  }

  const { owner, repo, version, subject } = verified.payload;
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const manifest = registry.registryDetailBasics(root).inspection.manifest;
  if (!manifest) return reply.code(500).send({ error: "Harness manifest unavailable" });
  const orgGate = gateEntitlementCheckVisibility(owner, manifest, auth.org.slug);
  if (!orgGate.ok) {
    appendOrgAudit({ slug: auth.org.slug, action: orgGate.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: `${owner}/${repo}` });
    return reply.code(orgGate.status).send({ error: orgGate.error });
  }
  const archive = registry.buildArchiveForVersion(owner, repo, root, version);
  if (!archive) return reply.code(404).send({ error: "Harness version not found" });
  const entitlement = await checkEntitlement({ owner, repo, version: archive.version, manifest, subject });
  appendOrgAudit({ slug: auth.org.slug, action: "community_code_verified", tokenName: auth.tokenName, subject: `${subject.type}:${subject.id}`, target: `${owner}/${repo}@${archive.version}` });
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

app.get("/orgs/:slug/bundle", async (request, reply) => {
  if (!orgsEnabled) return reply.code(404).send({ error: "Org setup is not enabled" });
  const { slug } = request.params as { slug: string };
  const token = orgTokenFromRequest(request);
  const result = readOrgBundle(slug, token);
  if (!result.ok) {
    appendOrgAudit({ slug: result.slug ?? "invalid", action: result.auditAction, tokenName: result.tokenName, subject: eventSubject(undefined), target: "setup" });
    return reply.code(result.status).send({ error: result.error });
  }
  appendOrgAudit({ slug: result.org.slug, action: "bundle_read", tokenName: result.tokenName, subject: eventSubject(undefined), target: "setup" });
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
  const auth = authorizeOrgToken(slug, token, ["read", "setup", "publish"]);
  if (!auth.ok) {
    appendOrgAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "workspace" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const counters = await fetchCountersMap();
  const owner = `@${auth.org.slug}`;
  const items = registry.sortRegistry(registry.scanHarnessRoot(owner, registry.orgImportRoot(auth.org.slug), counters), "new");
  appendOrgAudit({ slug: auth.org.slug, action: "workspace_read", tokenName: auth.tokenName, subject: eventSubject(undefined), target: "network_neighborhood" });
  return {
    organization: {
      slug: auth.org.slug,
      name: auth.org.name,
      plan: auth.org.plan
    },
    items,
    permissions: orgWorkspacePermissionsSummary(items),
    audit: readOrgAudit(auth.org.slug, 80)
  };
});

app.post("/orgs/:slug/imports/markdown-to-harness", async (request, reply) => {
  if (!orgsEnabled) return reply.code(404).send({ error: "Org publishing is not enabled" });
  const { slug } = request.params as { slug: string };
  const token = orgTokenFromRequest(request);
  const auth = authorizeOrgToken(slug, token, ["publish"]);
  if (!auth.ok) {
    appendOrgAudit({ slug: auth.slug ?? "invalid", action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target: "publish" });
    return reply.code(auth.status).send({ error: auth.error });
  }
  const body = request.body as ImportRequest;
  const result = await importMarkdownToHarness(body, { id: `org:${auth.org.slug}` }, { orgSlug: auth.org.slug, owner: `@${auth.org.slug}` });
  if ("error" in result) return reply.code(result.status ?? 500).send({ error: result.error });
  appendOrgAudit({ slug: auth.org.slug, action: "publish_import", tokenName: auth.tokenName, subject: eventSubject(undefined), target: result.item?.name });
  return result;
});

app.get("/repos/:owner/:repo/thread", async (request, reply) => {
  const { owner, repo } = request.params as { owner: string; repo: string };
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const manifest = registry.registryDetailBasics(root).inspection.manifest;
  const orgGate = gateOrgVisibility(owner, manifest, headerValue(request.headers.authorization), "thread");
  if (!orgGate.ok) return reply.code(orgGate.status).send({ error: orgGate.error });
  return { items: await fetchThreadPosts(owner, repo) };
});

app.get("/repos/:owner/:repo/security-report", async (request, reply) => {
  const { owner, repo } = request.params as { owner: string; repo: string };
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const { inspection, security } = registry.registryDetailBasics(root);
  const orgGate = gateOrgVisibility(owner, inspection.manifest, headerValue(request.headers.authorization), "security");
  if (!orgGate.ok) return reply.code(orgGate.status).send({ error: orgGate.error });
  return security;
});

app.get("/prs/:owner/:repo/:number/semantic-diff", async (request, reply) => {
  const { owner, repo } = request.params as { owner: string; repo: string; number: string };
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return reply.code(404).send({ error: "Harness not found" });
  const manifest = registry.registryDetailBasics(root).inspection.manifest;
  const orgGate = gateOrgVisibility(owner, manifest, headerValue(request.headers.authorization), "semantic_diff");
  if (!orgGate.ok) return reply.code(orgGate.status).send({ error: orgGate.error });
  return samplePrReview(root);
});

app.post("/mcp", async (request, reply) => {
  const server = buildMcpServer({
    publishMarkdown: publishMarkdownFromMcp,
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
  await recordEvent({ kind: "purchase", owner: result.owner, repo: result.repo, version: result.version, subject: eventSubject(result.subject_id), target: "webhook", client: "api" });
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
  if (!supabaseUrl || !supabaseAnonKey) return { user: { id: "local-dev" } };
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

const pullHarnessFromMcp: PullHarnessHandler = async ({ owner, name, version }, authorization) => {
  const result = await archiveForClient(owner, name, version, authorization, "mcp");
  if (result.status === 200) return result.body;
  const body = result.body && typeof result.body === "object" ? result.body as { error?: string } : {};
  return {
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
  const version = detail.manifest?.version ?? "current";
  const pricing = detail.manifest?.pricing;
  return {
    command: `npx onlyharness pull ${owner}/${name}`,
    localCommand: `node packages/harness-cli/dist/hh.mjs pull ${owner}/${name}`,
    archiveUrl: `https://onlyharness.com/api/repos/${owner}/${name}/archive?version=${encodeURIComponent(version)}`,
    contextCost: detail.contextCost,
    payment: pricing && pricing.model !== "free"
      ? { required: true, pricing, tokenEnv: "HH_TOKEN", paymentExitCode: 5 }
      : { required: false },
    next: [`hh run ${name} --json`, `hh eval ${name} --json`, `hh gate --dir ${name} --json`]
  };
};

async function harnessDetailPayload(owner: string, repo: string, authorization: string | undefined) {
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return { status: 404, error: "Harness not found" };
  const { inspection, evalResult, security, contextCost, standard } = registry.registryDetailBasics(root);
  const orgGate = gateOrgVisibility(owner, inspection.manifest, authorization, "detail");
  if (!orgGate.ok) return { status: orgGate.status, error: orgGate.error };
  const counters = await fetchCountersMap();
  const item = registry.registryItemFromDir(owner, root, counters);
  return {
    owner,
    name: repo,
    social: item ? registry.socialFromItem(item) : undefined,
    manifest: inspection.manifest,
    valid: inspection.valid,
    issues: inspection.issues,
    risk: inspection.risk,
    security,
    contextCost,
    standard,
    evalResult,
    example: registry.readExample(root),
    files: registry.listHarnessFiles(root)
  };
}

async function archiveForClient(owner: string, repo: string, version: string | undefined, authorization: string | undefined, client: "api" | "mcp", paymentSignature?: string): Promise<ArchiveClientResponse> {
  const root = registry.resolveHarnessPath(owner, repo);
  if (!root) return { status: 404, body: { error: "Harness not found" } };
  const manifest = registry.registryDetailBasics(root).inspection.manifest;
  if (!manifest) return { status: 500, body: { error: "Harness manifest unavailable" } };
  const orgGate = gateOrgVisibility(owner, manifest, authorization, "archive");
  if (!orgGate.ok) return { status: orgGate.status, body: { error: orgGate.error } };
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
    const x402 = paymentSignature
      ? await settleX402ArchivePayment({ owner, repo, version: archive.version, manifest, paymentRequired: payment.body, paymentSignature })
      : undefined;
    if (x402?.ok) {
      await recordEvent({ kind: "purchase", owner, repo, version: archive.version, subject: `wallet:${x402.payer}`, target: "x402", client });
      await recordEvent({ kind: "pull", owner, repo, version: archive.version, subject: `wallet:${x402.payer}`, target: "archive", client });
      return { status: 200, headers: x402.headers, body: { owner, repo, version: archive.version, snapshot: archive.snapshot, files: archive.files } };
    }
    await recordEvent({ kind: "checkout", owner, repo, version: archive.version, subject: eventSubject(auth.user?.id), target: "archive", client });
    return { status: payment.status, body: payment.body };
  }
  await recordEvent({ kind: "pull", owner, repo, version: archive.version, subject: eventSubject(auth.user?.id), target: "archive", client });
  return { status: 200, body: { owner, repo, version: archive.version, snapshot: archive.snapshot, files: archive.files } };
}

async function settleX402ArchivePayment(input: {
  owner: string;
  repo: string;
  version: string;
  manifest: HarnessManifest;
  paymentRequired: PaymentRequiredBody;
  paymentSignature: string;
}): Promise<{ ok: true; payer: string; headers: Record<string, string> } | { ok: false }> {
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
  }
  return {
    ok: true,
    payer,
    headers: {
      "PAYMENT-RESPONSE": encodePaymentResponseHeader(settle)
    }
  };
}

async function importMarkdownToHarness(body: ImportRequest, user: AuthUser, options: ImportOptions = {}) {
  if (!body?.markdown || body.markdown.length < 20) {
    return { status: 400, error: "markdown must be at least 20 characters" };
  }
  const name = slugify(body.name ?? firstHeading(body.markdown) ?? "imported-harness");
  const owner = options.owner ?? "local";
  const target = options.orgSlug ? path.join(registry.orgImportRoot(options.orgSlug), name) : path.join(registry.importRoot, name);
  mkdirSync(path.dirname(target), { recursive: true });
  const tempSource = path.join(registry.workspaceRoot, "data", `${name}.source.md`);
  writeFileSync(tempSource, body.markdown);
  const cliCommand = importCliCommand(tempSource, target, name);
  const cli = spawnSync(cliCommand.command, cliCommand.args, {
    cwd: registry.workspaceRoot,
    encoding: "utf8"
  });
  if (cli.status !== 0) {
    return { status: 500, error: cli.stderr || cli.stdout || "import failed" };
  }
  if (options.orgSlug) applyOrgManifest(target, options.orgSlug);
  const item = registry.registryItemFromDir(owner, target, new Map());
  const snapshot = registry.writeArchiveSnapshot(owner, name, target);
  if (!options.orgSlug) await upsertHarnessCreator("local", name, user.id);
  await recordEvent({ kind: "applied", owner, repo: name, version: snapshot?.version, subject: eventSubject(user.id), target: "publish", client: "api" });
  appendState({ type: "import", name, target, userId: user.id, at: new Date().toISOString() });
  return { item, output: cli.stdout, snapshotVersion: snapshot?.version };
}

function applyOrgManifest(root: string, orgSlug: string) {
  const manifestPath = path.join(root, "harness.yaml");
  const manifest = YAML.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.schemaVersion = "harness.v0.2";
  manifest.visibility = "org";
  manifest.org = orgSlug;
  writeFileSync(manifestPath, YAML.stringify(manifest));
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

function orgTokenFromAuthorization(authorization: string | undefined): string | undefined {
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
}

function gateOrgVisibility(owner: string, manifest: HarnessManifest | undefined, authorization: string | undefined, target: string):
  | { ok: true }
  | { ok: false; status: number; error: string } {
  if (owner.startsWith("@") && manifest?.visibility !== "org") return { ok: false, status: 403, error: "Org harness visibility mismatch" };
  if (manifest?.visibility === "private") return { ok: false, status: 403, error: "Private harness is not available through this API" };
  if (manifest?.visibility !== "org") return { ok: true };
  if (!orgsEnabled) return { ok: false, status: 404, error: "Org access is not enabled" };
  const slug = manifest.org;
  if (!slug || owner !== `@${slug}`) return { ok: false, status: 403, error: "Org harness owner mismatch" };
  const auth = authorizeOrgToken(slug, orgTokenFromAuthorization(authorization), ["read", "setup", "publish"]);
  if (!auth.ok) {
    appendOrgAudit({ slug: auth.slug ?? slug, action: auth.auditAction, tokenName: auth.tokenName, subject: eventSubject(undefined), target });
    return { ok: false, status: auth.status, error: auth.error };
  }
  appendOrgAudit({ slug: auth.org.slug, action: `${target}_read`, tokenName: auth.tokenName, subject: eventSubject(undefined), target: manifest.name });
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

function supabaseRestHeaders() {
  return {
    apikey: supabaseRestKey ?? "",
    authorization: `Bearer ${supabaseRestKey ?? ""}`
  };
}

function eventSubject(userId: string | undefined): string {
  return userId ? `user:${userId}` : "anonymous";
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

function samplePrReview(root: string) {
  const base = root;
  const head = createReviewVariant(root);
  const diff = diffHarnessDirs(base, head);
  return {
    number: 0,
    title: "Demo: tighten workflow and permission profile",
    demo: true,
    status: diff.status,
    markdown: semanticDiffMarkdown(diff),
    diff
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
