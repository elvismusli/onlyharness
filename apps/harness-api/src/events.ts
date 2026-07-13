import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { workspaceRoot } from "./registry.js";

export const MANAGED_EVENT_KINDS = ["recommended", "recommendation_accepted", "activation_started", "activation_ready", "activation_loaded", "activation_invoked", "outcome_reported", "activation_pinned", "activation_removed", "activation_failed"] as const;
export const EVENT_KINDS = ["view", "copy", "install", "pull", "checkout", "purchase", "suggested", "accepted", "applied", "eval", "gate", "escrow_reserved", "escrow_captured", "escrow_refunded", ...MANAGED_EVENT_KINDS] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type EventInput = {
  kind: string;
  owner?: string | null;
  repo?: string | null;
  version?: string | null;
  subject?: string | null;
  target?: string | null;
  client?: string | null;
  eventId?: string | null;
  recommendationId?: string | null;
  activationId?: string | null;
  mode?: string | null;
  evidence?: string | null;
  outcome?: string | null;
  reasonCode?: string | null;
};

export type EventRecord = {
  kind: EventKind;
  owner: string | null;
  repo: string | null;
  version: string | null;
  subject: string;
  target: string | null;
  client: string | null;
};

export type ManagedEventRecord = EventRecord & {
  eventId: string;
  recommendationId: string | null;
  activationId: string | null;
  mode: "temporary" | "pinned" | null;
  evidence: "agent_reported" | "user_confirmed" | "unknown" | null;
  outcome: "success" | "failed" | "unknown" | null;
  reasonCode: string | null;
};

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseRestKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const localEventsPath = path.resolve(process.env.HARNESS_EVENTS_PATH ?? path.join(workspaceRoot, "data/events.jsonl"));

export function sanitizeEvent(input: EventInput): EventRecord | ManagedEventRecord | undefined {
  if (!isEventKind(input.kind)) return undefined;
  const base: EventRecord = {
    kind: input.kind,
    owner: cleanSlug(input.owner),
    repo: cleanSlug(input.repo),
    version: cleanVersion(input.version),
    subject: cleanSubject(input.subject) ?? "anonymous",
    target: cleanTarget(input.target),
    client: cleanClient(input.client)
  };
  if (!isManagedEventKind(input.kind)) return base;
  const eventId = cleanManagedId(input.eventId, "evt");
  const client = input.client === "hh" || input.client === "superskill-claude" || input.client === "superskill-codex" ? input.client : undefined;
  if (!eventId || !client) return undefined;
  const mode = input.mode === "temporary" || input.mode === "pinned" ? input.mode : null;
  const evidence = input.evidence === "agent_reported" || input.evidence === "user_confirmed" || input.evidence === "unknown" ? input.evidence : null;
  const outcome = input.outcome === "success" || input.outcome === "failed" || input.outcome === "unknown" ? input.outcome : null;
  const recommendationId = cleanManagedId(input.recommendationId, "rec");
  const activationId = cleanManagedId(input.activationId, "act");
  const reasonCode = cleanReasonCode(input.reasonCode);
  if (
    (isProvided(input.mode) && !mode)
    || (isProvided(input.evidence) && !evidence)
    || (isProvided(input.outcome) && !outcome)
    || (isProvided(input.recommendationId) && !recommendationId)
    || (isProvided(input.activationId) && !activationId)
    || (isProvided(input.reasonCode) && !reasonCode)
  ) return undefined;
  return {
    ...base,
    client,
    eventId,
    recommendationId,
    activationId,
    mode,
    evidence,
    outcome,
    reasonCode
  };
}

export async function recordEvent(input: EventInput | EventRecord): Promise<boolean> {
  const event = isEventRecord(input) ? input : sanitizeEvent(input);
  if (!event) return false;

  if (supabaseUrl && supabaseRestKey) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/events`, {
        method: "POST",
        headers: {
          apikey: supabaseRestKey,
          authorization: `Bearer ${supabaseRestKey}`,
          "content-type": "application/json",
          prefer: "return=minimal"
        },
        body: JSON.stringify(event)
      });
      if (response.ok) return true;
    } catch {
      // Fall through to local append-only log.
    }
  }

  mkdirSync(path.dirname(localEventsPath), { recursive: true });
  appendFileSync(localEventsPath, `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`);
  return true;
}

export type ManagedEventWriteResult =
  | { recorded: true; duplicate: false }
  | { recorded: false; duplicate: true }
  | { recorded: false; duplicate: false; conflict: true }
  | { recorded: false; duplicate: false; unavailable: true }
  | { recorded: false; duplicate: false };

export async function recordManagedEvent(input: EventInput, options: { localPath?: string; telemetryEnabled?: boolean } = {}): Promise<ManagedEventWriteResult> {
  const event = sanitizeEvent(input);
  if (!event || !("eventId" in event)) return { recorded: false, duplicate: false };
  if (options.telemetryEnabled === false || process.env.SUPERSKILL_TELEMETRY_ENABLED === "false") return { recorded: false, duplicate: false };
  if (supabaseUrl && supabaseRestKey && !options.localPath) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/events?on_conflict=event_id`, {
        method: "POST",
        headers: {
          apikey: supabaseRestKey,
          authorization: `Bearer ${supabaseRestKey}`,
          "content-type": "application/json",
          prefer: "resolution=ignore-duplicates,return=representation"
        },
        body: JSON.stringify(managedDatabaseRow(event))
      });
      if (response.ok) {
        const rows = await response.json().catch(() => []) as unknown[];
        if (rows.length > 0) return { recorded: true, duplicate: false };
        const existing = await fetchManagedEventById(event.eventId);
        if (!existing) return { recorded: false, duplicate: false, unavailable: true };
        return sameManagedDatabaseRow(existing, managedDatabaseRow(event))
          ? { recorded: false, duplicate: true }
          : { recorded: false, duplicate: false, conflict: true };
      }
    } catch {
      return { recorded: false, duplicate: false, unavailable: true };
    }
    return { recorded: false, duplicate: false, unavailable: true };
  }
  const target = path.resolve(options.localPath ?? localEventsPath);
  const existing = localEventById(target, event.eventId);
  if (existing) {
    return sameManagedEvent(existing, event)
      ? { recorded: false, duplicate: true }
      : { recorded: false, duplicate: false, conflict: true };
  }
  mkdirSync(path.dirname(target), { recursive: true });
  appendFileSync(target, `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`);
  return { recorded: true, duplicate: false };
}

export async function fetchLastVerificationAt(owner: string, repo: string): Promise<string | undefined> {
  const remote = await fetchSupabaseLastVerificationAt(owner, repo);
  if (remote) return remote;
  return localLastVerificationAt(owner, repo);
}

function isEventKind(value: string): value is EventKind {
  return (EVENT_KINDS as readonly string[]).includes(value);
}

function isManagedEventKind(value: string): value is (typeof MANAGED_EVENT_KINDS)[number] {
  return (MANAGED_EVENT_KINDS as readonly string[]).includes(value);
}

function cleanSlug(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^@?[a-z0-9][a-z0-9_-]{1,80}$/.test(value) ? value : null;
}

function cleanVersion(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,60}$/.test(value) ? value : null;
}

function cleanSubject(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[a-zA-Z0-9:_-]{2,80}$/.test(value) ? value : null;
}

function cleanTarget(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[a-z0-9][a-z0-9:_-]{1,60}$/.test(value) ? value : null;
}

function cleanClient(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[a-z0-9][a-z0-9._-]{1,60}$/.test(value) ? value : null;
}

function cleanManagedId(value: string | null | undefined, prefix: "evt" | "rec" | "act"): string | null {
  if (!value) return null;
  return new RegExp(`^${prefix}_[A-Za-z0-9_-]{6,80}$`).test(value) ? value : null;
}

function cleanReasonCode(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[A-Z0-9_]{2,80}$/.test(value) ? value : null;
}

function isProvided(value: string | null | undefined): value is string {
  return value !== undefined && value !== null;
}

function isEventRecord(input: EventInput | EventRecord): input is EventRecord {
  return isEventKind(input.kind)
    && ("owner" in input)
    && ("repo" in input)
    && ("version" in input)
    && typeof input.subject === "string";
}

function localEventById(file: string, eventId: string): ManagedEventRecord | undefined {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as EventInput & { event_id?: string };
      if (parsed.eventId !== eventId && parsed.event_id !== eventId) continue;
      const sanitized = sanitizeEvent(parsed);
      return sanitized && "eventId" in sanitized ? sanitized : undefined;
    } catch {
      // Corrupt lines do not erase later valid append-only rows.
    }
  }
  return undefined;
}

function managedDatabaseRow(event: ManagedEventRecord) {
  return {
    kind: event.kind,
    owner: event.owner,
    repo: event.repo,
    version: event.version,
    subject: event.subject,
    target: event.target,
    client: event.client,
    event_id: event.eventId,
    recommendation_id: event.recommendationId,
    activation_id: event.activationId,
    mode: event.mode,
    evidence: event.evidence,
    outcome: event.outcome,
    reason_code: event.reasonCode
  };
}

type ManagedDatabaseRow = ReturnType<typeof managedDatabaseRow>;

async function fetchManagedEventById(eventId: string): Promise<ManagedDatabaseRow | undefined> {
  if (!supabaseUrl || !supabaseRestKey) return undefined;
  const query = new URLSearchParams({
    select: "kind,owner,repo,version,subject,target,client,event_id,recommendation_id,activation_id,mode,evidence,outcome,reason_code",
    event_id: `eq.${eventId}`,
    limit: "2"
  });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/events?${query.toString()}`, {
      headers: {
        apikey: supabaseRestKey,
        authorization: `Bearer ${supabaseRestKey}`
      }
    });
    if (!response.ok) return undefined;
    const rows = await response.json() as unknown[];
    return rows.length === 1 && isManagedDatabaseRow(rows[0]) ? rows[0] : undefined;
  } catch {
    return undefined;
  }
}

function sameManagedEvent(left: ManagedEventRecord, right: ManagedEventRecord): boolean {
  return sameManagedDatabaseRow(managedDatabaseRow(left), managedDatabaseRow(right));
}

function sameManagedDatabaseRow(left: ManagedDatabaseRow, right: ManagedDatabaseRow): boolean {
  return (Object.keys(right) as Array<keyof ManagedDatabaseRow>).every((key) => left[key] === right[key]);
}

function isManagedDatabaseRow(value: unknown): value is ManagedDatabaseRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ManagedDatabaseRow>;
  return typeof row.kind === "string"
    && typeof row.subject === "string"
    && typeof row.client === "string"
    && typeof row.event_id === "string";
}

async function fetchSupabaseLastVerificationAt(owner: string, repo: string): Promise<string | undefined> {
  if (!supabaseUrl || !supabaseRestKey) return undefined;
  const params = new URLSearchParams({
    select: "created_at",
    owner: `eq.${owner}`,
    repo: `eq.${repo}`,
    kind: "in.(eval,gate)",
    target: "eq.passed",
    order: "created_at.desc",
    limit: "1"
  });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/events?${params.toString()}`, {
      headers: {
        apikey: supabaseRestKey,
        authorization: `Bearer ${supabaseRestKey}`
      }
    });
    if (!response.ok) return undefined;
    const rows = await response.json() as Array<{ created_at?: string }>;
    return rows[0]?.created_at;
  } catch {
    return undefined;
  }
}

function localLastVerificationAt(owner: string, repo: string): string | undefined {
  if (!existsSync(localEventsPath)) return undefined;
  let latest = 0;
  let latestIso: string | undefined;
  for (const line of readFileSync(localEventsPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as EventRecord & { at?: string; created_at?: string };
      if (row.owner !== owner || row.repo !== repo || row.target !== "passed") continue;
      if (row.kind !== "eval" && row.kind !== "gate") continue;
      const value = row.created_at ?? row.at;
      const timestamp = value ? Date.parse(value) : NaN;
      if (Number.isFinite(timestamp) && timestamp > latest) {
        latest = timestamp;
        latestIso = value;
      }
    } catch {
      // Ignore corrupt local telemetry lines.
    }
  }
  return latestIso;
}
