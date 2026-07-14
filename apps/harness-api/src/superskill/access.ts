import { createHmac, timingSafeEqual } from "node:crypto";

import { SUPERSKILL_DEVICE_TOKEN_PREFIX, verifySuperskillDeviceToken } from "./device-token.js";

export const SUPERSKILL_MANAGED_SCOPE = "superskill:managed" as const;

export type SuperskillAccessScope = typeof SUPERSKILL_MANAGED_SCOPE;

export type SuperskillAccessPrincipal = {
  subject: string;
  scope: SuperskillAccessScope;
  cohort: string;
  evidence: "confirmed_user";
  publicGoEligible: true;
};

export type SuperskillAccessFailure = {
  ok: false;
  status: 401 | 403 | 503;
  code:
    | "SUPERSKILL_AUTH_REQUIRED"
    | "SUPERSKILL_AUTH_INVALID"
    | "SUPERSKILL_EMAIL_UNCONFIRMED"
    | "SUPERSKILL_ACCESS_DENIED"
    | "SUPERSKILL_AUTH_UNAVAILABLE";
};

export type SuperskillAccessResult =
  | { ok: true; principal: SuperskillAccessPrincipal }
  | SuperskillAccessFailure;

export type SuperskillAccessResolver = (input: {
  authorization: string | undefined;
  requiredScope: SuperskillAccessScope;
  now: Date;
}) => Promise<SuperskillAccessResult>;

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const DEFAULT_SUPABASE_AUTH_TIMEOUT_MS = 5_000;
const MAX_SUPABASE_AUTH_TIMEOUT_MS = 15_000;

export type SupabaseSuperskillAccessOptions = {
  supabaseUrl?: string;
  anonKey?: string;
  serviceRoleKey?: string;
  subjectSalt?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  agentTokenResolver?: (accessToken: string, requiredScopes: readonly [SuperskillAccessScope]) => Promise<
    | { ok: true; principal: { userId: string; subject: string; scopes: readonly string[] } }
    | { ok: false; kind: "invalid" | "forbidden" | "unavailable" }
  >;
};

type SupabaseAuthUser = {
  id?: unknown;
  email_confirmed_at?: unknown;
  banned_until?: unknown;
};

type SuperskillAccessGrantRow = {
  user_id?: unknown;
  subject?: unknown;
  scope?: unknown;
  cohort?: unknown;
  status?: unknown;
  expires_at?: unknown;
  revoked_at?: unknown;
};

/**
 * Builds the production managed-route resolver. It verifies the bearer with Supabase
 * Auth on every request and then reads the operator-controlled grant with the service
 * role. Neither credential nor the provider user document is returned to callers.
 */
export function createSupabaseSuperskillAccessResolver(options: SupabaseSuperskillAccessOptions = {}): SuperskillAccessResolver {
  const supabaseUrl = normalizeSupabaseOrigin(options.supabaseUrl ?? process.env.SUPABASE_URL);
  const anonKey = options.anonKey ?? process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = options.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const subjectSalt = options.subjectSalt ?? process.env.SUPERSKILL_SUBJECT_SALT;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = supabaseAuthTimeoutMs(options.timeoutMs ?? process.env.SUPABASE_AUTH_TIMEOUT_MS);

  return async ({ authorization, requiredScope, now }) => {
    const bearer = bearerToken(authorization);
    if (!bearer) return accessFailure(authorization ? "SUPERSKILL_AUTH_INVALID" : "SUPERSKILL_AUTH_REQUIRED");
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !validSubjectSalt(subjectSalt)) return accessFailure("SUPERSKILL_AUTH_UNAVAILABLE");

    const agent = bearer.startsWith("ohat_") && options.agentTokenResolver
      ? await options.agentTokenResolver(bearer, [requiredScope])
      : undefined;
    if (agent && !agent.ok) return accessFailure(
      agent.kind === "invalid" ? "SUPERSKILL_AUTH_INVALID"
        : agent.kind === "forbidden" ? "SUPERSKILL_ACCESS_DENIED"
          : "SUPERSKILL_AUTH_UNAVAILABLE"
    );
    const user = agent?.ok
      ? await fetchConfirmedAgentUser({
          supabaseUrl, serviceRoleKey, userId: agent.principal.userId, subject: agent.principal.subject,
          subjectSalt, fetchImpl, timeoutMs, now
        })
      : bearer.startsWith(SUPERSKILL_DEVICE_TOKEN_PREFIX)
        ? await fetchConfirmedDeviceUser({ supabaseUrl, serviceRoleKey, bearer, subjectSalt, requiredScope, fetchImpl, timeoutMs, now })
        : await fetchConfirmedUser({ supabaseUrl, anonKey, authorization: `Bearer ${bearer}`, fetchImpl, timeoutMs, now });
    if (!user.ok) return user;

    const expectedSubject = superskillUserSubject(user.userId, subjectSalt);
    if (agent?.ok && !safeSubjectEqual(agent.principal.subject, expectedSubject)) return accessFailure("SUPERSKILL_AUTH_INVALID");
    const grant = await fetchAccessGrant({
      supabaseUrl,
      serviceRoleKey,
      userId: user.userId,
      scope: requiredScope,
      fetchImpl,
      timeoutMs
    });
    if (!grant.ok) return grant;
    if (!grant.row) return accessFailure("SUPERSKILL_ACCESS_DENIED");

    const row = grant.row;
    if (
      row.userId !== user.userId
      || row.scope !== requiredScope
      || row.status !== "active"
      || row.revokedAt !== null
      || row.expiresAt.getTime() <= now.getTime()
      || !safeSubjectEqual(row.subject, expectedSubject)
    ) return accessFailure("SUPERSKILL_ACCESS_DENIED");

    return {
      ok: true,
      principal: {
        subject: expectedSubject,
        scope: requiredScope,
        cohort: row.cohort,
        evidence: "confirmed_user",
        publicGoEligible: true
      }
    };
  };
}

async function fetchConfirmedAgentUser(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
  subject: string;
  subjectSalt: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
  now: Date;
}): Promise<{ ok: true; userId: string } | SuperskillAccessFailure> {
  if (!safeSubjectEqual(input.subject, superskillUserSubject(input.userId, input.subjectSalt))) return accessFailure("SUPERSKILL_AUTH_INVALID");
  const result = await fetchSupabaseJsonExact({
    supabaseUrl: input.supabaseUrl,
    url: new URL(`/auth/v1/admin/users/${encodeURIComponent(input.userId)}`, `${input.supabaseUrl}/`),
    headers: { apikey: input.serviceRoleKey, authorization: `Bearer ${input.serviceRoleKey}` },
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs
  });
  if (!result) return accessFailure("SUPERSKILL_AUTH_UNAVAILABLE");
  if (result.status === 401 || result.status === 403 || result.status === 404) return accessFailure("SUPERSKILL_AUTH_INVALID");
  if (!result.ok || !result.hasJson || !result.payload || typeof result.payload !== "object" || Array.isArray(result.payload)) {
    return accessFailure("SUPERSKILL_AUTH_UNAVAILABLE");
  }
  const user = result.payload as SupabaseAuthUser;
  if (user.id !== input.userId || typeof user.email_confirmed_at !== "string" || !isValidTimestamp(user.email_confirmed_at)) {
    return accessFailure("SUPERSKILL_EMAIL_UNCONFIRMED");
  }
  if (Date.parse(user.email_confirmed_at) > input.now.getTime()) return accessFailure("SUPERSKILL_EMAIL_UNCONFIRMED");
  if (typeof user.banned_until === "string" && isValidTimestamp(user.banned_until) && Date.parse(user.banned_until) > input.now.getTime()) {
    return accessFailure("SUPERSKILL_ACCESS_DENIED");
  }
  return { ok: true, userId: input.userId };
}

async function fetchConfirmedDeviceUser(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  bearer: string;
  subjectSalt: string;
  requiredScope: SuperskillAccessScope;
  fetchImpl: FetchLike;
  timeoutMs: number;
  now: Date;
}): Promise<{ ok: true; userId: string } | SuperskillAccessFailure> {
  const token = verifySuperskillDeviceToken(input.bearer, input.subjectSalt, input.now);
  if (!token || token.scope !== input.requiredScope) return accessFailure("SUPERSKILL_AUTH_INVALID");
  const result = await fetchSupabaseJsonExact({
    supabaseUrl: input.supabaseUrl,
    url: new URL(`/auth/v1/admin/users/${encodeURIComponent(token.userId)}`, `${input.supabaseUrl}/`),
    headers: {
      apikey: input.serviceRoleKey,
      authorization: `Bearer ${input.serviceRoleKey}`
    },
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs
  });
  if (!result) return accessFailure("SUPERSKILL_AUTH_UNAVAILABLE");
  if (result.status === 401 || result.status === 403 || result.status === 404) return accessFailure("SUPERSKILL_AUTH_INVALID");
  if (!result.ok || !result.hasJson || !result.payload || typeof result.payload !== "object" || Array.isArray(result.payload)) {
    return accessFailure("SUPERSKILL_AUTH_UNAVAILABLE");
  }
  const user = result.payload as SupabaseAuthUser;
  if (user.id !== token.userId || typeof user.email_confirmed_at !== "string" || !isValidTimestamp(user.email_confirmed_at)) {
    return accessFailure("SUPERSKILL_EMAIL_UNCONFIRMED");
  }
  if (Date.parse(user.email_confirmed_at) > input.now.getTime()) return accessFailure("SUPERSKILL_EMAIL_UNCONFIRMED");
  if (!safeSubjectEqual(token.subject, superskillUserSubject(token.userId, input.subjectSalt))) return accessFailure("SUPERSKILL_AUTH_INVALID");
  return { ok: true, userId: token.userId };
}

export type SupabaseAuthIdentityResult =
  | { ok: true; user: { id: string; email?: string; emailConfirmedAt?: string } }
  | { ok: false; kind: "invalid" | "unavailable" };

/**
 * Fetches a Supabase Auth identity without allowing redirects or unbounded I/O.
 * Both managed access and the API's regular bearer auth use this same transport
 * boundary so credentials can never be replayed to a redirected origin.
 */
export async function fetchSupabaseAuthIdentity(input: {
  supabaseUrl: string;
  anonKey: string;
  authorization: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<SupabaseAuthIdentityResult> {
  const supabaseUrl = normalizeSupabaseOrigin(input.supabaseUrl);
  if (!supabaseUrl) return { ok: false, kind: "unavailable" };
  const result = await fetchSupabaseJsonExact({
    supabaseUrl,
    url: new URL("/auth/v1/user", `${supabaseUrl}/`),
    headers: { apikey: input.anonKey, authorization: input.authorization },
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs
  });
  if (!result) return { ok: false, kind: "unavailable" };
  if (result.status === 401 || result.status === 403) return { ok: false, kind: "invalid" };
  if (!result.ok || !result.hasJson || !result.payload || typeof result.payload !== "object" || Array.isArray(result.payload)) {
    return { ok: false, kind: "unavailable" };
  }
  const payload = result.payload as SupabaseAuthUser & { email?: unknown };
  if (typeof payload.id !== "string" || !isUuid(payload.id)) return { ok: false, kind: "invalid" };
  return {
    ok: true,
    user: {
      id: payload.id,
      ...(typeof payload.email === "string" ? { email: payload.email } : {}),
      ...(typeof payload.email_confirmed_at === "string" ? { emailConfirmedAt: payload.email_confirmed_at } : {})
    }
  };
}

export function normalizeSupabaseOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    const loopbackHttp = parsed.protocol === "http:"
      && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]");
    if (parsed.protocol !== "https:" && !loopbackHttp) return undefined;
    if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname !== "")) return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export function supabaseAuthTimeoutMs(value: number | string | undefined): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) return DEFAULT_SUPABASE_AUTH_TIMEOUT_MS;
  return Math.min(parsed, MAX_SUPABASE_AUTH_TIMEOUT_MS);
}

export function superskillUserSubject(userId: string, salt: string): string {
  return `user:${createHmac("sha256", salt).update(`superskill-user:${userId}`).digest("hex")}`;
}

function bearerToken(authorization: string | undefined): string | undefined {
  const match = authorization?.match(/^Bearer\s+([^\s]{1,8192})$/i);
  return match?.[1];
}

async function fetchConfirmedUser(input: {
  supabaseUrl: string;
  anonKey: string;
  authorization: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
  now: Date;
}): Promise<{ ok: true; userId: string } | SuperskillAccessFailure> {
  const identity = await fetchSupabaseAuthIdentity(input);
  if (!identity.ok) return accessFailure(identity.kind === "invalid" ? "SUPERSKILL_AUTH_INVALID" : "SUPERSKILL_AUTH_UNAVAILABLE");
  if (
    typeof identity.user.emailConfirmedAt !== "string"
    || !isValidTimestamp(identity.user.emailConfirmedAt)
    || Date.parse(identity.user.emailConfirmedAt) > input.now.getTime()
  ) {
    return accessFailure("SUPERSKILL_EMAIL_UNCONFIRMED");
  }
  return { ok: true, userId: identity.user.id };
}

async function fetchAccessGrant(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
  scope: SuperskillAccessScope;
  fetchImpl: FetchLike;
  timeoutMs: number;
}): Promise<{ ok: true; row?: NormalizedGrant } | SuperskillAccessFailure> {
  const url = new URL(`${input.supabaseUrl}/rest/v1/superskill_access_grants`);
  url.searchParams.set("select", "user_id,subject,scope,cohort,status,expires_at,revoked_at");
  url.searchParams.set("user_id", `eq.${input.userId}`);
  url.searchParams.set("scope", `eq.${input.scope}`);
  url.searchParams.set("limit", "2");
  const result = await fetchSupabaseJsonExact({
    supabaseUrl: input.supabaseUrl,
    url,
    headers: {
      apikey: input.serviceRoleKey,
      authorization: `Bearer ${input.serviceRoleKey}`
    },
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs
  });
  if (!result?.ok || !result.hasJson || !Array.isArray(result.payload)) return accessFailure("SUPERSKILL_AUTH_UNAVAILABLE");
  const rows = result.payload as SuperskillAccessGrantRow[];
  if (rows.length === 0) return { ok: true };
  if (rows.length !== 1) return accessFailure("SUPERSKILL_ACCESS_DENIED");
  const normalized = normalizeGrant(rows[0]);
  return normalized ? { ok: true, row: normalized } : accessFailure("SUPERSKILL_ACCESS_DENIED");
}

type SupabaseJsonResult = {
  ok: boolean;
  status: number;
  hasJson: boolean;
  payload?: unknown;
};

async function fetchSupabaseJsonExact(input: {
  supabaseUrl: string;
  url: URL;
  headers: Record<string, string>;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<SupabaseJsonResult | undefined> {
  const origin = normalizeSupabaseOrigin(input.supabaseUrl);
  if (!origin || input.url.origin !== origin || input.url.username || input.url.password || input.url.hash) return undefined;
  const expectedUrl = input.url.href;
  const controller = new AbortController();
  const timeoutMs = supabaseAuthTimeoutMs(input.timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Supabase request timed out"));
    }, timeoutMs);
    timer.unref?.();
  });
  const request = (async (): Promise<SupabaseJsonResult> => {
    const response = await (input.fetchImpl ?? fetch)(input.url, {
      headers: input.headers,
      redirect: "error",
      signal: controller.signal
    });
    if (response.url !== expectedUrl) throw new Error("Supabase response URL mismatch");
    if (!response.ok) return { ok: false, status: response.status, hasJson: false };
    const text = await response.text();
    if (!text) return { ok: true, status: response.status, hasJson: false };
    return { ok: true, status: response.status, hasJson: true, payload: JSON.parse(text) as unknown };
  })();
  try {
    return await Promise.race([request, timeout]);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}

type NormalizedGrant = {
  userId: string;
  subject: string;
  scope: string;
  cohort: string;
  status: string;
  expiresAt: Date;
  revokedAt: string | null;
};

function normalizeGrant(row: SuperskillAccessGrantRow): NormalizedGrant | undefined {
  if (
    typeof row.user_id !== "string"
    || !isUuid(row.user_id)
    || typeof row.subject !== "string"
    || !/^user:[a-f0-9]{64}$/.test(row.subject)
    || typeof row.scope !== "string"
    || typeof row.cohort !== "string"
    || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(row.cohort)
    || typeof row.status !== "string"
    || typeof row.expires_at !== "string"
    || !isValidTimestamp(row.expires_at)
    || (row.revoked_at !== null && row.revoked_at !== undefined && (typeof row.revoked_at !== "string" || !isValidTimestamp(row.revoked_at)))
  ) return undefined;
  return {
    userId: row.user_id,
    subject: row.subject,
    scope: row.scope,
    cohort: row.cohort,
    status: row.status,
    expiresAt: new Date(row.expires_at),
    revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null
  };
}

function accessFailure(code: SuperskillAccessFailure["code"]): SuperskillAccessFailure {
  if (code === "SUPERSKILL_AUTH_REQUIRED" || code === "SUPERSKILL_AUTH_INVALID") return { ok: false, status: 401, code };
  if (code === "SUPERSKILL_AUTH_UNAVAILABLE") return { ok: false, status: 503, code };
  return { ok: false, status: 403, code };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isValidTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function safeSubjectEqual(left: string, right: string): boolean {
  if (!/^user:[a-f0-9]{64}$/.test(left) || !/^user:[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function validSubjectSalt(value: string | undefined): value is string {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") >= 32;
}
