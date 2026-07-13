import { MANAGED_EVENT_KINDS, recordManagedEvent, type EventInput, type ManagedEventWriteResult } from "../events.js";
import { resolveManagedAccess, type SuperskillRouteOptions } from "./superskill.js";
import { createSupabaseSuperskillAccessResolver, type SuperskillAccessResolver } from "../superskill/access.js";

type ManagedEventWriter = (input: EventInput) => Promise<ManagedEventWriteResult>;

export type ManagedEventHttpResult = {
  status: number;
  headers?: Record<string, string>;
  body: Record<string, unknown>;
};

export type ManagedEventHandlerOptions = Pick<SuperskillRouteOptions, "tokenHashes" | "telemetrySalt"> & {
  enabled?: boolean;
  accessResolver?: SuperskillAccessResolver;
  now?: () => Date;
  writer?: ManagedEventWriter;
  telemetryEnabled?: boolean;
};

export async function handleManagedEventRequest(
  authorization: string | undefined,
  body: Record<string, unknown>,
  options: ManagedEventHandlerOptions = {}
): Promise<ManagedEventHttpResult | undefined> {
  const kind = String(body.kind ?? "");
  if (!(MANAGED_EVENT_KINDS as readonly string[]).includes(kind)) return undefined;
  const enabled = options.enabled ?? process.env.SUPERSKILL_ENABLED === "true";
  if (!enabled) {
    return { status: 503, body: { error: "SuperSkill managed routes are disabled", code: "SUPERSKILL_DISABLED" } };
  }

  const accessResolver = options.accessResolver ?? createSupabaseSuperskillAccessResolver();
  const auth = await resolveManagedAccess(authorization, options, accessResolver, options.now?.() ?? new Date());
  if (!auth.ok) {
    return {
      status: auth.status,
      ...(auth.status === 401 ? { headers: { "WWW-Authenticate": 'Bearer realm="superskill"' } } : {}),
      body: { error: managedEventAuthError(auth.reasonCode), code: auth.reasonCode }
    };
  }

  const writer = options.writer ?? recordManagedEvent;
  const result = await writer({
    kind,
    eventId: stringField(body.eventId),
    owner: stringField(body.owner),
    repo: stringField(body.repo),
    version: stringField(body.version),
    target: stringField(body.target),
    client: stringField(body.client),
    recommendationId: stringField(body.recommendationId),
    activationId: stringField(body.activationId),
    mode: stringField(body.mode),
    evidence: stringField(body.evidence),
    outcome: stringField(body.outcome),
    reasonCode: stringField(body.reasonCode),
    subject: auth.subject
  });
  const headers = {
    "X-OnlyHarness-SuperSkill-Auth": auth.evidence === "confirmed_user" ? "confirmed-user" : "legacy-alpha",
    "X-OnlyHarness-SuperSkill-Public-GO": auth.publicGoEligible ? "eligible" : "ineligible"
  };
  if ("conflict" in result && result.conflict) {
    return { status: 409, headers, body: { error: "Managed event ID conflicts with an existing event", code: "EVENT_CONFLICT" } };
  }
  if ("unavailable" in result && result.unavailable) {
    return { status: 503, headers, body: { error: "Managed event storage is temporarily unavailable", code: "EVENT_STORAGE_UNAVAILABLE" } };
  }
  const telemetryEnabled = options.telemetryEnabled ?? process.env.SUPERSKILL_TELEMETRY_ENABLED !== "false";
  if (!result.recorded && !result.duplicate && telemetryEnabled) {
    return { status: 400, headers, body: { error: "Invalid managed event", code: "VALIDATION_FAILED" } };
  }
  return { status: 200, headers, body: result };
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function managedEventAuthError(code: string): string {
  if (code === "SUPERSKILL_AUTH_REQUIRED") return "SuperSkill Bearer credential is required";
  if (code === "SUPERSKILL_AUTH_INVALID") return "SuperSkill Bearer credential is invalid or expired";
  if (code === "SUPERSKILL_EMAIL_UNCONFIRMED") return "A confirmed account is required for SuperSkill managed access";
  if (code === "SUPERSKILL_AUTH_UNAVAILABLE") return "SuperSkill authentication is temporarily unavailable";
  return "SuperSkill managed access is not granted";
}
