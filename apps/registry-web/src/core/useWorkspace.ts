import { useState } from "react";

import { apiUrl } from "./constants";
import type { WorkspaceCatalog, WorkspaceInvite, WorkspaceMember } from "./types";

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
  workspaceInviteRole: WorkspaceMember["role"];
  setWorkspaceInviteRole: (value: WorkspaceMember["role"]) => void;
  workspaceInviteMaxUses: string;
  setWorkspaceInviteMaxUses: (value: string) => void;
  workspaceInviteCode: string;
  workspaceInviteStatus: string;
  workspaceJoinCode: string;
  setWorkspaceJoinCode: (value: string) => void;
  workspaceJoinStatus: string;
  loadWorkspace: () => Promise<void>;
  loadWorkspaceMembers: () => Promise<void>;
  createWorkspaceInvite: () => Promise<void>;
  joinWorkspace: () => Promise<void>;
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
  const [workspaceInviteRole, setWorkspaceInviteRoleState] = useState<WorkspaceMember["role"]>("member");
  const [workspaceInviteMaxUses, setWorkspaceInviteMaxUses] = useState("1");
  const [workspaceInviteCode, setWorkspaceInviteCode] = useState("");
  const [workspaceInviteStatus, setWorkspaceInviteStatus] = useState("");
  const [workspaceJoinCode, setWorkspaceJoinCode] = useState("");
  const [workspaceJoinStatus, setWorkspaceJoinStatus] = useState("");

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
      setWorkspaceSlug(catalog.workspace.slug);
      localStorage.setItem("hh:workspaceSlug", catalog.workspace.slug);
      await loadWorkspaceMembersFor(catalog.workspace.slug);
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

  function setWorkspaceInviteRole(value: WorkspaceMember["role"]) {
    setWorkspaceInviteRoleState(MEMBER_ROLES.includes(value) ? value : "member");
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
    workspaceInviteRole,
    setWorkspaceInviteRole,
    workspaceInviteMaxUses,
    setWorkspaceInviteMaxUses,
    workspaceInviteCode,
    workspaceInviteStatus,
    workspaceJoinCode,
    setWorkspaceJoinCode,
    workspaceJoinStatus,
    loadWorkspace,
    loadWorkspaceMembers,
    createWorkspaceInvite,
    joinWorkspace,
    workspaceHeadersForOwner
  };
}

function cleanSlug(value: string): string {
  return value.replace(/^@/, "").trim().toLowerCase();
}
