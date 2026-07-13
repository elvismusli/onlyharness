import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as workspaces from "./workspaces.js";

export type WorkspaceSubscriptionStatus = "incomplete" | "active" | "past_due" | "canceled" | "expired";
export type WorkspaceSubscriptionProvider = "manual";

export type WorkspaceSubscription = {
  id: string;
  workspace_id?: string;
  workspace_slug: string;
  user_id: string;
  policy_id: string;
  provider: WorkspaceSubscriptionProvider;
  provider_subscription_ref: string;
  provider_customer_ref?: string | null;
  status: WorkspaceSubscriptionStatus;
  current_period_start?: string | null;
  current_period_end?: string | null;
  grace_until?: string | null;
  access_until?: string | null;
  cancel_at_period_end: boolean;
  canceled_at?: string | null;
  checkout_url?: string | null;
  portal_url?: string | null;
  created_at: string;
  updated_at: string;
};

type WorkspaceSubscriptionEvent = {
  id: string;
  workspace_id?: string;
  workspace_slug: string;
  subscription_id: string;
  provider: WorkspaceSubscriptionProvider;
  provider_event_ref: string;
  event_type: string;
  status: WorkspaceSubscriptionStatus;
  user_id: string;
  policy_id: string;
  current_period_start?: string | null;
  current_period_end?: string | null;
  grace_until?: string | null;
  access_until?: string | null;
  created_at: string;
};

type SubscriptionStore = {
  subscriptions?: WorkspaceSubscription[];
  events?: WorkspaceSubscriptionEvent[];
};

type SubscriptionMembershipResult =
  | workspaces.WorkspaceMemberResult
  | { ok: true; workspace: workspaces.WorkspaceRecord; member?: undefined; skipped: "removed_or_suspended" };

export type WorkspaceSubscriptionCheckoutResult =
  | { ok: true; workspace: workspaces.WorkspaceRecord; policy: workspaces.WorkspaceJoinPolicy; subscription: WorkspaceSubscription; checkout_url: string; next: string }
  | { ok: false; status: number; error: string; code: string };

export type WorkspaceSubscriptionWebhookResult =
  | { ok: true; status: "created" | "activated" | "renewed" | "past_due" | "canceled" | "expired" | "already_processed"; workspace: workspaces.WorkspaceRecord; policy?: workspaces.WorkspaceJoinPolicy; subscription: WorkspaceSubscription; member?: workspaces.WorkspaceMember; next: string }
  | { ok: false; status: number; error: string; code: string };

export type WorkspaceSubscriptionSweepResult =
  | { ok: true; workspace: workspaces.WorkspaceRecord; expired: WorkspaceSubscription[]; checked: number }
  | { ok: false; status: number; error: string; code: string };

export type WorkspaceSubscriptionListResult =
  | { ok: true; workspace: workspaces.WorkspaceRecord; subscriptions: WorkspaceSubscription[] }
  | { ok: false; status: number; error: string; code: string };

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseRestKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const localSubscriptionStorePath = process.env.WORKSPACE_SUBSCRIPTIONS_PATH
  ? path.resolve(process.env.WORKSPACE_SUBSCRIPTIONS_PATH)
  : undefined;

export function workspaceSubscriptionsEnabled(): boolean {
  return process.env.WORKSPACE_SUBSCRIPTIONS_ENABLED === "true";
}

export async function createWorkspaceSubscriptionCheckout(slugValue: string | undefined, input: { userId?: string; policyId?: string; provider?: string }): Promise<WorkspaceSubscriptionCheckoutResult> {
  const prepared = await preparePaidSubscriptionPolicy(slugValue, input.policyId);
  if (!prepared.ok) return prepared;
  const userId = cleanUserId(input.userId);
  if (!userId) return { ok: false, status: 401, error: "Signed-in user required before subscription checkout", code: "AUTH_REQUIRED" };
  const provider = normalizeProvider(input.provider);
  if (!provider) return { ok: false, status: 400, error: "Unsupported workspace subscription provider", code: "UNSUPPORTED_SUBSCRIPTION_PROVIDER" };

  const now = new Date().toISOString();
  const subscription: WorkspaceSubscription = {
    id: crypto.randomUUID(),
    workspace_id: prepared.workspace.id,
    workspace_slug: prepared.workspace.slug,
    user_id: userId,
    policy_id: prepared.policy.id,
    provider,
    provider_subscription_ref: `manual_sub_${crypto.randomUUID()}`,
    provider_customer_ref: null,
    status: "incomplete",
    current_period_start: null,
    current_period_end: null,
    grace_until: null,
    access_until: null,
    cancel_at_period_end: false,
    canceled_at: null,
    created_at: now,
    updated_at: now,
    checkout_url: "",
    portal_url: ""
  };
  const checkoutUrl = workspaceSubscriptionCheckoutUrl(prepared.workspace.slug, prepared.policy.id, subscription.provider_subscription_ref);
  subscription.checkout_url = checkoutUrl;
  subscription.portal_url = checkoutUrl;
  const persisted = await persistSubscription(subscription, prepared.workspace);
  if (!persisted.ok) return persisted;
  return {
    ok: true,
    workspace: prepared.workspace,
    policy: prepared.policy,
    subscription: persisted.subscription,
    checkout_url: checkoutUrl,
    next: "Complete the provider checkout. Membership is granted only after a signed workspace subscription webhook marks the subscription active or renewed."
  };
}

export async function settleWorkspaceSubscriptionWebhook(input: {
  provider?: string;
  provider_subscription_ref?: string;
  provider_event_ref?: string;
  event_type?: string;
  status?: string;
  current_period_start?: string | null;
  current_period_end?: string | null;
  grace_until?: string | null;
  cancel_at_period_end?: boolean;
  provider_customer_ref?: string | null;
}): Promise<WorkspaceSubscriptionWebhookResult> {
  const provider = normalizeProvider(input.provider);
  if (!provider) return { ok: false, status: 400, error: "Unsupported workspace subscription provider", code: "UNSUPPORTED_SUBSCRIPTION_PROVIDER" };
  const providerRef = cleanProviderRef(input.provider_subscription_ref);
  if (!providerRef) return { ok: false, status: 400, error: "provider_subscription_ref is required", code: "SUBSCRIPTION_REF_REQUIRED" };
  const subscription = await readSubscriptionByProviderRef(provider, providerRef);
  if (!subscription) return { ok: false, status: 404, error: "Workspace subscription not found", code: "SUBSCRIPTION_NOT_FOUND" };
  const policies = await workspaces.listWorkspaceJoinPolicies(subscription.workspace_slug);
  if (!policies.ok) return { ok: false, status: policies.status, error: policies.error, code: policies.code };
  const policy = policies.policies.find((row) => row.id === subscription.policy_id && row.kind === "paid_subscription");
  const eventType = cleanEventType(input.event_type ?? input.status ?? "subscription.updated");
  const status = subscriptionStatusFromWebhook(input.status, eventType);
  const now = new Date().toISOString();
  const periodStart = normalizeIso(input.current_period_start) ?? subscription.current_period_start ?? now;
  const periodEnd = normalizeIso(input.current_period_end) ?? subscription.current_period_end ?? defaultPeriodEnd(policy, now);
  const graceUntil = normalizeIso(input.grace_until) ?? defaultGraceUntil(policy, periodEnd);
  const accessUntil = accessUntilForStatus(status, periodEnd, graceUntil, input.cancel_at_period_end);
  const eventRef = cleanEventRef(input.provider_event_ref) ?? `${provider}:${providerRef}:${eventType}:${periodEnd}`;
  if (await subscriptionEventExists(subscription, eventRef)) {
    return {
      ok: true,
      status: "already_processed",
      workspace: policies.workspace,
      policy,
      subscription,
      next: "Duplicate workspace subscription webhook ignored; no membership mutation was performed."
    };
  }

  const updated: WorkspaceSubscription = {
    ...subscription,
    status,
    provider_customer_ref: cleanProviderRef(input.provider_customer_ref) ?? subscription.provider_customer_ref ?? null,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    grace_until: graceUntil,
    access_until: accessUntil,
    cancel_at_period_end: Boolean(input.cancel_at_period_end),
    canceled_at: status === "canceled" ? now : subscription.canceled_at ?? null,
    updated_at: now
  };
  const persisted = await updateSubscription(updated, policies.workspace);
  if (!persisted.ok) return persisted;
  const event: WorkspaceSubscriptionEvent = {
    id: crypto.randomUUID(),
    workspace_id: policies.workspace.id,
    workspace_slug: policies.workspace.slug,
    subscription_id: updated.id,
    provider,
    provider_event_ref: eventRef,
    event_type: eventType,
    status,
    user_id: updated.user_id,
    policy_id: updated.policy_id,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    grace_until: graceUntil,
    access_until: accessUntil,
    created_at: now
  };
  const eventPersisted = await persistSubscriptionEvent(event, policies.workspace);
  if (!eventPersisted.ok) return eventPersisted;

  const member = policy
    ? await applySubscriptionMembership(policies.workspace, policy, persisted.subscription, accessUntil)
    : undefined;
  if (member && !member.ok) return member;
  const membershipSkipped = member && "skipped" in member;
  return {
    ok: true,
    status: webhookResultStatus(status, subscription),
    workspace: policies.workspace,
    policy,
    subscription: persisted.subscription,
    member: member?.member,
    next: membershipSkipped
      ? "Subscription state was recorded, but workspace membership was not restored because the member is removed or suspended."
      : "Workspace membership expiry now mirrors the subscription access window. Read paths did not grant access."
  };
}

export async function listWorkspaceSubscriptions(slugValue: string | undefined, input: { userId?: string }): Promise<WorkspaceSubscriptionListResult> {
  const policies = await workspaces.listWorkspaceJoinPolicies(slugValue);
  if (!policies.ok) return { ok: false, status: policies.status, error: policies.error, code: policies.code };
  const userId = cleanUserId(input.userId);
  if (!userId) return { ok: false, status: 401, error: "Signed-in user required", code: "AUTH_REQUIRED" };
  const subscriptions = await readSubscriptionsForUser(policies.workspace, userId);
  return { ok: true, workspace: policies.workspace, subscriptions };
}

export async function sweepExpiredWorkspaceSubscriptions(slugValue: string | undefined, nowMs = Date.now()): Promise<WorkspaceSubscriptionSweepResult> {
  const policies = await workspaces.listWorkspaceJoinPolicies(slugValue);
  if (!policies.ok) return { ok: false, status: policies.status, error: policies.error, code: policies.code };
  const subscriptions = await readSubscriptionsForWorkspace(policies.workspace);
  const expired: WorkspaceSubscription[] = [];
  for (const subscription of subscriptions) {
    if (!["active", "past_due", "canceled"].includes(subscription.status)) continue;
    const accessUntil = subscription.access_until ? Date.parse(subscription.access_until) : NaN;
    if (!Number.isFinite(accessUntil) || accessUntil > nowMs) continue;
    const updated: WorkspaceSubscription = { ...subscription, status: "expired", updated_at: new Date(nowMs).toISOString() };
    const persisted = await updateSubscription(updated, policies.workspace);
    if (!persisted.ok) return persisted;
    const policy = policies.policies.find((row) => row.id === subscription.policy_id && row.kind === "paid_subscription");
    if (policy) {
      const member = await applySubscriptionMembership(policies.workspace, policy, persisted.subscription, subscription.access_until ?? new Date(nowMs).toISOString());
      if (!member.ok) return member;
    }
    expired.push(persisted.subscription);
  }
  return { ok: true, workspace: policies.workspace, expired, checked: subscriptions.length };
}

async function preparePaidSubscriptionPolicy(slugValue: string | undefined, policyId?: string): Promise<
  | { ok: true; workspace: workspaces.WorkspaceRecord; policy: workspaces.WorkspaceJoinPolicy }
  | { ok: false; status: number; error: string; code: string }
> {
  const policies = await workspaces.listWorkspaceJoinPolicies(slugValue);
  if (!policies.ok) return { ok: false, status: policies.status, error: policies.error, code: policies.code };
  const policy = policies.policies.find((row) => row.status === "active" && row.kind === "paid_subscription" && (!policyId || row.id === policyId));
  if (!policy) return { ok: false, status: 403, error: "No active paid subscription join policy allows checkout", code: "SUBSCRIPTION_POLICY_DENIED" };
  return { ok: true, workspace: policies.workspace, policy };
}

async function applySubscriptionMembership(workspace: workspaces.WorkspaceRecord, policy: workspaces.WorkspaceJoinPolicy, subscription: WorkspaceSubscription, accessUntil: string): Promise<SubscriptionMembershipResult> {
  const existing = await workspaces.readWorkspaceMember(workspace, subscription.user_id);
  if (existing && (existing.status === "removed" || existing.status === "suspended" || existing.removed_at)) {
    return { ok: true, workspace, skipped: "removed_or_suspended" };
  }
  return workspaces.upsertWorkspaceMember(workspace.slug, {
    userId: subscription.user_id,
    role: policy.role,
    source: "paid_entitlement",
    expiresAt: accessUntil
  });
}

async function persistSubscription(subscription: WorkspaceSubscription, workspace: workspaces.WorkspaceRecord): Promise<
  | { ok: true; subscription: WorkspaceSubscription }
  | { ok: false; status: number; error: string; code: string }
> {
  if (workspace.id && supabaseUrl && supabaseRestKey) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/workspace_subscriptions`, {
        method: "POST",
        headers: { ...supabaseHeaders(), "content-type": "application/json", prefer: "return=representation" },
        body: JSON.stringify(subscriptionForStorage(subscription, workspace))
      });
      if (!response.ok) return { ok: false, status: 502, error: `Workspace subscription insert failed: HTTP ${response.status}`, code: "SUBSCRIPTION_STORE_FAILED" };
      const body = await response.json() as WorkspaceSubscription[];
      return { ok: true, subscription: normalizeSubscription(body[0], workspace.slug)[0] ?? subscription };
    } catch {
      return { ok: false, status: 503, error: "Workspace subscription store unavailable", code: "SUBSCRIPTION_STORE_UNAVAILABLE" };
    }
  }
  const store = readLocalStore();
  const subscriptions = store.subscriptions ?? [];
  const next = [subscription, ...subscriptions.filter((row) => !(row.provider === subscription.provider && row.provider_subscription_ref === subscription.provider_subscription_ref))];
  writeLocalStore({ ...store, subscriptions: next });
  return { ok: true, subscription };
}

async function updateSubscription(subscription: WorkspaceSubscription, workspace: workspaces.WorkspaceRecord): Promise<
  | { ok: true; subscription: WorkspaceSubscription }
  | { ok: false; status: number; error: string; code: string }
> {
  if (workspace.id && supabaseUrl && supabaseRestKey) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/workspace_subscriptions?id=eq.${subscription.id}`, {
        method: "PATCH",
        headers: { ...supabaseHeaders(), "content-type": "application/json", prefer: "return=representation" },
        body: JSON.stringify(subscriptionForStorage(subscription, workspace))
      });
      if (!response.ok) return { ok: false, status: 502, error: `Workspace subscription update failed: HTTP ${response.status}`, code: "SUBSCRIPTION_STORE_FAILED" };
      const body = await response.json() as WorkspaceSubscription[];
      return { ok: true, subscription: normalizeSubscription(body[0], workspace.slug)[0] ?? subscription };
    } catch {
      return { ok: false, status: 503, error: "Workspace subscription store unavailable", code: "SUBSCRIPTION_STORE_UNAVAILABLE" };
    }
  }
  const store = readLocalStore();
  const subscriptions = store.subscriptions ?? [];
  writeLocalStore({
    ...store,
    subscriptions: [subscription, ...subscriptions.filter((row) => row.id !== subscription.id)]
  });
  return { ok: true, subscription };
}

async function readSubscriptionByProviderRef(provider: WorkspaceSubscriptionProvider, providerRef: string): Promise<WorkspaceSubscription | undefined> {
  if (supabaseUrl && supabaseRestKey) {
    try {
      const params = new URLSearchParams({
        select: subscriptionSelect(),
        provider: `eq.${provider}`,
        provider_subscription_ref: `eq.${providerRef}`,
        limit: "1"
      });
      const response = await fetch(`${supabaseUrl}/rest/v1/workspace_subscriptions?${params.toString()}`, { headers: supabaseHeaders() });
      if (response.ok) {
        const rows = await response.json() as WorkspaceSubscription[];
        const normalized = normalizeSubscription(rows[0]);
        if (normalized[0]) return normalized[0];
      }
    } catch {
      // fall through to local smoke store
    }
  }
  return (readLocalStore().subscriptions ?? []).find((row) => row.provider === provider && row.provider_subscription_ref === providerRef);
}

async function readSubscriptionsForUser(workspace: workspaces.WorkspaceRecord, userId: string): Promise<WorkspaceSubscription[]> {
  if (workspace.id && supabaseUrl && supabaseRestKey) {
    try {
      const params = new URLSearchParams({
        select: subscriptionSelect(),
        workspace_id: `eq.${workspace.id}`,
        user_id: `eq.${userId}`,
        order: "created_at.desc",
        limit: "50"
      });
      const response = await fetch(`${supabaseUrl}/rest/v1/workspace_subscriptions?${params.toString()}`, { headers: supabaseHeaders() });
      if (response.ok) return (await response.json() as WorkspaceSubscription[]).flatMap((row) => normalizeSubscription(row, workspace.slug));
    } catch {
      return [];
    }
  }
  return (readLocalStore().subscriptions ?? []).filter((row) => subscriptionBelongsToWorkspace(row, workspace) && row.user_id === userId);
}

async function readSubscriptionsForWorkspace(workspace: workspaces.WorkspaceRecord): Promise<WorkspaceSubscription[]> {
  if (workspace.id && supabaseUrl && supabaseRestKey) {
    try {
      const params = new URLSearchParams({
        select: subscriptionSelect(),
        workspace_id: `eq.${workspace.id}`,
        order: "created_at.desc",
        limit: "500"
      });
      const response = await fetch(`${supabaseUrl}/rest/v1/workspace_subscriptions?${params.toString()}`, { headers: supabaseHeaders() });
      if (response.ok) return (await response.json() as WorkspaceSubscription[]).flatMap((row) => normalizeSubscription(row, workspace.slug));
    } catch {
      return [];
    }
  }
  return (readLocalStore().subscriptions ?? []).filter((row) => subscriptionBelongsToWorkspace(row, workspace));
}

async function subscriptionEventExists(subscription: WorkspaceSubscription, eventRef: string): Promise<boolean> {
  if (subscription.workspace_id && supabaseUrl && supabaseRestKey) {
    try {
      const params = new URLSearchParams({
        select: "id",
        provider: `eq.${subscription.provider}`,
        provider_event_ref: `eq.${eventRef}`,
        limit: "1"
      });
      const response = await fetch(`${supabaseUrl}/rest/v1/workspace_subscription_events?${params.toString()}`, { headers: supabaseHeaders() });
      if (response.ok) return ((await response.json()) as unknown[]).length > 0;
    } catch {
      return false;
    }
  }
  return (readLocalStore().events ?? []).some((row) => row.provider === subscription.provider && row.provider_event_ref === eventRef);
}

async function persistSubscriptionEvent(event: WorkspaceSubscriptionEvent, workspace: workspaces.WorkspaceRecord): Promise<{ ok: true } | { ok: false; status: number; error: string; code: string }> {
  if (workspace.id && supabaseUrl && supabaseRestKey) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/workspace_subscription_events`, {
        method: "POST",
        headers: { ...supabaseHeaders(), "content-type": "application/json", prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(event)
      });
      if (response.ok || response.status === 409) return { ok: true };
      return { ok: false, status: 502, error: `Workspace subscription event insert failed: HTTP ${response.status}`, code: "SUBSCRIPTION_EVENT_STORE_FAILED" };
    } catch {
      return { ok: false, status: 503, error: "Workspace subscription event store unavailable", code: "SUBSCRIPTION_EVENT_STORE_UNAVAILABLE" };
    }
  }
  const store = readLocalStore();
  const events = store.events ?? [];
  writeLocalStore({
    ...store,
    events: [event, ...events.filter((row) => !(row.provider === event.provider && row.provider_event_ref === event.provider_event_ref))]
  });
  return { ok: true };
}

function readLocalStore(): SubscriptionStore {
  if (!localSubscriptionStorePath || !existsSync(localSubscriptionStorePath)) return { subscriptions: [], events: [] };
  try {
    const parsed = JSON.parse(readFileSync(localSubscriptionStorePath, "utf8")) as SubscriptionStore;
    return {
      subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions.flatMap((row) => normalizeSubscription(row)) : [],
      events: Array.isArray(parsed.events) ? parsed.events : []
    };
  } catch {
    return { subscriptions: [], events: [] };
  }
}

function writeLocalStore(store: SubscriptionStore) {
  if (!localSubscriptionStorePath) return;
  mkdirSync(path.dirname(localSubscriptionStorePath), { recursive: true });
  writeFileSync(localSubscriptionStorePath, `${JSON.stringify({ subscriptions: store.subscriptions ?? [], events: store.events ?? [] }, null, 2)}\n`);
}

function subscriptionForStorage(subscription: WorkspaceSubscription, workspace: workspaces.WorkspaceRecord): WorkspaceSubscription {
  return {
    ...subscription,
    workspace_id: workspace.id,
    workspace_slug: workspace.slug
  };
}

function normalizeSubscription(row: WorkspaceSubscription | undefined, workspaceSlug?: string): WorkspaceSubscription[] {
  if (!row?.id || !cleanUserId(row.user_id) || !cleanProviderRef(row.provider_subscription_ref)) return [];
  const provider = normalizeProvider(row.provider);
  const status = normalizeSubscriptionStatus(row.status);
  if (!provider || !status) return [];
  return [{
    id: row.id,
    workspace_id: typeof row.workspace_id === "string" ? row.workspace_id : undefined,
    workspace_slug: workspaces.cleanWorkspaceSlug(row.workspace_slug) ?? workspaces.cleanWorkspaceSlug(workspaceSlug) ?? "",
    user_id: row.user_id,
    policy_id: cleanPolicyId(row.policy_id) ?? "paid",
    provider,
    provider_subscription_ref: row.provider_subscription_ref,
    provider_customer_ref: cleanProviderRef(row.provider_customer_ref) ?? null,
    status,
    current_period_start: normalizeIso(row.current_period_start),
    current_period_end: normalizeIso(row.current_period_end),
    grace_until: normalizeIso(row.grace_until),
    access_until: normalizeIso(row.access_until),
    cancel_at_period_end: Boolean(row.cancel_at_period_end),
    canceled_at: normalizeIso(row.canceled_at),
    checkout_url: cleanUrl(row.checkout_url),
    portal_url: cleanUrl(row.portal_url),
    created_at: normalizeIso(row.created_at) ?? new Date().toISOString(),
    updated_at: normalizeIso(row.updated_at) ?? new Date().toISOString()
  }].filter((item) => Boolean(item.workspace_slug));
}

function subscriptionSelect(): string {
  return [
    "id",
    "workspace_id",
    "workspace_slug",
    "user_id",
    "policy_id",
    "provider",
    "provider_subscription_ref",
    "provider_customer_ref",
    "status",
    "current_period_start",
    "current_period_end",
    "grace_until",
    "access_until",
    "cancel_at_period_end",
    "canceled_at",
    "checkout_url",
    "portal_url",
    "created_at",
    "updated_at"
  ].join(",");
}

function accessUntilForStatus(status: WorkspaceSubscriptionStatus, periodEnd: string, graceUntil: string, cancelAtPeriodEnd?: boolean): string {
  if (status === "active") return periodEnd;
  if (status === "past_due") return graceUntil;
  if (status === "canceled" && cancelAtPeriodEnd) return periodEnd;
  if (status === "canceled" || status === "expired" || status === "incomplete") return new Date().toISOString();
  return periodEnd;
}

function defaultPeriodEnd(policy: workspaces.WorkspaceJoinPolicy | undefined, now: string): string {
  const days = Number(policy?.config.periodDays ?? 30);
  const bounded = Number.isFinite(days) && days > 0 && days <= 366 ? Math.floor(days) : 30;
  return new Date(Date.parse(now) + bounded * 24 * 60 * 60 * 1000).toISOString();
}

function defaultGraceUntil(policy: workspaces.WorkspaceJoinPolicy | undefined, periodEnd: string): string {
  const days = Number(policy?.config.graceDays ?? process.env.WORKSPACE_SUBSCRIPTION_GRACE_DAYS ?? 3);
  const bounded = Number.isFinite(days) && days >= 0 && days <= 60 ? Math.floor(days) : 3;
  return new Date(Date.parse(periodEnd) + bounded * 24 * 60 * 60 * 1000).toISOString();
}

function subscriptionStatusFromWebhook(value: string | undefined, eventType: string): WorkspaceSubscriptionStatus {
  const clean = normalizeSubscriptionStatus(value);
  if (clean) return clean;
  if (["invoice.paid", "subscription.active", "subscription.renewed"].includes(eventType)) return "active";
  if (["invoice.payment_failed", "subscription.past_due"].includes(eventType)) return "past_due";
  if (["subscription.canceled", "customer.subscription.deleted"].includes(eventType)) return "canceled";
  if (["subscription.expired"].includes(eventType)) return "expired";
  return "active";
}

function webhookResultStatus(status: WorkspaceSubscriptionStatus, previous: WorkspaceSubscription): Extract<WorkspaceSubscriptionWebhookResult, { ok: true }>["status"] {
  if (status === "active") return previous.status === "active" ? "renewed" : "activated";
  if (status === "past_due") return "past_due";
  if (status === "canceled") return "canceled";
  if (status === "expired") return "expired";
  return "created";
}

function workspaceSubscriptionCheckoutUrl(slug: string, policyId: string, subscriptionRef: string): string {
  const base = process.env.HARNESS_CHECKOUT_BASE_URL ?? "https://superskill.sh/checkout";
  const url = new URL(base);
  url.searchParams.set("workspace", slug);
  url.searchParams.set("policy_id", policyId);
  url.searchParams.set("subscription_ref", subscriptionRef);
  return url.toString();
}

function subscriptionBelongsToWorkspace(subscription: WorkspaceSubscription, workspace: workspaces.WorkspaceRecord): boolean {
  return Boolean((workspace.id && subscription.workspace_id === workspace.id) || subscription.workspace_slug === workspace.slug);
}

function normalizeProvider(value: unknown): WorkspaceSubscriptionProvider | undefined {
  return value === undefined || value === null || value === "" || value === "manual" ? "manual" : undefined;
}

function normalizeSubscriptionStatus(value: unknown): WorkspaceSubscriptionStatus | undefined {
  return ["incomplete", "active", "past_due", "canceled", "expired"].includes(String(value)) ? value as WorkspaceSubscriptionStatus : undefined;
}

function cleanUserId(value: string | undefined | null): string | undefined {
  const clean = value?.trim();
  return clean && /^[A-Za-z0-9._:@-]{2,128}$/.test(clean) ? clean : undefined;
}

function cleanPolicyId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_.:-]{1,96}$/.test(value) ? value : undefined;
}

function cleanProviderRef(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9._:@/-]{2,180}$/.test(value.trim()) ? value.trim() : undefined;
}

function cleanEventRef(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9._:@/-]{2,220}$/.test(value.trim()) ? value.trim() : undefined;
}

function cleanEventType(value: unknown): string {
  return typeof value === "string" && /^[a-z0-9_.:-]{2,80}$/i.test(value.trim()) ? value.trim() : "subscription.updated";
}

function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function supabaseHeaders() {
  return {
    apikey: supabaseRestKey ?? "",
    authorization: `Bearer ${supabaseRestKey}`
  };
}
