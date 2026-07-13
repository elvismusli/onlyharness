import { createHmac, randomBytes } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  fetchSupabaseAuthIdentity,
  normalizeSupabaseOrigin,
  SUPERSKILL_MANAGED_SCOPE,
  supabaseAuthTimeoutMs,
  superskillUserSubject,
  type FetchLike
} from "./access.js";
import {
  deriveDeviceSigningKey,
  issueSuperskillDeviceToken,
  SUPERSKILL_DEVICE_TOKEN_MAX_TTL_SECONDS
} from "./device-token.js";

const DEVICE_SESSION_TTL_SECONDS = 10 * 60;
const DEVICE_POLL_INTERVAL_SECONDS = 3;
const DEVICE_STORE_LIMIT = 5_000;
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SELF_SERVICE_ACTOR = "self-service:device-auth";
const SELF_SERVICE_COHORT = "self-service";

type DeviceSessionState = "pending" | "approving" | "approved" | "consumed";

type DeviceSession = {
  state: DeviceSessionState;
  createdAtMs: number;
  expiresAtMs: number;
  lastPollAtMs?: number;
  userId?: string;
  tokenExpiresAtMs?: number;
};

type RateBucket = { startedAtMs: number; count: number };

export type DeviceAuthUser = { id: string; emailConfirmedAt: string };

export type DeviceAuthIdentityResolver = (input: {
  authorization: string | undefined;
  now: Date;
}) => Promise<
  | { ok: true; user: DeviceAuthUser }
  | { ok: false; status: 401 | 403 | 503; code: "DEVICE_AUTH_REQUIRED" | "DEVICE_AUTH_INVALID" | "DEVICE_AUTH_EMAIL_UNCONFIRMED" | "DEVICE_AUTH_UNAVAILABLE" }
>;

export type DeviceAuthGrantResolver = (input: {
  userId: string;
  subject: string;
  expiresAt: Date;
}) => Promise<{ ok: true } | { ok: false; kind: "denied" | "unavailable" }>;

export type SuperskillDeviceAuthOptions = {
  subjectSalt?: string;
  publicUrl?: string;
  identityResolver?: DeviceAuthIdentityResolver;
  grantResolver?: DeviceAuthGrantResolver;
  fetchImpl?: FetchLike;
  now?: () => Date;
  random?: (bytes: number) => Buffer;
  sessionTtlSeconds?: number;
  pollIntervalSeconds?: number;
  tokenTtlSeconds?: number;
  storeLimit?: number;
  available?: boolean;
};

export type SuperskillDeviceAuthService = ReturnType<typeof createSuperskillDeviceAuthService>;

export function createSuperskillDeviceAuthService(options: SuperskillDeviceAuthOptions = {}) {
  const subjectSalt = options.subjectSalt ?? process.env.SUPERSKILL_SUBJECT_SALT ?? "";
  const signingKey = deriveDeviceSigningKey(subjectSalt);
  const publicUrl = normalizePublicUrl(options.publicUrl ?? process.env.SUPERSKILL_PUBLIC_URL ?? "https://superskill.sh");
  const now = options.now ?? (() => new Date());
  const random = options.random ?? randomBytes;
  const sessionTtlSeconds = boundedSeconds(options.sessionTtlSeconds, DEVICE_SESSION_TTL_SECONDS, 120, 15 * 60);
  const pollIntervalSeconds = boundedSeconds(options.pollIntervalSeconds, DEVICE_POLL_INTERVAL_SECONDS, 1, 10);
  const tokenTtlSeconds = boundedSeconds(options.tokenTtlSeconds, SUPERSKILL_DEVICE_TOKEN_MAX_TTL_SECONDS, 300, SUPERSKILL_DEVICE_TOKEN_MAX_TTL_SECONDS);
  const storeLimit = boundedInteger(options.storeLimit, DEVICE_STORE_LIMIT, 100, 20_000);
  const available = options.available ?? Boolean(
    signingKey
    && publicUrl
    && (
      (options.identityResolver && options.grantResolver)
      || (normalizeSupabaseOrigin(process.env.SUPABASE_URL) && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY)
    )
  );
  const sessions = new Map<string, DeviceSession>();
  const userCodes = new Map<string, string>();
  const startRates = new Map<string, RateBucket>();
  const approveRates = new Map<string, RateBucket>();
  const tokenRates = new Map<string, RateBucket>();

  function start(clientKey: string):
    | { ok: true; deviceCode: string; userCode: string; verificationUrl: string; expiresIn: number; interval: number }
    | { ok: false; status: 429 | 503; code: "DEVICE_AUTH_RATE_LIMITED" | "DEVICE_AUTH_UNAVAILABLE"; retryAfter?: number } {
    const requestNow = now();
    cleanup(requestNow.getTime());
    if (!available || !signingKey || !publicUrl) return { ok: false, status: 503, code: "DEVICE_AUTH_UNAVAILABLE" };
    const globalRate = takeRate(startRates, "global", 120, 60_000, requestNow.getTime());
    const clientRate = takeRate(startRates, `client:${rateKey(clientKey, signingKey)}`, 20, 60_000, requestNow.getTime());
    if (!globalRate.ok || !clientRate.ok) {
      const globalRetry = globalRate.ok ? 0 : globalRate.retryAfter;
      const clientRetry = clientRate.ok ? 0 : clientRate.retryAfter;
      return { ok: false, status: 429, code: "DEVICE_AUTH_RATE_LIMITED", retryAfter: Math.max(globalRetry, clientRetry, 1) };
    }
    if (sessions.size >= storeLimit) return { ok: false, status: 503, code: "DEVICE_AUTH_UNAVAILABLE" };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const deviceCode = `ohdc_${random(32).toString("base64url")}`;
      const userCodeRaw = randomUserCode(random);
      const deviceHash = secretHash(signingKey, "device", deviceCode);
      const userHash = secretHash(signingKey, "user", userCodeRaw);
      if (sessions.has(deviceHash) || userCodes.has(userHash)) continue;
      sessions.set(deviceHash, {
        state: "pending",
        createdAtMs: requestNow.getTime(),
        expiresAtMs: requestNow.getTime() + sessionTtlSeconds * 1_000
      });
      userCodes.set(userHash, deviceHash);
      return {
        ok: true,
        deviceCode,
        userCode: `${userCodeRaw.slice(0, 4)}-${userCodeRaw.slice(4)}`,
        verificationUrl: `${publicUrl}/#/superskill/account`,
        expiresIn: sessionTtlSeconds,
        interval: pollIntervalSeconds
      };
    }
    return { ok: false, status: 503, code: "DEVICE_AUTH_UNAVAILABLE" };
  }

  function preflightApprove(clientKey: string):
    | { ok: true }
    | { ok: false; status: 429; code: "DEVICE_AUTH_RATE_LIMITED"; retryAfter: number }
    | { ok: false; status: 503; code: "DEVICE_AUTH_UNAVAILABLE" } {
    const requestNow = now();
    cleanup(requestNow.getTime());
    if (!available || !signingKey) return { ok: false, status: 503, code: "DEVICE_AUTH_UNAVAILABLE" };
    const rate = takeRate(approveRates, `client:${rateKey(clientKey, signingKey)}`, 30, 5 * 60_000, requestNow.getTime());
    return rate.ok ? rate : { ok: false, status: 429, code: "DEVICE_AUTH_RATE_LIMITED", retryAfter: rate.retryAfter };
  }

  async function approve(input: { clientKey: string; userCode: string; user: DeviceAuthUser }): Promise<
    | { ok: true; expiresIn: number }
    | { ok: false; status: 400 | 403 | 409 | 410 | 429 | 503; code: string; retryAfter?: number }
  > {
    const requestNow = now();
    cleanup(requestNow.getTime());
    if (!signingKey) return { ok: false, status: 503, code: "DEVICE_AUTH_UNAVAILABLE" };
    const normalized = normalizeUserCode(input.userCode);
    if (!normalized) return { ok: false, status: 400, code: "DEVICE_USER_CODE_INVALID" };
    const deviceHash = userCodes.get(secretHash(signingKey, "user", normalized));
    const session = deviceHash ? sessions.get(deviceHash) : undefined;
    if (!deviceHash || !session) return { ok: false, status: 400, code: "DEVICE_USER_CODE_INVALID" };
    if (session.expiresAtMs <= requestNow.getTime()) {
      deleteSession(deviceHash);
      return { ok: false, status: 410, code: "DEVICE_CODE_EXPIRED" };
    }
    if (session.state !== "pending") return { ok: false, status: 409, code: "DEVICE_CODE_USED" };
    session.state = "approving";
    const subject = superskillUserSubject(input.user.id, subjectSalt);
    const tokenExpiresAt = new Date(requestNow.getTime() + tokenTtlSeconds * 1_000);
    let granted: Awaited<ReturnType<DeviceAuthGrantResolver>>;
    try {
      granted = await (options.grantResolver ?? createSupabaseDeviceGrantResolver({ subjectSalt, fetchImpl: options.fetchImpl }))({
        userId: input.user.id,
        subject,
        expiresAt: tokenExpiresAt
      });
    } catch {
      granted = { ok: false, kind: "unavailable" };
    }
    if (!granted.ok) {
      session.state = "pending";
      return granted.kind === "denied"
        ? { ok: false, status: 403, code: "DEVICE_AUTH_ACCESS_DENIED" }
        : { ok: false, status: 503, code: "DEVICE_AUTH_UNAVAILABLE" };
    }
    session.state = "approved";
    session.userId = input.user.id;
    session.tokenExpiresAtMs = tokenExpiresAt.getTime();
    return { ok: true, expiresIn: tokenTtlSeconds };
  }

  function token(input: { clientKey: string; deviceCode: string }):
    | { ok: true; accessToken: string; expiresIn: number }
    | { ok: false; status: 202 | 400 | 409 | 410 | 429 | 503; code: string; retryAfter?: number } {
    const requestNow = now();
    cleanup(requestNow.getTime());
    if (!signingKey || !/^ohdc_[A-Za-z0-9_-]{43}$/.test(input.deviceCode)) return { ok: false, status: 400, code: "DEVICE_CODE_INVALID" };
    const globalRate = takeRate(tokenRates, "global", 1_200, 60_000, requestNow.getTime());
    const clientRate = takeRate(tokenRates, `client:${rateKey(input.clientKey, signingKey)}`, 120, 60_000, requestNow.getTime());
    if (!globalRate.ok || !clientRate.ok) {
      const globalRetry = globalRate.ok ? 0 : globalRate.retryAfter;
      const clientRetry = clientRate.ok ? 0 : clientRate.retryAfter;
      return { ok: false, status: 429, code: "DEVICE_AUTH_RATE_LIMITED", retryAfter: Math.max(globalRetry, clientRetry, 1) };
    }
    const deviceHash = secretHash(signingKey, "device", input.deviceCode);
    const session = sessions.get(deviceHash);
    if (!session) return { ok: false, status: 400, code: "DEVICE_CODE_INVALID" };
    if (session.expiresAtMs <= requestNow.getTime()) {
      deleteSession(deviceHash);
      return { ok: false, status: 410, code: "DEVICE_CODE_EXPIRED" };
    }
    if (session.state === "consumed") return { ok: false, status: 409, code: "DEVICE_CODE_USED" };
    if (session.lastPollAtMs !== undefined && requestNow.getTime() - session.lastPollAtMs < pollIntervalSeconds * 1_000) {
      return { ok: false, status: 429, code: "DEVICE_AUTH_SLOW_DOWN", retryAfter: pollIntervalSeconds };
    }
    session.lastPollAtMs = requestNow.getTime();
    if (session.state === "pending" || session.state === "approving") {
      return { ok: false, status: 202, code: "AUTHORIZATION_PENDING", retryAfter: pollIntervalSeconds };
    }
    if (!session.userId || !session.tokenExpiresAtMs || session.tokenExpiresAtMs <= requestNow.getTime()) {
      session.state = "consumed";
      return { ok: false, status: 410, code: "DEVICE_CODE_EXPIRED" };
    }
    const accessToken = issueSuperskillDeviceToken({
      userId: session.userId,
      subjectSalt,
      issuedAt: requestNow,
      expiresAt: new Date(session.tokenExpiresAtMs),
      tokenId: random(18).toString("base64url")
    });
    if (!accessToken) return { ok: false, status: 503, code: "DEVICE_AUTH_UNAVAILABLE" };
    session.state = "consumed";
    return {
      ok: true,
      accessToken,
      expiresIn: Math.max(1, Math.floor((session.tokenExpiresAtMs - requestNow.getTime()) / 1_000))
    };
  }

  function cleanup(nowMs: number) {
    for (const [deviceHash, session] of sessions) {
      if (session.expiresAtMs + 60_000 <= nowMs) deleteSession(deviceHash);
    }
    cleanupRates(startRates, nowMs, 60_000);
    cleanupRates(approveRates, nowMs, 5 * 60_000);
    cleanupRates(tokenRates, nowMs, 60_000);
  }

  function deleteSession(deviceHash: string) {
    sessions.delete(deviceHash);
    for (const [userHash, mappedDeviceHash] of userCodes) {
      if (mappedDeviceHash === deviceHash) userCodes.delete(userHash);
    }
  }

  return { start, preflightApprove, approve, token };
}

export async function registerSuperskillDeviceAuthRoutes(app: FastifyInstance, options: SuperskillDeviceAuthOptions = {}): Promise<void> {
  const service = createSuperskillDeviceAuthService(options);
  const identityResolver = options.identityResolver ?? createSupabaseDeviceIdentityResolver({ fetchImpl: options.fetchImpl });
  const now = options.now ?? (() => new Date());

  app.post("/auth/device/start", async (request, reply) => {
    noStore(reply);
    const body = strictBody(request.body, ["client"]);
    if (!body) return reply.code(400).send({ error: "Invalid device start request", code: "DEVICE_CLIENT_INVALID" });
    if (body.client !== undefined && body.client !== "codex" && body.client !== "claude-code" && body.client !== "cli") {
      return reply.code(400).send({ error: "Unsupported device client", code: "DEVICE_CLIENT_INVALID" });
    }
    const result = service.start(clientKey(request));
    if (!result.ok) return sendDeviceFailure(reply, result);
    return reply.code(201).send({
      device_code: result.deviceCode,
      user_code: result.userCode,
      verification_uri: result.verificationUrl,
      expires_in: result.expiresIn,
      interval: result.interval
    });
  });

  app.post("/auth/device/approve", async (request, reply) => {
    noStore(reply);
    const body = strictBody(request.body, ["user_code"]);
    if (!body) return reply.code(400).send({ error: "Invalid device approval request", code: "DEVICE_USER_CODE_INVALID" });
    if (typeof body.user_code !== "string" || body.user_code.length > 16 || !/^[A-Za-z2-9\s-]{8,16}$/.test(body.user_code)) {
      return reply.code(400).send({ error: "User code is required", code: "DEVICE_USER_CODE_INVALID" });
    }
    const preflight = service.preflightApprove(clientKey(request));
    if (!preflight.ok) return sendDeviceFailure(reply, preflight);
    const identity = await identityResolver({ authorization: headerValue(request.headers.authorization), now: now() });
    if (!identity.ok) return reply.code(identity.status).send({ error: deviceAuthError(identity.code), code: identity.code });
    const result = await service.approve({ clientKey: clientKey(request), userCode: body.user_code, user: identity.user });
    if (!result.ok) return sendDeviceFailure(reply, result);
    return reply.send({ approved: true, expires_in: result.expiresIn });
  });

  app.post("/auth/device/token", async (request, reply) => {
    noStore(reply);
    const body = strictBody(request.body, ["device_code"]);
    if (!body) return reply.code(400).send({ error: "Invalid device token request", code: "DEVICE_CODE_INVALID" });
    if (typeof body.device_code !== "string") return reply.code(400).send({ error: "Device code is required", code: "DEVICE_CODE_INVALID" });
    const result = service.token({ clientKey: clientKey(request), deviceCode: body.device_code });
    if (!result.ok) return sendDeviceFailure(reply, result);
    return reply.send({ access_token: result.accessToken, token_type: "Bearer", expires_in: result.expiresIn, scope: SUPERSKILL_MANAGED_SCOPE });
  });
}

export function createSupabaseDeviceIdentityResolver(options: {
  fetchImpl?: FetchLike;
  supabaseUrl?: string;
  anonKey?: string;
  timeoutMs?: number;
} = {}): DeviceAuthIdentityResolver {
  const supabaseUrl = normalizeSupabaseOrigin(options.supabaseUrl ?? process.env.SUPABASE_URL);
  const anonKey = options.anonKey ?? process.env.SUPABASE_ANON_KEY;
  const timeoutMs = supabaseAuthTimeoutMs(options.timeoutMs ?? process.env.SUPABASE_AUTH_TIMEOUT_MS);
  return async ({ authorization, now }) => {
    if (!authorization) return { ok: false, status: 401, code: "DEVICE_AUTH_REQUIRED" };
    if (!/^Bearer\s+[^\s]{1,8192}$/i.test(authorization)) return { ok: false, status: 401, code: "DEVICE_AUTH_INVALID" };
    if (!supabaseUrl || !anonKey) return { ok: false, status: 503, code: "DEVICE_AUTH_UNAVAILABLE" };
    const identity = await fetchSupabaseAuthIdentity({ supabaseUrl, anonKey, authorization, timeoutMs, fetchImpl: options.fetchImpl });
    if (!identity.ok) return identity.kind === "invalid"
      ? { ok: false, status: 401, code: "DEVICE_AUTH_INVALID" }
      : { ok: false, status: 503, code: "DEVICE_AUTH_UNAVAILABLE" };
    const confirmedAt = typeof identity.user.emailConfirmedAt === "string" ? Date.parse(identity.user.emailConfirmedAt) : Number.NaN;
    if (!Number.isFinite(confirmedAt) || confirmedAt > now.getTime()) return { ok: false, status: 403, code: "DEVICE_AUTH_EMAIL_UNCONFIRMED" };
    return { ok: true, user: { id: identity.user.id, emailConfirmedAt: identity.user.emailConfirmedAt! } };
  };
}

export function createSupabaseDeviceGrantResolver(options: {
  subjectSalt: string;
  fetchImpl?: FetchLike;
  supabaseUrl?: string;
  serviceRoleKey?: string;
  timeoutMs?: number;
}): DeviceAuthGrantResolver {
  const supabaseUrl = normalizeSupabaseOrigin(options.supabaseUrl ?? process.env.SUPABASE_URL);
  const serviceRoleKey = options.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const timeoutMs = supabaseAuthTimeoutMs(options.timeoutMs ?? process.env.SUPABASE_AUTH_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl ?? fetch;
  return async ({ userId, subject, expiresAt }) => {
    if (!supabaseUrl || !serviceRoleKey || !deriveDeviceSigningKey(options.subjectSalt)) return { ok: false, kind: "unavailable" };
    const grantsUrl = new URL(`${supabaseUrl}/rest/v1/superskill_access_grants`);
    grantsUrl.searchParams.set("select", "user_id,subject,scope,status,expires_at,revoked_at");
    grantsUrl.searchParams.set("user_id", `eq.${userId}`);
    grantsUrl.searchParams.set("scope", `eq.${SUPERSKILL_MANAGED_SCOPE}`);
    grantsUrl.searchParams.set("limit", "2");
    const existing = await safeSupabaseRequest({
      supabaseUrl,
      url: grantsUrl,
      serviceRoleKey,
      fetchImpl,
      timeoutMs
    });
    if (!existing?.ok || !Array.isArray(existing.payload) || existing.payload.length > 1) return { ok: false, kind: "unavailable" };
    if (existing.payload.length === 1) {
      const row = existing.payload[0] as Record<string, unknown>;
      if (row.user_id !== userId || row.subject !== subject || row.scope !== SUPERSKILL_MANAGED_SCOPE) return { ok: false, kind: "denied" };
      if (row.status === "revoked" || row.status === "suspended" || row.revoked_at !== null) return { ok: false, kind: "denied" };
      if (row.status !== "active" || typeof row.expires_at !== "string" || !Number.isFinite(Date.parse(row.expires_at))) return { ok: false, kind: "denied" };
      if (Date.parse(row.expires_at) >= expiresAt.getTime()) return { ok: true };
    }
    const rpc = await safeSupabaseRequest({
      supabaseUrl,
      url: new URL(`${supabaseUrl}/rest/v1/rpc/upsert_superskill_access_grant`),
      serviceRoleKey,
      fetchImpl,
      timeoutMs,
      method: "POST",
      body: JSON.stringify({
        p_subject: subject,
        p_user_id: userId,
        p_scope: SUPERSKILL_MANAGED_SCOPE,
        p_cohort: SELF_SERVICE_COHORT,
        p_expires_at: expiresAt.toISOString(),
        p_actor: SELF_SERVICE_ACTOR
      })
    });
    if (rpc?.ok) return { ok: true };
    if (rpc && (rpc.status === 400 || rpc.status === 409)) return { ok: false, kind: "denied" };
    return { ok: false, kind: "unavailable" };
  };
}

async function safeSupabaseRequest(input: {
  supabaseUrl: string;
  url: URL;
  serviceRoleKey: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
  method?: "GET" | "POST";
  body?: string;
}): Promise<{ ok: boolean; status: number; payload?: unknown } | undefined> {
  if (input.url.origin !== input.supabaseUrl || input.url.username || input.url.password || input.url.hash) return undefined;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Supabase request timed out"));
      }, input.timeoutMs);
      timer.unref?.();
    });
    const request = (async () => {
      const response = await input.fetchImpl(input.url, {
        method: input.method ?? "GET",
        headers: {
          apikey: input.serviceRoleKey,
          authorization: `Bearer ${input.serviceRoleKey}`,
          ...(input.body ? { "content-type": "application/json" } : {})
        },
        ...(input.body ? { body: input.body } : {}),
        redirect: "error",
        signal: controller.signal
      });
      if (response.url !== input.url.href) throw new Error("Supabase response URL mismatch");
      const text = response.ok ? await response.text() : "";
      let payload: unknown;
      if (text) payload = JSON.parse(text) as unknown;
      return { ok: response.ok, status: response.status, ...(payload === undefined ? {} : { payload }) };
    })();
    return await Promise.race([request, timeout]);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}

function sendDeviceFailure(reply: FastifyReply, result: { status: number; code: string; retryAfter?: number }) {
  if (result.retryAfter) reply.header("Retry-After", String(result.retryAfter));
  return reply.code(result.status).send({ error: deviceAuthError(result.code), code: result.code, ...(result.retryAfter ? { retry_after: result.retryAfter } : {}) });
}

function deviceAuthError(code: string): string {
  if (code === "AUTHORIZATION_PENDING") return "Waiting for browser approval";
  if (code === "DEVICE_AUTH_SLOW_DOWN" || code === "DEVICE_AUTH_RATE_LIMITED") return "Too many device authorization requests";
  if (code === "DEVICE_CODE_EXPIRED") return "Device authorization expired";
  if (code === "DEVICE_CODE_USED") return "Device authorization was already used";
  if (code === "DEVICE_AUTH_EMAIL_UNCONFIRMED") return "Confirm your email before approving this device";
  if (code === "DEVICE_AUTH_ACCESS_DENIED") return "Managed access is suspended or revoked";
  if (code === "DEVICE_AUTH_REQUIRED") return "Sign in before approving a device";
  if (code === "DEVICE_AUTH_INVALID") return "Invalid or expired browser session";
  if (code === "DEVICE_AUTH_UNAVAILABLE") return "Device authorization is unavailable";
  return "Invalid device authorization code";
}

function noStore(reply: FastifyReply) {
  reply.header("Cache-Control", "no-store");
  reply.header("Pragma", "no-cache");
  reply.header("Referrer-Policy", "no-referrer");
}

function clientKey(request: FastifyRequest): string {
  return `${request.ip}|${headerValue(request.headers["user-agent"])?.slice(0, 160) ?? "unknown"}`;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function strictBody(value: unknown, allowedKeys: string[]): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  return Object.keys(body).every((key) => allowedKeys.includes(key)) ? body : undefined;
}

function normalizePublicUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    const loopback = parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]");
    if ((parsed.protocol !== "https:" && !loopback) || parsed.username || parsed.password || parsed.search || parsed.hash) return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function normalizeUserCode(value: string): string | undefined {
  const normalized = value.toUpperCase().replace(/[\s-]+/g, "");
  return normalized.length === 8 && [...normalized].every((char) => USER_CODE_ALPHABET.includes(char)) ? normalized : undefined;
}

function randomUserCode(random: (bytes: number) => Buffer): string {
  const bytes = random(8);
  let output = "";
  for (let index = 0; index < 8; index += 1) output += USER_CODE_ALPHABET[bytes[index] % USER_CODE_ALPHABET.length];
  return output;
}

function secretHash(key: Buffer, kind: string, value: string): string {
  return createHmac("sha256", key).update(`superskill-device-${kind}:${value}`).digest("hex");
}

function rateKey(value: string, key: Buffer): string {
  return createHmac("sha256", key).update(`superskill-device-rate:${value}`).digest("hex");
}

function takeRate(map: Map<string, RateBucket>, key: string, limit: number, windowMs: number, nowMs: number): { ok: true } | { ok: false; retryAfter: number } {
  const existing = map.get(key);
  if (!existing || nowMs - existing.startedAtMs >= windowMs) {
    map.set(key, { startedAtMs: nowMs, count: 1 });
    return { ok: true };
  }
  if (existing.count >= limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((existing.startedAtMs + windowMs - nowMs) / 1_000)) };
  existing.count += 1;
  return { ok: true };
}

function cleanupRates(map: Map<string, RateBucket>, nowMs: number, windowMs: number) {
  for (const [key, bucket] of map) if (nowMs - bucket.startedAtMs >= windowMs) map.delete(key);
}

function boundedSeconds(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return boundedInteger(value, fallback, minimum, maximum);
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Number.isInteger(value) && value !== undefined && value >= minimum && value <= maximum ? value : fallback;
}
