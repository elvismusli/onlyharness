import { createHash } from "node:crypto";
import { exactCapabilityReleaseSchema, recommendationResponseSchema } from "@harnesshub/capability-schema/browser";
import type {
  ExactReleaseResponse,
  ManagedArchive,
  ManagedCapability,
  ManagedEvent,
  RecommendationResponse,
  SuperSkillClient
} from "./superskill-types.js";
import { SuperSkillCliError } from "./superskill-types.js";
import type { ProjectState } from "./activation-store.js";
import { pendingEvents, queueEvent, replacePendingEvents } from "./activation-store.js";

export type InventorySummary = {
  managedSkills: number;
  unmanagedSkills: number;
  approxTokens: number;
  conflicts: number;
  permissionsKnown: boolean;
  installedManagedRefs: Array<{ ref: string; version: string; artifactDigest: string }>;
};

export function requireSuperSkillToken(): string {
  const token = process.env.HH_TOKEN ?? process.env.HH_SUPERSKILL_TOKEN;
  if (!token) {
    throw new SuperSkillCliError("SuperSkill account token is required.", 2, "SUPERSKILL_AUTH_REQUIRED", "Sign in at https://superskill.sh, export HH_TOKEN for this terminal session, and do not store it in the project. HH_SUPERSKILL_TOKEN is legacy compatibility only.");
  }
  return token;
}

export function validateTask(task: string): string {
  const normalized = task.replace(/\s+/g, " ").trim();
  if (normalized.length < 3 || normalized.length > 500) {
    throw new SuperSkillCliError("Task summary must contain 3 to 500 characters.", 3, "TASK_INVALID", "Provide a short privacy-safe task summary.");
  }
  const secretPatterns = [
    /\bsk-[A-Za-z0-9_-]{16,}\b/,
    /\b(?:api[_-]?key|access[_-]?token|token|private[_-]?key|password)\s*[:=]\s*\S{8,}/i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
    /(?:^|\s)\/(?:Users|home|private|var|tmp)\/\S+/,
    /\b[A-Za-z]:\\(?:Users|Documents|Projects)\\\S+/i
  ];
  if (secretPatterns.some((pattern) => pattern.test(normalized))) {
    throw new SuperSkillCliError("Task summary appears to contain a secret.", 3, "TASK_INVALID", "Remove credentials, tokens and private keys before routing.");
  }
  return normalized;
}

export async function recommendCapability(input: {
  registry: string;
  task: string;
  client: SuperSkillClient;
  inventory: InventorySummary;
  signal?: AbortSignal;
}): Promise<RecommendationResponse> {
  const token = requireSuperSkillToken();
  const task = validateTask(input.task);
  const platform = process.platform === "darwin" || process.platform === "linux" || process.platform === "win32" ? process.platform : "unknown";
  const arch = process.arch === "arm64" || process.arch === "x64" ? process.arch : "unknown";
  const response = await managedJson<unknown>(`${cleanRegistry(input.registry)}/recommendations`, token, {
    method: "POST",
    body: JSON.stringify({
      task,
      context: {
        client: input.client,
        os: platform,
        arch,
        installedManagedRefs: input.inventory.installedManagedRefs.slice(0, 20),
        inventorySummary: {
          managedSkills: input.inventory.managedSkills,
          unmanagedSkills: input.inventory.unmanagedSkills,
          approxTokens: input.inventory.approxTokens,
          conflicts: input.inventory.conflicts,
          permissionsKnown: input.inventory.permissionsKnown
        }
      }
    })
  }, input.signal);
  return parseManagedResponse(recommendationResponseSchema.safeParse(response), "recommendation");
}

export async function fetchExactRelease(input: {
  registry: string;
  capabilityId: string;
  version: string;
  signal?: AbortSignal;
}): Promise<ExactReleaseResponse> {
  const token = requireSuperSkillToken();
  const response = await managedJson<unknown>(
    `${cleanRegistry(input.registry)}/capabilities/${encodeURIComponent(input.capabilityId)}/releases/${encodeURIComponent(input.version)}`,
    token,
    {},
    input.signal
  );
  return parseManagedResponse(exactCapabilityReleaseSchema.safeParse(response), "exact release");
}

export async function fetchExactHandoffDecision(input: {
  registry: string;
  capability: { id: string; version: string; artifactDigest: string };
  client: SuperSkillClient;
  signal?: AbortSignal;
}): Promise<RecommendationResponse> {
  const token = requireSuperSkillToken();
  const response = await managedJson<unknown>(`${cleanRegistry(input.registry)}/superskill/handoff/decision`, token, {
    method: "POST",
    body: JSON.stringify({ capability: input.capability, client: input.client })
  }, input.signal);
  return parseManagedResponse(recommendationResponseSchema.safeParse(response), "exact handoff decision");
}

export async function fetchManagedArchive(input: {
  registry: string;
  archiveUrl: string;
  signal?: AbortSignal;
}): Promise<ManagedArchive> {
  const token = requireSuperSkillToken();
  const registry = new URL(`${cleanRegistry(input.registry)}/`);
  const archive = new URL(input.archiveUrl, registry);
  if (archive.origin !== registry.origin || !archive.pathname.includes("/capabilities/")) {
    throw new SuperSkillCliError("Managed archive URL is outside the configured registry.", 3, "ARTIFACT_NOT_IMMUTABLE", "Do not send the internal token to another origin.");
  }
  return managedJson<ManagedArchive>(archive.toString(), token, {}, input.signal);
}

export function computeDecisionDigest(
  capability: ManagedCapability,
  client: SuperSkillClient,
  expiresAt: string,
  recommendationId: string
): string {
  const contract = {
    recommendationId,
    selected: {
      id: capability.id,
      ref: capability.release.ref,
      version: capability.release.version,
      artifactDigest: capability.release.artifactDigest,
      client,
      permissions: capability.permissions,
      trustChecks: capability.trust.checks,
      limitations: capability.trust.limitations
    },
    expiresAt
  };
  return `sha256:${createHash("sha256").update(canonicalJson(contract)).digest("hex")}`;
}

export async function sendManagedEvent(input: { registry: string; event: ManagedEvent; state?: ProjectState }): Promise<boolean> {
  if (process.env.HH_SUPERSKILL_TELEMETRY === "off") return false;
  let token: string;
  try {
    token = requireSuperSkillToken();
  } catch {
    if (input.state) queueEvent(input.state, input.event);
    return false;
  }
  try {
    await managedJson(`${cleanRegistry(input.registry)}/events`, token, { method: "POST", body: JSON.stringify(input.event) });
    return true;
  } catch {
    if (input.state) queueEvent(input.state, input.event);
    return false;
  }
}

export async function flushManagedEvents(registry: string, state: ProjectState): Promise<{ sent: number; pending: number }> {
  const queued = pendingEvents(state);
  if (!queued.length || process.env.HH_SUPERSKILL_TELEMETRY === "off") return { sent: 0, pending: queued.length };
  let token: string;
  try { token = requireSuperSkillToken(); } catch { return { sent: 0, pending: queued.length }; }
  const remaining: ManagedEvent[] = [];
  let sent = 0;
  for (const event of queued) {
    try {
      await managedJson(`${cleanRegistry(registry)}/events`, token, { method: "POST", body: JSON.stringify(event) });
      sent += 1;
    } catch {
      remaining.push(event);
    }
  }
  replacePendingEvents(state, remaining);
  return { sent, pending: remaining.length };
}

async function managedJson<T>(url: string, token: string, init: RequestInit = {}, externalSignal?: AbortSignal): Promise<T> {
  const requestedUrl = new URL(url).toString();
  const timeout = new AbortController();
  const timeoutId = setTimeout(() => timeout.abort(), managedTimeoutMs());
  const signal = externalSignal ? AbortSignal.any([externalSignal, timeout.signal]) : timeout.signal;
  let response: Response;
  try {
    response = await fetch(requestedUrl, {
      ...init,
      redirect: "error",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...init.headers
      }
    });
  } catch (error) {
    if (externalSignal?.aborted) throw cancelled();
    if (timeout.signal.aborted) throw timedOut();
    throw new SuperSkillCliError(`SuperSkill request failed: ${safeError(error)}.`, 1, "NETWORK_FAILED", "Check HH_REGISTRY_URL and network access, then retry the same request ID.");
  } finally {
    clearTimeout(timeoutId);
  }
  if (response.url && response.url !== requestedUrl) {
    throw new SuperSkillCliError("SuperSkill response came from an unexpected URL.", 3, "REGISTRY_ORIGIN_UNTRUSTED", "Use only the canonical https://superskill.sh/api registry.");
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) {
    const payload = body as { error?: string; reasonCode?: string; code?: string; next?: string };
    const reasonCode = payload.reasonCode ?? payload.code ?? statusReason(response.status);
    const exitCode = response.status === 401 || response.status === 403 ? 2 : response.status === 404 ? 4 : response.status >= 500 ? 1 : 3;
    throw new SuperSkillCliError(payload.error ?? `SuperSkill request failed (${response.status}).`, exitCode, reasonCode, payload.next ?? defaultNext(reasonCode));
  }
  return body as T;
}

function cleanRegistry(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw untrustedRegistry(); }
  if (url.username || url.password || url.search || url.hash) throw untrustedRegistry();
  const pathname = url.pathname.replace(/\/$/, "") || "/";
  const canonical = url.protocol === "https:"
    && ((url.hostname === "superskill.sh" || url.hostname === "onlyharness.com") && !url.port && pathname === "/api");
  const insecureTest = process.env.NODE_ENV !== "production"
    && process.env.HH_SUPERSKILL_ALLOW_INSECURE_TEST_REGISTRY === "1"
    && url.protocol === "http:"
    && url.hostname === "127.0.0.1"
    && Boolean(url.port)
    && (pathname === "/" || pathname === "/api");
  if (!canonical && !insecureTest) throw untrustedRegistry();
  return pathname === "/" ? url.origin : `${url.origin}${pathname}`;
}

function managedTimeoutMs(): number {
  if (process.env.NODE_ENV !== "production" && process.env.HH_SUPERSKILL_ALLOW_INSECURE_TEST_REGISTRY === "1") {
    const configured = Number(process.env.HH_SUPERSKILL_TEST_TIMEOUT_MS);
    if (Number.isInteger(configured) && configured >= 10 && configured <= 15_000) return configured;
  }
  return 15_000;
}

function untrustedRegistry(): SuperSkillCliError {
  return new SuperSkillCliError("Managed registry origin is not trusted.", 3, "REGISTRY_ORIGIN_UNTRUSTED", "Use https://superskill.sh/api. The legacy https://onlyharness.com/api alias is compatibility-only.");
}

function cancelled(): SuperSkillCliError {
  return new SuperSkillCliError("SuperSkill request was cancelled.", 3, "REQUEST_CANCELLED", "No managed network result was accepted. Retry with fresh consent if the task is still wanted.");
}

function timedOut(): SuperSkillCliError {
  return new SuperSkillCliError("SuperSkill request timed out.", 1, "REQUEST_TIMEOUT", "No managed network result was accepted. Check service health and retry the same request ID.");
}

function statusReason(status: number): string {
  if (status === 401) return "SUPERSKILL_AUTH_REQUIRED";
  if (status === 403) return "INTERNAL_ALPHA_DENIED";
  if (status === 404) return "CAPABILITY_NOT_FOUND";
  if (status === 503) return "CATALOG_NOT_READY";
  return "SUPERSKILL_REQUEST_FAILED";
}

function defaultNext(reason: string): string {
  if (reason === "SUPERSKILL_AUTH_REQUIRED" || reason === "SUPERSKILL_AUTH_INVALID") return "Sign in at https://superskill.sh and export HH_TOKEN for this terminal session.";
  if (reason === "SUPERSKILL_CONFIRMED_ACCESS_REQUIRED" || reason === "SUPERSKILL_ACCESS_DENIED" || reason === "INTERNAL_ALPHA_DENIED") return "Use a confirmed SuperSkill account with an active managed-access grant; HH_SUPERSKILL_TOKEN is legacy compatibility only.";
  if (reason === "CAPABILITY_REVOKED" || reason === "CAPABILITY_QUARANTINED") return "Request a fresh recommendation or use the approved replacement.";
  if (reason === "PERMISSION_BLOCKED") return "Request a fresh recommendation after the exact release evidence or permissions are reviewed.";
  return "Retry after checking the managed API status.";
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 300);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function parseManagedResponse<T>(result: { success: true; data: T } | { success: false }, label: string): T {
  if (result.success) return result.data;
  throw new SuperSkillCliError(`Registry returned an invalid managed ${label} contract.`, 1, "CATALOG_NOT_READY", "Do not activate anything; retry after the managed API and CLI versions are aligned.");
}
