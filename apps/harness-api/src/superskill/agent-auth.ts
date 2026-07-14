import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  createSupabaseDeviceGrantResolver,
  createSupabaseDeviceIdentityResolver,
  type DeviceAuthGrantResolver,
  type DeviceAuthIdentityResolver
} from "./device-auth.js";
import { normalizeSupabaseOrigin, supabaseAuthTimeoutMs, superskillUserSubject, type FetchLike } from "./access.js";

export const AGENT_ACCESS_TOKEN_PREFIX = "ohat_" as const;
export const AGENT_REFRESH_TOKEN_PREFIX = "ohrt_" as const;
export const AGENT_REQUEST_PREFIX = "ohrq_" as const;
export const AGENT_DEVICE_PROOF_PREFIX = "ohdp_" as const;
export const AGENT_BROWSER_PROOF_PREFIX = "ohbp_" as const;
export const AGENT_BINDING_PREFIX = "ohbb_" as const;
export const AGENT_BIND_COOKIE = "__Host-superskill_agent_bind" as const;
export const AGENT_BIND_COOKIE_LOCAL = "superskill_agent_bind" as const;

export const AGENT_AUTH_SCOPES = [
  "superskill:managed",
  "resources:publish",
  "workspaces:read",
  "workspaces:write"
] as const;

export type AgentAuthScope = typeof AGENT_AUTH_SCOPES[number];
export type AgentAuthClient = "codex" | "claude-code" | "cli";
export type AgentRequestState = "pending" | "approved" | "denied" | "expired" | "consumed";

export type AgentAccessPrincipal = {
  userId: string;
  subject: string;
  clientId: AgentAuthClient;
  sessionId: string;
  scopes: AgentAuthScope[];
  expiresAt: Date;
  authKind: "agent_access";
};

type StoredRequest = {
  id: string;
  client: AgentAuthClient;
  scopes: AgentAuthScope[];
  deviceHash: string;
  browserHash: string;
  bindingHash?: string;
  state: AgentRequestState;
  userId?: string;
  subject?: string;
  createdAt: Date;
  expiresAt: Date;
  approvedAt?: Date;
  consumedAt?: Date;
};

type StoredSession = {
  id: string;
  userId: string;
  subject: string;
  client: AgentAuthClient;
  scopes: AgentAuthScope[];
  status: "active" | "revoked";
  createdAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
};

type StoredAccess = { hash: string; sessionId: string; expiresAt: Date; revokedAt?: Date };
type StoredRefresh = { hash: string; sessionId: string; generation: number; expiresAt: Date; consumedAt?: Date; replacedByHash?: string };

export type AgentAuthStore = {
  sweep(input: { now: Date }): Promise<"swept" | "unavailable">;
  createRequest(input: StoredRequest): Promise<"created" | "conflict" | "unavailable">;
  bindBrowser(input: { requestId: string; browserHash: string; consumedBrowserHash: string; bindingHash: string; now: Date }): Promise<StoreResult>;
  readContext(input: { requestId: string; bindingHash: string; now: Date }): Promise<ContextStoreResult>;
  decide(input: { requestId: string; bindingHash: string; decision: "approve" | "deny"; userId?: string; subject?: string; now: Date }): Promise<StoreResult>;
  exchange(input: {
    requestId: string;
    deviceHash: string;
    accessHash: string;
    refreshHash: string;
    accessExpiresAt: Date;
    sessionExpiresAt: Date;
    now: Date;
  }): Promise<ExchangeStoreResult>;
  refresh(input: {
    refreshHash: string;
    nextAccessHash: string;
    nextRefreshHash: string;
    accessExpiresAt: Date;
    now: Date;
  }): Promise<RefreshStoreResult>;
  revoke(input: { accessHash?: string; refreshHash?: string; now: Date }): Promise<"revoked" | "not_found" | "unavailable">;
  resolveAccess(input: { accessHash: string; now: Date }): Promise<ResolveStoreResult>;
};

type StoreResult = { ok: true } | { ok: false; kind: "invalid" | "expired" | "used" | "denied" | "unavailable" };
type ContextStoreResult =
  | { ok: true; request: Pick<StoredRequest, "id" | "client" | "scopes" | "state" | "expiresAt"> }
  | { ok: false; kind: "invalid" | "expired" | "unavailable" };
type ExchangeStoreResult =
  | { ok: true; session: StoredSession }
  | { ok: false; kind: "pending" | "invalid" | "expired" | "used" | "denied" | "unavailable" };
type RefreshStoreResult =
  | { ok: true; session: StoredSession }
  | { ok: false; kind: "invalid" | "expired" | "reused" | "unavailable" };
type ResolveStoreResult = { ok: true; principal: AgentAccessPrincipal } | { ok: false; kind: "invalid" | "unavailable" };

export type AgentAuthOptions = {
  enabled?: boolean;
  publicUrl?: string;
  subjectSalt?: string;
  tokenPepper?: string;
  accessTtlSeconds?: number;
  sessionTtlSeconds?: number;
  requestTtlSeconds?: number;
  pollIntervalSeconds?: number;
  now?: () => Date;
  random?: (bytes: number) => Buffer;
  store?: AgentAuthStore;
  identityResolver?: DeviceAuthIdentityResolver;
  grantResolver?: DeviceAuthGrantResolver;
  fetchImpl?: FetchLike;
};

export type AgentAuthService = ReturnType<typeof createAgentAuthService>;

export function createAgentAuthService(options: AgentAuthOptions = {}) {
  const now = options.now ?? (() => new Date());
  const random = options.random ?? randomBytes;
  const publicUrl = normalizePublicUrl(options.publicUrl ?? process.env.SUPERSKILL_PUBLIC_URL ?? "https://superskill.sh");
  const cookieSecure = !publicUrl?.startsWith("http://") || process.env.NODE_ENV === "production";
  const cookieName = cookieSecure ? AGENT_BIND_COOKIE : AGENT_BIND_COOKIE_LOCAL;
  const subjectSalt = options.subjectSalt ?? process.env.SUPERSKILL_SUBJECT_SALT ?? localSecret("subject");
  const tokenPepper = options.tokenPepper ?? process.env.SUPERSKILL_AGENT_TOKEN_PEPPER ?? localSecret("agent-token");
  const requestTtlSeconds = boundedSeconds(options.requestTtlSeconds, 10 * 60, 120, 15 * 60);
  const accessTtlSeconds = boundedSeconds(options.accessTtlSeconds ?? envInteger("SUPERSKILL_AGENT_ACCESS_TTL_SECONDS"), 10 * 60, 60, 10 * 60);
  const sessionTtlSeconds = boundedSeconds(options.sessionTtlSeconds ?? envInteger("SUPERSKILL_AGENT_SESSION_TTL_SECONDS"), 30 * 24 * 60 * 60, 60 * 60, 30 * 24 * 60 * 60);
  const pollIntervalSeconds = boundedSeconds(options.pollIntervalSeconds, 3, 1, 10);
  const enabled = options.enabled ?? (process.env.SUPERSKILL_AGENT_AUTH_ENABLED === "true" || process.env.NODE_ENV !== "production");
  const secretsValid = validSecret(subjectSalt) && validSecret(tokenPepper);
  const store = options.store ?? createDefaultAgentAuthStore({ tokenPepper, fetchImpl: options.fetchImpl });

  async function start(input: { client: AgentAuthClient; scopes: AgentAuthScope[] }) {
    if (!enabled || !publicUrl || !secretsValid) return { ok: false as const, kind: "unavailable" as const };
    if (await store.sweep({ now: now() }) === "unavailable") return { ok: false as const, kind: "unavailable" as const };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const requestId = secret(AGENT_REQUEST_PREFIX, random);
      const deviceProof = secret(AGENT_DEVICE_PROOF_PREFIX, random);
      const browserProof = secret(AGENT_BROWSER_PROOF_PREFIX, random);
      const requestNow = now();
      const expiresAt = new Date(requestNow.getTime() + requestTtlSeconds * 1_000);
      const created = await store.createRequest({
        id: requestId,
        client: input.client,
        scopes: input.scopes,
        deviceHash: hashSecret(tokenPepper, "device", deviceProof),
        browserHash: hashSecret(tokenPepper, "browser", browserProof),
        state: "pending",
        createdAt: requestNow,
        expiresAt
      });
      if (created === "unavailable") return { ok: false as const, kind: "unavailable" as const };
      if (created === "conflict") continue;
      const browserUrl = `${publicUrl}/#/superskill/connect?request=${encodeURIComponent(requestId)}&proof=${encodeURIComponent(browserProof)}`;
      return {
        ok: true as const,
        requestId,
        deviceProof,
        browserUrl,
        expiresIn: requestTtlSeconds,
        interval: pollIntervalSeconds
      };
    }
    return { ok: false as const, kind: "unavailable" as const };
  }

  async function bindBrowser(input: { requestId: string; browserProof: string }) {
    if (!enabled || !validRequestId(input.requestId) || !validSecretToken(input.browserProof, AGENT_BROWSER_PROOF_PREFIX)) {
      return { ok: false as const, kind: "invalid" as const };
    }
    const binding = secret(AGENT_BINDING_PREFIX, random);
    const result = await store.bindBrowser({
      requestId: input.requestId,
      browserHash: hashSecret(tokenPepper, "browser", input.browserProof),
      consumedBrowserHash: hashSecret(tokenPepper, "browser-consumed", secret(AGENT_BROWSER_PROOF_PREFIX, random)),
      bindingHash: hashSecret(tokenPepper, "binding", binding),
      now: now()
    });
    return result.ok ? { ok: true as const, binding } : result;
  }

  function bindingHash(binding: string | undefined): string | undefined {
    return validSecretToken(binding, AGENT_BINDING_PREFIX) ? hashSecret(tokenPepper, "binding", binding) : undefined;
  }

  async function context(input: { requestId: string; binding?: string }) {
    const hash = bindingHash(input.binding);
    if (!enabled || !validRequestId(input.requestId) || !hash) return { ok: false as const, kind: "invalid" as const };
    return store.readContext({ requestId: input.requestId, bindingHash: hash, now: now() });
  }

  async function decide(input: { requestId: string; binding?: string; decision: "approve" | "deny"; userId?: string }) {
    const hash = bindingHash(input.binding);
    if (!enabled || !validRequestId(input.requestId) || !hash || (input.decision === "approve" && (!input.userId || !isUuid(input.userId)))) return { ok: false as const, kind: "invalid" as const };
    return store.decide({
      requestId: input.requestId,
      bindingHash: hash,
      decision: input.decision,
      userId: input.userId,
      subject: input.userId ? superskillUserSubject(input.userId, subjectSalt) : undefined,
      now: now()
    });
  }

  async function token(input: { requestId: string; deviceProof: string }) {
    if (!enabled || !validRequestId(input.requestId) || !validSecretToken(input.deviceProof, AGENT_DEVICE_PROOF_PREFIX)) {
      return { ok: false as const, kind: "invalid" as const };
    }
    const requestNow = now();
    const accessToken = secret(AGENT_ACCESS_TOKEN_PREFIX, random);
    const refreshToken = secret(AGENT_REFRESH_TOKEN_PREFIX, random);
    const result = await store.exchange({
      requestId: input.requestId,
      deviceHash: hashSecret(tokenPepper, "device", input.deviceProof),
      accessHash: hashSecret(tokenPepper, "access", accessToken),
      refreshHash: hashSecret(tokenPepper, "refresh", refreshToken),
      accessExpiresAt: new Date(requestNow.getTime() + accessTtlSeconds * 1_000),
      sessionExpiresAt: new Date(requestNow.getTime() + sessionTtlSeconds * 1_000),
      now: requestNow
    });
    return result.ok ? tokenResult(result.session, accessToken, refreshToken, requestNow, accessTtlSeconds) : result;
  }

  async function refresh(refreshToken: string) {
    if (!enabled || !validSecretToken(refreshToken, AGENT_REFRESH_TOKEN_PREFIX)) return { ok: false as const, kind: "invalid" as const };
    const requestNow = now();
    const accessToken = secret(AGENT_ACCESS_TOKEN_PREFIX, random);
    const nextRefreshToken = secret(AGENT_REFRESH_TOKEN_PREFIX, random);
    const result = await store.refresh({
      refreshHash: hashSecret(tokenPepper, "refresh", refreshToken),
      nextAccessHash: hashSecret(tokenPepper, "access", accessToken),
      nextRefreshHash: hashSecret(tokenPepper, "refresh", nextRefreshToken),
      accessExpiresAt: new Date(requestNow.getTime() + accessTtlSeconds * 1_000),
      now: requestNow
    });
    return result.ok ? tokenResult(result.session, accessToken, nextRefreshToken, requestNow, accessTtlSeconds) : result;
  }

  async function revoke(input: { accessToken?: string; refreshToken?: string }) {
    const accessHash = validSecretToken(input.accessToken, AGENT_ACCESS_TOKEN_PREFIX)
      ? hashSecret(tokenPepper, "access", input.accessToken!)
      : undefined;
    const refreshHash = validSecretToken(input.refreshToken, AGENT_REFRESH_TOKEN_PREFIX)
      ? hashSecret(tokenPepper, "refresh", input.refreshToken!)
      : undefined;
    if (!accessHash && !refreshHash) return "not_found" as const;
    return store.revoke({ accessHash, refreshHash, now: now() });
  }

  async function resolveAccessToken(accessToken: string | undefined, requiredScopes: readonly AgentAuthScope[] = []): Promise<ResolveStoreResult | { ok: false; kind: "forbidden" }> {
    if (!enabled || !validSecretToken(accessToken, AGENT_ACCESS_TOKEN_PREFIX)) return { ok: false, kind: "invalid" };
    const result = await store.resolveAccess({ accessHash: hashSecret(tokenPepper, "access", accessToken!), now: now() });
    if (!result.ok) return result;
    return requiredScopes.every((scope) => result.principal.scopes.includes(scope)) ? result : { ok: false, kind: "forbidden" };
  }

  return { start, bindBrowser, context, decide, token, refresh, revoke, resolveAccessToken, accessTtlSeconds, sessionTtlSeconds, requestTtlSeconds, pollIntervalSeconds, cookieSecure, cookieName };
}

function tokenResult(session: StoredSession, accessToken: string, refreshToken: string, now: Date, accessTtlSeconds: number) {
  return {
    ok: true as const,
    accessToken,
    refreshToken,
    expiresIn: accessTtlSeconds,
    sessionExpiresIn: Math.max(1, Math.floor((session.expiresAt.getTime() - now.getTime()) / 1_000)),
    scopes: session.scopes
  };
}

export async function registerAgentAuthRoutes(app: FastifyInstance, service: AgentAuthService, options: Pick<AgentAuthOptions, "identityResolver" | "grantResolver" | "fetchImpl" | "subjectSalt"> = {}) {
  const identityResolver = options.identityResolver ?? createSupabaseDeviceIdentityResolver({ fetchImpl: options.fetchImpl });
  const subjectSalt = options.subjectSalt ?? process.env.SUPERSKILL_SUBJECT_SALT ?? localSecret("subject");
  const grantResolver = options.grantResolver ?? createSupabaseDeviceGrantResolver({ subjectSalt, fetchImpl: options.fetchImpl });
  const rates = new Map<string, { startedAt: number; count: number }>();

  app.post("/auth/agent/start", async (request, reply) => {
    secure(reply);
    const body = strictBody(request.body, ["client", "scopes"]);
    const client = body && validClient(body.client) ? body.client : undefined;
    const scopes = body ? normalizeScopes(body.scopes) : undefined;
    if (!client || !scopes) return reply.code(400).send({ error: "Invalid agent authorization request", code: "AGENT_AUTH_REQUEST_INVALID" });
    if (!takeRouteRate(rates, request, subjectSalt, "start", 20, 60_000, reply)) return;
    if (!takeGlobalRate(rates, subjectSalt, "start", 1_000, 60_000, reply)) return;
    const result = await service.start({ client, scopes });
    if (!result.ok) return reply.code(503).send({ error: "Agent authorization is unavailable", code: "AGENT_AUTH_UNAVAILABLE" });
    return reply.code(201).send({
      request_id: result.requestId,
      device_proof: result.deviceProof,
      browser_url: result.browserUrl,
      verification_uri: result.browserUrl,
      expires_in: result.expiresIn,
      interval: result.interval
    });
  });

  app.post("/auth/agent/browser-bind", async (request, reply) => {
    secure(reply);
    const body = strictBody(request.body, ["request_id", "browser_proof"]);
    if (!body || typeof body.request_id !== "string" || typeof body.browser_proof !== "string") return authFailure(reply, "invalid");
    const result = await service.bindBrowser({ requestId: body.request_id, browserProof: body.browser_proof });
    if (!result.ok) return authFailure(reply, result.kind);
    reply.header("Set-Cookie", `${service.cookieName}=${result.binding}; Path=/; HttpOnly;${service.cookieSecure ? " Secure;" : ""} SameSite=Lax; Max-Age=${service.requestTtlSeconds}`);
    return { bound: true, request_id: body.request_id };
  });

  app.get("/auth/agent/context", async (request, reply) => {
    secure(reply);
    const query = request.query as { request_id?: unknown };
    if (typeof query.request_id !== "string") return authFailure(reply, "invalid");
    const result = await service.context({ requestId: query.request_id, binding: cookie(request, service.cookieName) });
    if (!result.ok) return authFailure(reply, result.kind);
    return {
      request: {
        id: result.request.id,
        client: result.request.client,
        client_name: clientName(result.request.client),
        scopes: result.request.scopes,
        expires_at: result.request.expiresAt.toISOString(),
        status: result.request.state
      }
    };
  });

  app.post("/auth/agent/decision", async (request, reply) => {
    secure(reply);
    const body = strictBody(request.body, ["request_id", "decision"]);
    if (!body || typeof body.request_id !== "string" || (body.decision !== "approve" && body.decision !== "deny")) return authFailure(reply, "invalid");
    const identity = body.decision === "approve"
      ? await identityResolver({ authorization: header(request.headers.authorization), now: new Date() })
      : undefined;
    if (identity && !identity.ok) return reply.code(identity.status).send({ error: "Confirmed browser session required", code: identity.code });
    if (body.decision === "approve") {
      if (!identity?.ok) return reply.code(401).send({ error: "Confirmed browser session required", code: "DEVICE_AUTH_REQUIRED" });
      const context = await service.context({ requestId: body.request_id, binding: cookie(request, service.cookieName) });
      if (!context.ok) return authFailure(reply, context.kind);
      if (context.request.scopes.includes("superskill:managed")) {
        const grant = await grantResolver({
          userId: identity.user.id,
          subject: superskillUserSubject(identity.user.id, subjectSalt),
          expiresAt: new Date(Date.now() + service.sessionTtlSeconds * 1_000)
        });
        if (!grant.ok) return reply.code(grant.kind === "denied" ? 403 : 503).send({
          error: grant.kind === "denied" ? "Managed access is denied" : "Agent authorization is unavailable",
          code: grant.kind === "denied" ? "AGENT_ACCESS_DENIED" : "AGENT_AUTH_UNAVAILABLE"
        });
      }
    }
    const result = await service.decide({
      requestId: body.request_id,
      binding: cookie(request, service.cookieName),
      decision: body.decision,
      userId: identity?.ok ? identity.user.id : undefined
    });
    if (!result.ok) return authFailure(reply, result.kind);
    reply.header("Set-Cookie", `${service.cookieName}=; Path=/; HttpOnly;${service.cookieSecure ? " Secure;" : ""} SameSite=Lax; Max-Age=0`);
    return body.decision === "approve" ? { approved: true } : { denied: true };
  });

  app.post("/auth/agent/token", async (request, reply) => {
    secure(reply);
    const body = strictBody(request.body, ["request_id", "device_proof"]);
    if (!body || typeof body.request_id !== "string" || typeof body.device_proof !== "string") return authFailure(reply, "invalid");
    if (!takeRouteRate(rates, request, subjectSalt, "token", 120, 60_000, reply, body.request_id)) return;
    const result = await service.token({ requestId: body.request_id, deviceProof: body.device_proof });
    if (!result.ok) return tokenFailure(reply, result.kind, service.pollIntervalSeconds);
    return sendTokens(result);
  });

  app.post("/auth/agent/refresh", async (request, reply) => {
    secure(reply);
    const body = strictBody(request.body, ["refresh_token"]);
    if (!body || typeof body.refresh_token !== "string") return authFailure(reply, "invalid");
    if (!takeRouteRate(rates, request, subjectSalt, "refresh", 60, 60_000, reply, body.refresh_token)) return;
    const result = await service.refresh(body.refresh_token);
    if (!result.ok) return refreshFailure(reply, result.kind);
    return sendTokens(result);
  });

  app.post("/auth/agent/revoke", async (request, reply) => {
    secure(reply);
    const body = strictBody(request.body, ["refresh_token"]);
    if (!body) return authFailure(reply, "invalid");
    const result = await service.revoke({
      accessToken: bearer(header(request.headers.authorization)),
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined
    });
    if (result === "unavailable") return authFailure(reply, "unavailable");
    return { revoked: true };
  });
}

function sendTokens(result: { accessToken: string; refreshToken: string; expiresIn: number; sessionExpiresIn: number; scopes: AgentAuthScope[] }) {
  return {
    access_token: result.accessToken,
    refresh_token: result.refreshToken,
    token_type: "Bearer",
    expires_in: result.expiresIn,
    session_expires_in: result.sessionExpiresIn,
    scope: result.scopes.join(" ")
  };
}

function authFailure(reply: FastifyReply, kind: StoreResult extends never ? never : string) {
  if (kind === "expired") return reply.code(410).send({ error: "Agent authorization expired", code: "AGENT_AUTH_EXPIRED" });
  if (kind === "used") return reply.code(409).send({ error: "Agent authorization was already used", code: "AGENT_AUTH_USED" });
  if (kind === "denied") return reply.code(403).send({ error: "Agent authorization was denied", code: "AGENT_AUTH_DENIED" });
  if (kind === "unavailable") return reply.code(503).send({ error: "Agent authorization is unavailable", code: "AGENT_AUTH_UNAVAILABLE" });
  return reply.code(400).send({ error: "Invalid agent authorization", code: "AGENT_AUTH_INVALID" });
}

function tokenFailure(reply: FastifyReply, kind: string, interval: number) {
  if (kind === "pending") return reply.code(202).send({ error: "Waiting for browser approval", code: "AUTHORIZATION_PENDING", retry_after: interval });
  return authFailure(reply, kind);
}

function refreshFailure(reply: FastifyReply, kind: string) {
  reply.header("WWW-Authenticate", 'Bearer realm="superskill", error="invalid_token"');
  if (kind === "reused") return reply.code(401).send({ error: "Refresh token reuse revoked the session", code: "AGENT_REFRESH_REUSED" });
  if (kind === "unavailable") return authFailure(reply, kind);
  return reply.code(401).send({ error: "Invalid or expired refresh token", code: "AGENT_REFRESH_INVALID" });
}

export function createInMemoryAgentAuthStore(): AgentAuthStore {
  const requests = new Map<string, StoredRequest>();
  const sessions = new Map<string, StoredSession>();
  const accessTokens = new Map<string, StoredAccess>();
  const refreshTokens = new Map<string, StoredRefresh>();
  const consents = new Map<string, AgentAuthScope[]>();

  const revokeSession = (sessionId: string, now: Date) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    session.status = "revoked";
    session.revokedAt = now;
    for (const token of accessTokens.values()) if (token.sessionId === sessionId) token.revokedAt = now;
  };

  const consentKeyFor = (session: Pick<StoredSession, "userId" | "client">) => `${session.userId}:${session.client}`;
  const hasActiveConsent = (session: StoredSession) => {
    const scopes = consents.get(consentKeyFor(session));
    return Boolean(scopes && session.scopes.every((scope) => scopes.includes(scope)));
  };

  return {
    async sweep({ now }) {
      for (const [id, request] of requests) if (request.expiresAt.getTime() + 24 * 60 * 60 * 1_000 <= now.getTime()) requests.delete(id);
      for (const [id, session] of sessions) {
        const retentionStart = session.revokedAt ?? session.expiresAt;
        if (retentionStart.getTime() + 24 * 60 * 60 * 1_000 <= now.getTime()) {
          sessions.delete(id);
          for (const [hash, token] of accessTokens) if (token.sessionId === id) accessTokens.delete(hash);
          for (const [hash, token] of refreshTokens) if (token.sessionId === id) refreshTokens.delete(hash);
        }
      }
      return "swept";
    },
    async createRequest(input) {
      if (requests.has(input.id) || [...requests.values()].some((row) => row.deviceHash === input.deviceHash || row.browserHash === input.browserHash)) return "conflict";
      requests.set(input.id, structuredClone(input));
      return "created";
    },
    async bindBrowser({ requestId, browserHash, consumedBrowserHash, bindingHash, now }) {
      const request = requests.get(requestId);
      if (!request || !safeEqual(request.browserHash, browserHash)) return { ok: false, kind: "invalid" };
      if (request.expiresAt <= now) { request.state = "expired"; return { ok: false, kind: "expired" }; }
      if (request.bindingHash || request.state !== "pending") return { ok: false, kind: "used" };
      request.bindingHash = bindingHash;
      request.browserHash = consumedBrowserHash;
      return { ok: true };
    },
    async readContext({ requestId, bindingHash, now }) {
      const request = requests.get(requestId);
      if (!request || !request.bindingHash || !safeEqual(request.bindingHash, bindingHash)) return { ok: false, kind: "invalid" };
      if (request.expiresAt <= now && request.state === "pending") request.state = "expired";
      if (request.state === "expired") return { ok: false, kind: "expired" };
      return { ok: true, request: { id: request.id, client: request.client, scopes: [...request.scopes], state: request.state, expiresAt: request.expiresAt } };
    },
    async decide({ requestId, bindingHash, decision, userId, subject, now }) {
      const request = requests.get(requestId);
      if (!request || !request.bindingHash || !safeEqual(request.bindingHash, bindingHash)) return { ok: false, kind: "invalid" };
      if (request.expiresAt <= now) { request.state = "expired"; return { ok: false, kind: "expired" }; }
      if (request.state !== "pending") return { ok: false, kind: "used" };
      if (decision === "approve") {
        if (!userId || !subject) return { ok: false, kind: "invalid" };
        request.userId = userId;
        request.subject = subject;
        const consentKey = `${userId}:${request.client}`;
        request.scopes = [...new Set([...(consents.get(consentKey) ?? []), ...request.scopes])].sort() as AgentAuthScope[];
        consents.set(consentKey, [...request.scopes]);
      }
      request.state = decision === "approve" ? "approved" : "denied";
      request.approvedAt = now;
      return { ok: true };
    },
    async exchange({ requestId, deviceHash, accessHash, refreshHash, accessExpiresAt, sessionExpiresAt, now }) {
      const request = requests.get(requestId);
      if (!request || !safeEqual(request.deviceHash, deviceHash)) return { ok: false, kind: "invalid" };
      if (request.expiresAt <= now) { request.state = "expired"; return { ok: false, kind: "expired" }; }
      if (request.state === "pending") return { ok: false, kind: "pending" };
      if (request.state === "denied") return { ok: false, kind: "denied" };
      if (request.state !== "approved" || !request.userId || !request.subject) return { ok: false, kind: "used" };
      const session: StoredSession = {
        id: randomBytes(16).toString("hex"), userId: request.userId, subject: request.subject,
        client: request.client, scopes: [...request.scopes], status: "active", createdAt: now, expiresAt: sessionExpiresAt
      };
      sessions.set(session.id, session);
      accessTokens.set(accessHash, { hash: accessHash, sessionId: session.id, expiresAt: accessExpiresAt });
      refreshTokens.set(refreshHash, { hash: refreshHash, sessionId: session.id, generation: 0, expiresAt: sessionExpiresAt });
      request.state = "consumed";
      request.consumedAt = now;
      request.deviceHash = "consumed";
      return { ok: true, session: structuredClone(session) };
    },
    async refresh({ refreshHash, nextAccessHash, nextRefreshHash, accessExpiresAt, now }) {
      const token = refreshTokens.get(refreshHash);
      if (!token) return { ok: false, kind: "invalid" };
      const session = sessions.get(token.sessionId);
      if (!session) return { ok: false, kind: "invalid" };
      if (token.consumedAt) { revokeSession(session.id, now); return { ok: false, kind: "reused" }; }
      if (token.expiresAt <= now || session.expiresAt <= now || session.status !== "active" || !hasActiveConsent(session)) return { ok: false, kind: "expired" };
      token.consumedAt = now;
      token.replacedByHash = nextRefreshHash;
      accessTokens.set(nextAccessHash, { hash: nextAccessHash, sessionId: session.id, expiresAt: accessExpiresAt });
      refreshTokens.set(nextRefreshHash, { hash: nextRefreshHash, sessionId: session.id, generation: token.generation + 1, expiresAt: session.expiresAt });
      return { ok: true, session: structuredClone(session) };
    },
    async revoke({ accessHash, refreshHash, now }) {
      const sessionIds = new Set([
        accessHash ? accessTokens.get(accessHash)?.sessionId : undefined,
        refreshHash ? refreshTokens.get(refreshHash)?.sessionId : undefined
      ].filter((value): value is string => Boolean(value)));
      if (!sessionIds.size) return "not_found";
      const principals = new Set<string>();
      for (const sessionId of sessionIds) {
        const session = sessions.get(sessionId);
        if (session) principals.add(consentKeyFor(session));
      }
      for (const session of sessions.values()) {
        if (principals.has(consentKeyFor(session))) revokeSession(session.id, now);
      }
      for (const principal of principals) consents.delete(principal);
      return "revoked";
    },
    async resolveAccess({ accessHash, now }) {
      const access = accessTokens.get(accessHash);
      const session = access ? sessions.get(access.sessionId) : undefined;
      if (!access || !session || access.revokedAt || access.expiresAt <= now || session.status !== "active" || session.expiresAt <= now || !hasActiveConsent(session)) return { ok: false, kind: "invalid" };
      return {
        ok: true,
        principal: {
          userId: session.userId, subject: session.subject, clientId: session.client, sessionId: session.id,
          scopes: [...session.scopes], expiresAt: access.expiresAt, authKind: "agent_access"
        }
      };
    }
  };
}

export function createSupabaseAgentAuthStore(options: { tokenPepper: string; supabaseUrl?: string; serviceRoleKey?: string; fetchImpl?: FetchLike; timeoutMs?: number }): AgentAuthStore | undefined {
  const supabaseUrl = normalizeSupabaseOrigin(options.supabaseUrl ?? process.env.SUPABASE_URL);
  const serviceRoleKey = options.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return undefined;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = supabaseAuthTimeoutMs(options.timeoutMs ?? process.env.SUPABASE_AUTH_TIMEOUT_MS);
  const rpc = async (name: string, body: Record<string, unknown>) => supabaseRpc({ supabaseUrl, serviceRoleKey, fetchImpl, timeoutMs, name, body });
  return {
    async sweep(input) {
      const out = await rpc("agent_auth_sweep", rpcDates(input));
      return out?.ok === true ? "swept" : "unavailable";
    },
    async createRequest(input) {
      const out = await rpc("agent_auth_create_request", { p_request: requestJson(input) });
      return out?.ok ? "created" : out?.code === "conflict" ? "conflict" : "unavailable";
    },
    async bindBrowser(input) { return storeResult(await rpc("agent_auth_bind_browser", rpcDates(input))); },
    async readContext(input) {
      const out = await rpc("agent_auth_read_context", rpcDates(input));
      if (!out?.ok) return { ok: false, kind: contextKind(out?.code) };
      const request = parseRequest(out.request);
      return request ? { ok: true, request } : { ok: false, kind: "unavailable" };
    },
    async decide(input) {
      return storeResult(await rpc("agent_auth_decide", {
        ...rpcDates(input),
        p_user_id: input.userId ?? null,
        p_subject: input.subject ?? null
      }));
    },
    async exchange(input) {
      const out = await rpc("agent_auth_exchange", rpcDates(input));
      if (!out?.ok) return { ok: false, kind: exchangeKind(out?.code) };
      const session = parseSession(out.session);
      return session ? { ok: true, session } : { ok: false, kind: "unavailable" };
    },
    async refresh(input) {
      const out = await rpc("agent_auth_rotate_refresh", rpcDates(input));
      if (!out?.ok) return { ok: false, kind: refreshKind(out?.code) };
      const session = parseSession(out.session);
      return session ? { ok: true, session } : { ok: false, kind: "unavailable" };
    },
    async revoke(input) {
      const out = await rpc("agent_auth_revoke", rpcDates(input));
      return !out ? "unavailable" : out.ok ? "revoked" : out.code === "not_found" ? "not_found" : "unavailable";
    },
    async resolveAccess(input) {
      const out = await rpc("agent_auth_resolve_access", rpcDates(input));
      if (!out?.ok) return { ok: false, kind: out?.code === "invalid" ? "invalid" : "unavailable" };
      const principal = parsePrincipal(out.principal);
      return principal ? { ok: true, principal } : { ok: false, kind: "unavailable" };
    }
  };
}

function createDefaultAgentAuthStore(input: { tokenPepper: string; fetchImpl?: FetchLike }): AgentAuthStore {
  const remote = createSupabaseAgentAuthStore({ tokenPepper: input.tokenPepper, fetchImpl: input.fetchImpl });
  if (remote) return remote;
  return process.env.NODE_ENV === "production" ? unavailableStore() : createInMemoryAgentAuthStore();
}

function unavailableStore(): AgentAuthStore {
  return {
    async sweep() { return "unavailable"; },
    async createRequest() { return "unavailable"; },
    async bindBrowser() { return { ok: false, kind: "unavailable" }; },
    async readContext() { return { ok: false, kind: "unavailable" }; },
    async decide() { return { ok: false, kind: "unavailable" }; },
    async exchange() { return { ok: false, kind: "unavailable" }; },
    async refresh() { return { ok: false, kind: "unavailable" }; },
    async revoke() { return "unavailable"; },
    async resolveAccess() { return { ok: false, kind: "unavailable" }; }
  };
}

async function supabaseRpc(input: { supabaseUrl: string; serviceRoleKey: string; fetchImpl: FetchLike; timeoutMs: number; name: string; body: Record<string, unknown> }): Promise<Record<string, unknown> | undefined> {
  const url = new URL(`/rest/v1/rpc/${input.name}`, `${input.supabaseUrl}/`);
  const expectedUrl = url.href;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  timer.unref?.();
  try {
    const response = await input.fetchImpl(url, {
      method: "POST",
      headers: { apikey: input.serviceRoleKey, authorization: `Bearer ${input.serviceRoleKey}`, "content-type": "application/json" },
      body: JSON.stringify(input.body),
      redirect: "error",
      signal: controller.signal
    });
    if (response.url !== expectedUrl || !response.ok) return undefined;
    const value = await response.json() as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function requestJson(input: StoredRequest) {
  return {
    id: input.id, client: input.client, scopes: input.scopes, device_hash: input.deviceHash,
    browser_hash: input.browserHash, created_at: input.createdAt.toISOString(), expires_at: input.expiresAt.toISOString()
  };
}

function rpcDates<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [camelToParam(key), value instanceof Date ? value.toISOString() : value]));
}

function camelToParam(value: string) { return `p_${value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`; }

function storeResult(value: Record<string, unknown> | undefined): StoreResult {
  return value?.ok === true ? { ok: true } : { ok: false, kind: storeKind(value?.code) };
}
function storeKind(value: unknown): "invalid" | "expired" | "used" | "denied" | "unavailable" {
  return value === "expired" || value === "used" || value === "denied" || value === "invalid" ? value : "unavailable";
}
function exchangeKind(value: unknown): "pending" | "invalid" | "expired" | "used" | "denied" | "unavailable" {
  return value === "pending" ? "pending" : storeKind(value);
}
function contextKind(value: unknown): "invalid" | "expired" | "unavailable" {
  return value === "invalid" || value === "expired" ? value : "unavailable";
}
function refreshKind(value: unknown): "invalid" | "expired" | "reused" | "unavailable" {
  return value === "invalid" || value === "expired" || value === "reused" ? value : "unavailable";
}

function parseRequest(value: unknown): Pick<StoredRequest, "id" | "client" | "scopes" | "state" | "expiresAt"> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const scopes = normalizeScopes(row.scopes);
  if (typeof row.id !== "string" || !validClient(row.client) || !scopes || !validState(row.state) || typeof row.expires_at !== "string") return undefined;
  const expiresAt = new Date(row.expires_at);
  return Number.isFinite(expiresAt.getTime()) ? { id: row.id, client: row.client, scopes, state: row.state, expiresAt } : undefined;
}

function parseSession(value: unknown): StoredSession | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const scopes = normalizeScopes(row.scopes);
  if (typeof row.id !== "string" || typeof row.user_id !== "string" || typeof row.subject !== "string" || !validClient(row.client) || !scopes || typeof row.expires_at !== "string") return undefined;
  const expiresAt = new Date(row.expires_at);
  return Number.isFinite(expiresAt.getTime()) ? {
    id: row.id, userId: row.user_id, subject: row.subject, client: row.client, scopes,
    status: "active", createdAt: new Date(typeof row.created_at === "string" ? row.created_at : Date.now()), expiresAt
  } : undefined;
}

function parsePrincipal(value: unknown): AgentAccessPrincipal | undefined {
  const session = parseSession(value);
  if (!session || !value || typeof value !== "object") return undefined;
  const expires = (value as Record<string, unknown>).access_expires_at;
  const expiresAt = typeof expires === "string" ? new Date(expires) : undefined;
  if (!expiresAt || !Number.isFinite(expiresAt.getTime())) return undefined;
  return { userId: session.userId, subject: session.subject, clientId: session.client, sessionId: session.id, scopes: session.scopes, expiresAt, authKind: "agent_access" };
}

function normalizeScopes(value: unknown): AgentAuthScope[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > AGENT_AUTH_SCOPES.length) return undefined;
  const scopes = [...new Set(value)];
  if (!scopes.every((scope): scope is AgentAuthScope => typeof scope === "string" && (AGENT_AUTH_SCOPES as readonly string[]).includes(scope))) return undefined;
  return scopes.sort() as AgentAuthScope[];
}

function validClient(value: unknown): value is AgentAuthClient { return value === "codex" || value === "claude-code" || value === "cli"; }
function validState(value: unknown): value is AgentRequestState { return value === "pending" || value === "approved" || value === "denied" || value === "expired" || value === "consumed"; }
function validRequestId(value: string) { return validSecretToken(value, AGENT_REQUEST_PREFIX); }
function validSecretToken(value: string | undefined, prefix: string): value is string { return typeof value === "string" && value.startsWith(prefix) && new RegExp(`^${prefix}[A-Za-z0-9_-]{43}$`).test(value); }
function secret(prefix: string, random: (bytes: number) => Buffer) { return `${prefix}${random(32).toString("base64url")}`; }
function hashSecret(pepper: string, kind: string, value: string) { return createHmac("sha256", pepper).update(`superskill-agent-${kind}:v1:${value}`).digest("hex"); }
function safeEqual(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
function validSecret(value: string) { return Buffer.byteLength(value, "utf8") >= 32; }
function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function bearer(value: string | undefined) { return value?.match(/^Bearer\s+([^\s]{1,8192})$/i)?.[1]; }
function header(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
function clientName(client: AgentAuthClient) { return client === "claude-code" ? "Claude Code" : client === "codex" ? "Codex" : "SuperSkill CLI"; }
function envInteger(name: string) { const value = process.env[name]; return value && /^\d+$/.test(value) ? Number(value) : undefined; }
function boundedSeconds(value: number | undefined, fallback: number, min: number, max: number) { return Number.isSafeInteger(value) && value! >= min && value! <= max ? value! : fallback; }
function localSecret(kind: string) { return process.env.NODE_ENV === "production" ? "" : `onlyharness-local-${kind}-secret-at-least-32-bytes`; }
function normalizePublicUrl(value: string) { try { const url = new URL(value); const loopback = url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname); return (url.protocol === "https:" || loopback) && !url.username && !url.password && !url.search && !url.hash ? url.origin : undefined; } catch { return undefined; } }
function strictBody(value: unknown, keys: string[]) { if (value === undefined || value === null) return {} as Record<string, unknown>; if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; const body = value as Record<string, unknown>; return Object.keys(body).every((key) => keys.includes(key)) ? body : undefined; }
function cookie(request: FastifyRequest, name: string) { const raw = header(request.headers.cookie); if (!raw) return undefined; for (const part of raw.split(";")) { const [key, ...rest] = part.trim().split("="); if (key === name) return rest.join("="); } return undefined; }
function secure(reply: FastifyReply) { reply.header("Cache-Control", "no-store"); reply.header("Pragma", "no-cache"); reply.header("Referrer-Policy", "no-referrer"); reply.header("X-Content-Type-Options", "nosniff"); }
function takeRouteRate(
  rates: Map<string, { startedAt: number; count: number }>,
  request: FastifyRequest,
  secretValue: string,
  bucket: string,
  limit: number,
  windowMs: number,
  reply: FastifyReply,
  discriminator = ""
) {
  const forwarded = request.ip === "127.0.0.1" || request.ip === "::1"
    ? header(request.headers["x-forwarded-for"])?.split(",")[0]?.trim()
    : undefined;
  const client = forwarded && /^[0-9a-f:.]{3,64}$/i.test(forwarded) ? forwarded : request.ip;
  const key = hashSecret(secretValue, `rate-${bucket}`, `${client}|${discriminator}`);
  const now = Date.now();
  const current = rates.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    rates.set(key, { startedAt: now, count: 1 });
    if (rates.size > 10_000) for (const [entry, value] of rates) if (now - value.startedAt >= windowMs) rates.delete(entry);
    return true;
  }
  if (current.count < limit) { current.count += 1; return true; }
  const retryAfter = Math.max(1, Math.ceil((current.startedAt + windowMs - now) / 1_000));
  reply.header("Retry-After", String(retryAfter));
  reply.code(429).send({ error: "Agent authorization rate limit exceeded", code: "AGENT_AUTH_RATE_LIMITED", retry_after: retryAfter });
  return false;
}

function takeGlobalRate(
  rates: Map<string, { startedAt: number; count: number }>,
  secretValue: string,
  bucket: string,
  limit: number,
  windowMs: number,
  reply: FastifyReply
) {
  const key = hashSecret(secretValue, `rate-${bucket}-global`, "global");
  const now = Date.now();
  const current = rates.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    rates.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count < limit) { current.count += 1; return true; }
  const retryAfter = Math.max(1, Math.ceil((current.startedAt + windowMs - now) / 1_000));
  reply.header("Retry-After", String(retryAfter));
  reply.code(429).send({ error: "Agent authorization capacity limit exceeded", code: "AGENT_AUTH_RATE_LIMITED", retry_after: retryAfter });
  return false;
}
