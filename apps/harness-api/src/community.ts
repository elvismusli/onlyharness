import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { EntitlementSubject } from "./payments.js";

export type CommunityInviteCodePayload = {
  v: 1;
  subject: EntitlementSubject;
  owner: string;
  repo: string;
  version: string;
  exp: number;
  nonce: string;
};

export type CommunityInviteCodeResult =
  | { ok: true; code: string; payload: CommunityInviteCodePayload }
  | { ok: false; error: string };

export type CommunityInviteVerifyResult =
  | { ok: true; payload: CommunityInviteCodePayload }
  | { ok: false; status: 400 | 410; error: string };

export type WorkspaceJoinCodeSource = "telegram" | "discord" | "entitlement";

export type WorkspaceJoinCodePayload = {
  v: 1;
  kind: "workspace_join";
  workspace: string;
  subject: { type: "user"; id: string };
  source: WorkspaceJoinCodeSource;
  policyId?: string;
  exp: number;
  nonce: string;
};

export type WorkspaceJoinCodeResult =
  | { ok: true; code: string; payload: WorkspaceJoinCodePayload }
  | { ok: false; error: string };

export type WorkspaceJoinCodeVerifyResult =
  | { ok: true; payload: WorkspaceJoinCodePayload }
  | { ok: false; status: 400 | 410; error: string };

const codePrefix = "ohc_";
const workspaceJoinCodePrefix = "ohwj_";

export function createCommunityInviteCode(input: {
  subject: EntitlementSubject;
  owner: string;
  repo: string;
  version: string;
  secret: string;
  ttlSeconds?: number;
  nowMs?: number;
}): CommunityInviteCodeResult {
  const secret = input.secret.trim();
  if (secret.length < 24) return { ok: false, error: "COMMUNITY_INVITE_SECRET must be at least 24 characters" };
  const ttlSeconds = clampTtl(input.ttlSeconds);
  const nowMs = input.nowMs ?? Date.now();
  const payload: CommunityInviteCodePayload = {
    v: 1,
    subject: input.subject,
    owner: input.owner,
    repo: input.repo,
    version: input.version,
    exp: Math.floor(nowMs / 1000) + ttlSeconds,
    nonce: randomUUID()
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encoded, secret);
  return { ok: true, code: `${codePrefix}${encoded}.${signature}`, payload };
}

export function verifyCommunityInviteCode(input: {
  code: string;
  secret: string;
  nowMs?: number;
}): CommunityInviteVerifyResult {
  const secret = input.secret.trim();
  if (secret.length < 24) return { ok: false, status: 400, error: "Community invite secret is not configured" };
  const raw = input.code.trim();
  const normalized = raw.startsWith(codePrefix) ? raw.slice(codePrefix.length) : raw;
  const [encoded, signature, extra] = normalized.split(".");
  if (!encoded || !signature || extra !== undefined) return { ok: false, status: 400, error: "Invalid community code" };
  if (!safeEqual(sign(encoded, secret), signature)) return { ok: false, status: 400, error: "Invalid community code" };
  let payload: CommunityInviteCodePayload;
  try {
    payload = JSON.parse(base64UrlDecode(encoded)) as CommunityInviteCodePayload;
  } catch {
    return { ok: false, status: 400, error: "Invalid community code" };
  }
  if (!isValidPayload(payload)) return { ok: false, status: 400, error: "Invalid community code" };
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (payload.exp <= nowSeconds) return { ok: false, status: 410, error: "Community code expired" };
  return { ok: true, payload };
}

export function createWorkspaceJoinCode(input: {
  workspace: string;
  userId: string;
  source: WorkspaceJoinCodeSource;
  policyId?: string;
  secret: string;
  ttlSeconds?: number;
  nowMs?: number;
}): WorkspaceJoinCodeResult {
  const secret = input.secret.trim();
  if (secret.length < 24) return { ok: false, error: "WORKSPACE_JOIN_SECRET must be at least 24 characters" };
  const workspace = input.workspace.trim().toLowerCase();
  const userId = input.userId.trim();
  const policyId = input.policyId?.trim();
  if (!isValidWorkspaceSlug(workspace)) return { ok: false, error: "Invalid workspace slug" };
  if (!isValidUserId(userId)) return { ok: false, error: "Invalid workspace join subject" };
  if (!isValidWorkspaceJoinSource(input.source)) return { ok: false, error: "Invalid workspace join source" };
  if (policyId && !isValidPolicyId(policyId)) return { ok: false, error: "Invalid workspace join policy" };
  const ttlSeconds = clampTtl(input.ttlSeconds);
  const nowMs = input.nowMs ?? Date.now();
  const payload: WorkspaceJoinCodePayload = {
    v: 1,
    kind: "workspace_join",
    workspace,
    subject: { type: "user", id: userId },
    source: input.source,
    ...(policyId ? { policyId } : {}),
    exp: Math.floor(nowMs / 1000) + ttlSeconds,
    nonce: randomUUID()
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encoded, secret);
  return { ok: true, code: `${workspaceJoinCodePrefix}${encoded}.${signature}`, payload };
}

export function verifyWorkspaceJoinCode(input: {
  code: string;
  secret: string;
  nowMs?: number;
}): WorkspaceJoinCodeVerifyResult {
  const secret = input.secret.trim();
  if (secret.length < 24) return { ok: false, status: 400, error: "Workspace join secret is not configured" };
  const raw = input.code.trim();
  const normalized = raw.startsWith(workspaceJoinCodePrefix) ? raw.slice(workspaceJoinCodePrefix.length) : raw;
  const [encoded, signature, extra] = normalized.split(".");
  if (!encoded || !signature || extra !== undefined) return { ok: false, status: 400, error: "Invalid workspace join code" };
  if (!safeEqual(sign(encoded, secret), signature)) return { ok: false, status: 400, error: "Invalid workspace join code" };
  let payload: WorkspaceJoinCodePayload;
  try {
    payload = JSON.parse(base64UrlDecode(encoded)) as WorkspaceJoinCodePayload;
  } catch {
    return { ok: false, status: 400, error: "Invalid workspace join code" };
  }
  if (!isValidWorkspaceJoinPayload(payload)) return { ok: false, status: 400, error: "Invalid workspace join code" };
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (payload.exp <= nowSeconds) return { ok: false, status: 410, error: "Workspace join code expired" };
  return { ok: true, payload };
}

function clampTtl(value: number | undefined): number {
  if (!Number.isFinite(value)) return 600;
  return Math.max(60, Math.min(Math.floor(value ?? 600), 3600));
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function isValidPayload(value: CommunityInviteCodePayload): boolean {
  if (value?.v !== 1) return false;
  if (!Number.isInteger(value.exp) || value.exp <= 0) return false;
  if (typeof value.nonce !== "string" || value.nonce.length < 16 || value.nonce.length > 80) return false;
  if (!/^[a-z0-9][a-z0-9_-]{1,80}$/.test(value.repo)) return false;
  if (!/^@?[a-z0-9][a-z0-9_-]{1,80}$/.test(value.owner)) return false;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,60}$/.test(value.version)) return false;
  if (value.subject?.type === "org") return /^[a-z][a-z0-9_-]{1,48}$/.test(value.subject.id);
  if (value.subject?.type === "user" || value.subject?.type === "wallet") return /^[A-Za-z0-9._:@-]{1,160}$/.test(value.subject.id);
  return false;
}

function isValidWorkspaceJoinPayload(value: WorkspaceJoinCodePayload): boolean {
  if (value?.v !== 1 || value.kind !== "workspace_join") return false;
  if (!isValidWorkspaceSlug(value.workspace)) return false;
  if (!isValidWorkspaceJoinSource(value.source)) return false;
  if (value.policyId && !isValidPolicyId(value.policyId)) return false;
  if (!Number.isInteger(value.exp) || value.exp <= 0) return false;
  if (typeof value.nonce !== "string" || value.nonce.length < 16 || value.nonce.length > 80) return false;
  return value.subject?.type === "user" && isValidUserId(value.subject.id);
}

function isValidWorkspaceJoinSource(value: string): value is WorkspaceJoinCodeSource {
  return value === "telegram" || value === "discord" || value === "entitlement";
}

function isValidWorkspaceSlug(value: string): boolean {
  return /^[a-z][a-z0-9_-]{1,48}$/.test(value);
}

function isValidUserId(value: string): boolean {
  return /^[A-Za-z0-9._:@-]{2,160}$/.test(value);
}

function isValidPolicyId(value: string): boolean {
  return /^[a-z0-9][a-z0-9_.:-]{1,96}$/.test(value);
}
