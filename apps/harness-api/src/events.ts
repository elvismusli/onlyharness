import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { workspaceRoot } from "./registry.js";

export const EVENT_KINDS = ["view", "copy", "install", "pull", "checkout", "purchase", "suggested", "applied"] as const;
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

function isEventKind(value: string): value is EventKind {
  return (EVENT_KINDS as readonly string[]).includes(value);
}

function cleanSlug(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[a-z0-9][a-z0-9_-]{1,80}$/.test(value) ? value : null;
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
