import { useState } from "react";

import { apiUrl } from "./constants";
import type { WorkspaceCatalog } from "./types";

export type UseWorkspaceOptions = {
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
  loadWorkspace: () => Promise<void>;
  workspaceHeadersForOwner: (owner: string) => Record<string, string>;
};

export function useWorkspace(_opts: UseWorkspaceOptions = {}): UseWorkspaceResult {
  const [workspaceSlug, setWorkspaceSlug] = useState(() => localStorage.getItem("hh:workspaceSlug") ?? "acme");
  const [workspaceToken, setWorkspaceToken] = useState("");
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceCatalog, setWorkspaceCatalog] = useState<WorkspaceCatalog | undefined>();

  function workspaceHeadersForOwner(owner: string): Record<string, string> {
    const slug = owner.startsWith("@") ? owner.slice(1) : "";
    if (!slug || slug !== workspaceSlug.replace(/^@/, "").trim().toLowerCase() || !workspaceToken) return {};
    return { Authorization: `Bearer ${workspaceToken}` };
  }

  async function loadWorkspace() {
    const slug = workspaceSlug.replace(/^@/, "").trim().toLowerCase();
    if (!slug) return;
    setWorkspaceBusy(true);
    setWorkspaceStatus("");
    try {
      const response = await fetch(`${apiUrl}/workspaces/${encodeURIComponent(slug)}/workspace`, {
        headers: workspaceToken ? { Authorization: `Bearer ${workspaceToken}` } : {}
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
      const catalog = data as WorkspaceCatalog;
      setWorkspaceCatalog(catalog);
      setWorkspaceSlug(catalog.workspace.slug);
      localStorage.setItem("hh:workspaceSlug", catalog.workspace.slug);
      setWorkspaceStatus(`Loaded ${catalog.resources.length} workspace resources · ${catalog.audit.length} audit rows`);
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Workspace failed");
    } finally {
      setWorkspaceBusy(false);
    }
  }

  return {
    workspaceSlug,
    setWorkspaceSlug,
    workspaceToken,
    setWorkspaceToken,
    workspaceStatus,
    workspaceBusy,
    workspaceCatalog,
    loadWorkspace,
    workspaceHeadersForOwner
  };
}
