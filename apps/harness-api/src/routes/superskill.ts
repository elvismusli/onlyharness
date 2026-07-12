import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { capabilityIdSchema, clientSchema, recommendationRequestSchema, type ManagedCapability } from "@harnesshub/capability-schema/browser";
import { ManagedCatalog, ManagedCatalogError } from "../capabilities.js";
import { buildManagedArchive, ManagedArchiveError, type ManagedArchivePayload } from "../managed-archive.js";
import { digestCanonicalJson, recommendCapabilities, RecommendationValidationError } from "../recommendations.js";
import { evaluateManagedEligibility } from "../trust-policy.js";

export type SuperskillRouteOptions = {
  catalog?: ManagedCatalog;
  enabled?: boolean;
  tokenHashes?: string[];
  telemetrySalt?: string;
  now?: () => Date;
  archiveBuilder?: (capability: ManagedCapability) => ManagedArchivePayload;
};

export type SuperskillAuth = { ok: true; subject: string } | { ok: false; status: 401 | 403; reasonCode: "SUPERSKILL_AUTH_REQUIRED" | "INTERNAL_ALPHA_DENIED" };

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
  const cacheControl = "public, max-age=60, stale-while-revalidate=300";

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
    const auth = requireManagedAccess(request, reply, enabled, options);
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

  app.get("/capabilities/:id", async (request, reply) => {
    if (!requireManagedAccess(request, reply, enabled, options)) return;
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
    if (!requireManagedAccess(request, reply, enabled, options)) return;
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
    if (!requireManagedAccess(request, reply, enabled, options)) return;
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

function eligibleForBothClients(capability: ManagedCapability, now: Date): boolean {
  return evaluateManagedEligibility(capability, "claude-code", now).eligible
    && evaluateManagedEligibility(capability, "codex", now).eligible;
}

export function verifyDecisionConsent(input: {
  capability: ManagedCapability;
  client: string;
  expiresAt: string;
  decisionDigest: string;
  now?: Date;
}): boolean {
  const client = clientSchema.safeParse(input.client);
  if (!client.success || Date.parse(input.expiresAt) <= (input.now ?? new Date()).getTime()) return false;
  const expected = digestCanonicalJson({
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

function requireManagedAccess(request: FastifyRequest, reply: FastifyReply, enabled: boolean, options: SuperskillRouteOptions): SuperskillAuth & { ok: true } | undefined {
  if (!enabled) {
    void reply.code(503).send({ error: "SuperSkill managed routes are disabled", code: "SUPERSKILL_DISABLED" });
    return undefined;
  }
  const value = Array.isArray(request.headers.authorization) ? request.headers.authorization[0] : request.headers.authorization;
  const auth = superskillAuthFromHeader(value, options);
  if (!auth.ok) {
    void reply.code(auth.status).send({ error: auth.status === 401 ? "SuperSkill Bearer token is required" : "Internal alpha access denied", code: auth.reasonCode });
    return undefined;
  }
  return auth;
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

function parseTokenHashes(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter((item) => /^[a-f0-9]{64}$/.test(item));
}

function safeHashEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left.toLowerCase(), "hex"), Buffer.from(right.toLowerCase(), "hex"));
}
