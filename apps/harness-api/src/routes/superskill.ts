import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { capabilityIdSchema, clientSchema, exactHandoffDecisionRequestSchema, recommendationRequestSchema, type ManagedCapability } from "@harnesshub/capability-schema/browser";
import { ManagedCatalog, ManagedCatalogError } from "../capabilities.js";
import { buildManagedArchive, ManagedArchiveError, type ManagedArchivePayload } from "../managed-archive.js";
import { digestCanonicalJson, exactHandoffDecision, recommendCapabilities, RecommendationValidationError } from "../recommendations.js";
import {
  createSupabaseSuperskillAccessResolver,
  SUPERSKILL_MANAGED_SCOPE,
  type SuperskillAccessResolver
} from "../superskill/access.js";
import {
  buildSuperSkillBootstrapManifest,
  loadSuperSkillBootstrapContract,
  type SuperSkillBootstrapContract
} from "../superskill/bootstrap.js";
import { evaluateManagedEligibility } from "../trust-policy.js";

export type SuperskillRouteOptions = {
  catalog?: ManagedCatalog;
  enabled?: boolean;
  tokenHashes?: string[];
  telemetrySalt?: string;
  now?: () => Date;
  archiveBuilder?: (capability: ManagedCapability) => ManagedArchivePayload;
  accessResolver?: SuperskillAccessResolver;
  bootstrapContract?: SuperSkillBootstrapContract;
};

export type SuperskillAuth = { ok: true; subject: string } | { ok: false; status: 401 | 403; reasonCode: "SUPERSKILL_AUTH_REQUIRED" | "INTERNAL_ALPHA_DENIED" };

export type SuperskillManagedAuth = {
  ok: true;
  subject: string;
  evidence: "confirmed_user" | "legacy_alpha";
  publicGoEligible: boolean;
} | {
  ok: false;
  status: 401 | 403 | 503;
  reasonCode:
    | "SUPERSKILL_AUTH_REQUIRED"
    | "SUPERSKILL_AUTH_INVALID"
    | "SUPERSKILL_EMAIL_UNCONFIRMED"
    | "SUPERSKILL_ACCESS_DENIED"
    | "SUPERSKILL_AUTH_UNAVAILABLE";
};

export function superskillAuthFromHeader(authorization: string | undefined, options: Pick<SuperskillRouteOptions, "tokenHashes" | "telemetrySalt"> = {}): SuperskillAuth {
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return { ok: false, status: 401, reasonCode: "SUPERSKILL_AUTH_REQUIRED" };
  const token = match[1];
  const digest = createHash("sha256").update(token).digest("hex");
  const configured = options.tokenHashes ?? parseTokenHashes(process.env.SUPERSKILL_TOKEN_HASHES);
  const allowed = configured.some((expected) => safeHashEqual(expected, digest));
  if (!allowed) return { ok: false, status: 403, reasonCode: "INTERNAL_ALPHA_DENIED" };
  const salt = options.telemetrySalt ?? process.env.SUPERSKILL_TELEMETRY_SALT ?? "";
  const subject = `pilot:${createHmac("sha256", salt).update(token).digest("hex").slice(0, 32)}`;
  return { ok: true, subject };
}

export async function registerSuperskillRoutes(app: FastifyInstance, options: SuperskillRouteOptions = {}): Promise<void> {
  const catalog = options.catalog ?? new ManagedCatalog();
  const enabled = options.enabled ?? process.env.SUPERSKILL_ENABLED === "true";
  const now = options.now ?? (() => new Date());
  const archiveBuilder = options.archiveBuilder ?? buildManagedArchive;
  const accessResolver = options.accessResolver ?? createSupabaseSuperskillAccessResolver();
  const bootstrapContract = options.bootstrapContract ?? loadSuperSkillBootstrapContract();
  const cacheControl = "public, max-age=60, stale-while-revalidate=300";

  app.get("/superskill/install", async (_request, reply) => {
    if (bootstrapContract.installer.releaseStatus !== "published") return reply.code(503).send({ error: "SuperSkill bootstrap release is not published", code: "BOOTSTRAP_RELEASE_UNPUBLISHED" });
    reply.header("Cache-Control", cacheControl);
    secureBootstrapReply(reply);
    return buildSuperSkillBootstrapManifest(bootstrapContract);
  });

  app.get("/superskill/install/:id/:version/:digest", async (request, reply) => {
    if (bootstrapContract.installer.releaseStatus !== "published") return reply.code(503).send({ error: "SuperSkill bootstrap release is not published", code: "BOOTSTRAP_RELEASE_UNPUBLISHED" });
    const { id, version, digest } = request.params as { id: string; version: string; digest: string };
    if (!capabilityIdSchema.safeParse(id).success || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(version) || !/^[a-f0-9]{64}$/.test(digest)) return capabilityNotFound(reply);
    try {
      const capability = catalog.exact(id, version);
      if (!capability || capability.release.artifactDigest !== `sha256:${digest}` || capability.trust.status === "candidate") return capabilityNotFound(reply);
      if (capability.trust.status === "revoked") return reply.code(409).send({ error: "Capability release is revoked", code: "CAPABILITY_REVOKED" });
      if (capability.trust.status === "quarantined") return reply.code(409).send({ error: "Capability release is quarantined", code: "CAPABILITY_QUARANTINED" });
      if (capability.trust.status !== "approved" || !eligibleForBothClients(capability, now())) return reply.code(409).send({ error: "Capability release is not eligible for install handoff", code: "PERMISSION_BLOCKED" });
      reply.header("Cache-Control", "no-store");
      secureBootstrapReply(reply);
      return buildSuperSkillBootstrapManifest(bootstrapContract, capability);
    } catch (error) {
      return catalogFailure(reply, error);
    }
  });

  app.get("/showroom/selected", async (request, reply) => {
    const query = request.query as { limit?: string | number; job?: string };
    const parsedLimit = Number(query.limit ?? 12);
    const limit = Number.isInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 12 ? parsedLimit : 12;
    if (query.job && !capabilityIdSchema.safeParse(query.job).success) return publicNotFound(reply);
    try {
      reply.header("Cache-Control", cacheControl);
      return catalog.selectedShowroomList(limit, query.job);
    } catch (error) {
      return catalogFailure(reply, error);
    }
  });

  app.get("/showroom/capabilities", async (request, reply) => {
    const query = request.query as { limit?: string | number; job?: string };
    const parsedLimit = Number(query.limit ?? 12);
    const limit = Number.isInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 12 ? parsedLimit : 12;
    if (query.job && !capabilityIdSchema.safeParse(query.job).success) return publicNotFound(reply);
    try {
      reply.header("Cache-Control", cacheControl);
      return catalog.showroomList(limit, query.job, now());
    } catch (error) {
      return catalogFailure(reply, error);
    }
  });

  app.get("/showroom/capabilities/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!capabilityIdSchema.safeParse(id).success) return publicNotFound(reply);
    try {
      const detail = catalog.showroomDetail(id, now());
      if (!detail) return publicNotFound(reply);
      reply.header("Cache-Control", cacheControl);
      return detail;
    } catch (error) {
      return catalogFailure(reply, error);
    }
  });

  app.post("/recommendations", async (request, reply) => {
    const auth = await requireManagedAccess(request, reply, enabled, options, accessResolver, now());
    if (!auth) return;
    const parsed = recommendationRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Task or recommendation context is invalid", code: "TASK_INVALID" });
    try {
      return recommendCapabilities(parsed.data, catalog.listApproved(), { now: now() });
    } catch (error) {
      if (error instanceof RecommendationValidationError) return reply.code(400).send({ error: error.message, code: error.reasonCode });
      return catalogFailure(reply, error);
    }
  });

  app.post("/superskill/handoff/decision", async (request, reply) => {
    const requestNow = now();
    const auth = await requireManagedAccess(request, reply, enabled, options, accessResolver, requestNow);
    if (!auth) return;
    if (auth.evidence !== "confirmed_user" || !auth.publicGoEligible) {
      return reply.code(403).send({
        error: "A confirmed account with an active SuperSkill grant is required for exact handoff",
        code: "SUPERSKILL_CONFIRMED_ACCESS_REQUIRED"
      });
    }
    const parsed = exactHandoffDecisionRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Exact SuperSkill handoff is invalid", code: "HANDOFF_INVALID" });
    const { capability: tuple, client } = parsed.data;
    try {
      const capability = catalog.exact(tuple.id, tuple.version);
      if (!capability || capability.trust.status === "candidate" || capability.release.artifactDigest !== tuple.artifactDigest) return capabilityNotFound(reply);
      if (capability.trust.status === "revoked") return reply.code(409).send({ error: "Capability release is revoked", code: "CAPABILITY_REVOKED" });
      if (capability.trust.status === "quarantined") return reply.code(409).send({ error: "Capability release is quarantined", code: "CAPABILITY_QUARANTINED" });
      if (capability.trust.status !== "approved" || !evaluateManagedEligibility(capability, client, requestNow).eligible) {
        return reply.code(409).send({ error: "Capability release evidence is no longer eligible for activation", code: "PERMISSION_BLOCKED" });
      }
      const decisionNow = new Date(Math.floor(requestNow.getTime() / 60_000) * 60_000);
      const recommendationId = exactHandoffRecommendationId(auth.subject, tuple, client, decisionNow);
      reply.header("Cache-Control", "no-store");
      return exactHandoffDecision(capability, client, { now: decisionNow, recommendationId });
    } catch (error) {
      return catalogFailure(reply, error);
    }
  });

  app.get("/capabilities/:id", async (request, reply) => {
    if (!await requireManagedAccess(request, reply, enabled, options, accessResolver, now())) return;
    const { id } = request.params as { id: string };
    if (!capabilityIdSchema.safeParse(id).success) return capabilityNotFound(reply);
    try {
      const capability = catalog.detail(id);
      if (!capability || capability.trust.status === "candidate") return capabilityNotFound(reply);
      return capability;
    } catch (error) {
      return catalogFailure(reply, error);
    }
  });

  app.get("/capabilities/:id/releases/:version", async (request, reply) => {
    if (!await requireManagedAccess(request, reply, enabled, options, accessResolver, now())) return;
    const { id, version } = request.params as { id: string; version: string };
    if (!capabilityIdSchema.safeParse(id).success || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(version)) return capabilityNotFound(reply);
    try {
      const capability = catalog.exact(id, version);
      if (!capability || capability.trust.status === "candidate") return capabilityNotFound(reply);
      const revoked = capability.trust.status === "revoked";
      const quarantined = capability.trust.status === "quarantined";
      const replacement = catalog.revocation(capability.release.artifactDigest)?.replacement;
      const activationAllowed = capability.trust.status === "approved" && eligibleForBothClients(capability, now());
      return {
        capability,
        activationAllowed,
        ...(replacement ? { replacement } : {}),
        ...(activationAllowed ? { archive: { url: `/api/capabilities/${id}/releases/${version}/archive`, artifactDigest: capability.release.artifactDigest } } : {}),
        ...(revoked ? { blockCode: "CAPABILITY_REVOKED" as const } : quarantined ? { blockCode: "CAPABILITY_QUARANTINED" as const } : !activationAllowed ? { blockCode: "PERMISSION_BLOCKED" as const } : {})
      };
    } catch (error) {
      return catalogFailure(reply, error);
    }
  });

  app.get("/capabilities/:id/releases/:version/archive", async (request, reply) => {
    if (!await requireManagedAccess(request, reply, enabled, options, accessResolver, now())) return;
    const { id, version } = request.params as { id: string; version: string };
    if (!capabilityIdSchema.safeParse(id).success || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(version)) return capabilityNotFound(reply);
    try {
      const capability = catalog.exact(id, version);
      if (!capability) return capabilityNotFound(reply);
      if (capability.trust.status === "revoked") return reply.code(409).send({ error: "Capability release is revoked", code: "CAPABILITY_REVOKED" });
      if (capability.trust.status === "quarantined") return reply.code(409).send({ error: "Capability release is quarantined", code: "CAPABILITY_QUARANTINED" });
      if (capability.trust.status !== "approved") return reply.code(404).send({ error: "Capability release is not approved", code: "CAPABILITY_NOT_FOUND" });
      if (!eligibleForBothClients(capability, now())) return reply.code(409).send({ error: "Capability release evidence is no longer eligible for activation", code: "PERMISSION_BLOCKED" });
      return archiveBuilder(capability);
    } catch (error) {
      if (error instanceof ManagedArchiveError) return reply.code(error.status).send({ error: error.message, code: error.reasonCode });
      return catalogFailure(reply, error);
    }
  });
}

function exactHandoffRecommendationId(
  subject: string,
  tuple: { id: string; version: string; artifactDigest: string },
  client: string,
  issuedAt: Date
): string {
  return `rec_${createHash("sha256").update(JSON.stringify({ subject, tuple, client, issuedAt: issuedAt.toISOString() })).digest("base64url").slice(0, 24)}`;
}

function eligibleForBothClients(capability: ManagedCapability, now: Date): boolean {
  return evaluateManagedEligibility(capability, "claude-code", now).eligible
    && evaluateManagedEligibility(capability, "codex", now).eligible;
}

export function verifyDecisionConsent(input: {
  capability: ManagedCapability;
  client: string;
  recommendationId: string;
  expiresAt: string;
  decisionDigest: string;
  now?: Date;
}): boolean {
  const client = clientSchema.safeParse(input.client);
  if (!client.success || Date.parse(input.expiresAt) <= (input.now ?? new Date()).getTime()) return false;
  const expected = digestCanonicalJson({
    recommendationId: input.recommendationId,
    selected: {
      id: input.capability.id,
      ref: input.capability.release.ref,
      version: input.capability.release.version,
      artifactDigest: input.capability.release.artifactDigest,
      client: client.data,
      permissions: input.capability.permissions,
      trustChecks: input.capability.trust.checks,
      limitations: input.capability.trust.limitations
    },
    expiresAt: input.expiresAt
  });
  return safeHashEqual(expected.replace(/^sha256:/, ""), input.decisionDigest.replace(/^sha256:/, ""));
}

async function requireManagedAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  enabled: boolean,
  options: SuperskillRouteOptions,
  accessResolver: SuperskillAccessResolver,
  now: Date
): Promise<SuperskillManagedAuth & { ok: true } | undefined> {
  if (!enabled) {
    void reply.code(503).send({ error: "SuperSkill managed routes are disabled", code: "SUPERSKILL_DISABLED" });
    return undefined;
  }
  const value = Array.isArray(request.headers.authorization) ? request.headers.authorization[0] : request.headers.authorization;
  const auth = await resolveManagedAccess(value, options, accessResolver, now);
  if (!auth.ok) {
    if (auth.status === 401) reply.header("WWW-Authenticate", 'Bearer realm="superskill"');
    void reply.code(auth.status).send({ error: managedAccessError(auth.reasonCode), code: auth.reasonCode });
    return undefined;
  }
  reply.header("X-OnlyHarness-SuperSkill-Auth", auth.evidence === "confirmed_user" ? "confirmed-user" : "legacy-alpha");
  reply.header("X-OnlyHarness-SuperSkill-Public-GO", auth.publicGoEligible ? "eligible" : "ineligible");
  return auth;
}

export async function resolveManagedAccess(
  authorization: string | undefined,
  options: Pick<SuperskillRouteOptions, "tokenHashes" | "telemetrySalt">,
  accessResolver: SuperskillAccessResolver,
  now = new Date()
): Promise<SuperskillManagedAuth> {
  if (!authorization) return { ok: false, status: 401, reasonCode: "SUPERSKILL_AUTH_REQUIRED" };
  const legacy = superskillAuthFromHeader(authorization, options);
  if (legacy.ok) {
    return {
      ok: true,
      subject: legacy.subject,
      evidence: "legacy_alpha",
      publicGoEligible: false
    };
  }
  const resolved = await accessResolver({ authorization, requiredScope: SUPERSKILL_MANAGED_SCOPE, now });
  if (!resolved.ok) return { ok: false, status: resolved.status, reasonCode: resolved.code };
  return {
    ok: true,
    subject: resolved.principal.subject,
    evidence: resolved.principal.evidence,
    publicGoEligible: resolved.principal.publicGoEligible
  };
}

function managedAccessError(code: Exclude<SuperskillManagedAuth, { ok: true }>["reasonCode"]): string {
  if (code === "SUPERSKILL_AUTH_REQUIRED") return "SuperSkill Bearer credential is required";
  if (code === "SUPERSKILL_AUTH_INVALID") return "SuperSkill Bearer credential is invalid or expired";
  if (code === "SUPERSKILL_EMAIL_UNCONFIRMED") return "A confirmed account is required for SuperSkill managed access";
  if (code === "SUPERSKILL_AUTH_UNAVAILABLE") return "SuperSkill authentication is temporarily unavailable";
  return "SuperSkill managed access is not granted";
}

function catalogFailure(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : "Managed catalog is not ready";
  const code = error instanceof ManagedCatalogError ? error.reasonCode : "CATALOG_NOT_READY";
  return reply.code(503).send({ error: message, code });
}

function capabilityNotFound(reply: FastifyReply) {
  return reply.code(404).send({ error: "Capability not found", code: "CAPABILITY_NOT_FOUND" });
}

function publicNotFound(reply: FastifyReply) {
  return reply.code(404).send({ error: "Showroom capability not found" });
}

function secureBootstrapReply(reply: FastifyReply): void {
  reply.type("application/vnd.superskill.bootstrap+json; charset=utf-8");
  reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; sandbox");
  reply.header("X-Content-Type-Options", "nosniff");
}

function parseTokenHashes(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter((item) => /^[a-f0-9]{64}$/.test(item));
}

function safeHashEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left.toLowerCase(), "hex"), Buffer.from(right.toLowerCase(), "hex"));
}
