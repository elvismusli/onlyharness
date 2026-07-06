import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { workspaceRoot } from "./registry.js";

export const EVENT_KINDS = ["view", "copy", "install", "pull", "checkout", "purchase", "suggested", "accepted", "applied", "eval", "gate", "escrow_reserved", "escrow_captured", "escrow_refunded"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type EventInput = {
  kind: string;
  owner?: string | null;
  repo?: string | null;
  version?: string | null;
  subject?: string | null;
  target?: string | null;
  client?: string | null;
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

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseRestKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const localEventsPath = path.resolve(process.env.HARNESS_EVENTS_PATH ?? path.join(workspaceRoot, "data/events.jsonl"));

export function sanitizeEvent(input: EventInput): EventRecord | undefined {
  if (!isEventKind(input.kind)) return undefined;
  return {
    kind: input.kind,
    owner: cleanSlug(input.owner),
    repo: cleanSlug(input.repo),
    version: cleanVersion(input.version),
    subject: cleanSubject(input.subject) ?? "anonymous",
    target: cleanTarget(input.target),
    client: cleanClient(input.client)
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

export async function fetchLastVerificationAt(owner: string, repo: string): Promise<string | undefined> {
  const remote = await fetchSupabaseLastVerificationAt(owner, repo);
  if (remote) return remote;
  return localLastVerificationAt(owner, repo);
}

function isEventKind(value: string): value is EventKind {
  return (EVENT_KINDS as readonly string[]).includes(value);
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

function isEventRecord(input: EventInput | EventRecord): input is EventRecord {
  return isEventKind(input.kind)
    && ("owner" in input)
    && ("repo" in input)
    && ("version" in input)
    && typeof input.subject === "string";
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
