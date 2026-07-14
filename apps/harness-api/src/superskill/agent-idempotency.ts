import { createHash, createHmac } from "node:crypto";

import { normalizeSupabaseOrigin, supabaseAuthTimeoutMs, type FetchLike } from "./access.js";

export type AgentMutationStoredResponse = { status: number; body: Record<string, unknown> };

export type AgentMutationStore = {
  claim(input: { keyHash: string; userId: string; route: string; payloadHash: string; now: Date }): Promise<
    | { kind: "claimed" }
    | { kind: "replay"; response: AgentMutationStoredResponse }
    | { kind: "conflict" | "in_progress" | "unavailable" }
  >;
  complete(input: { keyHash: string; userId: string; route: string; payloadHash: string; status: number; body: Record<string, unknown>; now: Date }): Promise<boolean>;
};

const COMPLETE_ATTEMPTS = 3;

export function createAgentMutationService(options: { pepper?: string; store?: AgentMutationStore; fetchImpl?: FetchLike; now?: () => Date } = {}) {
  const pepper = options.pepper ?? process.env.SUPERSKILL_AGENT_TOKEN_PEPPER ?? (process.env.NODE_ENV === "production" ? "" : "onlyharness-local-agent-token-secret-at-least-32-bytes");
  const store = options.store ?? createDefaultStore(options.fetchImpl);
  const now = options.now ?? (() => new Date());
  return {
    async begin(input: { key: string | undefined; userId: string; route: string; payload: unknown }) {
      if (!validKey(input.key)) return { kind: "invalid" as const };
      if (Buffer.byteLength(pepper, "utf8") < 32) return { kind: "unavailable" as const };
      const keyHash = createHmac("sha256", pepper).update(`superskill-agent-idempotency:v1:${input.key}`).digest("hex");
      const payloadHash = createHash("sha256").update(canonicalJson(input.payload)).digest("hex");
      const result = await store.claim({ keyHash, userId: input.userId, route: input.route, payloadHash, now: now() });
      return result.kind === "claimed" ? { kind: "claimed" as const, keyHash, payloadHash } : result;
    },
    async complete(input: { keyHash: string; payloadHash: string; userId: string; route: string; status: number; body: Record<string, unknown> }) {
      if (!Number.isInteger(input.status) || input.status < 200 || input.status >= 600) return false;
      const serialized = JSON.stringify(input.body);
      if (Buffer.byteLength(serialized, "utf8") > 1024 * 1024) return false;
      for (let attempt = 0; attempt < COMPLETE_ATTEMPTS; attempt += 1) {
        if (await store.complete({ ...input, now: now() })) return true;
      }
      return false;
    }
  };
}

export function createInMemoryAgentMutationStore(): AgentMutationStore {
  const rows = new Map<string, { payloadHash: string; response?: AgentMutationStoredResponse }>();
  const identity = (keyHash: string, userId: string, route: string) => `${keyHash}:${userId}:${route}`;
  return {
    async claim(input) {
      const key = identity(input.keyHash, input.userId, input.route);
      const row = rows.get(key);
      if (!row) { rows.set(key, { payloadHash: input.payloadHash }); return { kind: "claimed" }; }
      if (row.payloadHash !== input.payloadHash) return { kind: "conflict" };
      if (row.response) return { kind: "replay", response: structuredClone(row.response) };
      return { kind: "in_progress" };
    },
    async complete(input) {
      const row = rows.get(identity(input.keyHash, input.userId, input.route));
      if (!row || row.payloadHash !== input.payloadHash) return false;
      if (row.response) return row.response.status === input.status && canonicalJson(row.response.body) === canonicalJson(input.body);
      row.response = { status: input.status, body: structuredClone(input.body) };
      return true;
    }
  };
}

export function createSupabaseAgentMutationStore(options: { supabaseUrl?: string; serviceRoleKey?: string; fetchImpl?: FetchLike; timeoutMs?: number } = {}): AgentMutationStore | undefined {
  const supabaseUrl = normalizeSupabaseOrigin(options.supabaseUrl ?? process.env.SUPABASE_URL);
  const serviceRoleKey = options.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return undefined;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = supabaseAuthTimeoutMs(options.timeoutMs ?? process.env.SUPABASE_AUTH_TIMEOUT_MS);
  const rpc = async (name: string, body: Record<string, unknown>) => {
    const url = new URL(`/rest/v1/rpc/${name}`, `${supabaseUrl}/`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, "content-type": "application/json" },
        body: JSON.stringify(body), redirect: "error", signal: controller.signal
      });
      if (response.url !== url.href || !response.ok) return undefined;
      const value = await response.json() as unknown;
      return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    } catch { return undefined; }
    finally { clearTimeout(timer); controller.abort(); }
  };
  return {
    async claim(input) {
      const value = await rpc("agent_mutation_claim", {
        p_key_hash: input.keyHash, p_user_id: input.userId, p_route: input.route,
        p_payload_hash: input.payloadHash, p_now: input.now.toISOString()
      });
      if (!value || typeof value.kind !== "string") return { kind: "unavailable" };
      if (value.kind === "claimed" || value.kind === "conflict" || value.kind === "in_progress") return { kind: value.kind };
      if (value.kind === "replay" && typeof value.status === "number" && value.body && typeof value.body === "object" && !Array.isArray(value.body)) {
        return { kind: "replay", response: { status: value.status, body: value.body as Record<string, unknown> } };
      }
      return { kind: "unavailable" };
    },
    async complete(input) {
      const value = await rpc("agent_mutation_complete", {
        p_key_hash: input.keyHash, p_user_id: input.userId, p_route: input.route,
        p_payload_hash: input.payloadHash, p_status: input.status, p_body: input.body, p_now: input.now.toISOString()
      });
      return value?.ok === true;
    }
  };
}

function createDefaultStore(fetchImpl?: FetchLike): AgentMutationStore {
  const remote = createSupabaseAgentMutationStore({ fetchImpl });
  if (remote) return remote;
  if (process.env.NODE_ENV !== "production") return createInMemoryAgentMutationStore();
  return {
    async claim() { return { kind: "unavailable" }; },
    async complete() { return false; }
  };
}

function validKey(value: string | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{16,200}$/.test(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return "null";
}
