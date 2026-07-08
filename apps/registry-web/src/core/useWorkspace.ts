import { useState } from "react";

import { apiUrl } from "./constants";
import type { WorkspaceCatalog, WorkspaceInvite, WorkspaceJoinPolicy, WorkspaceMember, WorkspaceSubscription } from "./types";

export type UseWorkspaceOptions = {
  accessToken?: string;
  requireUser?: (note: string) => boolean;
  onFlash?: (msg: string) => void;
};

export type UseWorkspaceResult = {
  workspaceSlug: string;
  setWorkspaceSlug: (value: string) => void;
  workspaceToken: string;
  setWorkspaceToken: (value: string) => void;
  workspaceStatus: string;
  workspaceBusy: boolean;
  workspaceCatalog: WorkspaceCatalog | undefined;
  workspaceMembers: WorkspaceMember[];
  workspaceJoinPolicies: WorkspaceJoinPolicy[];
  workspaceInviteRole: WorkspaceMember["role"];
  setWorkspaceInviteRole: (value: WorkspaceMember["role"]) => void;
  workspaceInviteMaxUses: string;
  setWorkspaceInviteMaxUses: (value: string) => void;
  workspaceInviteCode: string;
  workspaceInviteStatus: string;
  workspaceJoinCode: string;
  setWorkspaceJoinCode: (value: string) => void;
  workspaceJoinStatus: string;
  workspaceGateSource: "telegram" | "discord" | "entitlement";
  setWorkspaceGateSource: (value: "telegram" | "discord" | "entitlement") => void;
  workspaceGateCode: string;
  setWorkspaceGateCode: (value: string) => void;
  workspaceGateStatus: string;
  workspaceSubscriptions: WorkspaceSubscription[];
  workspaceSubscriptionPolicyId: string;
  setWorkspaceSubscriptionPolicyId: (value: string) => void;
  workspaceSubscriptionStatus: string;
  workspaceCollectionSlug: string;
  setWorkspaceCollectionSlug: (value: string) => void;
  workspaceApprovalResourceId: string;
  setWorkspaceApprovalResourceId: (value: string) => void;
  workspaceApprovalName: string;
  setWorkspaceApprovalName: (value: string) => void;
  workspaceApprovalNote: string;
  setWorkspaceApprovalNote: (value: string) => void;
  workspaceCollectionStatus: string;
  loadWorkspace: () => Promise<void>;
  loadWorkspaceMembers: () => Promise<void>;
  loadWorkspaceJoinPolicies: () => Promise<void>;
  createWorkspaceInvite: () => Promise<void>;
  joinWorkspace: () => Promise<void>;
  createWorkspaceJoinCode: () => Promise<void>;
  grantWorkspaceJoinCode: () => Promise<void>;
  createWorkspaceSubscriptionCheckout: () => Promise<void>;
  loadWorkspaceSubscriptions: () => Promise<void>;
  approveWorkspaceResource: () => Promise<void>;
  removeWorkspaceCollectionItem: (collectionSlug: string, itemId: string) => Promise<void>;
  workspaceHeadersForOwner: (owner: string) => Record<string, string>;
};

const MEMBER_ROLES: WorkspaceMember["role"][] = ["owner", "admin", "moderator", "publisher", "member", "viewer"];

export function useWorkspace(opts: UseWorkspaceOptions = {}): UseWorkspaceResult {
  const [workspaceSlug, setWorkspaceSlug] = useState(() => localStorage.getItem("hh:workspaceSlug") ?? "acme");
  const [workspaceToken, setWorkspaceToken] = useState("");
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceCatalog, setWorkspaceCatalog] = useState<WorkspaceCatalog | undefined>();
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [workspaceJoinPolicies, setWorkspaceJoinPolicies] = useState<WorkspaceJoinPolicy[]>([]);
  const [workspaceInviteRole, setWorkspaceInviteRoleState] = useState<WorkspaceMember["role"]>("member");
  const [workspaceInviteMaxUses, setWorkspaceInviteMaxUses] = useState("1");
  const [workspaceInviteCode, setWorkspaceInviteCode] = useState("");
  const [workspaceInviteStatus, setWorkspaceInviteStatus] = useState("");
  const [workspaceJoinCode, setWorkspaceJoinCode] = useState("");
  const [workspaceJoinStatus, setWorkspaceJoinStatus] = useState("");
  const [workspaceGateSource, setWorkspaceGateSourceState] = useState<"telegram" | "discord" | "entitlement">("telegram");
  const [workspaceGateCode, setWorkspaceGateCode] = useState("");
  const [workspaceGateStatus, setWorkspaceGateStatus] = useState("");
  const [workspaceSubscriptions, setWorkspaceSubscriptions] = useState<WorkspaceSubscription[]>([]);
  const [workspaceSubscriptionPolicyId, setWorkspaceSubscriptionPolicyId] = useState("");
  const [workspaceSubscriptionStatus, setWorkspaceSubscriptionStatus] = useState("");
  const [workspaceCollectionSlug, setWorkspaceCollectionSlug] = useState("approved");
  const [workspaceApprovalResourceId, setWorkspaceApprovalResourceId] = useState("");
  const [workspaceApprovalName, setWorkspaceApprovalName] = useState("");
  const [workspaceApprovalNote, setWorkspaceApprovalNote] = useState("");
  const [workspaceCollectionStatus, setWorkspaceCollectionStatus] = useState("");

  function workspaceHeadersForOwner(owner: string): Record<string, string> {
    const slug = owner.startsWith("@") ? owner.slice(1) : "";
    if (!slug || slug !== cleanSlug(workspaceSlug)) return {};
    return authHeaders();
  }

  async function loadWorkspace() {
    const slug = cleanSlug(workspaceSlug);
    if (!slug) return;
    setWorkspaceBusy(true);
    setWorkspaceStatus("");
    try {
      const response = await fetch(`${apiUrl}/workspaces/${encodeURIComponent(slug)}/workspace`, {
        headers: authHeaders()
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
      const catalog = data as WorkspaceCatalog;
      setWorkspaceCatalog(catalog);
      setWorkspaceJoinPolicies(catalog.joinPolicies ?? []);
      setWorkspaceSlug(catalog.workspace.slug);
      localStorage.setItem("hh:workspaceSlug", catalog.workspace.slug);
      await loadWorkspaceMembersFor(catalog.workspace.slug);
      if (opts.accessToken) await loadWorkspaceSubscriptionsFor(catalog.workspace.slug).catch(() => []);
      setWorkspaceStatus(`Loaded ${catalog.resources.length} workspace resources · ${catalog.audit.length} audit rows`);
      opts.onFlash?.(`Loaded @${catalog.workspace.slug}`);
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Workspace failed");
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function loadWorkspaceMembers() {
    await loadWorkspaceMembersFor(cleanSlug(workspaceSlug));
  }

  async function loadWorkspaceJoinPolicies() {
    await loadWorkspaceJoinPoliciesFor(cleanSlug(workspaceSlug));
  }

  async function loadWorkspaceSubscriptions() {
    const slug = cleanSlug(workspaceCatalog?.workspace.slug ?? workspaceSlug);
    if (!slug) return;
    if (!opts.accessToken && !opts.requireUser?.("Log on to read your workspace subscription receipts.")) return;
    setWorkspaceBusy(true);
    setWorkspaceSubscriptionStatus("");
    try {
      const subscriptions = await loadWorkspaceSubscriptionsFor(slug);
      setWorkspaceSubscriptionStatus(`Loaded ${subscriptions.length} subscription receipt${subscriptions.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setWorkspaceSubscriptionStatus(error instanceof Error ? error.message : "Subscription receipts failed");
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function createWorkspaceInvite() {
    const slug = cleanSlug(workspaceCatalog?.workspace.slug ?? workspaceSlug);
    if (!slug) return;
    if (!workspaceToken && !opts.accessToken && !opts.requireUser?.("Log on as a workspace admin or paste a workspace token to create an invite.")) return;
    setWorkspaceBusy(true);
    setWorkspaceInviteCode("");
    setWorkspaceInviteStatus("");
    try {
      const maxUses = Number(workspaceInviteMaxUses);
      const response = await fetch(`${apiUrl}/workspaces/${encodeURIComponent(slug)}/invites`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          role: workspaceInviteRole,
          maxUses: Number.isInteger(maxUses) && maxUses > 0 ? maxUses : null,
          expiresInSeconds: 60 * 60 * 24 * 7
        })
      });
      const data = await response.json().catch(() => ({})) as { error?: string; code?: string; invite?: WorkspaceInvite };
      if (!response.ok) throw new Error(data.error ?? `Invite failed (${response.status})`);
      if (!data.code) throw new Error("Invite created without a code.");
      setWorkspaceInviteCode(data.code);
      setWorkspaceInviteStatus(`Invite created for ${data.invite?.role ?? workspaceInviteRole}. Show this code once.`);
      opts.onFlash?.("Workspace invite created");
    } catch (error) {
      setWorkspaceInviteStatus(error instanceof Error ? error.message : "Invite failed");
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function joinWorkspace() {
    const slug = cleanSlug(workspaceSlug);
    const code = workspaceJoinCode.trim();
    if (!slug || !code) return setWorkspaceJoinStatus("Workspace slug and invite code are required.");
    if (!opts.accessToken && !opts.requireUser?.("Log on before joining a workspace with an invite code.")) return;
    setWorkspaceBusy(true);
    setWorkspaceJoinStatus("");
    try {
      const response = await fetch(`${apiUrl}/workspaces/${encodeURIComponent(slug)}/join`, {
        method: "POST",
        headers: { ...sessionHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ code })
      });
      const data = await response.json().catch(() => ({})) as { error?: string; member?: WorkspaceMember };
      if (!response.ok) throw new Error(data.error ?? `Join failed (${response.status})`);
      setWorkspaceJoinCode("");
      setWorkspaceJoinStatus(`Joined as ${data.member?.role ?? "member"}.`);
      opts.onFlash?.(`Joined @${slug}`);
      await loadWorkspace();
    } catch (error) {
      setWorkspaceJoinStatus(error instanceof Error ? error.message : "Join failed");
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function createWorkspaceJoinCode() {
    const slug = cleanSlug(workspaceCatalog?.workspace.slug ?? workspaceSlug);
    if (!slug) return;
    if (!opts.accessToken && !opts.requireUser?.("Log on before creating a workspace gate code.")) return;
    setWorkspaceBusy(true);
    setWorkspaceGateStatus("");
    setWorkspaceGateCode("");
    try {
      const response = await fetch(`${apiUrl}/workspaces/${encodeURIComponent(slug)}/join-code`, {
        method: "POST",
        headers: { ...sessionHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ source: workspaceGateSource })
      });
      const data = await response.json().catch(() => ({})) as { error?: string; code?: string; source?: string };
      if (!response.ok) throw new Error(data.error ?? `Gate code failed (${response.status})`);
      if (!data.code) throw new Error("Gate code response did not include a code.");
      setWorkspaceGateCode(data.code);
      setWorkspaceGateStatus(`Gate code created for ${data.source ?? workspaceGateSource}.`);
      opts.onFlash?.("Workspace gate code created");
    } catch (error) {
      setWorkspaceGateStatus(error instanceof Error ? error.message : "Gate code failed");
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function grantWorkspaceJoinCode() {
    const slug = cleanSlug(workspaceCatalog?.workspace.slug ?? workspaceSlug);
    const code = workspaceGateCode.trim();
    if (!slug || !code) return setWorkspaceGateStatus("Workspace slug and gate code are required.");
    if (!workspaceToken && !opts.accessToken && !opts.requireUser?.("Log on as a workspace admin or paste a gate token to grant membership.")) return;
    setWorkspaceBusy(true);
    setWorkspaceGateStatus("");
    try {
      const response = await fetch(`${apiUrl}/workspaces/${encodeURIComponent(slug)}/join-grants`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ code, source: workspaceGateSource })
      });
      const data = await response.json().catch(() => ({})) as { error?: string; member?: WorkspaceMember };
      if (!response.ok) throw new Error(data.error ?? `Grant failed (${response.status})`);
      setWorkspaceGateStatus(`Granted ${data.member?.source ?? workspaceGateSource} membership as ${data.member?.role ?? "member"}.`);
      opts.onFlash?.("Workspace gate membership granted");
      await loadWorkspaceMembersFor(slug);
    } catch (error) {
      setWorkspaceGateStatus(error instanceof Error ? error.message : "Grant failed");
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function createWorkspaceSubscriptionCheckout() {
    const slug = cleanSlug(workspaceCatalog?.workspace.slug ?? workspaceSlug);
    const policyId = workspaceSubscriptionPolicyId.trim()
      || workspaceJoinPolicies.find((policy) => policy.kind === "paid_subscription" && policy.status === "active")?.id
      || "";
    if (!slug || !policyId) return setWorkspaceSubscriptionStatus("Workspace and active paid subscription policy are required.");
    if (!opts.accessToken && !opts.requireUser?.("Log on before starting a workspace subscription checkout.")) return;
    setWorkspaceBusy(true);
    setWorkspaceSubscriptionStatus("");
    try {
      const response = await fetch(`${apiUrl}/workspaces/${encodeURIComponent(slug)}/subscriptions/checkout`, {
        method: "POST",
        headers: { ...sessionHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ policyId })
      });
      const data = await response.json().catch(() => ({})) as {
        error?: string;
        policy?: WorkspaceJoinPolicy;
        subscription?: WorkspaceSubscription;
        checkout_url?: string;
        next?: string;
      };
      if (!response.ok) throw new Error(data.error ?? `Subscription checkout failed (${response.status})`);
      if (!data.subscription) throw new Error("Subscription checkout response did not include a receipt.");
      setWorkspaceSubscriptionPolicyId(data.policy?.id ?? data.subscription.policyId);
      setWorkspaceSubscriptions((current) => upsertSubscription(current, data.subscription as WorkspaceSubscription));
      setWorkspaceSubscriptionStatus(`Checkout created. Access starts only after provider webhook confirms payment.${data.checkout_url ? ` Open: ${data.checkout_url}` : ""}`);
      opts.onFlash?.("Workspace subscription checkout created");
    } catch (error) {
      setWorkspaceSubscriptionStatus(error instanceof Error ? error.message : "Subscription checkout failed");
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function approveWorkspaceResource() {
    const slug = cleanSlug(workspaceCatalog?.workspace.slug ?? workspaceSlug);
    const collection = cleanCollectionSlug(workspaceCollectionSlug);
    const resourceId = workspaceApprovalResourceId.trim();
    if (!slug || !collection || !resourceId) return setWorkspaceCollectionStatus("Workspace, collection and public resource ID are required.");
    if (!workspaceToken && !opts.accessToken && !opts.requireUser?.("Log on as a workspace admin or paste a workspace token to approve resources.")) return;
    setWorkspaceBusy(true);
    setWorkspaceCollectionStatus("");
    try {
      const response = await fetch(`${apiUrl}/workspaces/${encodeURIComponent(slug)}/collections/${encodeURIComponent(collection)}/items`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          resourceId,
          name: workspaceApprovalName.trim() || undefined,
          note: workspaceApprovalNote.trim() || undefined
        })
      });
      const data = await response.json().catch(() => ({})) as { error?: string; resource?: { id?: string }; approvalState?: string };
      if (!response.ok) throw new Error(data.error ?? `Approval failed (${response.status})`);
      setWorkspaceApprovalResourceId("");
      setWorkspaceApprovalName("");
      setWorkspaceApprovalNote("");
      setWorkspaceCollectionStatus(`Approved ${data.resource?.id ?? resourceId} as ${data.approvalState ?? "workspace curation"}.`);
      opts.onFlash?.("Workspace resource approved");
      await loadWorkspace();
    } catch (error) {
      setWorkspaceCollectionStatus(error instanceof Error ? error.message : "Approval failed");
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function removeWorkspaceCollectionItem(collectionSlug: string, itemId: string) {
    const slug = cleanSlug(workspaceCatalog?.workspace.slug ?? workspaceSlug);
    const collection = cleanCollectionSlug(collectionSlug);
    if (!slug || !collection || !itemId) return setWorkspaceCollectionStatus("Workspace collection item is required.");
    if (!workspaceToken && !opts.accessToken && !opts.requireUser?.("Log on as a workspace admin or paste a workspace token to remove approved resources.")) return;
    setWorkspaceBusy(true);
    setWorkspaceCollectionStatus("");
    try {
      const response = await fetch(`${apiUrl}/workspaces/${encodeURIComponent(slug)}/collections/${encodeURIComponent(collection)}/items/${encodeURIComponent(itemId)}`, {
        method: "DELETE",
        headers: authHeaders()
      });
      const data = await response.json().catch(() => ({})) as { error?: string; item?: { itemRef?: string }; removedResourceId?: string };
      if (!response.ok) throw new Error(data.error ?? `Remove failed (${response.status})`);
      setWorkspaceCollectionStatus(`Removed ${data.item?.itemRef ?? itemId}${data.removedResourceId ? ` and ${data.removedResourceId}` : ""}.`);
      opts.onFlash?.("Workspace collection item removed");
      await loadWorkspace();
    } catch (error) {
      setWorkspaceCollectionStatus(error instanceof Error ? error.message : "Remove failed");
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function loadWorkspaceMembersFor(slug: string) {
    if (!slug) return;
    const response = await fetch(`${apiUrl}/workspaces/${encodeURIComponent(slug)}/members`, {
      headers: authHeaders()
    });
    const data = await response.json().catch(() => ({})) as { members?: WorkspaceMember[] };
    if (response.ok) {
      setWorkspaceMembers(data.members ?? []);
      return;
    }
    setWorkspaceMembers([]);
  }

  async function loadWorkspaceJoinPoliciesFor(slug: string) {
    if (!slug) return;
    const response = await fetch(`${apiUrl}/workspaces/${encodeURIComponent(slug)}/join-policies`, {
      headers: authHeaders()
    });
    const data = await response.json().catch(() => ({})) as { policies?: WorkspaceJoinPolicy[] };
    if (response.ok) {
      setWorkspaceJoinPolicies(data.policies ?? []);
      return;
    }
    setWorkspaceJoinPolicies([]);
  }

  async function loadWorkspaceSubscriptionsFor(slug: string): Promise<WorkspaceSubscription[]> {
    if (!slug || !opts.accessToken) return [];
    const response = await fetch(`${apiUrl}/workspaces/${encodeURIComponent(slug)}/subscriptions/me`, {
      headers: sessionHeaders()
    });
    const data = await response.json().catch(() => ({})) as { error?: string; subscriptions?: WorkspaceSubscription[] };
    if (!response.ok) {
      setWorkspaceSubscriptions([]);
      throw new Error(data.error ?? `Subscription receipts failed (${response.status})`);
    }
    const subscriptions = data.subscriptions ?? [];
    setWorkspaceSubscriptions(subscriptions);
    return subscriptions;
  }

  function setWorkspaceInviteRole(value: WorkspaceMember["role"]) {
    setWorkspaceInviteRoleState(MEMBER_ROLES.includes(value) ? value : "member");
  }

  function setWorkspaceGateSource(value: "telegram" | "discord" | "entitlement") {
    setWorkspaceGateSourceState(["telegram", "discord", "entitlement"].includes(value) ? value : "telegram");
  }

  function authHeaders(): Record<string, string> {
    return workspaceToken ? { Authorization: `Bearer ${workspaceToken}` } : sessionHeaders();
  }

  function sessionHeaders(): Record<string, string> {
    return opts.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : {};
  }

  return {
    workspaceSlug,
    setWorkspaceSlug,
    workspaceToken,
    setWorkspaceToken,
    workspaceStatus,
    workspaceBusy,
    workspaceCatalog,
    workspaceMembers,
    workspaceJoinPolicies,
    workspaceInviteRole,
    setWorkspaceInviteRole,
    workspaceInviteMaxUses,
    setWorkspaceInviteMaxUses,
    workspaceInviteCode,
    workspaceInviteStatus,
    workspaceJoinCode,
    setWorkspaceJoinCode,
    workspaceJoinStatus,
    workspaceGateSource,
    setWorkspaceGateSource,
    workspaceGateCode,
    setWorkspaceGateCode,
    workspaceGateStatus,
    workspaceSubscriptions,
    workspaceSubscriptionPolicyId,
    setWorkspaceSubscriptionPolicyId,
    workspaceSubscriptionStatus,
    workspaceCollectionSlug,
    setWorkspaceCollectionSlug,
    workspaceApprovalResourceId,
    setWorkspaceApprovalResourceId,
    workspaceApprovalName,
    setWorkspaceApprovalName,
    workspaceApprovalNote,
    setWorkspaceApprovalNote,
    workspaceCollectionStatus,
    loadWorkspace,
    loadWorkspaceMembers,
    loadWorkspaceJoinPolicies,
    createWorkspaceInvite,
    joinWorkspace,
    createWorkspaceJoinCode,
    grantWorkspaceJoinCode,
    createWorkspaceSubscriptionCheckout,
    loadWorkspaceSubscriptions,
    approveWorkspaceResource,
    removeWorkspaceCollectionItem,
    workspaceHeadersForOwner
  };
}

function upsertSubscription(current: WorkspaceSubscription[], next: WorkspaceSubscription): WorkspaceSubscription[] {
  const withoutCurrent = current.filter((subscription) => subscription.id !== next.id);
  return [next, ...withoutCurrent].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function cleanSlug(value: string): string {
  return value.replace(/^@/, "").trim().toLowerCase();
}

function cleanCollectionSlug(value: string): string {
  return value.toLowerCase().trim().replace(/^@/, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "approved";
}
